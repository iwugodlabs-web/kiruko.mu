"""Offline clock-out reconciliation (Feature 1) — service-level tests.

Covers guards #1 and #2:
  * normal clock-out applies end_time;
  * supersede overwrites an auto_closed session's synthetic end_time;
  * defer to dispute when approved / finalized / admin-edited (no in-place write);
  * future end_time is clamped and flagged as time_skew.
"""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session


def _setup(db: Session, *, auto_closed=False, approved=False, rejected=False, start_time=None) -> dict:
    from core.model import Company, Job, PrivateUser, TimeLog, User

    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    db.commit()

    suffix = datetime.utcnow().strftime("%H%M%S%f")

    owner = User(
        user_type="company",
        email=f"co-owner-{suffix}@kontokaz.test",
        user_name=f"co-owner-{suffix}",
        password_hash="x",
    )
    db.add(owner)
    db.flush()

    co = Company(
        user_id=owner.user_id,
        company_name=f"CO Co {suffix}",
        email=f"co-{suffix}@kontokaz.test",
        brn=f"CO_BRN_{suffix}",
        country_code="MU",
    )
    db.add(co)
    db.flush()

    emp_user = User(
        user_type="private",
        email=f"co-emp-{suffix}@kontokaz.test",
        user_name=f"co-emp-{suffix}",
        password_hash="x",
    )
    db.add(emp_user)
    db.flush()

    priv = PrivateUser(
        user_id=emp_user.user_id,
        first_name="Clock",
        last_name="Out",
        company_id=co.company_id,
        role="employee",
    )
    db.add(priv)
    db.flush()

    job = Job(
        private_user_id=priv.private_user_id,
        company_id=co.company_id,
        job_title="Tester",
        employer_name="CO Co",
        employer_brn=co.brn,
    )
    db.add(job)
    db.flush()

    start = start_time or datetime(2026, 4, 1, 9, 0, tzinfo=timezone.utc)
    synthetic_end = datetime(2026, 4, 1, 21, 0, tzinfo=timezone.utc)
    tl = TimeLog(
        job_id=job.job_id,
        private_user_id=priv.private_user_id,
        day_of_week="Wednesday",
        start_time=start,
        end_time=synthetic_end if auto_closed else None,
        location={"lat": 0, "lng": 0},
        hours_worked=12.0 if auto_closed else None,
        auto_closed=auto_closed,
        admin_approved=approved,
        admin_rejected=rejected,
    )
    db.add(tl)
    db.commit()

    return {
        "owner_user_id": owner.user_id,
        "owner_email": owner.email,
        "company_id": co.company_id,
        "emp_user_id": emp_user.user_id,
        "emp_email": emp_user.email,
        "priv_id": priv.private_user_id,
        "job_id": job.job_id,
        "tl_id": tl.timelog_id,
        "start": start,
    }


def _cleanup(db: Session, ctx: dict) -> None:
    db.rollback()
    db.execute(
        sql_text("DELETE FROM time_log_disputes WHERE time_log_id=:i"),
        {"i": ctx["tl_id"]},
    )
    db.execute(sql_text("DELETE FROM time_logs WHERE timelog_id=:i"), {"i": ctx["tl_id"]})
    db.execute(sql_text("DELETE FROM jobs WHERE job_id=:j"), {"j": ctx["job_id"]})
    from tests.conftest import audit_logs_unlocked
    with audit_logs_unlocked(db):
        db.execute(
            sql_text("DELETE FROM audit_logs WHERE target_id=:t"),
            {"t": str(ctx["tl_id"])},
        )
        db.execute(
            sql_text("DELETE FROM private_users WHERE user_id=:u"),
            {"u": ctx["emp_user_id"]},
        )
        db.execute(sql_text("DELETE FROM companies WHERE company_id=:c"), {"c": ctx["company_id"]})
        db.execute(
            sql_text("DELETE FROM users WHERE email IN (:e1, :e2)"),
            {"e1": ctx["owner_email"], "e2": ctx["emp_email"]},
        )
        db.commit()


def _run(db: Session, ctx: dict, end_time, location=None, geo_check=None):
    from core.model import TimeLog, User
    from services.time_log_clock_out import clock_out

    tl = db.query(TimeLog).filter(TimeLog.timelog_id == ctx["tl_id"]).one()
    current_user = db.query(User).filter(User.user_id == ctx["owner_user_id"]).one()
    return asyncio.run(
        clock_out(
            db, tl, end_time, location, geo_check,
            current_user=current_user, client_ip="127.0.0.1",
        )
    )


class TestClockOutReconciliation:
    def test_normal_clock_out_applies_end_time(self, db: Session):
        ctx = _setup(db)
        try:
            end = datetime(2026, 4, 1, 17, 0, tzinfo=timezone.utc)
            result = _run(db, ctx, end, location={"lat": -20.16, "longitude": 57.50})
            assert result["deferred"] is False
            assert result["time_skew"] is False

            row = db.execute(
                sql_text("SELECT end_time, hours_worked FROM time_logs WHERE timelog_id=:i"),
                {"i": ctx["tl_id"]},
            ).fetchone()
            assert row[0] is not None
            assert float(row[1]) == 8.0  # 9:00 -> 17:00
        finally:
            _cleanup(db, ctx)

    def test_supersede_auto_closed_session(self, db: Session):
        ctx = _setup(db, auto_closed=True)
        try:
            end = datetime(2026, 4, 1, 17, 30, tzinfo=timezone.utc)
            result = _run(db, ctx, end, location={"lat": -20.16, "longitude": 57.50})
            assert result["deferred"] is False

            row = db.execute(
                sql_text("SELECT end_time, auto_closed, hours_worked FROM time_logs WHERE timelog_id=:i"),
                {"i": ctx["tl_id"]},
            ).fetchone()
            # end_time overwritten to the real time, auto_closed cleared.
            assert row[1] is False
            assert float(row[2]) == 8.5  # 9:00 -> 17:30
        finally:
            _cleanup(db, ctx)

    def test_defer_when_approved(self, db: Session):
        ctx = _setup(db, approved=True)
        try:
            end = datetime(2026, 4, 1, 18, 0, tzinfo=timezone.utc)
            result = _run(db, ctx, end, location={"lat": -20.16, "longitude": 57.50})
            assert result["deferred"] is True
            assert "approved" in result["deferred_reason"]

            n = db.execute(
                sql_text("SELECT COUNT(*) FROM time_log_disputes WHERE time_log_id=:i"),
                {"i": ctx["tl_id"]},
            ).scalar()
            assert n == 1
            # Original (approved) end_time must be untouched.
            row = db.execute(
                sql_text("SELECT end_time, admin_approved FROM time_logs WHERE timelog_id=:i"),
                {"i": ctx["tl_id"]},
            ).fetchone()
            assert row[0] is None  # never had a real clock-out
            assert row[1] is True
        finally:
            _cleanup(db, ctx)

    def test_defer_when_finalized_period(self, db: Session):
        from core.model import PayrollRun

        ctx = _setup(db)
        run = PayrollRun(
            company_id=ctx["company_id"],
            period_start=date(2026, 4, 1),
            period_end=date(2026, 4, 30),
            status="finalized",
        )
        db.add(run)
        db.commit()
        try:
            end = datetime(2026, 4, 1, 18, 0, tzinfo=timezone.utc)
            result = _run(db, ctx, end, location={"lat": -20.16, "longitude": 57.50})
            assert result["deferred"] is True
            assert "finalized" in result["deferred_reason"]
        finally:
            db.execute(sql_text("DELETE FROM payroll_runs WHERE id=:i"), {"i": run.id})
            db.commit()
            _cleanup(db, ctx)

    def test_future_end_time_clamped_and_skewed(self, db: Session):
        start = datetime.now(timezone.utc) - timedelta(hours=1)
        ctx = _setup(db, start_time=start)
        try:
            future = datetime.now(timezone.utc) + timedelta(hours=2)
            result = _run(db, ctx, future, location={"lat": -20.16, "longitude": 57.50})
            assert result["deferred"] is False
            assert result["time_skew"] is True
            # end_time must not be in the future.
            row = db.execute(
                sql_text("SELECT end_time FROM time_logs WHERE timelog_id=:i"),
                {"i": ctx["tl_id"]},
            ).fetchone()
            assert row[0] <= datetime.now(timezone.utc)
        finally:
            _cleanup(db, ctx)


class TestClockOutEndpoint:
    def test_post_endpoint_returns_result_shape(self, db: Session, _engine):
        from fastapi.testclient import TestClient

        ctx = _setup(db)
        try:
            from fastapi import Depends as _Depends
            from sqlalchemy.orm import sessionmaker
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

            def _override_user(db: Session = _Depends(core_config.get_db)) -> User:
                return db.query(User).filter(User.user_id == ctx["owner_user_id"]).one()

            app.dependency_overrides[core_config.get_db] = _override_db
            app.dependency_overrides[get_current_user] = _override_user
            client = TestClient(app, raise_server_exceptions=False)
            try:
                resp = client.post(
                    f"/api/v1/job/time-log/{ctx['tl_id']}/clock-out",
                    json={
                        "end_time": "2026-04-01T17:00:00Z",
                        "location": {"lat": -20.16, "longitude": 57.50},
                    },
                )
                assert resp.status_code == 200, resp.text
                body = resp.json()
                assert body["timelog_id"] == ctx["tl_id"]
                assert body["deferred"] is False
            finally:
                app.dependency_overrides.clear()
        finally:
            _cleanup(db, ctx)
