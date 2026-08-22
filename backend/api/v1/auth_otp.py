"""OTP-based login (request + verify) — phone-first auth for users
without an email or who'd rather not deal with passwords.

Flow:
  1. Client POSTs `/auth/otp/request {phone}` → server normalizes the
     phone, looks up the user, issues a 6-digit code via the active
     provider (console / WhatsApp / Twilio). Returns a generic 200
     regardless of whether the phone matches a real user (prevents
     enumeration). Same OTP store as email verification — re-uses
     `VerificationToken` with `token_type='login_phone'` and `email`
     column holding the canonical phone.
  2. Client POSTs `/auth/otp/verify {phone, code}` → server verifies
     and returns the exact same response shape as `/user/login` so
     the frontend can reuse its post-login plumbing unchanged.

Rate limits (per-phone, enforced by checking attempts on the existing
token; per-IP via SlowAPI):
  * Request: 5/hour/IP, 3/hour/phone (so an attacker can't drain the
    SMS/WhatsApp budget; legit users can re-request twice if first try
    fails).
  * Verify: 10/minute/IP (covers code typos without enabling brute
    force; combined with bcrypt + 6-digit space gives ~1.6M effective
    attempts to crack a 10-min code — fine).
"""

import logging
import random
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.encoders import jsonable_encoder
from passlib.context import CryptContext
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core import config
from core.dependencies import get_current_user
from core.limiter import RATE_LIMITING_ENABLED, limiter
from core.model import User, VerificationToken
from core.phone_utils import normalize_phone
from core.security import create_access_token
from db_models.crud.user import get_user_by_phone
from schema.user_schema import showUser
from services.otp_providers import get_provider
from services.otp_providers.base import OtpDeliveryError
from services.trusted_device_service import check_or_bind, list_devices, revoke_device

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth/otp", tags=["Auth — OTP"])

_OTP_TOKEN_TYPE = "login_phone"
_OTP_TTL_MINUTES = 10
_otp_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=10)


class RequestOtpBody(BaseModel):
    phone: str = Field(min_length=4, max_length=40)


class VerifyOtpBody(BaseModel):
    phone: str = Field(min_length=4, max_length=40)
    code: str = Field(min_length=4, max_length=8, pattern=r"^\d+$")


@router.post("/request", status_code=200)
@(limiter.limit("5/hour") if RATE_LIMITING_ENABLED else lambda f: f)
async def request_otp(
    request: Request,
    body: RequestOtpBody,
    db: Session = Depends(config.get_db),
):
    """Issue a 6-digit OTP and deliver via the active provider.

    Returns a generic 200 even if the phone doesn't match any user —
    preserves the anti-enumeration property and matches the
    `/password/forgot-password` flow's behavior.
    """
    canonical = normalize_phone(body.phone)
    if not canonical:
        raise HTTPException(status_code=400, detail="invalid_phone")

    user = get_user_by_phone(canonical, db)
    if not user:
        # Generic success — don't tell the caller whether the phone
        # exists. The metric to watch is request volume, not user
        # presence (and `_issue_phone_otp` only runs for real users
        # so we don't accidentally spend WhatsApp credits on probes).
        logger.info("OTP requested for unknown phone=%s", canonical)
        return {"status": "ok", "expires_in_seconds": _OTP_TTL_MINUTES * 60}

    # Per-phone soft rate limit. Counting active (unused, unexpired)
    # tokens for the same phone in the last hour avoids the
    # full-bucket complexity of a separate limiter while still
    # catching the obvious abuse case.
    one_hour_ago = datetime.now(timezone.utc) - timedelta(hours=1)
    recent_count = (
        db.query(VerificationToken)
        .filter(
            VerificationToken.email == canonical,
            VerificationToken.token_type == _OTP_TOKEN_TYPE,
            VerificationToken.created_at >= one_hour_ago,
        )
        .count()
    )
    if recent_count >= 3:
        raise HTTPException(
            status_code=429,
            detail="too_many_requests_try_later",
        )

    code = str(random.randint(100000, 999999))
    # Same invalidate-previous pattern as `_issue_otp` in verification.py.
    db.query(VerificationToken).filter(
        VerificationToken.email == canonical,
        VerificationToken.token_type == _OTP_TOKEN_TYPE,
        VerificationToken.used == False,  # noqa: E712
    ).update({"used": True})
    token = VerificationToken(
        email=canonical,
        token_type=_OTP_TOKEN_TYPE,
        otp_hash=_otp_ctx.hash(code),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=_OTP_TTL_MINUTES),
        used=False,
    )
    db.add(token)
    db.commit()

    provider = get_provider()
    locale = None
    if user.private_user and getattr(user.private_user, "preferred_locale", None):
        locale = user.private_user.preferred_locale
    try:
        provider.send(phone_e164=canonical, code=code, locale=locale)
    except OtpDeliveryError as e:
        # Surface as 502 — the code IS stored, but the user got
        # nothing, so retry is the right next step (and won't burn
        # the per-phone limit twice because the existing unused
        # token gets invalidated on the next request).
        logger.error("OTP delivery failed via %s: %s", provider.name, e)
        raise HTTPException(status_code=502, detail=f"delivery_failed_{e.code}")

    return {
        "status": "ok",
        "expires_in_seconds": _OTP_TTL_MINUTES * 60,
        "provider": provider.name,
    }


@router.post("/verify")
@(limiter.limit("10/minute") if RATE_LIMITING_ENABLED else lambda f: f)
async def verify_otp_login(
    request: Request,
    body: VerifyOtpBody,
    db: Session = Depends(config.get_db),
):
    """Verify the code and, on success, return the same shape as
    `/user/login` (access_token + refresh_token + user dict)."""
    canonical = normalize_phone(body.phone)
    if not canonical:
        raise HTTPException(status_code=400, detail="invalid_phone")

    token = (
        db.query(VerificationToken)
        .filter(
            VerificationToken.email == canonical,
            VerificationToken.token_type == _OTP_TOKEN_TYPE,
            VerificationToken.used == False,  # noqa: E712
        )
        .order_by(VerificationToken.created_at.desc())
        .first()
    )

    if not token or not _otp_ctx.verify(body.code, token.otp_hash):
        # Don't disclose whether the phone was unknown vs the code was
        # wrong — both map to the same error.
        raise HTTPException(status_code=400, detail="invalid_code")

    if datetime.now(timezone.utc) > token.expires_at:
        token.used = True
        db.commit()
        raise HTTPException(status_code=400, detail="code_expired")

    token.used = True
    db.commit()

    user = get_user_by_phone(canonical, db)
    if not user:
        # Token survived a user deletion — defensive, shouldn't happen
        # in practice. Treat as expired.
        raise HTTPException(status_code=400, detail="invalid_code")

    # Device binding (phone-number-recycling mitigation). Done AFTER OTP
    # verification — we don't want to leak "this device is/isn't trusted"
    # before proving the caller actually has the code. See
    # services/trusted_device_service.py for the full policy.
    device_id = (request.headers.get("X-Device-Id") or "").strip() or None
    device_name = (request.headers.get("X-Device-Name") or "").strip() or None
    outcome, _ = check_or_bind(
        db=db, user=user, device_id=device_id, device_name=device_name,
    )
    if outcome == "needs_approval":
        raise HTTPException(
            status_code=403,
            detail="new_device_requires_approval",
        )

    # Disabled accounts cannot obtain a session via OTP either (mirrors the
    # password-login guard and get_current_user's per-request block).
    if not getattr(user, "user_enabled", True):
        raise HTTPException(
            status_code=403,
            detail="This account has been disabled. Please contact your administrator.",
        )

    # Mirror the /user/login response. Audience matches the X-Client-Platform
    # header (web | mobile) so admin endpoints can still scope to web.
    raw_platform = (request.headers.get("X-Client-Platform") or "").strip().lower()
    client_platform = "mobile" if raw_platform == "mobile" else "web"

    # Auto-verify the user on first successful OTP login. The legacy
    # email-verification gate exists because we want to prove ownership
    # of the channel; a successful OTP delivery on the phone already
    # proves that ownership for the phone channel.
    if not user.user_verified:
        user.user_verified = True
        db.commit()

    try:
        from db_models.crud.user import get_roles_for_user
        roles = get_roles_for_user(user.user_id, db)
    except Exception:
        roles = []

    from core.settings import config as settings_config
    try:
        super_emails = settings_config("SUPER_ADMIN_EMAILS", default="") or ""
        super_list = [
            e.strip().strip('"').strip("'").lower()
            for e in super_emails.split(",")
            if e.strip()
        ]
        is_super = (user.email or "").lower() in super_list
    except Exception:
        is_super = False

    # Web-dashboard access flag for delegated management employees — mirrors the
    # password-login path so phone-OTP logins reach /dashboard too (the web
    # middleware reads only the token).
    try:
        from core.roles import is_company_admin
        from core.permission_guards import company_access_for_user, company_rbac_enabled
        # Unconditional (null-safe): owners have no private_user but ARE admins.
        _ica = is_company_admin(user)
        _cp, _cr = company_access_for_user(user, db)
        company_web_access = bool(company_rbac_enabled() and (_ica or _cr))
    except Exception:
        company_web_access = False

    access_token = create_access_token(
        user_data={
            "email": user.email,
            "user_id": user.user_id,
            "user_name": user.user_name,
            "is_superuser": is_super,
            "user_type": user.user_type.value if hasattr(user.user_type, "value") else user.user_type,
            "roles": roles,
            "company_web_access": company_web_access,
        },
        audience=client_platform,
    )
    # Same refresh policy as the password login path (REFRESH_TOKEN_EXPIRY
    # is defined there, in days). Deferred import — avoids a module-load
    # cycle and resolves from sys.modules at call time.
    from api.v1.user import REFRESH_TOKEN_EXPIRY
    refresh_token = create_access_token(
        user_data={"email": user.email, "user_uid": str(user.user_id)},
        refresh=True,
        expiry=timedelta(days=REFRESH_TOKEN_EXPIRY),
        audience=client_platform,
    )

    # Self-heal `onboard_complete` — mirror the password-login path
    # (services/user_service.login_user). Without this, a phone-OTP login
    # returns a stale-false flag and strands a fully-onboarded user on the
    # profile screen on every login.
    try:
        from core.onboarding import refresh_user_onboard_state
        refresh_user_onboard_state(user, db)
        db.commit()
    except Exception:
        db.rollback()

    user_dict = jsonable_encoder(user)
    user_data = jsonable_encoder(showUser.model_validate(user_dict))
    if user.private_user:
        user_data["private_user_id"] = user.private_user.private_user_id
    user_data["roles"] = roles
    user_data["is_superuser"] = is_super

    return {
        "status": "success",
        "message": "OTP verified",
        "access_token": access_token,
        "refresh_token": refresh_token,
        "data": user_data,
    }


# ---------------------------------------------------------------------------
# Trusted-device management — authenticated user manages their own devices.
# ---------------------------------------------------------------------------


@router.get("/devices")
def list_my_devices(
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """List the caller's active trusted devices. Used by a future
    settings screen ("manage devices") and by support staff to see what
    a user has bound when investigating a recycled-number complaint."""
    rows = list_devices(db, current_user.user_id, include_revoked=False)
    return {
        "devices": [
            {
                "device_id": r.device_id,
                "device_name": r.device_name,
                "first_seen_at": r.first_seen_at.isoformat() if r.first_seen_at else None,
                "last_seen_at": r.last_seen_at.isoformat() if r.last_seen_at else None,
            }
            for r in rows
        ]
    }


@router.post("/devices/{device_id}/revoke", status_code=204)
def revoke_my_device(
    device_id: str,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Revoke one of the caller's trusted devices. After this, an OTP
    login from that device for a passwordless user will be rejected with
    `new_device_requires_approval` (or, if it was the last device, the
    next OTP login becomes a TOFU re-bind)."""
    ok = revoke_device(db, current_user.user_id, device_id)
    if not ok:
        raise HTTPException(status_code=404, detail="device_not_found")
    return None
