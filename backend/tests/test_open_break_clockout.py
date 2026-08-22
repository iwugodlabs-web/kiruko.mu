"""An open (never explicitly ended) break must still be deducted from
hours_worked at clock-out, through to the clock-out time — not silently
excluded. Before this fix, update_time_log's total_break_seconds query
filtered `BreakLog.end_time.isnot(None)`, so a break the employee started
but never formally ended (e.g. clocked back in without pressing "end
break" first) contributed zero deduction, inflating hours_worked. This is
what real payroll sums for hourly staff (proration.sum_hours_worked_in_period)
and what the employer-facing web attendance stat sums too — mobile's own
local hours calculation already falls back the open break's end to the
session's end_time, so the backend silently disagreeing with that was a
real, if narrow, bug (not just a display quirk).
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal as D

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from core.model import BreakLog, Job, TimeLog
from db_models.crud.job import update_time_log


def _make_open_time_log(db: Session, private_user_id: int, job_id: int, d: date) -> TimeLog:
    tl = TimeLog(
        job_id=job_id, private_user_id=private_user_id,
        day_of_week=d.strftime("%A"),
        start_time=datetime.combine(d, time(9, 0), tzinfo=timezone.utc),
        end_time=None,
        location={},
    )
    db.add(tl)
    db.flush()
    return tl


def _cleanup(db: Session, timelog_id: int) -> None:
    db.execute(sql_text("DELETE FROM break_logs WHERE timelog_id=:t"), {"t": timelog_id})
    db.execute(sql_text("DELETE FROM time_logs WHERE timelog_id=:t"), {"t": timelog_id})
    db.commit()


class TestOpenBreakDeductedThroughClockout:
    def test_open_break_deducted_to_clockout_time(self, db: Session, test_employee):
        job = db.query(Job).filter(Job.private_user_id == test_employee.private_user_id).first()
        d = date(2026, 5, 4)
        tl = _make_open_time_log(db, test_employee.private_user_id, job.job_id, d)
        try:
            # Break started at 12:00, never explicitly ended (end_time stays NULL).
            break_start = datetime.combine(d, time(12, 0), tzinfo=timezone.utc)
            db.add(BreakLog(timelog_id=tl.timelog_id, start_time=break_start, end_time=None))
            db.commit()

            clock_out = datetime.combine(d, time(17, 0), tzinfo=timezone.utc)
            updated = asyncio.run(update_time_log(tl.timelog_id, {"end_time": clock_out}, db))

            # 09:00-17:00 = 8h raw. The open break (12:00 -> clock-out 17:00 = 5h)
            # must be deducted through to clock-out, not ignored -> 3.0h worked.
            assert updated.hours_worked == D("3.00")
        finally:
            _cleanup(db, tl.timelog_id)

    def test_closed_break_still_deducted_normally(self, db: Session, test_employee):
        """Regression guard: a normally-closed break must still deduct
        exactly its own logged duration, unaffected by the open-break fix."""
        job = db.query(Job).filter(Job.private_user_id == test_employee.private_user_id).first()
        d = date(2026, 5, 5)
        tl = _make_open_time_log(db, test_employee.private_user_id, job.job_id, d)
        try:
            break_start = datetime.combine(d, time(12, 0), tzinfo=timezone.utc)
            db.add(BreakLog(timelog_id=tl.timelog_id, start_time=break_start,
                             end_time=break_start + timedelta(minutes=30)))
            db.commit()

            clock_out = datetime.combine(d, time(17, 0), tzinfo=timezone.utc)
            updated = asyncio.run(update_time_log(tl.timelog_id, {"end_time": clock_out}, db))

            # 8h raw - 30min logged break = 7.5h.
            assert updated.hours_worked == D("7.50")
        finally:
            _cleanup(db, tl.timelog_id)

    def test_no_break_unaffected(self, db: Session, test_employee):
        """Regression guard: a shift with no BreakLog rows at all computes
        the full raw duration, same as before this fix."""
        job = db.query(Job).filter(Job.private_user_id == test_employee.private_user_id).first()
        d = date(2026, 5, 6)
        tl = _make_open_time_log(db, test_employee.private_user_id, job.job_id, d)
        try:
            db.commit()

            clock_out = datetime.combine(d, time(17, 0), tzinfo=timezone.utc)
            updated = asyncio.run(update_time_log(tl.timelog_id, {"end_time": clock_out}, db))

            assert updated.hours_worked == D("8.00")
        finally:
            _cleanup(db, tl.timelog_id)
