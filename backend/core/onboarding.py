"""Server-authoritative onboarding evaluation (plan Phase 12.A).

`onboard_complete` is now computed by the server from concrete user state,
not set by a trusting client. This module defines the minimum-data
threshold per user_type and exposes a single function the rest of the
codebase calls.

The rule:
- Private user: first_name + last_name + phone + at least one Job
  (preferred) OR `onboarding_acknowledged_no_employer = True` (escape
  hatch for users without a current employer).
- Company user: company_name + brn + address present on the Company row,
  AND at least one Department exists.

Callers:
- `PATCH /user/{user_id}` re-evaluates after any profile mutation.
- `POST /user/{user_id}/onboard-complete` explicit "I'm done" endpoint
  that 422s with the list of missing fields if not satisfied.
- The legacy job-creation path that used to unconditionally flip the flag.
"""
from __future__ import annotations
import logging
from typing import List, Tuple

from sqlalchemy.orm import Session

from core.model import User, PrivateUser, Company, Department, Job, UserType

logger = logging.getLogger(__name__)


# Returned as part of the 422 payload so the wizard can scroll to the
# offending field and the QA team has a deterministic enum to assert on.
MISSING_PROFILE_FIRST_NAME = "profile.first_name"
MISSING_PROFILE_LAST_NAME = "profile.last_name"
MISSING_PROFILE_PHONE = "profile.phone"
MISSING_EMPLOYER_LINK = "profile.employer_link"  # either a Job or the no-employer ack

MISSING_COMPANY_NAME = "company.company_name"
MISSING_COMPANY_BRN = "company.brn"
MISSING_COMPANY_ADDRESS = "company.address"
MISSING_FIRST_DEPARTMENT = "company.first_department"


def _evaluate_private(user: User, db: Session) -> List[str]:
    pu = user.private_user
    missing: List[str] = []
    if not pu:
        # No PrivateUser row yet — every profile field is missing.
        return [
            MISSING_PROFILE_FIRST_NAME,
            MISSING_PROFILE_LAST_NAME,
            MISSING_PROFILE_PHONE,
            MISSING_EMPLOYER_LINK,
        ]
    if not (pu.first_name or "").strip():
        missing.append(MISSING_PROFILE_FIRST_NAME)
    if not (pu.last_name or "").strip():
        missing.append(MISSING_PROFILE_LAST_NAME)
    if not (pu.phone or "").strip():
        missing.append(MISSING_PROFILE_PHONE)

    # Employer link: either a job exists, or the user explicitly told us
    # they have no current employer. Either is acceptable — onboarding
    # cannot block users between jobs from using the calculator.
    has_job = db.query(Job).filter(Job.private_user_id == pu.private_user_id).count() > 0
    acked_no_employer = bool(getattr(pu, "onboarding_acknowledged_no_employer", False))
    if not (has_job or acked_no_employer):
        missing.append(MISSING_EMPLOYER_LINK)
    return missing


def _evaluate_company(user: User, db: Session) -> List[str]:
    missing: List[str] = []
    company: Company | None = None
    # `User.company` is the company-admin's owning Company per existing model.
    company = getattr(user, "company", None)
    if not company:
        # No Company row owned by this user yet.
        return [MISSING_COMPANY_NAME, MISSING_COMPANY_BRN, MISSING_COMPANY_ADDRESS, MISSING_FIRST_DEPARTMENT]

    if not (company.company_name or "").strip():
        missing.append(MISSING_COMPANY_NAME)
    if not (company.brn or "").strip():
        missing.append(MISSING_COMPANY_BRN)
    if not (company.address or "").strip():
        missing.append(MISSING_COMPANY_ADDRESS)
    dept_count = db.query(Department).filter(Department.company_id == company.company_id).count()
    if dept_count < 1:
        missing.append(MISSING_FIRST_DEPARTMENT)
    return missing


def evaluate_missing(user: User, db: Session) -> List[str]:
    """Return the list of missing-data keys for this user. Empty list ⇒
    the user meets the onboarding threshold."""
    if not user:
        return []
    if user.user_type == UserType.company:
        return _evaluate_company(user, db)
    if user.user_type == UserType.private:
        return _evaluate_private(user, db)
    # Other user_types (e.g. platform-admin support accounts) skip onboarding.
    return []


def compute_onboard_complete(user: User, db: Session) -> bool:
    """Authoritative onboarding check. The result of this function is what
    `User.onboard_complete` should be — call it from every mutation that
    touches profile / company / department data and persist the result."""
    return len(evaluate_missing(user, db)) == 0


def refresh_user_onboard_state(user: User, db: Session) -> Tuple[bool, List[str]]:
    """Convenience: recompute and persist `onboard_complete` on the user
    row, returning `(new_value, missing_fields)`. Does NOT commit — let the
    caller bundle this into its own transaction so the audit row and the
    flag flip atomically (plan F2 pattern)."""
    missing = evaluate_missing(user, db)
    new_value = len(missing) == 0
    if user.onboard_complete != new_value:
        user.onboard_complete = new_value
        logger.info(
            "refresh_user_onboard_state: user_id=%s onboard_complete -> %s (missing=%s)",
            user.user_id, new_value, missing,
        )
    return new_value, missing
