"""The review-by-exception migration folds historical classification into SQL.

This guards that the SQL backfill agrees with the Python classifier on
representative rows — so the "Needs review" view is correct for pre-deploy data.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session


def _setup(db: Session, **kw) -> dict:
    from core.model import Company, Job, PrivateUser, TimeLog, User

    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    db.commit()

    suffix = datetime.utcnow().strftime("%H%M%S%f")
    owner = User(user_type="company", email=f"bf-{suffix}@x.test", user_name=f"bf-{suffix}", password_hash="x")
    db.add(owner); db.flush()
    co = Company(user_id=owner.user_id, company_name=f"BF {suffix}", email=f"bf-{suffix}@x.test", brn=f"BF{suffix}", country_code="MU")
    db.add(co); db.flush()
    emp = User(user_type="private", email=f"bfe-{suffix}@x.test", user_name=f"bfe-{suffix}", password_hash="x")
    db.add(emp); db.flush()
    priv = PrivateUser(user_id=emp.user_id, first_name="B", last_name="F", company_id=co.company_id, role="employee")
    db.add(priv); db.flush()
    job = Job(private_user_id=priv.private_user_id, company_id=co.company_id, job_title="T", employer_name="BF", employer_brn=co.brn)
    db.add(job); db.flush()

    base = dict(
        job_id=job.job_id,
        private_user_id=priv.private_user_id,
        day_of_week="Monday",
        start_time=datetime(2026, 4, 1, 9, 0, tzinfo=timezone.utc),
        location={"lat": 0, "lng": 0},
    )
    base.update(kw)
    tl = TimeLog(**base)
    db.add(tl); db.flush()
    db.commit()

    return {
        "owner_email": owner.email,
        "emp_email": emp.email,
        "emp_user_id": emp.user_id,
        "company_id": co.company_id,
        "job_id": job.job_id,
        "tl_id": tl.timelog_id,
    }


def _cleanup(db: Session, ctx: dict):
    db.rollback()
    db.execute(sql_text("DELETE FROM time_log_disputes WHERE time_log_id=:i"), {"i": ctx["tl_id"]})
    db.execute(sql_text("DELETE FROM time_logs WHERE timelog_id=:i"), {"i": ctx["tl_id"]})
    db.execute(sql_text("DELETE FROM jobs WHERE job_id=:j"), {"j": ctx["job_id"]})
    from tests.conftest import audit_logs_unlocked
    with audit_logs_unlocked(db):
        db.execute(sql_text("DELETE FROM private_users WHERE user_id=:u"), {"u": ctx["emp_user_id"]})
        db.execute(sql_text("DELETE FROM companies WHERE company_id=:c"), {"c": ctx["company_id"]})
        db.execute(
            sql_text("DELETE FROM users WHERE email IN (:e1, :e2)"),
            {"e1": ctx["owner_email"], "e2": ctx["emp_email"]},
        )
        db.commit()


class TestMigrationBackfillAgreesWithClassifier:
    def _run_backfill(self, db: Session, ctx: dict):
        from services.time_log_backfill import BACKFILL_REASONS_SQL

        db.execute(sql_text("UPDATE time_logs SET needs_review=NULL, exception_reasons=NULL WHERE timelog_id=:i"), {"i": ctx["tl_id"]})
        db.commit()
        db.execute(sql_text(BACKFILL_REASONS_SQL))
        db.commit()

    def _assert_matches(self, db: Session, ctx: dict):
        from core.model import TimeLog
        from services.time_log_classifier import classify_exceptions

        row = db.execute(
            sql_text("SELECT needs_review, exception_reasons FROM time_logs WHERE timelog_id=:i"),
            {"i": ctx["tl_id"]},
        ).fetchone()
        tl = db.query(TimeLog).filter(TimeLog.timelog_id == ctx["tl_id"]).one()
        expected = set(classify_exceptions(tl))
        got = set(row[1] or [])
        assert got == expected, f"SQL backfill {got} != classifier {expected}"
        assert row[0] is (len(expected) > 0)

    def test_auto_closed_and_late(self, db: Session):
        ctx = _setup(db, auto_closed=True, is_late=True, end_time=datetime(2026, 4, 1, 21, 0, tzinfo=timezone.utc))
        try:
            self._run_backfill(db, ctx)
            self._assert_matches(db, ctx)
        finally:
            _cleanup(db, ctx)

    def test_geofence_mock(self, db: Session):
        ctx = _setup(db, geofence_check_json={"mock_detected": True, "reason": "mock_detected"})
        try:
            self._run_backfill(db, ctx)
            self._assert_matches(db, ctx)
        finally:
            _cleanup(db, ctx)

    def test_clean_session_stays_clean(self, db: Session):
        ctx = _setup(
            db,
            end_time=datetime(2026, 4, 1, 17, 0, tzinfo=timezone.utc),
            location={"lat": 0, "lng": 0, "clock_out": {"lat": 0, "lng": 0}},
        )
        try:
            self._run_backfill(db, ctx)
            self._assert_matches(db, ctx)
        finally:
            _cleanup(db, ctx)
