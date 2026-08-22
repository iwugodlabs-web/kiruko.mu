"""Per-employee leave balance (entitlement / taken / remaining) for a year.

A pragmatic v1 computed from policy + approved leave history — NOT a ledger.
For each active, paid leave type in the employee's company:

  entitlement = annual allowance implied by the accrual policy
                  annual / tenure_based → days_per_year
                  monthly              → rate × months accrued this year
                (capped at days_per_year and max_balance when set)
  taken       = approved leave days (this type) intersecting the calendar year
  remaining   = entitlement − taken

Days are counted inclusively (calendar days of the leave that fall in the year);
public-holiday adjustment is intentionally omitted here — this is a guide for
the employee, while payroll's leave_summary remains the period-exact figure.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from core.model import Job, Leave, LeaveType, PrivateUser


def _months_accrued(year: int, today: date, employment_start: Optional[date]) -> int:
    """Whole months of accrual elapsed this year, not counting months before
    employment started. Past years accrue a full 12; the current year accrues
    through the current month."""
    last_month = 12 if year < today.year else today.month
    first_month = 1
    if employment_start and employment_start.year == year:
        first_month = employment_start.month
    elif employment_start and employment_start.year > year:
        return 0
    return max(0, last_month - first_month + 1)


def _taken_days(db: Session, private_user_id: int, lt: LeaveType, y_start: date, y_end: date) -> int:
    """Inclusive calendar days of APPROVED leave for this type intersecting the
    year. Matches by leave_type_id, falling back to the legacy code string."""
    rows = (
        db.query(Leave.start_date, Leave.end_date)
        .filter(
            Leave.private_user_id == private_user_id,
            Leave.status == "approved",
            Leave.start_date <= y_end,
            Leave.end_date >= y_start,
            or_(
                Leave.leave_type_id == lt.id,
                (Leave.leave_type_id.is_(None)) & (func.lower(Leave.leave_type) == lt.code.lower()),
            ),
        )
        .all()
    )
    total = 0
    for start, end in rows:
        eff_start = max(start, y_start)
        eff_end = min(end, y_end)
        if eff_end >= eff_start:
            total += (eff_end - eff_start).days + 1
    return total


def compute_leave_balance(db: Session, private_user_id: int, year: int, *, today: Optional[date] = None) -> dict:
    """Return {year, balances:[{code,label,is_paid,entitlement,taken,remaining,accrual_method}]}.

    Only active, paid leave types with a derivable entitlement are returned.
    """
    today = today or date.today()
    y_start, y_end = date(year, 1, 1), date(year, 12, 31)

    priv = db.query(PrivateUser).filter(PrivateUser.private_user_id == private_user_id).one_or_none()
    if priv is None or not priv.company_id:
        return {"year": year, "balances": []}

    job = (
        db.query(Job)
        .filter(Job.private_user_id == private_user_id)
        .order_by(Job.created_at.desc())
        .first()
    )
    emp_start = (
        job.first_date_of_employment.date()
        if job and job.first_date_of_employment
        else None
    )

    types = (
        db.query(LeaveType)
        .filter(
            LeaveType.company_id == priv.company_id,
            LeaveType.is_active.is_(True),
            LeaveType.is_paid.is_(True),
        )
        .order_by(LeaveType.code)
        .all()
    )

    balances = []
    for lt in types:
        # Entitlement from the accrual policy.
        entitlement: Optional[Decimal] = None
        if lt.accrual_method == "monthly" and lt.accrual_rate_days_per_month is not None:
            months = _months_accrued(year, today, emp_start)
            entitlement = Decimal(lt.accrual_rate_days_per_month) * Decimal(months)
            if lt.days_per_year is not None:
                entitlement = min(entitlement, Decimal(lt.days_per_year))
        elif lt.days_per_year is not None:
            entitlement = Decimal(lt.days_per_year)

        if entitlement is None:
            continue  # no derivable allowance — skip rather than show a blank

        if lt.max_balance is not None:
            entitlement = min(entitlement, Decimal(lt.max_balance))

        taken = Decimal(_taken_days(db, private_user_id, lt, y_start, y_end))
        remaining = entitlement - taken

        balances.append({
            "code": lt.code,
            "label": lt.label,
            "is_paid": bool(lt.is_paid),
            "accrual_method": lt.accrual_method,
            "entitlement": float(entitlement),
            "taken": float(taken),
            "remaining": float(remaining),
        })

    return {"year": year, "balances": balances}
