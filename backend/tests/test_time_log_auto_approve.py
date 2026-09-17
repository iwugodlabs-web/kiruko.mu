"""Review-by-exception P2 — auto-approve clean clock-ins (opt-in).

Covers:
  * maybe_auto_approve auto-approves clean sessions only when the company opted
    in, and never sampled-for-audit sessions;
  * clean_pending_ids returns the "approve all clean" set (excludes sampled);
  * the approve-clean endpoint bulk-approves exactly that set.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session


def _setup(db: Session, *, auto_approve=False, sample_pct=0) -> dict:
    from core.model import Company, Job, PrivateUser, TimeLog, User

    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    db.commit()

    suffix = datetime.utcnow().strftime("%H%M%S%f")

    owner = User(
        user_type="company",
        email=f"aa-owner-{suffix}@kontokaz.test",
        user_name=f"aa-owner-{suffix}",
        password_hash="x",
    )
    db.add(owner)
    db.flush()

    co = Company(
        user_id=owner.user_id,
        company_name=f"AA Co {suffix}",
        email=f"aa-{suffix}@kontokaz.test",
        brn=f"AA_BRN_{suffix}",
        country_code="MU",
        auto_approve_clean_clockins=auto_approve,
        review_sample_pct=sample_pct,
    )
    db.add(co)
    db.flush()

    emp_user = User(
        user_type="private",
        email=f"aa-emp-{suffix}@kontokaz.test",
        user_name=f"aa-emp-{suffix}",
        password_hash="x",
    )
    db.add(emp_user)
    db.flush()

    priv = PrivateUser(
        user_id=emp_user.user_id,
        first_name="Auto",
        last_name="Approve",
        company_id=co.company_id,
        role="employee",
    )
    db.add(priv)
    db.flush()

    job = Job(
        private_user_id=priv.private_user_id,
        company_id=co.company_id,
        job_title="Tester",
        employer_name="AA Co",
        employer_brn=co.brn,
    )
    db.add(job)
    db.flush()

    # Two clean, pending sessions (needs_review=False) + one flagged (late).
    tl_clean_a = TimeLog(
        job_id=job.job_id,
        private_user_id=priv.private_user_id,
        day_of_week="Wednesday",
        start_time=datetime(2026, 4, 1, 9, 0, tzinfo=timezone.utc),
        end_time=datetime(2026, 4, 1, 17, 0, tzinfo=timezone.utc),
        location={"lat": 0, "lng": 0, "clock_out": {"lat": 0, "lng": 0}},
        hours_worked=8.0,
        needs_review=False,
        exception_reasons=[],
    )
    tl_clean_b = TimeLog(
        job_id=job.job_id,
        private_user_id=priv.private_user_id,
        day_of_week="Wednesday",
        start_time=datetime(2026, 4, 2, 9, 0, tzinfo=timezone.utc),
        end_time=datetime(2026, 4, 2, 17, 0, tzinfo=timezone.utc),
        location={"lat": 0, "lng": 0, "clock_out": {"lat": 0, "lng": 0}},
        hours_worked=8.0,
        needs_review=False,
        exception_reasons=[],
    )
    tl_flagged = TimeLog(
        job_id=job.job_id,
        private_user_id=priv.private_user_id,
        day_of_week="Wednesday",
        start_time=datetime(2026, 4, 3, 9, 0, tzinfo=timezone.utc),
        end_time=datetime(2026, 4, 3, 17, 0, tzinfo=timezone.utc),
        location={"lat": 0, "lng": 0, "clock_out": {"lat": 0, "lng": 0}},
        hours_worked=8.0,
        is_late=True,
        needs_review=True,
        exception_reasons=["late"],
    )
    db.add_all([tl_clean_a, tl_clean_b, tl_flagged])
    db.commit()

    return {
        "owner_user_id": owner.user_id,
        "owner_email": owner.email,
        "company_id": co.company_id,
        "emp_user_id": emp_user.user_id,
        "emp_email": emp_user.email,
        "priv_id": priv.private_user_id,
        "job_id": job.job_id,
        "tl_ids": [tl_clean_a.timelog_id, tl_clean_b.timelog_id, tl_flagged.timelog_id],
    }


def _cleanup(db: Session, ctx: dict) -> None:
    db.rollback()
    db.execute(sql_text("DELETE FROM time_logs WHERE timelog_id = ANY(:ids)"), {"ids": ctx["tl_ids"]})
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


class TestMaybeAutoApprove:
    def test_auto_approves_clean_when_opted_in(self, db: Session):
        from core.model import TimeLog
        from services.time_log_auto_approve import maybe_auto_approve

        ctx = _setup(db, auto_approve=True)
        try:
            tl = db.query(TimeLog).filter(TimeLog.timelog_id == ctx["tl_ids"][0]).one()
            assert maybe_auto_approve(db, tl) is True
            db.commit()
            assert tl.admin_approved is True
            assert tl.admin_approved_by_user_id is None  # system marker
        finally:
            _cleanup(db, ctx)

    def test_no_auto_approve_when_not_opted_in(self, db: Session):
        from core.model import TimeLog
        from services.time_log_auto_approve import maybe_auto_approve

        ctx = _setup(db, auto_approve=False)
        try:
            tl = db.query(TimeLog).filter(TimeLog.timelog_id == ctx["tl_ids"][0]).one()
            assert maybe_auto_approve(db, tl) is False
            assert tl.admin_approved is False
        finally:
            _cleanup(db, ctx)

    def test_no_auto_approve_when_flagged(self, db: Session):
        from core.model import TimeLog
        from services.time_log_auto_approve import maybe_auto_approve

        ctx = _setup(db, auto_approve=True)
        try:
            tl = db.query(TimeLog).filter(TimeLog.timelog_id == ctx["tl_ids"][2]).one()
            assert tl.needs_review is True
            assert maybe_auto_approve(db, tl) is False
        finally:
            _cleanup(db, ctx)

    def test_no_auto_approve_when_sampled(self, db: Session):
        from core.model import TimeLog
        from services.time_log_auto_approve import maybe_auto_approve

        ctx = _setup(db, auto_approve=True, sample_pct=100)
        try:
            tl = db.query(TimeLog).filter(TimeLog.timelog_id == ctx["tl_ids"][0]).one()
            assert maybe_auto_approve(db, tl) is False
        finally:
            _cleanup(db, ctx)


class TestCleanPendingIds:
    def test_excludes_flagged(self, db: Session):
        from services.time_log_auto_approve import clean_pending_ids

        ctx = _setup(db)
        try:
            ids = clean_pending_ids(
                db,
                ctx["company_id"],
                datetime(2026, 4, 1, tzinfo=timezone.utc),
                datetime(2026, 4, 30, tzinfo=timezone.utc),
            )
            assert ctx["tl_ids"][0] in ids
            assert ctx["tl_ids"][1] in ids
            assert ctx["tl_ids"][2] not in ids  # flagged
        finally:
            _cleanup(db, ctx)


class TestApproveCleanEndpoint:
    def test_approve_clean_approves_only_clean(self, db: Session, _engine):
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

            def _override_user(db_s: Session = _Depends(core_config.get_db)) -> User:
                return db_s.query(User).filter(User.user_id == ctx["owner_user_id"]).one()

            app.dependency_overrides[core_config.get_db] = _override_db
            app.dependency_overrides[get_current_user] = _override_user
            client = TestClient(app, raise_server_exceptions=False)
            try:
                resp = client.post(
                    f"/api/v1/companies/{ctx['company_id']}/time-logs/approve-clean",
                    params={"month": "2026-04"},
                )
                assert resp.status_code == 200, resp.text
                body = resp.json()
                assert body["approved_count"] == 2

                rows = db.execute(
                    sql_text(
                        "SELECT admin_approved FROM time_logs WHERE timelog_id = ANY(:ids) ORDER BY timelog_id"
                    ),
                    {"ids": ctx["tl_ids"]},
                ).fetchall()
                assert rows == [(True,), (True,), (False,)]  # flagged stays unapproved
            finally:
                app.dependency_overrides.clear()
        finally:
            _cleanup(db, ctx)
