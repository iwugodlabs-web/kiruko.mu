"""Route-level smoke for the field-sales commission HTTP layer.

The phase0/phase2 suites deliberately drive the service/CRUD layer directly
(their own docstring: "the HTTP layer is a thin wrapper"). This test exercises
the *actual* `api/v1/commissions.py` endpoints over HTTP — the layer the web
admin and mobile client call — for the core loop:

    product -> sale -> plan+rule -> assignment -> run -> approve -> push

It asserts via the DB (one-off allowance) so it does not depend on the exact
response-schema shape. On-payroll rep only (Phase 0 scope).
"""

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import text

from core.model import (
    Company,
    EmployeeOneOffAllowance,
    PrivateUser,
    ProductVariant,
    Sale,
    User,
)
from services import commission_service as engine


@pytest.fixture()
def rep_company(db):
    """A MU company + owner (admin) + one on-payroll rep. Committed so the
    route's request session sees it; field-sales rows cleaned on teardown."""
    sfx = uuid.uuid4().hex[:8]
    owner = User(
        user_type="company", email=f"rt-owner-{sfx}@kontokazdemo.com",
        user_name=f"rt-owner-{sfx}", password_hash="x",
    )
    db.add(owner)
    db.flush()
    company = Company(
        user_id=owner.user_id, company_name=f"RT Co {sfx}",
        email=f"rt-co-{sfx}@kontokazdemo.com", brn=f"RT_BRN_{sfx}", country_code="MU",
    )
    db.add(company)
    db.flush()
    u = User(
        user_type="private", email=f"rt-rep-{sfx}@kontokazdemo.com",
        user_name=f"rt-rep-{sfx}", password_hash="x",
    )
    db.add(u)
    db.flush()
    rep = PrivateUser(
        user_id=u.user_id, first_name="Rahul", last_name="Rep",
        company_id=company.company_id, pass_port_number=f"RT_REP_{sfx}", role="employee",
    )
    db.add(rep)
    db.flush()

    # A second rank-and-file rep, to prove a rep cannot act on another's sales.
    u2 = User(
        user_type="private", email=f"rt-rep2-{sfx}@kontokazdemo.com",
        user_name=f"rt-rep2-{sfx}", password_hash="x",
    )
    db.add(u2)
    db.flush()
    rep2 = PrivateUser(
        user_id=u2.user_id, first_name="Sunil", last_name="Rep2",
        company_id=company.company_id, pass_port_number=f"RT_REP2_{sfx}", role="employee",
    )
    db.add(rep2)
    db.flush()

    # The field_sales paid module is OFF by default — enable it so the routes
    # (which correctly gate on the entitlement) are reachable.
    from core.modules import set_company_module
    set_company_module(
        db, company_id=company.company_id, module_key="field_sales",
        enabled=True, actor_user_id=owner.user_id,
    )
    db.commit()

    yield company, rep, u, rep2, owner

    db.rollback()
    for stmt in [
        "DELETE FROM commission_payables",
        "DELETE FROM commission_line_items",
        "DELETE FROM commission_runs",
        "DELETE FROM commission_plan_assignments",
        "DELETE FROM commission_rules",
        "DELETE FROM commission_plans",
        "DELETE FROM sales_return_lines",
        "DELETE FROM sales_returns",
        "DELETE FROM sale_lines",
        "DELETE FROM sales",
        "DELETE FROM product_variants",
        "DELETE FROM products",
        "DELETE FROM employee_one_off_allowances",
        f"DELETE FROM company_modules WHERE company_id = {company.company_id}",
    ]:
        db.execute(text(stmt))
    db.commit()


def _client(db, current_user_id: int):
    from core import config as core_config
    from core.dependencies import get_current_user
    from main import app
    from fastapi.testclient import TestClient

    def _override_db():
        yield db

    def _override_user():
        return db.query(User).filter(User.user_id == current_user_id).one()

    app.dependency_overrides[core_config.get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_user
    return TestClient(app, raise_server_exceptions=False)


def _ok(resp):
    assert resp.status_code in (200, 201), f"{resp.status_code}: {resp.text}"
    return resp


def test_core_loop_over_http(db, rep_company):
    company, rep, _rep_user, _rep2, owner = rep_company
    cid = company.company_id
    client = _client(db, owner.user_id)
    try:
        base = f"/api/v1/companies/{cid}"

        # 1. product + default variant @ 100.00
        r = _ok(client.post(f"{base}/products", json={
            "name": "Coca-Cola", "category": "Beverages",
            "default_variant": {"sku": "CC-500", "unit_price": "100.00"},
        }))
        variant_id = r.json()["variants"][0]["id"]

        # 2. sale of 24 units (admin-entered → auto-approved)
        _ok(client.post(f"{base}/sales", json={
            "rep_private_user_id": rep.private_user_id,
            "sold_at": "2026-05-10T09:00:00+00:00",
            "lines": [{"variant_id": variant_id, "quantity": "24"}],
        }))

        # 3. plan + 3% flat rule scoped to Beverages
        r = _ok(client.post(f"{base}/commission-plans", json={
            "name": "Field Rep 3%", "trigger": "on_sale",
            "rules": [{
                "rule_type": "flat_percent", "params": {"percent": "3.00"},
                "scope_category": "Beverages",
            }],
        }))
        plan_id = r.json()["id"]

        # 4. assign the plan to the rep
        _ok(client.post(f"{base}/commission-plans/{plan_id}/assignments", json={
            "private_user_id": rep.private_user_id, "effective_from": "2026-01-01",
        }))

        # 5. compute the run for May 2026
        r = _ok(client.post(f"{base}/commission-runs", json={
            "period_start": "2026-05-01", "period_end": "2026-05-31",
        }))
        run_id = r.json()["id"]

        # 6. approve, then 7. push to payroll
        _ok(client.post(f"{base}/commission-runs/{run_id}/approve", json={}))
        push = _ok(client.post(f"{base}/commission-runs/{run_id}/push-to-payroll", json={})).json()
        assert len(push.get("settled", [])) == 1, push

        # DB truth: the push wrote a taxable COMMISSION one-off of 24*100*3% = 72.00
        one_off = (
            db.query(EmployeeOneOffAllowance)
            .filter(EmployeeOneOffAllowance.private_user_id == rep.private_user_id)
            .one()
        )
        assert Decimal(one_off.amount) == Decimal("72.00")
        comp = one_off.component
        assert comp.code == engine.COMMISSION_COMPONENT_CODE
        assert comp.is_taxable is True
    finally:
        from main import app
        app.dependency_overrides.clear()


def test_plan_versioning_over_http(db, rep_company):
    """Step A over the actual HTTP layer: create → revise (draft) → versions →
    activate (explicit date and no body) → archive, plus the per-family list."""
    company, rep, _rep_user, _rep2, owner = rep_company
    cid = company.company_id
    client = _client(db, owner.user_id)
    try:
        base = f"/api/v1/companies/{cid}"

        r = _ok(client.post(f"{base}/commission-plans", json={
            "name": "Versioned 3%", "trigger": "on_sale",
            "rules": [{"rule_type": "flat_percent", "params": {"percent": "3.00"}}],
        }))
        plan = r.json()
        assert plan["version"] == 1 and plan["family_id"] == plan["id"]
        assert plan["status"] == "active"
        pid = plan["id"]

        # revise (no name) → a draft clone that inherits the family name
        r = _ok(client.put(f"{base}/commission-plans/{pid}", json={
            "rules": [{"rule_type": "flat_percent", "params": {"percent": "6.00"}}],
        }))
        draft = r.json()
        assert draft["version"] == 2 and draft["status"] == "draft"
        assert draft["family_id"] == pid and draft["name"] == "Versioned 3%"

        r = _ok(client.get(f"{base}/commission-plans/{pid}/versions"))
        assert [v["version"] for v in r.json()] == [2, 1]

        # activate with an explicit effective date
        r = _ok(client.post(f"{base}/commission-plans/{draft['id']}/activate",
                            json={"effective_from": "2026-05-16"}))
        activated = r.json()
        assert activated["status"] == "active"
        assert activated["effective_from"] == "2026-05-16"

        # listing collapses to one row per family (the effective version)
        r = _ok(client.get(f"{base}/commission-plans"))
        listed = [p for p in r.json() if p["family_id"] == pid]
        assert len(listed) == 1 and listed[0]["version"] == 2

        # a second revise, activated with an EMPTY body (defaults to today)
        r = _ok(client.put(f"{base}/commission-plans/{pid}", json={
            "rules": [{"rule_type": "flat_percent", "params": {"percent": "9.00"}}],
        }))
        draft2 = r.json()
        r = _ok(client.post(f"{base}/commission-plans/{draft2['id']}/activate"))
        assert r.json()["status"] == "active" and r.json()["effective_from"] is not None

        # archive removes the family from the default list
        _ok(client.post(f"{base}/commission-plans/{pid}/archive"))
        r = _ok(client.get(f"{base}/commission-plans"))
        assert [p for p in r.json() if p["family_id"] == pid] == []
    finally:
        from main import app
        app.dependency_overrides.clear()


def _make_variant(db, cid, owner_user_id) -> int:
    """Create a product+variant via the admin HTTP path; return its variant id."""
    admin = _client(db, owner_user_id)
    try:
        r = _ok(admin.post(f"/api/v1/companies/{cid}/products", json={
            "name": "Spring Water", "category": "Beverages",
            "default_variant": {"sku": "W-1L", "unit_price": "50.00"},
        }))
        return r.json()["variants"][0]["id"]
    finally:
        from main import app
        app.dependency_overrides.clear()


def test_rep_cannot_sync_another_reps_sale(db, rep_company):
    """Authorization boundary: a rank-and-file rep must not attribute a synced
    sale to a different rep — the HTTP layer must 403."""
    company, rep, rep_user, rep2, owner = rep_company
    cid = company.company_id
    variant_id = _make_variant(db, cid, owner.user_id)

    rep_client = _client(db, rep_user.user_id)
    try:
        r = rep_client.post(f"/api/v1/companies/{cid}/sales/sync", json={"items": [{
            "client_uuid": "cuid-cross-rep-0001",
            "rep_private_user_id": rep2.private_user_id,   # NOT the caller
            "sold_at": "2026-05-11T09:00:00+00:00",
            "lines": [{"variant_id": variant_id, "quantity": "2"}],
        }]})
        assert r.status_code == 403, f"{r.status_code}: {r.text}"
        assert "their own sales" in r.text
    finally:
        from main import app
        app.dependency_overrides.clear()

    # And nothing was written for either rep.
    assert db.query(Sale).filter(Sale.company_id == cid).count() == 0


def test_rep_syncs_own_sale_idempotent(db, rep_company):
    """Happy-path offline sync by a rep for their own sale, and idempotency:
    the same client_uuid flushed twice yields one sale, not two."""
    company, rep, rep_user, rep2, owner = rep_company
    cid = company.company_id
    variant_id = _make_variant(db, cid, owner.user_id)

    rep_client = _client(db, rep_user.user_id)
    item = {
        "client_uuid": "cuid-own-sale-0001",
        "rep_private_user_id": rep.private_user_id,        # the caller
        "sold_at": "2026-05-12T09:00:00+00:00",
        "lines": [{"variant_id": variant_id, "quantity": "3"}],
    }
    try:
        res1 = _ok(rep_client.post(f"/api/v1/companies/{cid}/sales/sync",
                                   json={"items": [item]})).json()
        assert res1["accepted"] == 1 and res1["errors"] == 0, res1

        # Retry the identical batch → recognised as a duplicate, no new sale.
        res2 = _ok(rep_client.post(f"/api/v1/companies/{cid}/sales/sync",
                                   json={"items": [item]})).json()
        assert res2["duplicates"] == 1, res2
    finally:
        from main import app
        app.dependency_overrides.clear()

    sales = (
        db.query(Sale)
        .filter(Sale.company_id == cid, Sale.rep_private_user_id == rep.private_user_id)
        .all()
    )
    assert len(sales) == 1


def test_sales_view_scoping_rep_manager_admin(db, rep_company):
    """Reads are scoped: admin → all, manager → self + direct reports,
    plain rep → own only."""
    company, rep, rep_user, rep2, owner = rep_company
    cid = company.company_id

    # rep manages rep2; a third rep is on nobody's team.
    rep2.manager_private_user_id = rep.private_user_id
    sfx = uuid.uuid4().hex[:8]
    u3 = User(user_type="private", email=f"rt-rep3-{sfx}@kontokazdemo.com",
              user_name=f"rt-rep3-{sfx}", password_hash="x")
    db.add(u3)
    db.flush()
    rep3 = PrivateUser(user_id=u3.user_id, first_name="Asha", last_name="Rep3",
                       company_id=cid, pass_port_number=f"RT_REP3_{sfx}", role="employee")
    db.add(rep3)
    db.flush()
    db.commit()

    variant_id = _make_variant(db, cid, owner.user_id)

    # Admin books one sale for each of the three reps.
    admin = _client(db, owner.user_id)
    try:
        for who in (rep.private_user_id, rep2.private_user_id, rep3.private_user_id):
            _ok(admin.post(f"/api/v1/companies/{cid}/sales", json={
                "rep_private_user_id": who,
                "sold_at": "2026-05-10T09:00:00+00:00",
                "lines": [{"variant_id": variant_id, "quantity": "1"}],
            }))
        assert len(_ok(admin.get(f"/api/v1/companies/{cid}/sales")).json()) == 3
    finally:
        from main import app
        app.dependency_overrides.clear()

    # Manager (rep) sees self + direct report (rep2) — NOT rep3.
    mgr = _client(db, rep_user.user_id)
    try:
        assert len(_ok(mgr.get(f"/api/v1/companies/{cid}/sales")).json()) == 2
    finally:
        from main import app
        app.dependency_overrides.clear()

    # Plain rep (rep2, no reports) sees only their own.
    rep2_client = _client(db, rep2.user_id)
    try:
        assert len(_ok(rep2_client.get(f"/api/v1/companies/{cid}/sales")).json()) == 1
    finally:
        from main import app
        app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Bucket-2: verification smokes for the lower-risk read/report endpoints.
# ---------------------------------------------------------------------------


def _seed_approved_run(db, cid, rep_pid, owner_user_id):
    """Via the admin HTTP path: product -> sale(for rep) -> plan+rule -> assign
    -> compute -> approve. Returns ids for the downstream report endpoints."""
    admin = _client(db, owner_user_id)
    try:
        pr = _ok(admin.post(f"/api/v1/companies/{cid}/products", json={
            "name": "Coca-Cola", "category": "Beverages",
            "default_variant": {"sku": "CC-500", "unit_price": "100.00"},
        })).json()
        variant_id = pr["variants"][0]["id"]
        sale = _ok(admin.post(f"/api/v1/companies/{cid}/sales", json={
            "rep_private_user_id": rep_pid,
            "sold_at": "2026-05-10T09:00:00+00:00",
            "lines": [{"variant_id": variant_id, "quantity": "24"}],
        })).json()
        plan = _ok(admin.post(f"/api/v1/companies/{cid}/commission-plans", json={
            "name": "Rep 3%", "trigger": "on_sale",
            "rules": [{"rule_type": "flat_percent", "params": {"percent": "3.00"},
                       "scope_category": "Beverages"}],
        })).json()
        _ok(admin.post(f"/api/v1/companies/{cid}/commission-plans/{plan['id']}/assignments",
                       json={"private_user_id": rep_pid, "effective_from": "2026-01-01"}))
        run = _ok(admin.post(f"/api/v1/companies/{cid}/commission-runs",
                             json={"period_start": "2026-05-01", "period_end": "2026-05-31"})).json()
        _ok(admin.post(f"/api/v1/companies/{cid}/commission-runs/{run['id']}/approve", json={}))
        return {"run_id": run["id"], "sale_id": sale["id"],
                "sale_line_id": sale["lines"][0]["id"], "variant_id": variant_id}
    finally:
        from main import app
        app.dependency_overrides.clear()


def test_leaderboard_and_liability_smoke(db, rep_company):
    company, rep, _ru, _r2, owner = rep_company
    cid = company.company_id
    _seed_approved_run(db, cid, rep.private_user_id, owner.user_id)
    admin = _client(db, owner.user_id)
    try:
        lb = _ok(admin.get(f"/api/v1/companies/{cid}/commission-leaderboard",
                           params={"period_start": "2026-05-01", "period_end": "2026-05-31"})).json()
        assert isinstance(lb.get("entries"), list) and len(lb["entries"]) >= 1
        liab = _ok(admin.get(f"/api/v1/companies/{cid}/commission-liability")).json()
        assert liab is not None
    finally:
        from main import app
        app.dependency_overrides.clear()


def test_statement_pdf_smoke(db, rep_company):
    company, rep, _ru, _r2, owner = rep_company
    cid = company.company_id
    seed = _seed_approved_run(db, cid, rep.private_user_id, owner.user_id)
    admin = _client(db, owner.user_id)
    try:
        r = admin.get(
            f"/api/v1/companies/{cid}/commission-runs/{seed['run_id']}/statement/{rep.private_user_id}.pdf"
        )
        # 503 only if the PDF renderer isn't installed in this env — the wiring
        # (auth, run/rep lookup, line selection) is exercised either way.
        assert r.status_code in (200, 503), f"{r.status_code}: {r.text}"
        if r.status_code == 200:
            assert r.content[:4] == b"%PDF"
            assert r.headers.get("content-type", "").startswith("application/pdf")
    finally:
        from main import app
        app.dependency_overrides.clear()


def test_sales_return_smoke(db, rep_company):
    company, rep, _ru, _r2, owner = rep_company
    cid = company.company_id
    seed = _seed_approved_run(db, cid, rep.private_user_id, owner.user_id)
    admin = _client(db, owner.user_id)
    try:
        ret = _ok(admin.post(f"/api/v1/companies/{cid}/sales-returns", json={
            "sale_id": seed["sale_id"],
            "returned_at": "2026-06-02T09:00:00+00:00",
            "reason": "Damaged on delivery",
            "lines": [{"sale_line_id": seed["sale_line_id"], "quantity": "6"}],
        })).json()
        assert "id" in ret
        listed = _ok(admin.get(f"/api/v1/companies/{cid}/sales-returns",
                               params={"sale_id": seed["sale_id"]})).json()
        assert len(listed) == 1
    finally:
        from main import app
        app.dependency_overrides.clear()


def test_bulk_review_smoke(db, rep_company):
    """Month-end batch review: a reject needs a reason; both decisions apply to
    the whole batch and report per-sale outcomes."""
    company, rep, _ru, _r2, owner = rep_company
    cid = company.company_id
    variant_id = _make_variant(db, cid, owner.user_id)
    admin = _client(db, owner.user_id)
    try:
        sale_ids = [
            _ok(admin.post(f"/api/v1/companies/{cid}/sales", json={
                "rep_private_user_id": rep.private_user_id,
                "sold_at": "2026-05-10T09:00:00+00:00",
                "lines": [{"variant_id": variant_id, "quantity": "1"}],
            })).json()["id"]
            for _ in range(2)
        ]

        # Reject without a reason is refused up front.
        r = admin.post(f"/api/v1/companies/{cid}/sales/review-bulk",
                       json={"sale_ids": sale_ids, "decision": "reject"})
        assert r.status_code == 422, f"{r.status_code}: {r.text}"

        rejected = _ok(admin.post(f"/api/v1/companies/{cid}/sales/review-bulk", json={
            "sale_ids": sale_ids, "decision": "reject", "notes": "Pricing data wrong",
        })).json()
        assert rejected["succeeded"] == 2 and rejected["failed"] == 0, rejected
        assert {r0["status"] for r0 in rejected["results"]} == {"rejected"}

        approved = _ok(admin.post(f"/api/v1/companies/{cid}/sales/review-bulk", json={
            "sale_ids": sale_ids, "decision": "approve",
        })).json()
        assert approved["succeeded"] == 2, approved
    finally:
        from main import app
        app.dependency_overrides.clear()


def test_clawback_smoke(db, rep_company):
    """A clawback is recorded as a negative COMMISSION earning (never a rewrite)."""
    company, rep, _ru, _r2, owner = rep_company
    cid = company.company_id
    admin = _client(db, owner.user_id)
    try:
        res = _ok(admin.post(f"/api/v1/companies/{cid}/commission-clawbacks", json={
            "private_user_id": rep.private_user_id,
            "amount": "120.00",
            "reason": "Over-paid on a disputed sale",
        })).json()
        assert res.get("one_off_allowance_id"), res
    finally:
        from main import app
        app.dependency_overrides.clear()

    row = (
        db.query(EmployeeOneOffAllowance)
        .filter(EmployeeOneOffAllowance.private_user_id == rep.private_user_id)
        .one()
    )
    assert Decimal(row.amount) == Decimal("-120.00")


def test_erp_reconcile_smoke(db, rep_company):
    """External sales feed: dry-run matches SKUs, commit imports new rows, and a
    replay of the same external_id is idempotent."""
    company, rep, _ru, _r2, owner = rep_company
    cid = company.company_id
    _make_variant(db, cid, owner.user_id)  # sku "W-1L"
    admin = _client(db, owner.user_id)

    item = {
        "external_id": "ERP-1001", "sku": "W-1L", "quantity": "5",
        "sold_at": "2026-05-14T09:00:00+00:00", "rep_private_user_id": rep.private_user_id,
    }
    try:
        dry = _ok(admin.post(f"/api/v1/companies/{cid}/sales/erp-reconcile",
                             json={"items": [item], "commit": False})).json()
        assert (dry["new"], dry["created"]) == (1, 0), dry

        first = _ok(admin.post(f"/api/v1/companies/{cid}/sales/erp-reconcile",
                               json={"items": [item], "commit": True})).json()
        assert (first["new"], first["created"]) == (1, 1), first

        replay = _ok(admin.post(f"/api/v1/companies/{cid}/sales/erp-reconcile",
                                json={"items": [item], "commit": True})).json()
        assert (replay["duplicates"], replay["created"]) == (1, 0), replay

        unknown = _ok(admin.post(f"/api/v1/companies/{cid}/sales/erp-reconcile", json={
            "items": [{**item, "external_id": "ERP-1002", "sku": "NOPE"}], "commit": False,
        })).json()
        assert unknown["unmatched_sku"] == 1, unknown
    finally:
        from main import app
        app.dependency_overrides.clear()

    assert db.query(Sale).filter(
        Sale.company_id == cid, Sale.client_uuid == "erp:ERP-1001"
    ).count() == 1


def test_product_import_smoke(db, rep_company):
    """CSV product import: the template downloads, dry-run previews without
    writing, and a commit creates the product/variant."""
    company, rep, _ru, _r2, owner = rep_company
    cid = company.company_id
    admin = _client(db, owner.user_id)
    csv_body = (
        "name,sku,price,category\n"
        "Imported Soda 1L,IMP-1L,50.00,Beverages\n"
    )
    try:
        tpl = admin.get(f"/api/v1/companies/{cid}/products/import/template")
        assert tpl.status_code == 200
        assert tpl.headers.get("content-type", "").startswith("text/csv")
        assert "name" in tpl.text

        preview = _ok(admin.post(
            f"/api/v1/companies/{cid}/products/import",
            params={"dry_run": "true"},
            files={"file": ("products.csv", csv_body, "text/csv")},
        )).json()
        assert preview["status"] == "preview" and preview["ready"] == 1, preview

        imported = _ok(admin.post(
            f"/api/v1/companies/{cid}/products/import",
            params={"dry_run": "false"},
            files={"file": ("products.csv", csv_body, "text/csv")},
        )).json()
        assert imported["status"] == "imported", imported
        assert imported["products_created"] == 1 and imported["variants_created"] == 1, imported
    finally:
        from main import app
        app.dependency_overrides.clear()

    variant = (
        db.query(ProductVariant)
        .filter(ProductVariant.sku == "IMP-1L")
        .one_or_none()
    )
    assert variant is not None
