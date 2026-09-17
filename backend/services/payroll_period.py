"""Shared predicate for "is this date inside a finalized payroll period?"

Single source of truth for the locked-period rule — used by the admin edit path
and the offline clock-out supersede path so both agree on when a session's
money has already been paid/filed and must NOT be silently rewritten.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional


def session_in_finalized_period(db, company_id: int, start_time: Optional[datetime]):
    """Return the finalized PayrollRun whose window contains ``start_time``'s
    date, or None. A non-None result means the session is inside a locked
    period and its hours must not be mutated in place."""
    from core.model import PayrollRun

    if start_time is None:
        return None
    log_date = start_time.date() if isinstance(start_time, datetime) else start_time
    return (
        db.query(PayrollRun)
        .filter(
            PayrollRun.company_id == company_id,
            PayrollRun.status == "finalized",
            PayrollRun.period_start <= log_date,
            PayrollRun.period_end >= log_date,
        )
        .first()
    )
