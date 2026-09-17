"""Review-by-exception: classifier + persisted columns + list filter.

Covers:
  * classify_exceptions returns the right reason keys per signal.
  * recompute persists needs_review / exception_reasons.
  * list endpoint's needs_review=true/false filter buckets rows correctly
    (unclassified NULL rows surface as "needs review").
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session


# ---------------------------------------------------------------------------
# Classifier unit tests (no DB)
# ---------------------------------------------------------------------------


def _tl(**kw) -> "TimeLog":
    from core.model import TimeLog

    base = dict(
        job_id=1,
        private_user_id=1,
        day_of_week="Monday",
        start_time=datetime(2026, 4, 1, 9, 0, tzinfo=timezone.utc),
        location={"lat": 0, "lng": 0},
    )
    base.update(kw)
    return TimeLog(**base)


class TestClassifier:
    def test_clean_session_has_no_reasons(self):
        from services.time_log_classifier import classify_exceptions

        tl = _tl(
            end_time=datetime(2026, 4, 1, 17, 0, tzinfo=timezone.utc),
            location={"lat": 0, "lng": 0, "clock_out": {"lat": 0, "lng": 0}},
        )
        assert classify_exceptions(tl) == []

    def test_auto_closed_flagged(self):
        from services.time_log_classifier import classify_exceptions

        tl = _tl(auto_closed=True, end_time=datetime(2026, 4, 1, 17, 0, tzinfo=timezone.utc))
        reasons = classify_exceptions(tl)
        assert "auto_closed" in reasons

    def test_geofence_and_schedule_signals(self):
        from services.time_log_classifier import classify_exceptions

        tl = _tl(
            out_of_geofence=True,
            out_of_schedule=True,
            is_late=True,
            end_time=datetime(2026, 4, 1, 17, 0, tzinfo=timezone.utc),
            location={"lat": 0, "lng": 0, "clock_out": {"lat": 0, "lng": 0}},
        )
        reasons = classify_exceptions(tl)
        assert "out_of_geofence" in reasons
        assert "out_of_schedule" in reasons
        assert "late" in reasons

    def test_unconfirmed_overtime_flagged_but_confirmed_not(self):
        from services.time_log_classifier import classify_exceptions

        tl = _tl(is_overtime=True, overtime_confirmed_by_employer=False)
        assert "overtime_unconfirmed" in classify_exceptions(tl)

        tl2 = _tl(is_overtime=True, overtime_confirmed_by_employer=True)
        assert "overtime_unconfirmed" not in classify_exceptions(tl2)

    def test_mock_location_and_low_accuracy(self):
        from services.time_log_classifier import classify_exceptions

        mock = _tl(geofence_check_json={"mock_detected": True, "reason": "mock_detected"})
        assert "mock_location" in classify_exceptions(mock)

        imprecise = _tl(geofence_check_json={"accuracy_m": 300.0, "reason": "inside"})
        assert "low_accuracy" in classify_exceptions(imprecise)

    def test_recompute_persists_columns(self):
        from services.time_log_classifier import recompute

        tl = _tl(auto_closed=True, end_time=datetime(2026, 4, 1, 17, 0, tzinfo=timezone.utc))
        recompute(tl)
        assert tl.needs_review is True
        assert "auto_closed" in tl.exception_reasons


class TestSampling:
    def test_deterministic_and_bounded(self):
        from services.time_log_classifier import is_sampled_for_review

        assert is_sampled_for_review(1, 123, 0) is False
        assert is_sampled_for_review(1, 123, 100) is True
        # Same input → same output (stability).
        assert is_sampled_for_review(7, 999, 30) == is_sampled_for_review(7, 999, 30)
        # Different company for the same timelog_id may differ.
        assert isinstance(is_sampled_for_review(7, 999, 30), bool)

    def test_distribution_roughly_matches_pct(self):
        from services.time_log_classifier import is_sampled_for_review

        pct = 25
        n = 2000
        sampled = sum(1 for i in range(n) if is_sampled_for_review(1, i, pct))
        assert 0.15 * n < sampled < 0.35 * n, f"sampled {sampled}/{n}"


# ---------------------------------------------------------------------------
# List filter integration test
# ---------------------------------------------------------------------------


def _setup_review(db: Session, sample_pct: int = 0) -> dict:
    from core.model import Company, Job, PrivateUser, TimeLog, User

    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    db.commit()

    suffix = datetime.utcnow().strftime("%H%M%S%f")

    owner = User(
        user_type="company",
        email=f"rbe-owner-{suffix}@kontokaz.test",
        user_name=f"rbe-owner-{suffix}",
        password_hash="x",
    )
    db.add(owner)
    db.flush()

    co = Company(
        user_id=owner.user_id,
        company_name=f"RBE Co {suffix}",
        email=f"rbe-{suffix}@kontokaz.test",
        brn=f"RBE_BRN_{suffix}",
        country_code="MU",
        review_sample_pct=sample_pct,
    )
    db.add(co)
    db.flush()

    emp_user = User(
        user_type="private",
        email=f"rbe-emp-{suffix}@kontokaz.test",
        user_name=f"rbe-emp-{suffix}",
        password_hash="x",
    )
    db.add(emp_user)
    db.flush()

    priv = PrivateUser(
        user_id=emp_user.user_id,
        first_name="Review",
        last_name="Exception",
        company_id=co.company_id,
        role="employee",
    )
    db.add(priv)
    db.flush()

    job = Job(
        private_user_id=priv.private_user_id,
        company_id=co.company_id,
        job_title="Tester",
        employer_name="RBE Co",
        employer_brn=co.brn,
    )
    db.add(job)
    db.flush()

    ids = []
    for day, needs_review, reasons in (
        (1, True, ["late"]),
        (2, False, []),
        (3, None, None),  # unclassified (simulates pre-backfill)
    ):
        tl = TimeLog(
            job_id=job.job_id,
            private_user_id=priv.private_user_id,
            day_of_week="Wednesday",
            start_time=datetime(2026, 4, day, 9, 0, tzinfo=timezone.utc),
            end_time=datetime(2026, 4, day, 17, 0, tzinfo=timezone.utc),
            location={"lat": 0, "lng": 0},
            needs_review=needs_review,
            exception_reasons=reasons if reasons is not None else None,
        )
        db.add(tl)
        db.flush()
        ids.append(tl.timelog_id)
    db.commit()

    return {
        "owner_user_id": owner.user_id,
        "owner_email": owner.email,
        "company_id": co.company_id,
        "emp_email": emp_user.email,
        "tl_ids": ids,
    }


def _cleanup_review(db: Session, ctx: dict) -> None:
    db.rollback()
    db.execute(sql_text("DELETE FROM time_logs WHERE timelog_id = ANY(:ids)"), {"ids": ctx["tl_ids"]})
    db.execute(sql_text("DELETE FROM jobs WHERE company_id=:c"), {"c": ctx["company_id"]})
    from tests.conftest import audit_logs_unlocked
    with audit_logs_unlocked(db):
        db.execute(sql_text("DELETE FROM private_users WHERE company_id=:c"), {"c": ctx["company_id"]})
        db.execute(sql_text("DELETE FROM companies WHERE company_id=:c"), {"c": ctx["company_id"]})
        db.execute(
            sql_text("DELETE FROM users WHERE email IN (:e1, :e2)"),
            {"e1": ctx["owner_email"], "e2": ctx["emp_email"]},
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
    return app  # caller wraps in TestClient


class TestListNeedsReviewFilter:
    def test_filter_buckets_rows(self, db: Session, _engine):
        from fastapi.testclient import TestClient

        ctx = _setup_review(db)
        try:
            app = _client(_engine, ctx["owner_user_id"])
            client = TestClient(app, raise_server_exceptions=False)
            try:
                base = f"/api/v1/companies/{ctx['company_id']}/time-logs"
                month = {"month": "2026-04"}

                all_rows = client.get(base, params=month).json()
                assert len(all_rows) == 3

                needs = client.get(base, params={**month, "needs_review": "true"}).json()
                needs_ids = {r["timelog_id"] for r in needs}
                # late (flagged) + unclassified (NULL) → both "needs review"
                assert ctx["tl_ids"][0] in needs_ids
                assert ctx["tl_ids"][2] in needs_ids
                assert ctx["tl_ids"][1] not in needs_ids

                clean = client.get(base, params={**month, "needs_review": "false"}).json()
                clean_ids = {r["timelog_id"] for r in clean}
                assert clean_ids == {ctx["tl_ids"][1]}
            finally:
                from main import app as _app
                _app.dependency_overrides.clear()
        finally:
            _cleanup_review(db, ctx)


class TestRandomSampleAudit:
    def test_sample_pct_100_pulls_clean_into_needs_review(self, db: Session, _engine):
        from fastapi.testclient import TestClient

        ctx = _setup_review(db, sample_pct=100)
        try:
            app = _client(_engine, ctx["owner_user_id"])
            client = TestClient(app, raise_server_exceptions=False)
            try:
                base = f"/api/v1/companies/{ctx['company_id']}/time-logs"
                month = {"month": "2026-04"}

                needs = client.get(base, params={**month, "needs_review": "true"}).json()
                by_id = {r["timelog_id"]: r for r in needs}

                # Clean row (tl_ids[1]) is now pulled in and flagged as sample.
                assert ctx["tl_ids"][1] in by_id
                assert by_id[ctx["tl_ids"][1]]["sampled_for_review"] is True
                assert by_id[ctx["tl_ids"][1]]["needs_review"] is False
            finally:
                from main import app as _app
                _app.dependency_overrides.clear()
        finally:
            _cleanup_review(db, ctx)
