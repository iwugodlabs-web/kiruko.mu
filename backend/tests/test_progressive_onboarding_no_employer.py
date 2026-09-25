"""Progressive onboarding — no-employer path + minimal payloads.

Redesign v2 shrinks mandatory onboarding to first/last/phone + (a Job OR an
explicit "no employer" acknowledgement). These tests pin the backend side of
that contract:

  * PATCH /user can set `onboarding_acknowledged_no_employer` and the server
    recomputes `onboard_complete` (previously the flag was read but never
    writable, so users without an employer were permanently gated).
  * POST /user/onboard accepts a payload with no job_data / no salary_data.
  * A user who neither supplies a job nor acks stays incomplete.
"""
import uuid
from datetime import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from core.model import Job, PrivateUser, Salary, User


def _client(_engine, current_user_id: int) -> TestClient:
    from fastapi import Depends as _Depends
    from sqlalchemy.orm import sessionmaker
    from core import config as core_config
    from core.dependencies import get_current_user
    from core.model import User as UserORM
    from main import app

    SessionFactory = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

    def _override_db():
        s = SessionFactory()
        try:
            yield s
        finally:
            s.close()

    def _override_user(db: Session = _Depends(core_config.get_db)) -> UserORM:
        return db.query(UserORM).filter(UserORM.user_id == current_user_id).one()

    app.dependency_overrides[core_config.get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_user
    return TestClient(app, raise_server_exceptions=False)


def _clear() -> None:
    from main import app
    app.dependency_overrides.clear()


def _private_user(db: Session, *, phone: str | None = None) -> tuple[User, PrivateUser]:
    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    sfx = uuid.uuid4().hex[:8]
    u = User(
        user_type="private",
        email=f"prog-{sfx}@x.com",
        user_name=f"prog-{sfx}",
        password_hash="x",
    )
    db.add(u)
    db.flush()
    pu = PrivateUser(
        user_id=u.user_id,
        first_name="Pat",
        last_name="Progress",
        phone=phone or f"+2305{sfx[:7]}",
        role="employee",
    )
    db.add(pu)
    db.flush()
    db.commit()
    return u, pu


def test_patch_ack_no_employer_completes_onboarding(db: Session, _engine):
    u, pu = _private_user(db)
    assert u.onboard_complete is False

    client = _client(_engine, u.user_id)
    try:
        resp = client.patch(
            f"/api/v1/user/{u.user_id}",
            json={"onboarding_acknowledged_no_employer": True},
        )
    finally:
        _clear()
    assert resp.status_code == 200, resp.text

    db.refresh(u)
    db.refresh(pu)
    assert pu.onboarding_acknowledged_no_employer is True
    assert u.onboard_complete is True
    assert db.query(Job).filter(Job.private_user_id == pu.private_user_id).count() == 0


def test_onboard_without_job_or_salary_uses_ack(db: Session, _engine):
    u, pu = _private_user(db)

    client = _client(_engine, u.user_id)
    try:
        resp = client.post(
            "/api/v1/user/onboard",
            json={
                "user_data": {
                    "private_user_id": pu.private_user_id,
                    "onboarding_acknowledged_no_employer": True,
                }
            },
        )
    finally:
        _clear()

    assert resp.status_code in (200, 201), resp.text
    body = resp.json()
    assert body["status"] == "success"
    assert body["missing"] == []

    db.refresh(u)
    assert u.onboard_complete is True
    assert db.query(Job).filter(Job.private_user_id == pu.private_user_id).count() == 0


def test_onboard_minimal_job_without_salary(db: Session, _engine):
    """Setup can create a job (employer + schedule) without a salary row yet."""
    u, pu = _private_user(db)

    client = _client(_engine, u.user_id)
    try:
        resp = client.post(
            "/api/v1/user/onboard",
            json={
                "user_data": {"private_user_id": pu.private_user_id},
                "job_data": {
                    "private_user_id": pu.private_user_id,
                    "job_title": "Cleaner",
                    "employer_name": "Acme Ltd",
                    "employer_brn": f"ACME_{uuid.uuid4().hex[:6]}",
                    "work_days": {"Monday": "8", "Tuesday": "8"},
                },
            },
        )
    finally:
        _clear()

    assert resp.status_code in (200, 201), resp.text
    body = resp.json()
    assert body["status"] == "success"
    assert body["missing"] == []

    db.refresh(u)
    assert u.onboard_complete is True
    jobs = db.query(Job).filter(Job.private_user_id == pu.private_user_id).all()
    assert len(jobs) == 1
    assert db.query(Salary).filter(Salary.job_id == jobs[0].job_id).count() == 0


def test_onboard_tolerates_locale_time_format(db: Session, _engine):
    """French-locale "08 h 00" / "17 h 30" must not 422 the whole write."""
    u, pu = _private_user(db)

    client = _client(_engine, u.user_id)
    try:
        resp = client.post(
            "/api/v1/user/onboard",
            json={
                "user_data": {"private_user_id": pu.private_user_id},
                "job_data": {
                    "private_user_id": pu.private_user_id,
                    "job_title": "Vendeuse",
                    "employer_name": "Zilwa Eklere Ltd",
                    "employer_brn": f"ZILWA_{uuid.uuid4().hex[:6]}",
                    "work_start_time": "08 h 00",
                    "work_end_time": "17 h 30",
                    "work_days": {"Monday": "8"},
                },
            },
        )
    finally:
        _clear()

    assert resp.status_code in (200, 201), resp.text
    assert resp.json()["status"] == "success"
    job = db.query(Job).filter(Job.private_user_id == pu.private_user_id).one()
    assert job.work_start_time == time(8, 0)
    assert job.work_end_time == time(17, 30)


def test_onboard_without_job_or_ack_stays_incomplete(db: Session, _engine):
    u, pu = _private_user(db)

    client = _client(_engine, u.user_id)
    try:
        resp = client.post(
            "/api/v1/user/onboard",
            json={"user_data": {"private_user_id": pu.private_user_id}},
        )
    finally:
        _clear()

    assert resp.status_code in (200, 201), resp.text
    body = resp.json()
    assert body["status"] == "success"
    assert "profile.employer_link" in body["missing"]

    db.refresh(u)
    assert u.onboard_complete is False
