from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from core import config
from core.model import VerificationToken
from db_models.crud.user import get_user_by_email
from services.email_service import send_signup_otp_email
from passlib.context import CryptContext
import random
from datetime import datetime, timedelta, timezone
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/verify", tags=["Verification"])

_otp_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=10)


def _issue_otp(email: str, token_type: str, expires_minutes: int, db: Session) -> str:
    """Invalidate any existing active token for this email+type, then create a new one.
    Returns the plain-text OTP to be emailed."""
    # Mark all previous active tokens as used
    db.query(VerificationToken).filter(
        VerificationToken.email == email,
        VerificationToken.token_type == token_type,
        VerificationToken.used == False,  # noqa: E712
    ).update({"used": True})

    otp = str(random.randint(100000, 999999))
    logger.info(f"OTP issued  email={email}  type={token_type}  otp={otp}  expires_in={expires_minutes}m")
    token = VerificationToken(
        email=email,
        token_type=token_type,
        otp_hash=_otp_ctx.hash(otp),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=expires_minutes),
        used=False,
    )
    db.add(token)
    db.commit()
    return otp


def _verify_otp(email: str, otp: str, token_type: str, db: Session) -> None:
    """Verify the OTP. Raises HTTPException on failure; marks token used on success."""
    token = (
        db.query(VerificationToken)
        .filter(
            VerificationToken.email == email,
            VerificationToken.token_type == token_type,
            VerificationToken.used == False,  # noqa: E712
        )
        .order_by(VerificationToken.created_at.desc())
        .first()
    )

    if not token or not _otp_ctx.verify(otp, token.otp_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OTP.")

    if datetime.now(timezone.utc) > token.expires_at:
        token.used = True
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OTP has expired.")

    token.used = True
    db.commit()


@router.post("/signup", status_code=status.HTTP_200_OK)
def verify_signup(email: str, otp: str, db: Session = Depends(config.get_db)):
    """Verifies the signup OTP and marks the user as verified."""
    _verify_otp(email, otp, "signup", db)

    user = get_user_by_email(email, db)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    user.user_verified = True
    db.commit()

    return {"status": "success", "message": "Email verified successfully. You can now log in."}


@router.post("/resend", status_code=status.HTTP_200_OK)
def resend_verification(email: str, db: Session = Depends(config.get_db)):
    """Resends a verification OTP, invalidating any previous code."""
    user = get_user_by_email(email, db)
    if not user:
        # Prevent enumeration
        return {"message": "If an account with this email exists, a new OTP has been sent."}

    if user.user_verified:
        return {"message": "User is already verified."}

    otp = _issue_otp(email, "signup", 10, db)
    send_signup_otp_email(email, otp)
    logging.info(f"Resend OTP issued for {email}")

    return {"status": "success", "message": "Verification code resent."}
