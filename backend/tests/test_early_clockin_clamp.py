"""Early clock-in paid-hours clamp (Ivor's "arrival/departure time" bug).

An employee who clocks in before their scheduled shift start was
previously paid for those early minutes automatically — is_late/
out_of_schedule only flagged the session, never affected pay.
KioskService.effective_paid_start + the widened
proration.sum_hours_worked_in_period now clamp paid hours to the
scheduled start by default. TimeLog.hours_worked itself (the raw
attendance record) is untouched — only the payroll-facing sum changes.

MU (Indian/Mauritius) is UTC+4, no DST — all times below are constructed
as explicit UTC instants matching a stated MU-local wall-clock time, to
avoid any ambiguity from naive-datetime interpretation.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal as D

import pytest

from services.kiosk_service import KioskService
from services.payroll_engine import _apply_pay_basis
from services.salary_resolver import resolve_components


MU_OFFSET = timedelta(hours=4)


def _mu_local(d: date, hh: int, mm: int) -> datetime:
    """A UTC-aware datetime for the given MU-local wall-clock time."""
    return datetime(d.year, d.month, d.day, hh, mm, tzinfo=timezone.utc) - MU_OFFSET


def _set_pay_basis(db, employee_id, *, pay_basis="monthly", hourly_rate=None):
    from core.model import Job, Salary

    salary = (
        db.query(Salary)
        .join(Job, Salary.job_id == Job.job_id)
        .filter(Job.private_user_id == employee_id)
        .order_by(Salary.created_at.desc())
        .first()
    )
    salary.pay_basis = pay_basis
    salary.hourly_rate = hourly_rate
    db.flush()


def _set_job_schedule(db, employee_id, *, start=None, end=None):
    from core.model import Job

    job = db.query(Job).filter(Job.private_user_id == employee_id).order_by(Job.created_at.desc()).first()
    job.work_start_time = start
    job.work_end_time = end
    db.flush()
    return job


def _add_time_log(db, employee_id, job_id, *, start, end):
    from core.model import TimeLog

    hours = D((end - start).total_seconds() / 3600).quantize(D("0.01"))
    tl = TimeLog(
        job_id=job_id, private_user_id=employee_id, day_of_week=start.strftime("%A"),
        start_time=start, end_time=end, location={"lat": 0, "lng": 0}, hours_worked=hours,
    )
    db.add(tl)
    db.flush()
    return tl


class TestEffectivePaidStartHelper:
    """Unit-level coverage of KioskService.effective_paid_start in isolation
    (no DB) — cheap, exact boundary checks before the integration tests."""

    def test_returns_actual_start_unchanged_when_no_schedule(self):
        start = _mu_local(date(2026, 5, 4), 8, 30)
        assert KioskService.effective_paid_start(None, None, "Indian/Mauritius", start) == start

    def test_clamps_early_clockin_to_scheduled_start(self):
        start = _mu_local(date(2026, 5, 4), 8, 30)
        result = KioskService.effective_paid_start(time(9, 0), time(17, 0), "Indian/Mauritius", start)
        assert result == _mu_local(date(2026, 5, 4), 9, 0)

    def test_no_clamp_when_on_time_or_late(self):
        on_time = _mu_local(date(2026, 5, 4), 9, 0)
        late = _mu_local(date(2026, 5, 4), 9, 45)
        assert KioskService.effective_paid_start(time(9, 0), time(17, 0), "Indian/Mauritius", on_time) == on_time
        assert KioskService.effective_paid_start(time(9, 0), time(17, 0), "Indian/Mauritius", late) == late

    def test_skips_clamp_for_overnight_shift(self):
        start = _mu_local(date(2026, 5, 4), 20, 0)
        result = KioskService.effective_paid_start(time(22, 0), time(6, 0), "Indian/Mauritius", start)
        assert result == start


class TestPayrollClampIntegration:
    """End-to-end through _apply_pay_basis, matching how the real payroll
    engine calls proration.sum_hours_worked_in_period."""

    def test_early_clockin_clamped_from_paid_hours(self, db, seed_mu_rules, test_employee, test_company_id):
        _set_pay_basis(db, test_employee.private_user_id, pay_basis="hourly", hourly_rate=D("250.00"))
        job = _set_job_schedule(db, test_employee.private_user_id, start=time(9, 0), end=time(17, 0))
        day = date(2026, 5, 4)
        # Clocks in 30 min early (08:30), clocks out on time (17:00) → 8.5h raw.
        tl = _add_time_log(
            db, test_employee.private_user_id, job.job_id,
            start=_mu_local(day, 8, 30), end=_mu_local(day, 17, 0),
        )
        try:
            resolved = resolve_components(db, test_employee.private_user_id, day)
            _apply_pay_basis(db, test_employee, day, day, "MU", resolved)
            basic = next(c.amount for c in resolved.components if c.is_basic)
            # Clamped to 09:00-17:00 = 8.0h × 250 = 2000, not 8.5h × 250 = 2125.
            assert basic == D("2000.00")
            # The raw attendance record is untouched — still shows the actual 8.5h.
            assert tl.hours_worked == D("8.50")
        finally:
            db.query(type(tl)).filter(type(tl).timelog_id == tl.timelog_id).delete()
            _set_job_schedule(db, test_employee.private_user_id, start=None, end=None)
            _set_pay_basis(db, test_employee.private_user_id, pay_basis="monthly")
            db.commit()

    def test_no_schedule_configured_no_clamp(self, db, seed_mu_rules, test_employee, test_company_id):
        _set_pay_basis(db, test_employee.private_user_id, pay_basis="hourly", hourly_rate=D("250.00"))
        job = _set_job_schedule(db, test_employee.private_user_id, start=None, end=None)
        day = date(2026, 5, 4)
        tl = _add_time_log(
            db, test_employee.private_user_id, job.job_id,
            start=_mu_local(day, 8, 30), end=_mu_local(day, 17, 0),
        )
        try:
            resolved = resolve_components(db, test_employee.private_user_id, day)
            _apply_pay_basis(db, test_employee, day, day, "MU", resolved)
            basic = next(c.amount for c in resolved.components if c.is_basic)
            # No schedule configured — conservative default, full 8.5h paid.
            assert basic == D("2125.00")
        finally:
            db.query(type(tl)).filter(type(tl).timelog_id == tl.timelog_id).delete()
            _set_pay_basis(db, test_employee.private_user_id, pay_basis="monthly")
            db.commit()

    def test_ninety_minutes_early_and_flagged_out_of_schedule_still_clamps(
        self, db, seed_mu_rules, test_employee, test_company_id,
    ):
        _set_pay_basis(db, test_employee.private_user_id, pay_basis="hourly", hourly_rate=D("250.00"))
        job = _set_job_schedule(db, test_employee.private_user_id, start=time(9, 0), end=time(17, 0))
        day = date(2026, 5, 4)
        # 90 min early — beyond the 30-min grace, so is_out_of_schedule=True
        # for a REAL clock-in (checked separately below); the pay clamp is a
        # plain time comparison and isn't gated on that flag at all.
        assert KioskService.is_out_of_schedule(
            job=job, company_timezone="Indian/Mauritius", clock_in_at=_mu_local(day, 7, 30),
        ) is True
        tl = _add_time_log(
            db, test_employee.private_user_id, job.job_id,
            start=_mu_local(day, 7, 30), end=_mu_local(day, 17, 0),
        )
        try:
            resolved = resolve_components(db, test_employee.private_user_id, day)
            _apply_pay_basis(db, test_employee, day, day, "MU", resolved)
            basic = next(c.amount for c in resolved.components if c.is_basic)
            # Clamped to 09:00-17:00 = 8.0h × 250 = 2000, same as the 30-min case.
            assert basic == D("2000.00")
        finally:
            db.query(type(tl)).filter(type(tl).timelog_id == tl.timelog_id).delete()
            _set_job_schedule(db, test_employee.private_user_id, start=None, end=None)
            _set_pay_basis(db, test_employee.private_user_id, pay_basis="monthly")
            db.commit()

    def test_on_time_or_late_clockin_not_clamped(self, db, seed_mu_rules, test_employee, test_company_id):
        _set_pay_basis(db, test_employee.private_user_id, pay_basis="hourly", hourly_rate=D("250.00"))
        job = _set_job_schedule(db, test_employee.private_user_id, start=time(9, 0), end=time(17, 0))
        day = date(2026, 5, 4)
        tl = _add_time_log(
            db, test_employee.private_user_id, job.job_id,
            start=_mu_local(day, 9, 45), end=_mu_local(day, 17, 0),
        )
        try:
            resolved = resolve_components(db, test_employee.private_user_id, day)
            _apply_pay_basis(db, test_employee, day, day, "MU", resolved)
            basic = next(c.amount for c in resolved.components if c.is_basic)
            # 09:45-17:00 = 7.25h × 250 = 1812.50, unclamped (not early).
            assert basic == D("1812.50")
        finally:
            db.query(type(tl)).filter(type(tl).timelog_id == tl.timelog_id).delete()
            _set_job_schedule(db, test_employee.private_user_id, start=None, end=None)
            _set_pay_basis(db, test_employee.private_user_id, pay_basis="monthly")
            db.commit()

    def test_overnight_shift_not_clamped(self, db, seed_mu_rules, test_employee, test_company_id):
        _set_pay_basis(db, test_employee.private_user_id, pay_basis="hourly", hourly_rate=D("250.00"))
        job = _set_job_schedule(db, test_employee.private_user_id, start=time(22, 0), end=time(6, 0))
        day = date(2026, 5, 4)
        tl = _add_time_log(
            db, test_employee.private_user_id, job.job_id,
            start=_mu_local(day, 21, 30), end=_mu_local(day, 23, 30),
        )
        try:
            resolved = resolve_components(db, test_employee.private_user_id, day)
            _apply_pay_basis(db, test_employee, day, day, "MU", resolved)
            basic = next(c.amount for c in resolved.components if c.is_basic)
            # 21:30-23:30 = 2.0h × 250 = 500, unclamped — overnight shifts skip the clamp.
            assert basic == D("500.00")
        finally:
            db.query(type(tl)).filter(type(tl).timelog_id == tl.timelog_id).delete()
            _set_job_schedule(db, test_employee.private_user_id, start=None, end=None)
            _set_pay_basis(db, test_employee.private_user_id, pay_basis="monthly")
            db.commit()


class TestBucketedOvertimeEngineClamp:
    """The bucketed overtime engine is the production path when an overtime
    rule is configured — used by real payroll runs (create_draft_run) and
    the estimate. It loads raw TimeLog rows independently of
    proration.sum_hours_worked_in_period, so it needed its own clamp at
    _load_and_bucket_overtime's BucketerTimeLog construction — this covers
    that fix specifically."""

    def test_early_clockin_clamped_in_bucketed_engine(self, db, seed_mu_rules, test_employee, test_company_id):
        from services import payroll_rules

        _set_pay_basis(db, test_employee.private_user_id, pay_basis="hourly", hourly_rate=D("250.00"))
        job = _set_job_schedule(db, test_employee.private_user_id, start=time(9, 0), end=time(17, 0))
        ps, pe = date(2026, 5, 4), date(2026, 5, 4)  # Mon 4 May 2026
        # Clocks in 30 min early (08:30 MU), clocks out on time (17:00 MU) → 8.5h raw.
        tl = _add_time_log(
            db, test_employee.private_user_id, job.job_id,
            start=_mu_local(ps, 8, 30), end=_mu_local(ps, 17, 0),
        )
        tl.admin_approved = True
        db.flush()
        rule = payroll_rules.resolve_overtime_rule(db, "MU", ps)
        try:
            resolved = resolve_components(db, test_employee.private_user_id, ps)
            _apply_pay_basis(db, test_employee, ps, pe, "MU", resolved, overtime_rule=rule)
            total_earnings = sum((c.amount for c in resolved.components if c.kind == "earning"), D("0"))
            # Clamped to 09:00-17:00 = 8.0h (not the raw 8.5h — confirms the
            # bucketed engine's own fix), minus the fixture's 30-min unlogged-
            # break deduction (a separate, pre-existing feature of this engine,
            # unrelated to the clamp) = 7.5h × 250 = 1875.00.
            assert total_earnings == D("1875.00")
        finally:
            db.query(type(tl)).filter(type(tl).timelog_id == tl.timelog_id).delete()
            _set_job_schedule(db, test_employee.private_user_id, start=None, end=None)
            _set_pay_basis(db, test_employee.private_user_id, pay_basis="monthly")
            db.commit()


class TestEstimateFallbackClampConsistency:
    """The employer/employee estimate's fallback path (payslip_estimate_
    service._row_hours, used when hours_worked wasn't persisted) must apply
    the SAME clamp — otherwise the estimate would disagree with the real
    payroll run over an early clock-in."""

    def test_estimate_fallback_clamps_unpersisted_hours(self, db, seed_mu_rules, test_employee, test_company_id):
        from core.model import Job, TimeLog
        from services.payslip_estimate_service import _summarize_clockins

        job = _set_job_schedule(db, test_employee.private_user_id, start=time(9, 0), end=time(17, 0))
        day = date(2026, 5, 4)
        start = _mu_local(day, 8, 30)
        end = _mu_local(day, 17, 0)
        # hours_worked intentionally NOT set (None) — forces the fallback
        # (end - start)-derived path in _row_hours.
        tl = TimeLog(
            job_id=job.job_id, private_user_id=test_employee.private_user_id,
            day_of_week=start.strftime("%A"), start_time=start, end_time=end,
            location={"lat": 0, "lng": 0}, hours_worked=None,
        )
        db.add(tl)
        db.flush()
        try:
            summary = _summarize_clockins(
                db, test_employee.private_user_id, day, day,
                company_timezone="Indian/Mauritius",
            )
            # Clamped to 09:00-17:00 = 8.0h, not the raw 8.5h.
            assert summary["total_hours_decimal"] == D("8.00")
        finally:
            db.query(TimeLog).filter(TimeLog.timelog_id == tl.timelog_id).delete()
            _set_job_schedule(db, test_employee.private_user_id, start=None, end=None)
            db.commit()
