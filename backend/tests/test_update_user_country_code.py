"""PATCH /user/{user_id} — country_code field for independent users.

Only meaningful for a PrivateUser with no company_id (see the schema
comment on UpdateUser.country_code and PrivateUser.effective_country_code,
core/model.py:149-176) — a company employee's country always comes from
their employer regardless of what they submit here. Validated against
active Country rows with the same rigor as company signup.
"""
from __future__ import annotations

import uuid
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session, sessionmaker


def _make_independent_user(db: Session) -> dict:
    from core.model import PrivateUser, User

    s = uuid.uuid4().hex[:8]
    u = User(user_type="private", email=f"cc-upd-{s}@ccupdtest.dev", user_name=f"cc-upd-{s}", password_hash="x")
    db.add(u)
    db.flush()
    pu = PrivateUser(
        user_id=u.user_id,
        first_name="Test",
        last_name="Independent",
        company_id=None,
        pass_port_number=f"CCUPD_{s}",
        role="employee",
    )
    db.add(pu)
    db.commit()
    return {"user_id": u.user_id, "private_user_id": pu.private_user_id, "suffix": s}


@pytest.fixture()
def independent_user(db: Session):
    ctx = _make_independent_user(db)
    yield ctx
    db.rollback()
    db.execute(sql_text("DELETE FROM private_users WHERE pass_port_number LIKE :p"), {"p": f"CCUPD_{ctx['suffix']}"})
    db.execute(sql_text("DELETE FROM users WHERE email LIKE :e"), {"e": f"cc-upd-{ctx['suffix']}@ccupdtest.dev"})
    db.commit()


@pytest.fixture()
def client(_engine, independent_user):
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
        return d.query(User).filter(User.user_id == independent_user["user_id"]).one()

    app.dependency_overrides[core_config.get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_user
    yield TestClient(app, raise_server_exceptions=False)
    app.dependency_overrides.clear()


def test_setting_active_country_code_succeeds(client: TestClient, independent_user: dict, db: Session):
    resp = client.patch(f"/api/v1/user/{independent_user['user_id']}", json={"country_code": "TZ"})
    assert resp.status_code == 200, resp.text

    # Mobile settings needs both fields in the response to show the current
    # value and pre-select it in the picker without a second round-trip.
    body = resp.json()
    assert body["private_user"]["country_code"] == "TZ"
    assert body["private_user"]["effective_country_code"] == "TZ"

    db.expire_all()
    from core.model import PrivateUser
    pu = db.query(PrivateUser).filter(PrivateUser.private_user_id == independent_user["private_user_id"]).one()
    assert pu.country_code == "TZ"
    assert pu.effective_country_code == "TZ"


def test_unknown_country_code_rejected(client: TestClient, independent_user: dict, db: Session):
    resp = client.patch(f"/api/v1/user/{independent_user['user_id']}", json={"country_code": "ZZ"})
    assert resp.status_code == 400, resp.text

    db.expire_all()
    from core.model import PrivateUser
    pu = db.query(PrivateUser).filter(PrivateUser.private_user_id == independent_user["private_user_id"]).one()
    assert pu.country_code is None  # rejected, not silently saved
