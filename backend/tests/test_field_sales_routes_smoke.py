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

    # The field_sales paid module is OFF by default — enable it so the routes
    # (which correctly gate on the entitlement) are reachable.
    from core.modules import set_company_module
    set_company_module(
        db, company_id=company.company_id, module_key="field_sales",
        enabled=True, actor_user_id=owner.user_id,
    )
    db.commit()

    yield company, rep, owner

    db.rollback()
    for stmt in [
        "DELETE FROM commission_payables",
        "DELETE FROM commission_line_items",
        "DELETE FROM commission_runs",
        "DELETE FROM commission_plan_assignments",
        "DELETE FROM commission_rules",
        "DELETE FROM commission_plans",
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
    company, rep, owner = rep_company
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
