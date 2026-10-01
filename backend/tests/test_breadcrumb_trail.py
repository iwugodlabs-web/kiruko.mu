"""Shift-trail breadcrumbs (forgotten clock-out locator) — service-level tests.

Covers:
  * append_breadcrumb pins fixes onto an OPEN session, dedups by recorded_at,
    and rejects closed sessions (400);
  * _finalize_active_log attaches a fresh crumb as an *estimated* clock-out
    fix using the offline `Coordinates:` address convention (resolvable by
    every client with zero client changes);
  * stale trails (>4h) and pre-existing clock_out fixes are left alone —
    no invented or overwritten locations.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session


def _setup(db: Session) -> dict:
    from core.model import Company, Job, PrivateUser, TimeLog, User

    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    db.commit()

    suffix = datetime.utcnow().strftime("%H%M%S%f")

    owner = User(
        user_type="company",
        email=f"trail-owner-{suffix}@kontokaz.test",
        user_name=f"trail-owner-{suffix}",
        password_hash="x",
    )
    db.add(owner)
    db.flush()

    co = Company(
        user_id=owner.user_id,
        company_name=f"Trail Co {suffix}",
        email=f"trail-{suffix}@kontokaz.test",
        brn=f"TRAIL_BRN_{suffix}",
        country_code="MU",
    )
    db.add(co)
    db.flush()

    emp_user = User(
        user_type="private",
        email=f"trail-emp-{suffix}@kontokaz.test",
        user_name=f"trail-emp-{suffix}",
        password_hash="x",
    )
    db.add(emp_user)
    db.flush()

    priv = PrivateUser(
        user_id=emp_user.user_id,
        first_name="Trail",
        last_name="Walker",
        company_id=co.company_id,
        role="employee",
    )
    db.add(priv)
    db.flush()

    job = Job(
        private_user_id=priv.private_user_id,
        company_id=co.company_id,
        job_title="Tester",
        employer_name="Trail Co",
        employer_brn=co.brn,
    )
    db.add(job)
    db.flush()

    tl = TimeLog(
        job_id=job.job_id,
        private_user_id=priv.private_user_id,
        day_of_week="Wednesday",
        start_time=datetime(2026, 4, 1, 9, 0, tzinfo=timezone.utc),
        end_time=None,
        location={"address": "HQ"},
        hours_worked=None,
        auto_closed=False,
    )
    db.add(tl)
    db.commit()

    return {"tl_id": tl.timelog_id}


def _get(db: Session, tl_id: int):
    from core.model import TimeLog

    db.expire_all()
    return db.query(TimeLog).filter(TimeLog.timelog_id == tl_id).one()


class TestAppendBreadcrumb:
    def test_appends_and_dedups(self, db: Session):
        from services.time_log_service import TimeLogService

        fx = _setup(db)
        ts = datetime(2026, 4, 1, 17, 0, tzinfo=timezone.utc)
        r1 = TimeLogService.append_breadcrumb(db, _get(db, fx["tl_id"]), -20.16, 57.50, ts)
        assert r1["trail_points"] == 1
        # Same recorded_at replays safely (no duplicate).
        r2 = TimeLogService.append_breadcrumb(db, _get(db, fx["tl_id"]), -20.16, 57.50, ts)
        assert r2["trail_points"] == 1
        r3 = TimeLogService.append_breadcrumb(
            db, _get(db, fx["tl_id"]), -20.17, 57.51, ts + timedelta(minutes=30)
        )
        assert r3["trail_points"] == 2

    def test_rejects_closed_session(self, db: Session):
        from services.time_log_service import TimeLogService

        fx = _setup(db)
        tl = _get(db, fx["tl_id"])
        tl.end_time = datetime(2026, 4, 1, 18, 0, tzinfo=timezone.utc)
        db.commit()
        with pytest.raises(HTTPException) as exc:
            TimeLogService.append_breadcrumb(
                db, _get(db, fx["tl_id"]), -20.16, 57.50,
                datetime(2026, 4, 1, 17, 0, tzinfo=timezone.utc),
            )
        assert exc.value.status_code == 400


class TestTrailClockOutAttach:
    def test_fresh_crumb_attaches_estimated(self, db: Session):
        from services.time_log_service import TimeLogService

        fx = _setup(db)
        close_at = datetime(2026, 4, 1, 21, 0, tzinfo=timezone.utc)
        TimeLogService.append_breadcrumb(
            db, _get(db, fx["tl_id"]), -20.1620, 57.5012,
            close_at - timedelta(minutes=20),
        )
        tl = _get(db, fx["tl_id"])
        TimeLogService._finalize_active_log(tl, close_at, auto_closed=True)
        db.commit()
        tl = _get(db, fx["tl_id"])
        assert tl.auto_closed is True
        fix = tl.location["clock_out"]
        assert fix["estimated"] is True
        assert fix["address"] == "Coordinates: -20.1620, 57.5012"
        assert fix["basis"] == "breadcrumb"

    def test_stale_crumb_leaves_absence(self, db: Session):
        from services.time_log_service import TimeLogService

        fx = _setup(db)
        close_at = datetime(2026, 4, 1, 21, 0, tzinfo=timezone.utc)
        TimeLogService.append_breadcrumb(
            db, _get(db, fx["tl_id"]), -20.1620, 57.5012,
            close_at - timedelta(hours=6),
        )
        tl = _get(db, fx["tl_id"])
        TimeLogService._finalize_active_log(tl, close_at, auto_closed=True)
        db.commit()
        tl = _get(db, fx["tl_id"])
        assert "clock_out" not in tl.location

    def test_device_fix_never_overwritten(self, db: Session):
        from services.time_log_service import TimeLogService

        fx = _setup(db)
        tl = _get(db, fx["tl_id"])
        loc = dict(tl.location or {})
        loc["clock_out"] = {"address": "Real Street 1"}
        tl.location = loc
        from sqlalchemy.orm.attributes import flag_modified

        flag_modified(tl, "location")
        db.commit()
        close_at = datetime(2026, 4, 1, 21, 0, tzinfo=timezone.utc)
        TimeLogService.append_breadcrumb(
            db, _get(db, fx["tl_id"]), -20.1620, 57.5012,
            close_at - timedelta(minutes=20),
        )
        tl = _get(db, fx["tl_id"])
        TimeLogService._finalize_active_log(tl, close_at, auto_closed=True)
        db.commit()
        tl = _get(db, fx["tl_id"])
        assert tl.location["clock_out"] == {"address": "Real Street 1"}
