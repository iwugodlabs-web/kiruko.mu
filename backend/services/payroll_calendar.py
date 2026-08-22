"""Payroll calendar resolution + period-close enforcement (M24).

Two responsibilities:

* `resolve_calendar(db, country_code, as_of)` — pick the active
  PayrollCalendar row for a country at a given date. Today only
  monthly periods are supported by the engine; the column is here
  for the future.

* `prior_period(period_start, period_type)` — given the start of a
  period, return the start/end of the period immediately before it.
  Used by enforcement to answer "what's the previous run that must
  be closed before this one can start?".

* `assert_prior_period_closed(db, company_id, period_start,
  country_code)` — raise HTTPException(409) if a draft for the
  immediately-preceding period exists in a non-terminal state. A
  *finalized* or *cancelled* prior is fine (cancelled means the
  admin explicitly closed the period without a payslip; finalized
  is the happy path). This deliberately does NOT require the prior
  period to have any run at all — companies onboarding mid-year
  shouldn't have to backfill empty draft+cancel cycles for prior
  months.
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date
from typing import Optional, Tuple

from fastapi import HTTPException
from sqlalchemy import and_, desc, or_
from sqlalchemy.orm import Session

from core.model import PayrollCalendar, PayrollRun


def resolve_calendar(
    db: Session, country_code: str, as_of: date
) -> Optional[PayrollCalendar]:
    """The PayrollCalendar in force for `country_code` on `as_of`, or None."""
    return (
        db.query(PayrollCalendar)
        .filter(PayrollCalendar.country_code == country_code)
        .filter(
            and_(
                PayrollCalendar.effective_from <= as_of,
                or_(
                    PayrollCalendar.effective_to.is_(None),
                    PayrollCalendar.effective_to > as_of,
                ),
            )
        )
        .order_by(desc(PayrollCalendar.effective_from))
        .first()
    )


def prior_period(period_start: date, period_type: str = "monthly") -> Tuple[date, date]:
    """Return (prior_start, prior_end) — the period immediately before
    the one beginning on `period_start`. Today only `monthly` is
    implemented; biweekly/weekly raise NotImplementedError so callers
    fail loudly when those calendars get introduced."""
    if period_type != "monthly":
        raise NotImplementedError(f"prior_period: period_type={period_type!r} not supported yet")
    if period_start.month == 1:
        prior_start = date(period_start.year - 1, 12, 1)
    else:
        prior_start = date(period_start.year, period_start.month - 1, 1)
    last_day = monthrange(prior_start.year, prior_start.month)[1]
    prior_end = date(prior_start.year, prior_start.month, last_day)
    return prior_start, prior_end


def assert_prior_period_closed(
    db: Session,
    *,
    company_id: int,
    period_start: date,
    country_code: str,
) -> None:
    """Raise HTTPException(409) if an open draft for the immediately-
    preceding period exists. Open = status NOT IN ('finalized',
    'cancelled'). No prior run at all is fine."""
    calendar = resolve_calendar(db, country_code, period_start)
    period_type = calendar.period_type if calendar else "monthly"

    prior_start, _ = prior_period(period_start, period_type=period_type)

    open_prior = (
        db.query(PayrollRun)
        .filter(
            PayrollRun.company_id == company_id,
            PayrollRun.period_start == prior_start,
            PayrollRun.status.notin_(("finalized", "cancelled")),
        )
        .first()
    )
    if open_prior is not None:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot start payroll for {period_start.strftime('%B %Y')}: the prior "
                f"period ({prior_start.strftime('%B %Y')}) has an open run (id={open_prior.id}, "
                f"status={open_prior.status}). Finalize or cancel it first."
            ),
        )
