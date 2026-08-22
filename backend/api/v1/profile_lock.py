"""Profile-lock admin endpoints + reusable dependency.

Two semantically distinct gates over the self-edit path:

    is_locked        — admin-controlled, two-way. Freezes COMPANY_FIELDS.
    identity_verified — one-way KYC flag. Freezes IDENTITY_FIELDS.

Endpoints:
    POST /private-users/{id}/lock              — set is_locked=true (admin only)
    POST /private-users/{id}/unlock            — set is_locked=false (admin only)
    POST /private-users/{id}/verify-identity   — set identity_verified=true (admin only)
    GET  /private-users/{id}/lock              — read both flag states

There is intentionally no "unverify-identity" endpoint — to accept new
identity data, admin re-calls verify-identity, which re-stamps the timestamp
and actor.

One reusable dependency:
    require_unlocked_or_admin(target_private_user_id, fields_being_edited)
        ↳ raises 403 if either lock applies to a touched field AND the
          actor isn't an employer-level admin.
"""

from datetime import datetime, timezone
from typing import Iterable, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core import config
from core.model import AuditLog, PrivateUser, User
from core.dependencies import get_current_user
from core.profile_lock import fields_blocked_by_lock


router = APIRouter(prefix="/private-users", tags=["Profile Lock"])


# ---------------------------------------------------------------------------
# Authorization helpers
# ---------------------------------------------------------------------------


def _user_is_admin_for(actor: User, target: PrivateUser, db: Session) -> bool:
    """Whether `actor` may lock/unlock/bypass the target's profile lock.

    Permission-aware (mirrors job.py / one_off_allowances): when company RBAC is
    ON this checks the fine-grained `edit_employee` permission — which owners/
    company admins bypass, and which a delegated people-ops role (HR Manager)
    holds — so HR can manage profile locks the role catalogue grants them. When
    OFF, falls back to the owner/admin-only predicate (today's behavior). Returns
    a bool so the lock UI can render the badge state without raising.
    """
    if target.company_id is None:
        return False
    try:
        from core.permission_guards import company_rbac_enabled, assert_company_permission
        if company_rbac_enabled():
            assert_company_permission(actor, target.company_id, "edit_employee", db)
            return True
        from core.auth_guards import require_company_admin
        require_company_admin(actor, target.company_id, db)
        return True
    except HTTPException:
        return False


def require_admin_for_target(
    private_user_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
) -> tuple[User, PrivateUser]:
    target = db.query(PrivateUser).filter(PrivateUser.private_user_id == private_user_id).one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail=f"PrivateUser {private_user_id} not found")
    if not _user_is_admin_for(current_user, target, db):
        raise HTTPException(
            status_code=403,
            detail="Only an employer admin or platform admin can manage this profile lock.",
        )
    return current_user, target


def require_unlocked_or_admin(
    target_private_user_id: int,
    fields_being_edited: Iterable[str],
    db: Session,
    current_user: User,
) -> None:
    """Reusable guard for any endpoint that mutates PrivateUser-adjacent data.

    Call this *before* applying the edit:

        from api.v1.profile_lock import require_unlocked_or_admin
        require_unlocked_or_admin(
            target_private_user_id=pid,
            fields_being_edited=set(payload.model_dump(exclude_unset=True).keys()),
            db=db,
            current_user=current_user,
        )

    Raises 403 if the edit touches a field frozen by either lock
    (``is_locked`` over COMPANY_FIELDS, or ``identity_verified`` over
    IDENTITY_FIELDS) AND the caller is not an admin for the target.
    """
    target = db.query(PrivateUser).filter(PrivateUser.private_user_id == target_private_user_id).one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail=f"PrivateUser {target_private_user_id} not found")

    blocked = fields_blocked_by_lock(target, fields_being_edited)
    if not blocked:
        return

    # Locked + blocked fields touched — only admins may proceed.
    if _user_is_admin_for(current_user, target, db):
        return

    # Audit the blocked attempt so admins can see what employees are trying to change.
    db.add(
        AuditLog(
            actor_user_id=current_user.user_id,
            action="profile.edit_blocked",
            target_type="private_users",
            target_id=str(target_private_user_id),
            meta={"blocked_fields": sorted(blocked)},
        )
    )
    db.commit()

    # Build a message that names which lock applies. If both locks apply
    # to different fields in the same payload, mention both.
    from core.profile_lock import IDENTITY_FIELDS, COMPANY_FIELDS

    identity_blocked = sorted(blocked & IDENTITY_FIELDS)
    company_blocked = sorted(blocked & COMPANY_FIELDS)
    parts: list[str] = []
    if identity_blocked:
        parts.append(
            f"{', '.join(identity_blocked)} (identity verified by admin — contact HR to change)"
        )
    if company_blocked:
        parts.append(
            f"{', '.join(company_blocked)} (profile locked — contact your employer to request an unlock)"
        )
    raise HTTPException(
        status_code=403,
        detail="Cannot edit " + "; ".join(parts) + ".",
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


class LockRequest(BaseModel):
    reason: Optional[str] = None


class LockResponse(BaseModel):
    private_user_id: int
    is_locked: bool
    locked_at: Optional[datetime]
    locked_by_user_id: Optional[int]
    lock_reason: Optional[str]
    # Identity verification — surfaced here so the mobile profile screen can
    # render both Personal-step (gated by identity_verified) and Company/Legal
    # steps (gated by is_locked) from a single fetch.
    identity_verified: bool = False
    identity_verified_at: Optional[datetime] = None
    identity_verified_by_user_id: Optional[int] = None


def _build_lock_response(target: PrivateUser) -> "LockResponse":
    return LockResponse(
        private_user_id=target.private_user_id,
        is_locked=target.is_locked,
        locked_at=target.locked_at,
        locked_by_user_id=target.locked_by_user_id,
        lock_reason=target.lock_reason,
        identity_verified=target.identity_verified,
        identity_verified_at=target.identity_verified_at,
        identity_verified_by_user_id=target.identity_verified_by_user_id,
    )


class VerifyIdentityRequest(BaseModel):
    note: Optional[str] = None


@router.post("/{private_user_id}/lock", response_model=LockResponse)
def lock_profile(
    private_user_id: int,
    payload: LockRequest = Body(default=LockRequest()),
    bundle: tuple[User, PrivateUser] = Depends(require_admin_for_target),
    db: Session = Depends(config.get_db),
):
    from core.profile_lock import AUTO_LOCK_REASON

    actor, target = bundle
    if target.is_locked:
        # Already locked. If it was AUTO-locked (admin company-edit) and an admin
        # is now *explicitly* locking, upgrade it to a manual lock so the identity
        # fields freeze too — otherwise the auto-lock marker would keep identity
        # editable and the manual "Lock" would be a silent no-op. An already-manual
        # lock is left as-is (idempotent).
        if target.lock_reason == AUTO_LOCK_REASON:
            target.lock_reason = payload.reason
            target.locked_at = datetime.now(timezone.utc)
            target.locked_by_user_id = actor.user_id
            db.add(
                AuditLog(
                    actor_user_id=actor.user_id,
                    action="profile.lock_upgraded",
                    target_type="private_users",
                    target_id=str(private_user_id),
                    meta={"from": "auto", "reason": payload.reason},
                )
            )
            db.commit()
            db.refresh(target)
        return _build_lock_response(target)

    target.is_locked = True
    target.locked_at = datetime.now(timezone.utc)
    target.locked_by_user_id = actor.user_id
    target.lock_reason = payload.reason

    db.add(
        AuditLog(
            actor_user_id=actor.user_id,
            action="profile.lock",
            target_type="private_users",
            target_id=str(private_user_id),
            meta={"reason": payload.reason},
        )
    )
    db.commit()
    db.refresh(target)

    return _build_lock_response(target)


@router.post("/{private_user_id}/unlock", response_model=LockResponse)
def unlock_profile(
    private_user_id: int,
    payload: LockRequest = Body(default=LockRequest()),
    bundle: tuple[User, PrivateUser] = Depends(require_admin_for_target),
    db: Session = Depends(config.get_db),
):
    actor, target = bundle

    if not target.is_locked:
        return _build_lock_response(target)

    prior_locked_at = target.locked_at
    prior_locked_by = target.locked_by_user_id
    prior_reason = target.lock_reason

    target.is_locked = False
    target.locked_at = None
    target.locked_by_user_id = None
    target.lock_reason = None

    db.add(
        AuditLog(
            actor_user_id=actor.user_id,
            action="profile.unlock",
            target_type="private_users",
            target_id=str(private_user_id),
            meta={
                "unlock_reason": payload.reason,
                "prior_locked_at": prior_locked_at.isoformat() if prior_locked_at else None,
                "prior_locked_by_user_id": prior_locked_by,
                "prior_lock_reason": prior_reason,
            },
        )
    )
    db.commit()
    db.refresh(target)

    return _build_lock_response(target)


@router.get("/{private_user_id}/lock", response_model=LockResponse)
def get_lock_status(
    private_user_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    target = db.query(PrivateUser).filter(PrivateUser.private_user_id == private_user_id).one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail=f"PrivateUser {private_user_id} not found")
    # Anyone authenticated can read lock status (employees see their own state).
    return _build_lock_response(target)


@router.post("/{private_user_id}/verify-identity", response_model=LockResponse)
def verify_identity(
    private_user_id: int,
    payload: VerifyIdentityRequest = Body(default=VerifyIdentityRequest()),
    bundle: tuple[User, PrivateUser] = Depends(require_admin_for_target),
    db: Session = Depends(config.get_db),
):
    """Mark an employee's identity as admin-verified.

    Once set, IDENTITY_FIELDS (first/last name, DOB, passport, gender) become
    non-self-editable for this employee. There is no inverse "unverify"
    endpoint by design — preventing gaming. Calling this again on a verified
    employee re-stamps the timestamp + actor (legitimate re-verification
    after a fresh check).
    """
    actor, target = bundle

    target.identity_verified = True
    target.identity_verified_at = datetime.now(timezone.utc)
    target.identity_verified_by_user_id = actor.user_id

    db.add(
        AuditLog(
            actor_user_id=actor.user_id,
            action="profile.identity_verified",
            target_type="private_users",
            target_id=str(private_user_id),
            meta={"note": payload.note},
        )
    )
    db.commit()
    db.refresh(target)

    return _build_lock_response(target)
