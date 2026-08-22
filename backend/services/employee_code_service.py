"""Short, human-readable employee codes (e.g. 'JS4821').

Format: first-initial + last-initial (falling back to 'X' when a name has no
alphabetic character) + 4 random digits. Uniqueness is scoped per company —
two employees named John Smith at two different companies can share a code,
since the code is only ever looked up within one company's screens
(Clock-in review, Employees list).

Call `ensure_employee_code` anywhere a PrivateUser becomes company-scoped for
the first time (created with a company_id, or later linked to one) — it's a
no-op if the row already has a code or has no company.
"""

from __future__ import annotations

import secrets

from sqlalchemy.orm import Session

from core.model import PrivateUser

_MAX_RETRIES_AT_4_DIGITS = 20


def _initial(name: str | None) -> str:
    for ch in name or "":
        if ch.isalpha():
            return ch.upper()
    return "X"


def _prefix(first_name: str | None, last_name: str | None) -> str:
    return _initial(first_name) + _initial(last_name)


def generate_employee_code(db: Session, company_id: int, first_name: str | None, last_name: str | None) -> str:
    """Generate a code guaranteed unique within `company_id`.

    Widens from 4 to 5 random digits after repeated collisions — a safety
    valve for companies with many people sharing the same two initials, not
    the common case.
    """
    prefix = _prefix(first_name, last_name)

    for digits in (4, 5):
        cap = 10 ** digits
        for _ in range(_MAX_RETRIES_AT_4_DIGITS):
            candidate = f"{prefix}{secrets.randbelow(cap):0{digits}d}"
            exists = (
                db.query(PrivateUser.private_user_id)
                .filter(
                    PrivateUser.company_id == company_id,
                    PrivateUser.employee_code == candidate,
                )
                .first()
            )
            if exists is None:
                return candidate
    # Astronomically unlikely to be reached (20 collisions at both 4 and 5
    # digits), but never leave the caller without a code.
    return f"{prefix}{secrets.token_hex(4).upper()}"


def ensure_employee_code(db: Session, private_user: PrivateUser) -> None:
    """Assign an employee_code if this PrivateUser is company-scoped and
    doesn't have one yet. Safe to call unconditionally at every
    creation/company-linking site."""
    if private_user.company_id is None or private_user.employee_code:
        return
    private_user.employee_code = generate_employee_code(
        db, private_user.company_id, private_user.first_name, private_user.last_name,
    )
