"""Step C: opt-in maker-checker (segregation of duties) for Field Sales.

When `companies.field_sales_maker_checker` is true:
  * a plan/price version created by one admin sits `pending`;
  * a *different* admin must activate/approve it (403 on self-approval);
  * pending prices never resolve, so they cannot alter pay;
  * the uncontrolled lever (`PATCH variant.unit_price`) is refused.

Switching the flag on requires >= 2 active admins, else it would deadlock.
Default false: behaviour is identical to before.
"""

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import text

from core.model import Company, PrivateUser, ProductPrice, User
from db_models.crud import field_sales as crud


@pytest.fixture()
def mc_company(db):
    sfx = uuid.uuid4().hex[:8]
    owner = User(
        user_type="company", email=f"mc-owner-{sfx}@kontokazdemo.com",
        user_name=f"mc-owner-{sfx}", password_hash="x",
    )
    db.add(owner)
    db.flush()
    company = Company(
        user_id=owner.user_id, company_name=f"MC Co {sfx}",
        email=f"mc-co-{sfx}@kontokazdemo.com", brn=f"MC_BRN_{sfx}", country_code="MU",
    )
    db.add(company)
    db.flush()

    # A second admin (private user with an admin-level role).
    u2 = User(
        user_type="private", email=f"mc-admin-{sfx}@kontokazdemo.com",
        user_name=f"mc-admin-{sfx}", password_hash="x",
    )
    db.add(u2)
    db.flush()
    admin2 = PrivateUser(
        user_id=u2.user_id, first_name="Second", last_name="Admin",
        company_id=company.company_id, pass_port_number=f"MC_ADMIN_{sfx}", role="admin",
    )
    db.add(admin2)
    db.flush()

    from core.modules import set_company_module
    set_company_module(
        db, company_id=company.company_id, module_key="field_sales",
        enabled=True, actor_user_id=owner.user_id,
    )
    db.commit()

    yield company, owner, admin2, u2

    db.rollback()
    for stmt in [
        "DELETE FROM product_prices",
        "DELETE FROM commission_plan_assignments",
        "DELETE FROM commission_rules",
        "DELETE FROM commission_plans",
        "DELETE FROM product_variants",
        "DELETE FROM products",
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


def _settings(client, cid, value):
    return client.put(f"/api/v1/companies/{cid}/field-sales/settings", json={"maker_checker": value})


def _variant(client, cid, *, sku="MC-SKU", unit_price="100.00"):
    r = _ok(client.post(f"/api/v1/companies/{cid}/products", json={
        "name": f"Product {sku}", "category": "Beverages",
        "default_variant": {"sku": sku, "unit_price": unit_price},
    }))
    body = r.json()
    return body["id"], body["variants"][0]["id"]


PLAN_BODY = {
    "name": "MC Plan", "trigger": "on_sale",
    "rules": [{"rule_type": "flat_percent", "params": {"percent": "3.00"}}],
}


def test_enable_requires_two_active_admins(db, mc_company):
    company, owner, _admin2, _u2 = mc_company
    client = _client(db, owner.user_id)
    try:
        # A fresh company with only its owner cannot enable the flag.
        sfx = uuid.uuid4().hex[:8]
        o = User(user_type="company", email=f"solo-{sfx}@kontokazdemo.com",
                 user_name=f"solo-{sfx}", password_hash="x")
        db.add(o)
        db.flush()
        solo = Company(user_id=o.user_id, company_name=f"Solo {sfx}",
                       email=f"solo-co-{sfx}@kontokazdemo.com",
                       brn=f"SOLO_{sfx}", country_code="MU")
        db.add(solo)
        db.flush()
        from core.modules import set_company_module
        set_company_module(
            db, company_id=solo.company_id, module_key="field_sales",
            enabled=True, actor_user_id=o.user_id,
        )
        db.commit()

        from main import app
        app.dependency_overrides.clear()
        solo_client = _client(db, o.user_id)
        r = solo_client.put(
            f"/api/v1/companies/{solo.company_id}/field-sales/settings",
            json={"maker_checker": True},
        )
        assert r.status_code == 409, r.text
        assert "two active admins" in r.text

        app.dependency_overrides.clear()
        # The fixture company has owner + admin2 -> allowed.
        r = _settings(_client(db, owner.user_id), company.company_id, True)
        _ok(r)
        assert r.json()["maker_checker"] is True
        assert r.json()["admin_count"] >= 2
    finally:
        from main import app
        app.dependency_overrides.clear()


def test_plan_self_activation_forbidden(db, mc_company):
    company, owner, _admin2, u2 = mc_company
    cid = company.company_id
    owner_client = _client(db, owner.user_id)
    try:
        _ok(_settings(owner_client, cid, True))

        r = _ok(owner_client.post(f"/api/v1/companies/{cid}/commission-plans", json=PLAN_BODY))
        plan = r.json()
        assert plan["status"] == "pending", plan
        assert plan["created_by_user_id"] == owner.user_id
        pid = plan["id"]

        # The maker cannot activate their own version.
        r = owner_client.post(f"/api/v1/companies/{cid}/commission-plans/{pid}/activate", json={})
        assert r.status_code == 403, r.text

        from main import app
        app.dependency_overrides.clear()
        checker_client = _client(db, u2.user_id)
        r = _ok(checker_client.post(f"/api/v1/companies/{cid}/commission-plans/{pid}/activate", json={}))
        assert r.json()["status"] == "active"
        assert r.json()["approved_by_user_id"] == u2.user_id
    finally:
        from main import app
        app.dependency_overrides.clear()


def test_pending_price_does_not_resolve_until_second_admin_approves(db, mc_company):
    company, owner, _admin2, u2 = mc_company
    cid = company.company_id
    client = _client(db, owner.user_id)
    try:
        _ok(_settings(client, cid, True))
        product_id, variant_id = _variant(client, cid)

        r = _ok(client.post(f"/api/v1/companies/{cid}/product-prices", json={
            "variant_id": variant_id, "amount": "50.00",
            "effective_from": "2026-05-01",
        }))
        price = r.json()
        assert price["status"] == "pending"
        assert price["created_by_user_id"] == owner.user_id
        assert crud.resolve_price(db, cid, variant_id, on_date=date(2026, 5, 10)) == Decimal("100.00")

        r = client.post(f"/api/v1/companies/{cid}/product-prices/{price['id']}/approve")
        assert r.status_code == 403, r.text

        from main import app
        app.dependency_overrides.clear()
        checker = _client(db, u2.user_id)
        r = _ok(checker.post(f"/api/v1/companies/{cid}/product-prices/{price['id']}/approve"))
        assert r.json()["status"] == "active"
        assert r.json()["approved_by_user_id"] == u2.user_id
        assert crud.resolve_price(db, cid, variant_id, on_date=date(2026, 5, 10)) == Decimal("50.00")

        # A second pending price can be rejected by a different admin and
        # never resolves.
        r = _ok(checker.post(f"/api/v1/companies/{cid}/product-prices", json={
            "variant_id": variant_id, "amount": "25.00",
            "effective_from": "2026-06-01",
        }))
        rid = r.json()["id"]
        app.dependency_overrides.clear()
        maker_client = _client(db, owner.user_id)
        r = _ok(maker_client.post(f"/api/v1/companies/{cid}/product-prices/{rid}/reject"))
        assert r.json()["status"] == "rejected"
        assert crud.resolve_price(db, cid, variant_id, on_date=date(2026, 6, 10)) == Decimal("50.00")
    finally:
        from main import app
        app.dependency_overrides.clear()


def test_raw_unit_price_lever_refused_when_flag_on(db, mc_company):
    company, owner, _admin2, _u2 = mc_company
    cid = company.company_id
    client = _client(db, owner.user_id)
    try:
        _ok(_settings(client, cid, True))
        product_id, variant_id = _variant(client, cid, unit_price="100.00")
        path = f"/api/v1/companies/{cid}/products/{product_id}/variants/{variant_id}"

        r = client.patch(path, json={"unit_price": "120.00"})
        assert r.status_code == 409, r.text
        assert "effective-dated" in r.text

        # Non-price edits still go through.
        _ok(client.patch(path, json={"sku": "MC-SKU-2"}))

        # With the flag off the inline lever works again.
        _ok(_settings(client, cid, False))
        _ok(client.patch(path, json={"unit_price": "120.00"}))
    finally:
        from main import app
        app.dependency_overrides.clear()
