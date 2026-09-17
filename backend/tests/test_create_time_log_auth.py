"""The clock-in POST was previously unauthenticated. Regression guard for the
fix: a private employee may only create a time log for themselves; creating one
for a co-worker must 403."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session


def _setup(db: Session) -> dict:
    from core.model import Company, Job, PrivateUser, User

    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    db.commit()

    suffix = datetime.utcnow().strftime("%H%M%S%f")

    owner = User(
        user_type="company",
        email=f"ca-owner-{suffix}@kontokaz.test",
        user_name=f"ca-owner-{suffix}",
        password_hash="x",
    )
    db.add(owner)
    db.flush()

    co = Company(
        user_id=owner.user_id,
        company_name=f"CA Co {suffix}",
        email=f"ca-{suffix}@kontokaz.test",
        brn=f"CA_BRN_{suffix}",
        country_code="MU",
    )
    db.add(co)
    db.flush()

    def make_emp(tag):
        u = User(
            user_type="private",
            email=f"ca-emp-{tag}-{suffix}@kontokaz.test",
            user_name=f"ca-emp-{tag}-{suffix}",
            password_hash="x",
        )
        db.add(u)
        db.flush()
        p = PrivateUser(
            user_id=u.user_id,
            first_name=f"Emp{tag}",
            last_name="Tester",
            company_id=co.company_id,
            role="employee",
        )
        db.add(p)
        db.flush()
        return u, p

    emp_a, priv_a = make_emp("A")
    emp_b, priv_b = make_emp("B")

    job = Job(
        private_user_id=priv_a.private_user_id,
        company_id=co.company_id,
        job_title="Tester",
        employer_name="CA Co",
        employer_brn=co.brn,
    )
    db.add(job)
    db.commit()

    return {
        "owner_user_id": owner.user_id,
        "owner_email": owner.email,
        "company_id": co.company_id,
        "emp_a_user_id": emp_a.user_id,
        "emp_a_email": emp_a.email,
        "emp_b_email": emp_b.email,
        "priv_a_id": priv_a.private_user_id,
        "priv_b_id": priv_b.private_user_id,
        "job_id": job.job_id,
        "emails": [owner.email, emp_a.email, emp_b.email],
    }


def _cleanup(db: Session, ctx: dict) -> None:
    db.rollback()
    db.execute(sql_text("DELETE FROM jobs WHERE job_id=:j"), {"j": ctx["job_id"]})
    from tests.conftest import audit_logs_unlocked
    with audit_logs_unlocked(db):
        db.execute(sql_text("DELETE FROM private_users WHERE company_id=:c"), {"c": ctx["company_id"]})
        db.execute(sql_text("DELETE FROM companies WHERE company_id=:c"), {"c": ctx["company_id"]})
        db.execute(
            sql_text("DELETE FROM users WHERE email = ANY(:emails)"),
            {"emails": ctx["emails"]},
        )
        db.commit()


def _client(_engine, current_user_id: int):
    from fastapi import Depends as _Depends
    from sqlalchemy.orm import Session as _Session, sessionmaker
    from core import config as core_config
    from core.dependencies import get_current_user
    from core.model import User
    from main import app

    SessionFactory = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

    def _override_db():
        s = SessionFactory()
        try:
            yield s
        finally:
            s.close()

    def _override_user(db: _Session = _Depends(core_config.get_db)) -> User:
        return db.query(User).filter(User.user_id == current_user_id).one()

    app.dependency_overrides[core_config.get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_user
    return app


def _payload(ctx: dict, private_user_id: int) -> dict:
    return {
        "job_id": ctx["job_id"],
        "private_user_id": private_user_id,
        "day_of_week": "Monday",
        "start_time": "2026-04-01T09:00:00Z",
        "location": {"latitude": -20.16, "longitude": 57.50},
    }


class TestCreateTimeLogAuth:
    def test_private_user_cannot_clock_in_for_coworker(self, db: Session, _engine):
        from fastapi.testclient import TestClient

        ctx = _setup(db)
        try:
            app = _client(_engine, ctx["emp_a_user_id"])
            client = TestClient(app, raise_server_exceptions=False)
            try:
                resp = client.post(
                    "/api/v1/job/create-time-log",
                    json=_payload(ctx, ctx["priv_b_id"]),  # co-worker's id
                )
                assert resp.status_code == 403, resp.text
            finally:
                from main import app as _app
                _app.dependency_overrides.clear()
        finally:
            _cleanup(db, ctx)

    def test_private_user_can_clock_in_for_self(self, db: Session, _engine):
        from fastapi.testclient import TestClient

        ctx = _setup(db)
        try:
            app = _client(_engine, ctx["emp_a_user_id"])
            client = TestClient(app, raise_server_exceptions=False)
            try:
                resp = client.post(
                    "/api/v1/job/create-time-log",
                    json=_payload(ctx, ctx["priv_a_id"]),
                )
                assert resp.status_code == 201, resp.text
            finally:
                from main import app as _app
                _app.dependency_overrides.clear()
        finally:
            _cleanup(db, ctx)

    def test_clock_in_is_idempotent_via_key(self, db: Session, _engine):
        """Queued clock-in replay: same Idempotency-Key + body must NOT create a
        duplicate session — the middleware returns the cached response."""
        from fastapi.testclient import TestClient

        ctx = _setup(db)
        key = f"clockin-{datetime.utcnow().strftime('%H%M%S%f')}"
        try:
            app = _client(_engine, ctx["emp_a_user_id"])
            client = TestClient(app, raise_server_exceptions=False)
            try:
                body = _payload(ctx, ctx["priv_a_id"])
                r1 = client.post(
                    "/api/v1/job/create-time-log",
                    json=body,
                    headers={"Idempotency-Key": key},
                )
                assert r1.status_code == 201, r1.text
                r2 = client.post(
                    "/api/v1/job/create-time-log",
                    json=body,
                    headers={"Idempotency-Key": key},
                )
                assert r2.status_code == 201, r2.text
                assert r1.json()["timelog_id"] == r2.json()["timelog_id"]
            finally:
                from main import app as _app
                _app.dependency_overrides.clear()

            n = db.execute(
                sql_text(
                    "SELECT COUNT(*) FROM time_logs WHERE private_user_id=:p AND job_id=:j"
                ),
                {"p": ctx["priv_a_id"], "j": ctx["job_id"]},
            ).scalar()
            assert n == 1
        finally:
            db.execute(sql_text("DELETE FROM idempotency_keys WHERE key=:k"), {"k": key})
            db.commit()
            _cleanup(db, ctx)
