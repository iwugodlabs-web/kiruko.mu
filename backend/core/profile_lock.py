"""Constants and helpers for the employee profile-lock feature.

Two semantically distinct locks gate different field sets:

* ``is_locked`` — admin-controlled, two-way. Always freezes ``COMPANY_FIELDS``
  (job/salary/employment classification). A *manual* lock (employer explicitly
  sealing the profile) ALSO freezes ``IDENTITY_FIELDS``; an *auto* lock (flipped
  on by an admin company-edit, stamped ``AUTO_LOCK_REASON``) does not, so an
  employee can still finish their KYC data mid-onboarding. Applies only to the
  *self-service* edit path — admins always bypass via the admin path.

* ``identity_verified`` — one-way KYC flag. Freezes ``IDENTITY_FIELDS``
  (legal identity). Once an admin verifies, the employee cannot silently
  change DOB / passport / NID, since those flow into MRA filings.

Editable-when-locked fields like ``phone``, ``address``, contact details
are intentionally excluded from both sets — these often need to be
updated even after a profile is sealed for payroll integrity.
"""

from typing import Iterable


# Identity / KYC — frozen once `identity_verified = true`.
IDENTITY_FIELDS: frozenset[str] = frozenset({
    "first_name",
    "last_name",
    "date_of_birth",
    "pass_port_number",
    "gender",
    # Self-reported country for independent (no-employer) users. Company
    # employees' country is employer/assignment-derived and never set here.
    # Frozen with the identity fields so it's editable until the profile is
    # locked, then read-only — same as the rest of the Personal step.
    "country_code",
})

# Company / employment / compensation — frozen once `is_locked = true`.
COMPANY_FIELDS: frozenset[str] = frozenset({
    "employment_type",
    "fte",
    "salary_assignments",
    "country_locations",
    "jobs",
})

# Back-compat alias for any caller still importing the old name. New code
# should use ``fields_blocked_by_lock(user, payload_fields)`` instead.
LOCKABLE_FIELDS: frozenset[str] = IDENTITY_FIELDS | COMPANY_FIELDS

# Provenance stamped on ``lock_reason`` when ``is_locked`` is flipped on
# automatically by an admin company-edit (vs. an employer manually sealing the
# profile). A *manual* lock seals identity too; an *auto* lock does not, so an
# employee can still finish entering their own KYC data mid-onboarding.
AUTO_LOCK_REASON: str = "Auto-locked on admin company-edit"


def fields_blocked_by_lock(user, payload_fields: Iterable[str]) -> set[str]:
    """Return the subset of ``payload_fields`` that the user's locks forbid.

    Empty set ⇒ payload is safe.

    ``user`` is the target ``PrivateUser`` whose locks are evaluated.
    Locks compose: a payload that touches both an identity field and a
    company field on a fully-locked user gets both back in the result.

    Identity fields freeze when EITHER the one-way ``identity_verified`` KYC
    flag is set OR the profile was *manually* locked by an employer (a deliberate
    "seal this profile" action). An ``is_locked`` that was set automatically by
    an admin company-edit freezes only company fields, so onboarding KYC entry
    stays open.
    """
    payload = set(payload_fields)
    blocked: set[str] = set()
    is_locked = getattr(user, "is_locked", False)
    manual_lock = is_locked and getattr(user, "lock_reason", None) != AUTO_LOCK_REASON
    if getattr(user, "identity_verified", False) or manual_lock:
        blocked |= payload & IDENTITY_FIELDS
    if is_locked:
        blocked |= payload & COMPANY_FIELDS
    return blocked


def auto_lock_on_admin_company_edit(target_pu, actor, db) -> bool:
    """Auto-flip ``is_locked`` to true when an admin edits a company field.

    Idempotent — does nothing (and returns False) when the profile is already
    locked. Otherwise sets ``is_locked=true`` with provenance pointing at the
    admin actor, writes an ``AuditLog`` entry, and returns True. Caller is
    responsible for committing the surrounding transaction; this helper does
    not commit on its own to avoid surprising callers.

    Call this from every admin path that mutates ``COMPANY_FIELDS`` so the
    employee's self-edit window auto-closes on any company-side change.
    """
    from datetime import datetime, timezone

    from core.model import AuditLog

    if target_pu.is_locked:
        return False

    target_pu.is_locked = True
    target_pu.locked_at = datetime.now(timezone.utc)
    target_pu.locked_by_user_id = actor.user_id
    target_pu.lock_reason = AUTO_LOCK_REASON

    db.add(
        AuditLog(
            actor_user_id=actor.user_id,
            action="profile.auto_locked",
            target_type="private_users",
            target_id=str(target_pu.private_user_id),
            meta={"trigger": "admin_company_edit"},
        )
    )
    return True
