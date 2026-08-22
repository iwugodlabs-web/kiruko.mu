"""Account claim for imported employees.

Bulk-imported staff are created with a random password and user_verified=False,
so they cannot log in (login blocks unverified users). This gives them a
tokenized link to set their own password AND verify their account in one step —
no email dependency: the employer can hand out the link, or it's emailed once
SMTP is configured.

Token = a high-entropy secret; only its SHA-256 lives in the DB
(verification_tokens.otp_hash, token_type='account_claim'). Single-use, expiring.
"""
import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, constr
from sqlalchemy.orm import Session

from core import config
from core.dependencies import get_current_user
from core.model import User, VerificationToken
from core.security import generate_passwd_hash

router = APIRouter()

CLAIM_TOKEN_TYPE = "account_claim"
CLAIM_TTL_DAYS = 14


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def generate_claim_token(db: Session, user: User, ttl_days: int = CLAIM_TTL_DAYS) -> str:
    """Create a single-use claim token for `user`, returning the RAW token (the
    only time it's available). Invalidates any prior unused claim tokens for the
    same email. Caller commits."""
    db.query(VerificationToken).filter(
        VerificationToken.email == user.email,
        VerificationToken.token_type == CLAIM_TOKEN_TYPE,
        VerificationToken.used == False,  # noqa: E712
    ).update({"used": True}, synchronize_session=False)

    raw = secrets.token_urlsafe(32)
    db.add(VerificationToken(
        email=user.email,
        token_type=CLAIM_TOKEN_TYPE,
        otp_hash=_hash(raw),
        expires_at=datetime.now(timezone.utc) + timedelta(days=ttl_days),
        used=False,
    ))
    db.flush()
    return raw


def invalidate_claim_tokens(db: Session, email: str) -> int:
    """Burn any unused account-claim tokens for `email`. Called when an employee
    is removed/detached so a still-live "set your password" link (valid up to 14
    days) can't be used to activate an account for someone who is no longer a
    member — e.g. after a mis-typed-email onboard is undone. Caller commits.
    Returns the number of tokens invalidated."""
    if not email:
        return 0
    return (
        db.query(VerificationToken)
        .filter(
            VerificationToken.email == email,
            VerificationToken.token_type == CLAIM_TOKEN_TYPE,
            VerificationToken.used == False,  # noqa: E712
        )
        .update({"used": True}, synchronize_session=False)
    )


def _resolve_token(db: Session, raw: str) -> tuple[VerificationToken, User]:
    tok = (
        db.query(VerificationToken)
        .filter(
            VerificationToken.token_type == CLAIM_TOKEN_TYPE,
            VerificationToken.otp_hash == _hash(raw or ""),
            VerificationToken.used == False,  # noqa: E712
        )
        .first()
    )
    if tok is None:
        raise HTTPException(status_code=400, detail="This link is invalid or has already been used.")
    if datetime.now(timezone.utc) > tok.expires_at:
        raise HTTPException(status_code=400, detail="This link has expired. Ask your employer to send a new one.")
    user = db.query(User).filter(User.email == tok.email).first()
    if user is None:
        raise HTTPException(status_code=404, detail="Account no longer exists.")
    return tok, user


class ClaimValidateRequest(BaseModel):
    token: str


class ClaimCompleteRequest(BaseModel):
    token: str
    new_password: constr(min_length=8)


class ClaimResendRequest(BaseModel):
    user_id: int


@router.post("/account/claim/validate")
def validate_claim(body: ClaimValidateRequest, db: Session = Depends(config.get_db)):
    """Peek a claim token without consuming it — drives the claim page header."""
    _, user = _resolve_token(db, body.token)
    first_name = getattr(getattr(user, "private_user", None), "first_name", None)
    return {"valid": True, "email": user.email, "first_name": first_name or ""}


def _user_web_access(db: Session, user: User) -> bool:
    """Whether this account may use the WEB dashboard vs. the mobile app — mirrors
    login's `company_web_access`. Company owners + platform admins → web; a
    regular employee (a private user with no company management role) → the mobile
    app. Drives the claim page's final CTA so a just-onboarded employee isn't
    dead-ended at a web login that rejects them."""
    utype = getattr(user.user_type, "value", user.user_type)
    if utype == "company":
        return True
    try:
        from db_models.crud.user import get_roles_for_user
        if "platform_admin" in (get_roles_for_user(user.user_id, db) or []):
            return True
    except Exception:
        pass
    try:
        from core.permission_guards import company_access_for_user, company_rbac_enabled
        from core.roles import is_company_admin_for
        if not company_rbac_enabled():
            return False
        _cperms, _croles = company_access_for_user(user, db)
        pu = getattr(user, "private_user", None)
        cid = getattr(pu, "company_id", None)
        admin = is_company_admin_for(user, cid, db) if cid else False
        return bool(admin or _croles)
    except Exception:
        return False


@router.post("/account/claim/complete")
def complete_claim(body: ClaimCompleteRequest, db: Session = Depends(config.get_db)):
    """Set the password AND verify the account, then consume the token."""
    tok, user = _resolve_token(db, body.token)
    # Defense-in-depth: a removed employee is disabled (user_enabled=False) and
    # their tokens are burned on removal, but if a stale link somehow survives,
    # refuse to (re)activate a disabled account rather than silently re-enabling
    # it. Onboarded/imported users are created enabled, so this only blocks the
    # removed case.
    if getattr(user, "user_enabled", True) is False:
        raise HTTPException(status_code=400, detail="This account is no longer active. Ask your employer for a new link.")
    user.password_hash = generate_passwd_hash(body.new_password)
    user.user_verified = True
    user.user_enabled = True
    tok.used = True
    db.commit()
    # web_access tells the claim page where to send them: web login (owners/admins)
    # or "open the mobile app" (regular employees, who are blocked from web).
    return {"status": "success", "email": user.email, "web_access": _user_web_access(db, user)}


@router.post("/account/claim/resend")
def resend_claim(
    body: ClaimResendRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(config.get_db),
):
    """Re-issue a fresh 14-day account-claim link for an imported employee who
    hasn't set up their account yet (the original link expired or was lost).

    Invalidates any prior unused token. Authorized by the `onboard_employee`
    company permission (owner/admin bypass inside assert_company_permission) for
    the employee's own company. Best-effort emails the new link (if SMTP is
    configured) and always returns it so the employer can hand it out manually.
    """
    target = db.query(User).filter(User.user_id == body.user_id).first()
    if target is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    # NB: intentionally NOT gated on user_verified. An admin who "approves" an
    # imported employee flips user_verified=true but they still have the random
    # import password and can't log in — they still need a link. For a genuinely
    # claimed user this acts as a harmless password-reset link.
    pu = getattr(target, "private_user", None)
    company_id = getattr(pu, "company_id", None)
    if company_id is None:
        raise HTTPException(status_code=400, detail="Employee is not attached to a company.")

    from core.permission_guards import assert_company_permission
    assert_company_permission(current_user, company_id, "onboard_employee", db)

    token = generate_claim_token(db, target)
    db.commit()

    name = getattr(pu, "first_name", None)
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")
    claim_link = f"{frontend_url}/claim?token={token}"
    try:
        from services.email_service import send_account_claim_email
        send_account_claim_email(target.email, name, token)
    except Exception:
        pass  # email is best-effort; the link is returned for manual hand-off
    return {
        "status": "success",
        "email": target.email,
        "name": name,
        "token": token,
        "claim_link": claim_link,
    }
