"""Per-company paid-module entitlements (`company_modules` + `require_module`).

Locks in the contract that Field Sales & Commissions is OFF by default and only
reachable once a platform admin flips the `field_sales` module for that company:
  - registry helpers (`is_module_enabled`, `list_company_modules`, `set_...`)
  - the `require_module` FastAPI dependency gate
  - the admin toggle endpoint
  - the company-facing `GET /companies/{id}/modules` route
"""

import uuid

import pytest
from fastapi import Depends as _Depends
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from core import config as core_config
from core.dependencies import get_current_user, require_module
from core.model import Company, PrivateUser, User
from core.modules import (
    is_module_enabled,
    list_company_modules,
    set_company_module,
)


@pytest.fixture()
def module_company(db):
    sfx = uuid.uuid4().hex[:8]
    owner = User(
        user_type="company", email=f"mod-owner-{sfx}@kontokaz.test",
        user_name=f"mod-owner-{sfx}", password_hash="x",
    )
    db.add(owner)
    db.flush()
    company = Company(
        user_id=owner.user_id, company_name=f"Module Co. {sfx}",
        email=f"mod-co-{sfx}@kontokaz.test", brn=f"MOD_{sfx}", country_code="MU",
    )
    db.add(company)
    db.flush()

    member_user = User(
        user_type="private", email=f"mod-member-{sfx}@kontokaz.test",
        user_name=f"mod-member-{sfx}", password_hash="x",
    )
    db.add(member_user)
    db.flush()
    member = PrivateUser(
        user_id=member_user.user_id, first_name="Mod", last_name="Member",
        company_id=company.company_id, pass_port_number=f"MOD_{sfx}", role="employee",
    )
    db.add(member)
    db.flush()
    db.commit()

    yield {
        "company_id": company.company_id,
        "owner": owner,
        "member_user": member_user,
        "member": member,
    }

    db.rollback()
    from sqlalchemy import text
    db.execute(
        text("DELETE FROM company_modules WHERE company_id = :c"),
        {"c": company.company_id},
    )
    db.commit()


# ── registry helpers ─────────────────────────────────────────────────────
def test_field_sales_module_defaults_off(db, module_company):
    cid = module_company["company_id"]
    assert is_module_enabled(db, cid, "field_sales") is False
    mods = {m["module_key"]: m for m in list_company_modules(db, cid)}
    assert mods["field_sales"]["enabled"] is False
    assert mods["field_sales"]["label"]


def test_unknown_module_is_never_enabled(db, module_company):
    assert is_module_enabled(db, module_company["company_id"], "no_such_module") is False


def test_set_company_module_toggles_and_stamps(db, module_company):
    cid = module_company["company_id"]
    actor = module_company["owner"].user_id

    row = set_company_module(
        db, company_id=cid, module_key="field_sales", enabled=True, actor_user_id=actor
    )
    db.commit()
    assert row.enabled is True
    assert row.enabled_at is not None
    assert row.changed_by_user_id == actor
    assert is_module_enabled(db, cid, "field_sales") is True

    # Idempotent re-enable keeps the original enabled_at.
    first_enabled_at = row.enabled_at
    row = set_company_module(
        db, company_id=cid, module_key="field_sales", enabled=True, actor_user_id=actor
    )
    db.commit()
    assert row.enabled_at == first_enabled_at

    row = set_company_module(
        db, company_id=cid, module_key="field_sales", enabled=False, actor_user_id=actor
    )
    db.commit()
    assert row.enabled is False
    assert row.disabled_at is not None
    assert is_module_enabled(db, cid, "field_sales") is False


def test_set_company_module_rejects_unknown_key(db, module_company):
    with pytest.raises(KeyError):
        set_company_module(
            db, company_id=module_company["company_id"],
            module_key="no_such_module", enabled=True, actor_user_id=None,
        )


# ── require_module dependency ────────────────────────────────────────────
def test_require_module_blocks_when_disabled(db, module_company):
    company = db.query(Company).filter(
        Company.company_id == module_company["company_id"]
    ).one()
    dep = require_module("field_sales")
    with pytest.raises(HTTPException) as exc:
        dep(company=company, db=db)
    assert exc.value.status_code == 403


def test_require_module_allows_when_enabled(db, module_company):
    cid = module_company["company_id"]
    set_company_module(
        db, company_id=cid, module_key="field_sales", enabled=True,
        actor_user_id=module_company["owner"].user_id,
    )
    db.commit()
    company = db.query(Company).filter(Company.company_id == cid).one()
    dep = require_module("field_sales")
    assert dep(company=company, db=db).company_id == cid


# ── admin toggle endpoint ────────────────────────────────────────────────
def test_admin_toggle_endpoint_enables_and_disables(db, module_company):
    from api.v1 import admin
    from core.model import CompanyModule

    cid = module_company["company_id"]
    actor = module_company["owner"]

    res = admin.admin_set_company_module(
        company_id=cid, module_key="field_sales",
        body=admin._ModuleToggleBody(enabled=True),
        current_user=actor, db=db,
    )
    assert res["enabled"] is True
    assert (
        db.query(CompanyModule)
        .filter(CompanyModule.company_id == cid, CompanyModule.module_key == "field_sales")
        .one()
        .enabled
        is True
    )

    res = admin.admin_set_company_module(
        company_id=cid, module_key="field_sales",
        body=admin._ModuleToggleBody(enabled=False),
        current_user=actor, db=db,
    )
    assert res["enabled"] is False


def test_admin_toggle_endpoint_rejects_unknown_module(db, module_company):
    from api.v1 import admin

    with pytest.raises(HTTPException) as exc:
        admin.admin_set_company_module(
            company_id=module_company["company_id"], module_key="no_such_module",
            body=admin._ModuleToggleBody(enabled=True),
            current_user=module_company["owner"], db=db,
        )
    assert exc.value.status_code == 400


# ── HTTP-level gating ────────────────────────────────────────────────────
@pytest.fixture()
def module_client(_engine, db, module_company):
    from main import app

    uid = module_company["member_user"].user_id
    SessionFactory = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

    def _override_db():
        d = SessionFactory()
        try:
            yield d
        finally:
            d.close()

    def _override_user(d: Session = _Depends(core_config.get_db)) -> User:
        return d.query(User).filter(User.user_id == uid).one()

    app.dependency_overrides[core_config.get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_user
    yield TestClient(app, raise_server_exceptions=False), module_company["company_id"]
    app.dependency_overrides.clear()


def test_http_commissions_403_when_module_disabled(module_client):
    client, cid = module_client
    resp = client.get(f"/api/v1/companies/{cid}/sales")
    assert resp.status_code == 403, resp.text
    assert "field_sales" in resp.json()["detail"]


def test_http_commissions_allowed_when_module_enabled(module_client, db):
    client, cid = module_client
    set_company_module(db, company_id=cid, module_key="field_sales", enabled=True,
                       actor_user_id=None)
    db.commit()
    resp = client.get(f"/api/v1/companies/{cid}/sales")
    assert resp.status_code == 200, resp.text


def test_http_modules_endpoint_lists_field_sales(module_client):
    client, cid = module_client
    resp = client.get(f"/api/v1/companies/{cid}/modules")
    assert resp.status_code == 200, resp.text
    keys = [m["module_key"] for m in resp.json()["modules"]]
    assert "field_sales" in keys
