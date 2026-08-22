"""Step-up auth: 5-minute single-use tokens for high-stakes operations (M7).

Two-step flow on the server:

    1. issue_step_up_otp(db, user, purpose) — invalidates prior unused
       step-up OTPs for (email, purpose), creates a new VerificationToken
       row with token_type='step_up.<purpose>', returns the OTP code.
       The router calls send_step_up_otp(email, purpose, otp).

    2. consume_otp_and_issue_token(db, user, purpose, otp) — verifies the
       OTP via the existing CryptContext bcrypt scheme, marks the
       VerificationToken as used, then INSERTs a fresh StepUpToken row
       with a 5-minute TTL. Returns (token, expires_at).

    3. require_step_up_token(purpose) — FastAPI dependency factory.
       Reads `X-Step-Up-Token` header, validates against StepUpToken
       (matches user, purpose, not expired, not consumed), marks consumed
       atomically. Raises 401 with a clear hint on any failure.

OTP storage piggybacks on the existing VerificationToken table (used by
password reset and signup verification) — same bcrypt-hashed scheme,
different token_type so the chains don't collide.
"""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional, Tuple

from fastapi import Depends, Header, HTTPException, status
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from core import config
from core.dependencies import get_current_user
from core.model import StepUpToken, User, VerificationToken


logger = logging.getLogger("kontokaz.step_up")


# Reuse the same bcrypt context as password_reset for OTP hashing.
_otp_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=10)


# Allow-list of purposes a client may request. Anything outside this is
# rejected so the OTP infra can't be repurposed by a malicious caller.
ALLOWED_PURPOSES: frozenset[str] = frozenset({
    "payroll_finalize",
    "rule_supersede",  # for future use; not yet wired into the router
})


def _token_type_for_purpose(purpose: str) -> str:
    """Compute the VerificationToken.token_type label for a given purpose.

    Prefix `su.` (not `step_up.`) is used because the upstream column is
    `VARCHAR(20)`. The longest allowed purpose is therefore 17 chars; the
    ALLOWED_PURPOSES list above stays well within that bound.
    """
    return f"su.{purpose}"


def _generate_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _generate_token() -> str:
    """An opaque, URL-safe 64-char token. Stored as the PK so collisions
    are vanishingly improbable (256-bit entropy)."""
    return secrets.token_urlsafe(48)[:80]


# ---------------------------------------------------------------------------
# OTP issuance + verification
# ---------------------------------------------------------------------------


def issue_step_up_otp(db: Session, user: User, purpose: str) -> str:
    """Invalidate any pending step-up OTPs for (email, purpose), create a
    fresh one, return the OTP code. Caller commits."""
    if purpose not in ALLOWED_PURPOSES:
        raise HTTPException(status_code=400, detail=f"Unknown step-up purpose: {purpose}")

    token_type = _token_type_for_purpose(purpose)

    db.query(VerificationToken).filter(
        VerificationToken.email == user.email,
        VerificationToken.token_type == token_type,
        VerificationToken.used == False,  # noqa: E712
    ).update({"used": True})

    otp = _generate_otp()
    row = VerificationToken(
        email=user.email,
        token_type=token_type,
        otp_hash=_otp_ctx.hash(otp),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
        used=False,
    )
    db.add(row)
    db.commit()
    return otp


def consume_otp_and_issue_token(
    db: Session,
    user: User,
    purpose: str,
    otp: str,
) -> Tuple[str, datetime]:
    """Verify the OTP and issue a fresh step-up token. Caller commits."""
    if purpose not in ALLOWED_PURPOSES:
        raise HTTPException(status_code=400, detail=f"Unknown step-up purpose: {purpose}")

    token_type = _token_type_for_purpose(purpose)
    vt = (
        db.query(VerificationToken)
        .filter(
            VerificationToken.email == user.email,
            VerificationToken.token_type == token_type,
            VerificationToken.used == False,  # noqa: E712
        )
        .order_by(VerificationToken.created_at.desc())
        .first()
    )
    if vt is None or not _otp_ctx.verify(otp, vt.otp_hash):
        raise HTTPException(status_code=400, detail="Invalid or expired OTP.")

    if datetime.now(timezone.utc) > vt.expires_at:
        vt.used = True
        db.commit()
        raise HTTPException(status_code=400, detail="OTP has expired.")

    # Mark OTP used (single-use)
    vt.used = True

    # Issue the step-up token (5-min TTL, single-use, scoped to purpose).
    token_value = _generate_token()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=5)
    db.add(
        StepUpToken(
            token=token_value,
            user_id=user.user_id,
            purpose=purpose,
            expires_at=expires_at,
        )
    )
    db.commit()

    logger.info(
        "step_up.token_issued",
        extra={"user_id": user.user_id, "purpose": purpose, "expires_at": expires_at.isoformat()},
    )
    return token_value, expires_at


# ---------------------------------------------------------------------------
# Token validation + consumption
# ---------------------------------------------------------------------------


def _validate_and_consume(db: Session, token_value: str, user_id: int, purpose: str) -> StepUpToken:
    """Atomic: load the token, check user/purpose/expiry/unconsumed, mark
    consumed. Raises 401 with a specific message on any failure."""
    if not token_value or not isinstance(token_value, str):
        raise HTTPException(
            status_code=401,
            detail="X-Step-Up-Token header is missing.",
        )

    row = db.query(StepUpToken).filter(StepUpToken.token == token_value).one_or_none()
    if row is None:
        raise HTTPException(status_code=401, detail="Step-up token not recognized.")

    if row.user_id != user_id:
        # Don't leak that it's a real token issued to someone else.
        raise HTTPException(status_code=401, detail="Step-up token not recognized.")

    if row.purpose != purpose:
        raise HTTPException(
            status_code=401,
            detail=f"Step-up token issued for '{row.purpose}', not '{purpose}'.",
        )

    if row.consumed_at is not None:
        raise HTTPException(
            status_code=401,
            detail="Step-up token has already been used. Request a fresh OTP.",
        )

    if datetime.now(timezone.utc) > row.expires_at:
        raise HTTPException(
            status_code=401,
            detail="Step-up token has expired. Request a fresh OTP.",
        )

    row.consumed_at = datetime.now(timezone.utc)
    db.commit()
    logger.info(
        "step_up.token_consumed",
        extra={"user_id": user_id, "purpose": purpose, "token": row.token[:8] + "..."},
    )
    return row


def require_step_up_token(purpose: str) -> Callable:
    """Build a FastAPI dependency that enforces a valid X-Step-Up-Token
    for a specific `purpose`. Token is consumed (single-use) on success.

    Usage:
        @router.post("/payroll/runs/{run_id}/finalize")
        def finalize(
            ...,
            _step_up=Depends(require_step_up_token("payroll_finalize")),
        ):
            ...
    """
    if purpose not in ALLOWED_PURPOSES:
        raise ValueError(f"Unknown step-up purpose: {purpose}")

    def dependency(
        x_step_up_token: Optional[str] = Header(
            None,
            alias="X-Step-Up-Token",
            description="Single-use 5-min token from POST /auth/step-up. Required.",
        ),
        db: Session = Depends(config.get_db),
        current_user: User = Depends(get_current_user),
    ) -> str:
        return _validate_and_consume(
            db, x_step_up_token or "", current_user.user_id, purpose
        ).token

    return dependency
