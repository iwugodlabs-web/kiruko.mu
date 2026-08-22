"""Joiner / leaver / part-time proration helpers (M20).

Two pure responsibilities:

* `working_days_in_period(country_code, start, end, work_days_mask=None)` —
  count weekdays in `[start, end]` (inclusive) excluding public holidays for
  the given country. If `work_days_mask` is provided (e.g. the employee's
  Job.work_days dict from onboarding), it overrides the default Mon–Fri.

* `compute_proration_factor(employee_start, employee_end, period_start,
  period_end, country_code, work_days_mask=None)` — fraction of working
  days the employee was actually employed during the period. Used to scale
  monthly basis components for joiners and leavers. Always between 0 and 1.

These helpers do *not* know about salary amounts, FTE, or pay basis. The
payroll engine multiplies its own values by the factors these return.

They are deliberately country-aware (public holidays differ) and weekly-
schedule-aware (some employees work 6-day weeks), but they don't try to
model paid leave — that's the leave-impact column on payslips, computed
separately downstream.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from core.model import PublicHoliday


# Default working-week mask: Monday=0 ... Sunday=6
_DEFAULT_WORKDAYS = {0, 1, 2, 3, 4}


def _normalize_workdays_mask(work_days_mask: Optional[dict | Iterable]) -> set[int]:
    """Translate an employee's `Job.work_days` dict (or any keyed iterable)
    into a set of `date.weekday()` integers (Monday=0).

    `Job.work_days` in this codebase is a JSONB shaped like
    `{"Monday": "...", "Tuesday": "...", ...}` — keys are day names. We
    accept either that shape or a set/list of ints already.
    """
    if work_days_mask is None:
        return set(_DEFAULT_WORKDAYS)

    name_to_idx = {
        "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
        "friday": 4, "saturday": 5, "sunday": 6,
    }
    out: set[int] = set()

    if isinstance(work_days_mask, dict):
        for key in work_days_mask.keys():
            idx = name_to_idx.get(str(key).lower())
            if idx is not None:
                out.add(idx)
        return out or set(_DEFAULT_WORKDAYS)

    # Iterable of ints (or strings)
    for item in work_days_mask:
        if isinstance(item, int):
            out.add(item)
        elif isinstance(item, str):
            idx = name_to_idx.get(item.lower())
            if idx is not None:
                out.add(idx)
    return out or set(_DEFAULT_WORKDAYS)


def working_dates_in_period(
    db: Session,
    country_code: str,
    start: date,
    end: date,
    work_days_mask: Optional[dict | Iterable] = None,
) -> set[date]:
    """The set of working days in `[start, end]` (inclusive).

    A working day is one whose weekday is in the mask AND which is not a
    public holiday for the country. Returns an empty set if `end < start`.

    `working_days_in_period` is just `len(...)` of this; callers that need the
    actual dates (e.g. attendance/absence reconciliation) use this directly so
    the working-day definition lives in one place.
    """
    if end < start:
        return set()

    mask = _normalize_workdays_mask(work_days_mask)

    # A holiday is observed on `observed_date` when set (e.g. a Sunday holiday
    # taken the following Monday), else on `date`. Exclude the OBSERVED day from
    # working days, consistent with the overtime engine and payroll engine which
    # both use coalesce(observed_date, date). Keying on date alone would count
    # the observed day as a normal working day and miss the actual day off.
    from sqlalchemy import func
    observed = func.coalesce(PublicHoliday.observed_date, PublicHoliday.date)
    holidays = {
        obs for (obs,) in db.query(observed)
        .filter(PublicHoliday.country_code == country_code)
        .filter(observed >= start)
        .filter(observed <= end)
        .all()
    }

    out: set[date] = set()
    cursor = start
    while cursor <= end:
        if cursor.weekday() in mask and cursor not in holidays:
            out.add(cursor)
        cursor += timedelta(days=1)
    return out


def working_days_in_period(
    db: Session,
    country_code: str,
    start: date,
    end: date,
    work_days_mask: Optional[dict | Iterable] = None,
) -> int:
    """Count working days in `[start, end]` (inclusive).

    A working day is one whose weekday is in the mask AND which is not a
    public holiday for the country. Returns 0 if `end < start`.
    """
    return len(working_dates_in_period(db, country_code, start, end, work_days_mask))


def compute_proration_factor(
    db: Session,
    *,
    employee_start: Optional[date],
    employee_end: Optional[date],
    period_start: date,
    period_end: date,
    country_code: str,
    work_days_mask: Optional[dict | Iterable] = None,
) -> Decimal:
    """Fraction of the period the employee was active.

    Returns Decimal in [0, 1] quantized to 4 decimal places. The result is
    a working-day ratio, not a calendar-day ratio — a 5-day-week employee
    who joins on a Wednesday and works 3 of the 22 working days that month
    gets 3/22, not 3/(period calendar days).

    `employee_start`/`employee_end` are intersected with the period before
    counting. `None` means "open-ended" — `start=None` is treated as "was
    employed before the period began", `end=None` as "still employed at
    period end". The common all-month case (`start=None`, `end=None`)
    returns Decimal(1).
    """
    eff_start = max(employee_start, period_start) if employee_start else period_start
    eff_end = min(employee_end, period_end) if employee_end else period_end

    if eff_end < eff_start:
        return Decimal("0.0000")

    period_total = working_days_in_period(
        db, country_code, period_start, period_end, work_days_mask
    )
    if period_total == 0:
        return Decimal("0.0000")

    employed_days = working_days_in_period(
        db, country_code, eff_start, eff_end, work_days_mask
    )

    # 8 decimal places — display-friendly enough but precise enough that
    # `(employed/period) × monthly_amount` rounded to 2dp matches what an
    # accountant would compute with integer day counts. A 4dp factor would
    # introduce rounding drift (10/21 displayed as 0.4762 → 30000×0.4762
    # = 14286.00 instead of the correct 14285.71).
    factor = Decimal(employed_days) / Decimal(period_total)
    if factor > Decimal("1.00000000"):
        factor = Decimal("1.00000000")
    return factor.quantize(Decimal("0.00000001"))


def sum_hours_worked_in_period(
    db: Session,
    *,
    private_user_id: int,
    period_start: date,
    period_end: date,
    require_approved: bool = False,
    company_timezone: Optional[str] = None,
) -> Decimal:
    """Sum of `time_logs.hours_worked` whose start_time falls in the period.

    Used by the hourly pay-basis branch of the payroll engine. NULL hours
    are skipped (a clock-in without a clock-out shouldn't pay anything
    until the user closes it).

    When ``require_approved=True``, only logs with admin_approved=true are
    summed. Wired from the payroll engine using
    Company.require_approved_clockins_for_payroll. Pre-existing rows are
    backfilled to admin_approved=true by the M3 migration so flipping this
    flag doesn't silently zero historical hours.

    Overtime is gated unconditionally: a row flagged is_overtime=True is only
    summed if overtime_confirmed_by_employer=True. Pending or rejected
    overtime drops out of payroll until the employer signs off.

    Each row is clamped to its job's scheduled start (KioskService.
    effective_paid_start) before being added — a clock-in before the
    scheduled shift start doesn't pay for the early minutes by default.
    `company_timezone` is required for that clamp to apply; omitting it
    (or the job having no configured schedule) falls back to raw hours,
    same as before this existed.
    """
    from core.model import Job, TimeLog
    from datetime import datetime, time, timezone
    from sqlalchemy import or_
    from services.kiosk_service import KioskService

    # Start of period (00:00) to end of period inclusive (23:59:59). time_logs
    # columns are TIMESTAMPTZ, so bound with explicit UTC — a naive bound would
    # be coerced via the DB session TimeZone and shift the window on a non-UTC
    # session.
    start_dt = datetime.combine(period_start, time.min, tzinfo=timezone.utc)
    end_dt = datetime.combine(period_end, time.max, tzinfo=timezone.utc)

    q = (
        db.query(TimeLog.hours_worked, TimeLog.start_time, Job.work_start_time, Job.work_end_time)
        .join(Job, TimeLog.job_id == Job.job_id)
        .filter(TimeLog.private_user_id == private_user_id)
        .filter(TimeLog.start_time >= start_dt)
        .filter(TimeLog.start_time <= end_dt)
        .filter(TimeLog.hours_worked.isnot(None))
        .filter(
            or_(
                # isnot(True) matches both False and NULL — a NULL is_overtime
                # row is regular hours and must be paid (SQL `IS FALSE` would
                # drop it). Mirrors the v2 engine's bool(is_overtime) coercion.
                TimeLog.is_overtime.isnot(True),
                TimeLog.overtime_confirmed_by_employer.is_(True),
            )
        )
    )
    if require_approved:
        q = q.filter(TimeLog.admin_approved.is_(True))

    rows = q.all()
    total = Decimal("0.00")
    for hrs, row_start, work_start_time, work_end_time in rows:
        if hrs is None:
            continue
        hrs_dec = Decimal(hrs)
        if row_start is not None:
            effective_start = KioskService.effective_paid_start(
                work_start_time, work_end_time, company_timezone, row_start,
            )
            if effective_start > row_start:
                early_seconds = (effective_start - row_start).total_seconds()
                hrs_dec = max(Decimal("0.00"), hrs_dec - Decimal(early_seconds) / Decimal(3600))
        total += hrs_dec
    return total.quantize(Decimal("0.01"))
