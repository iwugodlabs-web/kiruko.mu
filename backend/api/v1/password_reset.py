from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from core import config
from core.model import VerificationToken
from schema.password_reset_schema import ForgotPasswordRequest, VerifyOTPRequest, ResetPasswordRequest
from db_models.crud.user import get_user_by_email, update_password_by_email
from services.email_service import send_password_reset_otp
from core.security import create_access_token, decode_token, generate_passwd_hash
from core.limiter import limiter, RATE_LIMITING_ENABLED
from passlib.context import CryptContext
import os
import random
from datetime import datetime, timedelta, timezone
import logging

router = APIRouter()

# Dev convenience: outside production, surface the reset OTP in the logs so it can
# be used without a working email provider. Mirrors core/security.py's env check.
_IS_PROD = os.getenv("ENVIRONMENT", "development").strip().lower() == "production"

_otp_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=10)


def _issue_reset_otp(email: str, db: Session) -> str:
    """Invalidate existing password-reset tokens for this email, then create a new one."""
    db.query(VerificationToken).filter(
        VerificationToken.email == email,
        VerificationToken.token_type == "password_reset",
        VerificationToken.used == False,  # noqa: E712
    ).update({"used": True})

    otp = str(random.randint(100000, 999999))
    token = VerificationToken(
        email=email,
        token_type="password_reset",
        otp_hash=_otp_ctx.hash(otp),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
        used=False,
    )
    db.add(token)
    db.commit()
    return otp


@router.post("/forgot-password", status_code=status.HTTP_200_OK)
@(limiter.limit("5/minute") if RATE_LIMITING_ENABLED else lambda f: f)
def forgot_password(request: Request, body: ForgotPasswordRequest, db: Session = Depends(config.get_db)):
    """
    Handles the first step of password reset.
    Generates an OTP and sends it to the user's email.
    Rate limited: 5 requests/minute per IP.
    """
    user = get_user_by_email(body.email, db)
    if not user:
        logging.info(f"Password reset requested for non-existent email: {body.email}")
        return {"message": "If an account with this email exists, a password reset OTP has been sent."}

    otp = _issue_reset_otp(user.email, db)
    send_password_reset_otp(email=user.email, otp=otp)
    logging.info(f"Password reset OTP issued for {user.email}")
    if not _IS_PROD:
        # NEVER logs in production — guarded so the OTP can't leak to prod logs.
        logging.warning(f"[DEV] Password reset OTP for {user.email}: {otp}")

    return {"message": "If an account with this email exists, a password reset OTP has been sent."}


@router.post("/verify-otp", status_code=status.HTTP_200_OK)
@(limiter.limit("10/minute") if RATE_LIMITING_ENABLED else lambda f: f)
def verify_otp(request: Request, body: VerifyOTPRequest, db: Session = Depends(config.get_db)):
    """
    Verifies the OTP and provides a short-lived token for password reset.
    Rate limited: 10 requests/minute per IP.
    """
    token = (
        db.query(VerificationToken)
        .filter(
            VerificationToken.email == body.email,
            VerificationToken.token_type == "password_reset",
            VerificationToken.used == False,  # noqa: E712
        )
        .order_by(VerificationToken.created_at.desc())
        .first()
    )

    if not token or not _otp_ctx.verify(body.otp, token.otp_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OTP.")

    if datetime.now(timezone.utc) > token.expires_at:
        token.used = True
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OTP has expired.")

    token.used = True
    db.commit()

    reset_token = create_access_token(
        user_data={"sub": body.email, "scope": "reset_password"},
        expiry=timedelta(minutes=10)
    )

    return {"status": "success", "token": reset_token}


@router.post("/reset-password", status_code=status.HTTP_200_OK)
@(limiter.limit("5/minute") if RATE_LIMITING_ENABLED else lambda f: f)
def reset_password(request: Request, body: ResetPasswordRequest, db: Session = Depends(config.get_db)):
    """
    Resets the user's password using a valid reset token.
    Rate limited: 5 requests/minute per IP.
    """
    try:
        payload = decode_token(body.token)
        # The user data is nested under the 'user' key in the token payload
        token_data = payload.get("user") if payload else None
        if not token_data or token_data.get("scope") != "reset_password":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired reset token.")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired reset token.")

    email = token_data.get("sub")
    if not email:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload.")

    hashed_password = generate_passwd_hash(body.new_password)

    success = update_password_by_email(db, email=email, new_password_hash=hashed_password)

    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    return {"status": "success", "message": "Password has been reset successfully."}
