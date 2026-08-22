"""Date-aware resolution helpers for employee country assignments.

Phase 1 (display) surface. The payroll engine is intentionally NOT wired to
these — payroll stays Company.country_code-scoped until Phase 2 (gated).
"""

from datetime import date
from typing import Optional

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from core.model import EmployeeCountryAssignment, PrivateUser


def active_country_assignment(
    db: Session,
    private_user_id: int,
    as_of: Optional[date] = None,
) -> Optional[EmployeeCountryAssignment]:
    """The assignment in force on ``as_of`` (default today), or None.

    Open-ended windows (``effective_to IS NULL``) are active forever; ended
    windows are active until the day before ``effective_to`` (exclusive end,
    matching the salary-assignment convention).
    """
    as_of = as_of or date.today()
    return (
        db.query(EmployeeCountryAssignment)
        .filter(EmployeeCountryAssignment.private_user_id == private_user_id)
        .filter(EmployeeCountryAssignment.archived_at.is_(None))
        .filter(EmployeeCountryAssignment.effective_from <= as_of)
        .filter(
            or_(
                EmployeeCountryAssignment.effective_to.is_(None),
                EmployeeCountryAssignment.effective_to > as_of,
            )
        )
        .order_by(EmployeeCountryAssignment.effective_from.desc())
        .first()
    )


def resolve_effective_country(
    db: Session,
    user: PrivateUser,
    as_of: Optional[date] = None,
) -> str:
    """Effective country for ``user`` on ``as_of``.

    Assignment-aware wrapper over ``PrivateUser.effective_country_code``: an
    active country assignment wins; otherwise the property's existing
    precedence (company → self → phone → 'MU') applies unchanged.
    """
    assignment = active_country_assignment(db, user.private_user_id, as_of)
    if assignment is not None:
        return assignment.country_code
    return user.effective_country_code


def has_open_assignment(db: Session, private_user_id: int) -> bool:
    """True if the employee has an open-ended, un-archived assignment."""
    return (
        db.query(EmployeeCountryAssignment.id)
        .filter(EmployeeCountryAssignment.private_user_id == private_user_id)
        .filter(EmployeeCountryAssignment.effective_to.is_(None))
        .filter(EmployeeCountryAssignment.archived_at.is_(None))
        .first()
        is not None
    )
