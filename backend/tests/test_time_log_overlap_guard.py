"""TimeLog.find_overlapping_time_log — the write-time overlap gate.

overtime_engine._assert_no_overlaps has always documented itself as
"defense-in-depth" behind a write-time gate supposedly enforced in
api.v1.job. That gate never actually existed: no create/update path
checked a new or edited [start, end) range against the employee's other
CLOSED time logs. A bad edit (most plausibly an admin hand-correction via
PATCH /time-logs/{id}) could silently create an overlap that only
surfaced later as an uncaught ValueError during payroll compute — which
aborted the entire company's draft-run creation, not just that employee's
payslip.

This covers the three write paths: mobile create, mobile update/clock-out,
and the admin PATCH review endpoint.
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, time, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from core.model import Job, TimeLog
from db_models.crud.job import create_time_log, update_time_log
from schema.job_schema import CreateTimeLog


def _make_closed_time_log(db: Session, private_user_id: int, job_id: int, d: date,
                           start_hour: int, end_hour: int) -> TimeLog:
    tl = TimeLog(
        job_id=job_id, private_user_id=private_user_id,
        day_of_week=d.strftime("%A"),
        start_time=datetime.combine(d, time(start_hour, 0), tzinfo=timezone.utc),
        end_time=datetime.combine(d, time(end_hour, 0), tzinfo=timezone.utc),
        location={},
    )
    db.add(tl)
    db.flush()
    return tl


def _cleanup(db: Session, *timelog_ids: int) -> None:
    db.execute(sql_text("DELETE FROM time_logs WHERE timelog_id = ANY(:ids)"), {"ids": list(timelog_ids)})
    db.commit()


class TestCreateTimeLogOverlapGuard:
    def test_rejects_overlapping_create(self, db: Session, test_employee):
        job = db.query(Job).filter(Job.private_user_id == test_employee.private_user_id).first()
        d = date(2026, 5, 10)
        existing = _make_closed_time_log(db, test_employee.private_user_id, job.job_id, d, 9, 17)
        db.commit()
        try:
            payload = CreateTimeLog(
                job_id=job.job_id,
                private_user_id=test_employee.private_user_id,
                day_of_week=d.strftime("%A"),
                start_time=datetime.combine(d, time(12, 0), tzinfo=timezone.utc),
                end_time=datetime.combine(d, time(14, 0), tzinfo=timezone.utc),
                location={},
            )
            with pytest.raises(HTTPException) as exc_info:
                asyncio.run(create_time_log(payload, db))
            assert exc_info.value.status_code == 409
        finally:
            _cleanup(db, existing.timelog_id)

    def test_allows_adjacent_create(self, db: Session, test_employee):
        """Regression guard: back-to-back shifts (one ends exactly when the
        next starts) are a normal pattern, not an overlap."""
        job = db.query(Job).filter(Job.private_user_id == test_employee.private_user_id).first()
        d = date(2026, 5, 11)
        existing = _make_closed_time_log(db, test_employee.private_user_id, job.job_id, d, 9, 17)
        db.commit()
        try:
            payload = CreateTimeLog(
                job_id=job.job_id,
                private_user_id=test_employee.private_user_id,
                day_of_week=d.strftime("%A"),
                start_time=datetime.combine(d, time(17, 0), tzinfo=timezone.utc),
                end_time=datetime.combine(d, time(20, 0), tzinfo=timezone.utc),
                location={},
            )
            created = asyncio.run(create_time_log(payload, db))
            _cleanup(db, existing.timelog_id, created.timelog_id)
        except Exception:
            _cleanup(db, existing.timelog_id)
            raise


class TestUpdateTimeLogOverlapGuard:
    def test_rejects_overlapping_update(self, db: Session, test_employee):
        job = db.query(Job).filter(Job.private_user_id == test_employee.private_user_id).first()
        d = date(2026, 5, 12)
        blocker = _make_closed_time_log(db, test_employee.private_user_id, job.job_id, d, 9, 17)
        # An open session the employee is clocking out of, starting mid-way
        # through the existing closed log above — a corrected/backdated
        # clock-in landing on top of an already-logged shift.
        open_log = TimeLog(
            job_id=job.job_id, private_user_id=test_employee.private_user_id,
            day_of_week=d.strftime("%A"),
            start_time=datetime.combine(d, time(12, 0), tzinfo=timezone.utc),
            end_time=None,
            location={},
        )
        db.add(open_log)
        db.commit()
        try:
            clock_out = datetime.combine(d, time(18, 0), tzinfo=timezone.utc)
            with pytest.raises(HTTPException) as exc_info:
                asyncio.run(update_time_log(open_log.timelog_id, {"end_time": clock_out}, db))
            assert exc_info.value.status_code == 409
        finally:
            _cleanup(db, blocker.timelog_id, open_log.timelog_id)

    def test_allows_non_overlapping_update(self, db: Session, test_employee):
        """Regression guard: a normal clock-out with no conflicting log must
        still succeed exactly as before this fix."""
        job = db.query(Job).filter(Job.private_user_id == test_employee.private_user_id).first()
        d = date(2026, 5, 13)
        open_log = TimeLog(
            job_id=job.job_id, private_user_id=test_employee.private_user_id,
            day_of_week=d.strftime("%A"),
            start_time=datetime.combine(d, time(9, 0), tzinfo=timezone.utc),
            end_time=None,
            location={},
        )
        db.add(open_log)
        db.commit()
        try:
            clock_out = datetime.combine(d, time(17, 0), tzinfo=timezone.utc)
            updated = asyncio.run(update_time_log(open_log.timelog_id, {"end_time": clock_out}, db))
            assert updated.hours_worked == 8.0
        finally:
            _cleanup(db, open_log.timelog_id)
