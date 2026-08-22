"""Tests for employee country assignments (missions / transfers).

Covers the date-aware resolution precedence and the CRUD endpoints, plus the
no-assignment backward-compat guarantee (existing behavior byte-identical).
"""
from __future__ import annotations

import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session, sessionmaker

from services import country_assignment


def _make_company_with_employee(db: Session) -> dict:
    """A dedicated Company (+ owner User + employee PrivateUser) for this test,
    isolated from the shared fixtures so we can mutate company_id safely."""
    from core.model import Company, PrivateUser, User

    s = uuid.uuid4().hex[:6]
    owner = User(user_type="company", email=f"cca-owner-{s}@cctest.dev",
                 user_name=f"cca-owner-{s}", password_hash="x")
    db.add(owner)
    db.flush()
    emp_user = User(user_type="private", email=f"cca-emp-{s}@cctest.dev",
                    user_name=f"cca-emp-{s}", password_hash="x")
    db.add(emp_user)
    db.flush()
    co = Company(
        user_id=owner.user_id,
        company_name=f"CCA Co {s}",
        brn=f"BRN-{s}",
        country_code="MU",
    )
    db.add(co)
    db.flush()
    pu = PrivateUser(
        user_id=emp_user.user_id,
        first_name="Carmen",
        last_name="Cat",
        company_id=co.company_id,
        pass_port_number=f"CCA_{s}",
        role="employee",
    )
    db.add(pu)
    db.commit()
    return {
        "suffix": s,
        "company_id": co.company_id,
        "owner_id": owner.user_id,
        "employee_user_id": emp_user.user_id,
        "private_user_id": pu.private_user_id,
    }


@pytest.fixture()
def ctx(db: Session):
    c = _make_company_with_employee(db)
    yield c
    db.rollback()
    db.execute(sql_text(
        "DELETE FROM employee_country_assignments WHERE private_user_id=:p"),
        {"p": c["private_user_id"]})
    db.execute(sql_text("DELETE FROM private_users WHERE pass_port_number LIKE :p"),
               {"p": f"CCA_{c['suffix']}"})
    db.execute(sql_text("DELETE FROM companies WHERE company_name LIKE :p"),
               {"p": f"CCA Co {c['suffix']}"})
    # NOTE: the owner/employee User rows are intentionally LEFT in place —
    # the owner writes audit_logs rows and audit_logs is append-only (its
    # reject trigger forbids the ON DELETE SET NULL cascade too).
    db.commit()


@pytest.fixture()
def client(_engine, ctx):
    from fastapi import Depends as _Depends
    from core import config as core_config
    from core.dependencies import get_current_user
    from core.model import User
    from main import app

    SessionFactory = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

    def _override_db():
        d = SessionFactory()
        try:
            yield d
        finally:
            d.close()

    def _override_user(d: Session = _Depends(core_config.get_db)) -> User:
        return d.query(User).filter(User.user_id == ctx["owner_id"]).one()

    app.dependency_overrides[core_config.get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_user
    yield TestClient(app, raise_server_exceptions=False)
    app.dependency_overrides.clear()


def _make_assignment(db: Session, ctx: dict, country_code="TZ", reason="mission",
                     effective_from=None, effective_to=None):
    from core.model import EmployeeCountryAssignment
    a = EmployeeCountryAssignment(
        private_user_id=ctx["private_user_id"],
        country_code=country_code,
        reason=reason,
        effective_from=effective_from or date(2026, 7, 1),
        effective_to=effective_to,
        created_by_user_id=ctx["owner_id"],
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return a


# --------------------------------------------------------------------------
# Resolution precedence + backward compatibility
# --------------------------------------------------------------------------


def test_no_assignment_keeps_company_country(db: Session, ctx: dict):
    from core.model import PrivateUser
    pu = db.query(PrivateUser).filter(PrivateUser.private_user_id == ctx["private_user_id"]).one()
    assert pu.effective_country_code == "MU"
    assert country_assignment.active_country_assignment(db, pu.private_user_id) is None


def test_open_assignment_supersedes_company_country(db: Session, ctx: dict):
    _make_assignment(db, ctx, country_code="TZ")
    from core.model import PrivateUser
    pu = db.query(PrivateUser).filter(PrivateUser.private_user_id == ctx["private_user_id"]).one()
    assert pu.effective_country_code == "TZ"
    assert country_assignment.resolve_effective_country(db, pu) == "TZ"


def test_ended_assignment_falls_back_to_company(db: Session, ctx: dict):
    # Effective 2026-01-01 → 2026-01-15; "today" (real clock) is well after.
    _make_assignment(db, ctx, country_code="TZ",
                     effective_from=date(2026, 1, 1), effective_to=date(2026, 1, 15))
    from core.model import PrivateUser
    pu = db.query(PrivateUser).filter(PrivateUser.private_user_id == ctx["private_user_id"]).one()
    assert pu.effective_country_code == "MU"  # reverted to employer country


def test_resolve_is_date_aware(db: Session, ctx: dict):
    a = _make_assignment(db, ctx, country_code="TZ", effective_from=date(2026, 8, 1))
    assert country_assignment.active_country_assignment(db, ctx["private_user_id"], date(2026, 7, 31)) is None
    act = country_assignment.active_country_assignment(db, ctx["private_user_id"], date(2026, 8, 1))
    assert act is not None and act.id == a.id


# --------------------------------------------------------------------------
# API
# --------------------------------------------------------------------------


def test_create_list_active_and_end(client: TestClient, ctx: dict, db: Session):
    base = f"/api/v1/private-users/{ctx['private_user_id']}/country-locations"

    resp = client.post(base, json={
        "country_code": "TZ",
        "reason": "mission",
        "effective_from": "2026-07-01",
    })
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["country_code"] == "TZ"
    assert body["country_name"] == "Tanzania"

    resp = client.get(f"{base}/active")
    assert resp.status_code == 200, resp.text
    assert resp.json()["country_code"] == "TZ"

    assign_id = body["id"]
    resp = client.post(f"{base}/{assign_id}/end", json={"effective_to": "2026-12-31"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["effective_to"] == "2026-12-31"

    resp = client.get(f"{base}/active")
    assert resp.status_code == 200, resp.text
    assert resp.json()["country_code"] == "TZ"  # still active within window

    resp = client.get(base)
    assert resp.status_code == 200, resp.text
    assert len(resp.json()) == 1


def test_supersede_closes_prior_open(client: TestClient, ctx: dict, db: Session):
    base = f"/api/v1/private-users/{ctx['private_user_id']}/country-locations"
    r1 = client.post(base, json={"country_code": "TZ", "reason": "mission",
                                 "effective_from": "2026-07-01"}).json()
    r2 = client.post(base, json={"country_code": "TZ", "reason": "mission",
                                 "effective_from": "2026-09-01"}).json()
    assert r2["country_code"] == "TZ"
    # The first open assignment was auto-closed at the second's start.
    db.expire_all()
    rows = client.get(base).json()
    by_id = {r["id"]: r for r in rows}
    assert len(by_id) == 2
    assert by_id[r1["id"]]["effective_to"] == "2026-09-01"
    assert by_id[r2["id"]]["effective_to"] is None


def test_inactive_country_rejected(client: TestClient, ctx: dict):
    base = f"/api/v1/private-users/{ctx['private_user_id']}/country-locations"
    resp = client.post(base, json={"country_code": "ZZ", "reason": "mission",
                                   "effective_from": "2026-07-01"})
    assert resp.status_code == 400


def test_transfer_new_company_repoints_primary(client: TestClient, ctx: dict, db: Session):
    from core.model import Company, PrivateUser

    co2 = Company(company_name=f"CCA Co2 {ctx['suffix']}", brn=f"BRN2-{ctx['suffix']}",
                  country_code="MU")
    db.add(co2)
    db.commit()
    db.refresh(co2)

    base = f"/api/v1/private-users/{ctx['private_user_id']}/country-locations"
    resp = client.post(base, json={
        "country_code": "TZ", "reason": "transfer_new_company",
        "effective_from": "2026-07-01", "new_company_id": co2.company_id,
    })
    assert resp.status_code == 201, resp.text

    db.expire_all()
    pu = db.query(PrivateUser).filter(PrivateUser.private_user_id == ctx["private_user_id"]).one()
    assert pu.company_id == co2.company_id

    db.execute(sql_text("DELETE FROM employee_country_assignments WHERE private_user_id=:p"),
               {"p": ctx["private_user_id"]})
    db.execute(sql_text("DELETE FROM private_users WHERE private_user_id=:p"),
               {"p": ctx["private_user_id"]})
    db.execute(sql_text("DELETE FROM companies WHERE company_id=:p"),
               {"p": co2.company_id})
    db.commit()


def test_transfer_new_company_same_company_is_noop(client: TestClient, ctx: dict, db: Session):
    from core.model import PrivateUser

    base = f"/api/v1/private-users/{ctx['private_user_id']}/country-locations"
    resp = client.post(base, json={
        "country_code": "TZ", "reason": "transfer_new_company",
        "effective_from": "2026-07-01", "new_company_id": ctx["company_id"],
    })
    assert resp.status_code == 201, resp.text
    db.expire_all()
    pu = db.query(PrivateUser).filter(PrivateUser.private_user_id == ctx["private_user_id"]).one()
    assert pu.company_id == ctx["company_id"]  # unchanged


def test_end_rejects_to_before_from(client: TestClient, ctx: dict, db: Session):
    from core.model import EmployeeCountryAssignment

    a = _make_assignment(db, ctx, country_code="TZ", effective_from=date(2026, 7, 1))
    base = f"/api/v1/private-users/{ctx['private_user_id']}/country-locations"
    resp = client.post(f"{base}/{a.id}/end", json={"effective_to": "2026-01-01"})
    assert resp.status_code == 400


def test_employee_cannot_set_own_assignment(client: TestClient, ctx: dict):
    from fastapi import Depends as _Depends
    from core import config as core_config
    from core.dependencies import get_current_user
    from core.model import User
    from main import app

    prior = app.dependency_overrides.get(get_current_user)

    def _emp_user(d: Session = _Depends(core_config.get_db)) -> User:
        return d.query(User).filter(User.user_id == ctx["employee_user_id"]).one()

    app.dependency_overrides[get_current_user] = _emp_user
    try:
        resp = client.post(
            f"/api/v1/private-users/{ctx['private_user_id']}/country-locations",
            json={"country_code": "TZ", "reason": "mission", "effective_from": "2026-07-01"},
        )
        assert resp.status_code == 403
    finally:
        if prior is not None:
            app.dependency_overrides[get_current_user] = prior
        else:
            app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.clear()


# --------------------------------------------------------------------------
# Phase 3 — company report (history / filters / residency indicator / CSV)
# --------------------------------------------------------------------------


def test_company_report_json_and_filters(client: TestClient, ctx: dict, db: Session):
    # Ended mission (past) + open mission (future-dated) + open current mission.
    _make_assignment(db, ctx, country_code="TZ", reason="mission",
                     effective_from=date(2026, 1, 1), effective_to=date(2026, 1, 15))
    _make_assignment(db, ctx, country_code="TZ", reason="mission",
                     effective_from=date(2030, 1, 1))  # upcoming, sole open row
    _make_assignment(db, ctx, country_code="TZ", reason="mission",
                     effective_from=date(2026, 3, 1), effective_to=date(2026, 12, 31))  # active by 2026-06-01
    db.expire_all()

    url = f"/api/v1/companies/{ctx['company_id']}/country-assignments/report?as_of=2026-06-01"
    resp = client.get(url)
    assert resp.status_code == 200, resp.text
    rows = resp.json()
    assert len(rows) == 3

    # Status derivation against as_of=2026-06-01 (real clock is Aug 2026, so we
    # pass as_of explicitly to avoid depending on wall-clock date).
    by_status = {}
    for r in rows:
        by_status[r["status"]] = r
    assert by_status["ended"]["country_code"] == "TZ"
    assert by_status["active"]["country_code"] == "TZ"
    assert by_status["upcoming"]["status"] == "upcoming"

    # Filter by status=active narrows to one.
    resp = client.get(url + "&status=active")
    assert resp.status_code == 200
    assert len(resp.json()) == 1

    # Residency indicator: the 2026-03-01 window (>183 days by 2026-10-01)
    # should be flagged. Filter status=active at that date.
    resp = client.get(f"/api/v1/companies/{ctx['company_id']}/country-assignments/report?as_of=2026-10-01&status=active")
    assert resp.status_code == 200
    active = [r for r in resp.json() if r["status"] == "active"]
    assert any(r["residency_qualified"] for r in active)


def test_company_report_csv(client: TestClient, ctx: dict, db: Session):
    _make_assignment(db, ctx, country_code="TZ", reason="mission", effective_from=date(2026, 3, 1))
    db.expire_all()

    resp = client.get(
        f"/api/v1/companies/{ctx['company_id']}/country-assignments/report?format=csv&as_of=2026-06-01"
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("text/csv")
    assert "country_code" in resp.text
    assert "residency_qualified" in resp.text


def test_company_search_finds_active_companies(client: TestClient, ctx: dict, db: Session):
    resp = client.get("/api/v1/companies", params={"q": ctx["company_name"] if "company_name" in ctx else "CCA Co"})
    assert resp.status_code == 200, resp.text
    names = [c["company_name"] for c in resp.json()]
    assert any("CCA Co" in n for n in names)
    assert all("company_id" in c and "brn" in c for c in resp.json())


def test_company_search_requires_admin(client: TestClient, ctx: dict):
    from fastapi import Depends as _Depends
    from core import config as core_config
    from core.dependencies import get_current_user
    from core.model import User
    from main import app

    prior = app.dependency_overrides.get(get_current_user)

    def _emp_user(d: Session = _Depends(core_config.get_db)) -> User:
        return d.query(User).filter(User.user_id == ctx["employee_user_id"]).one()

    app.dependency_overrides[get_current_user] = _emp_user
    try:
        resp = client.get("/api/v1/companies", params={"q": "Kiruko"})
        assert resp.status_code == 403
    finally:
        if prior is not None:
            app.dependency_overrides[get_current_user] = prior
        else:
            app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.clear()
