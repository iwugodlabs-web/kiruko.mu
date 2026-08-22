"""Step-up auth router (M7).

Two endpoints to perform fresh OTP-backed re-authentication before a
high-stakes action:

    POST /auth/step-up/request   { purpose }
        — issues a 6-digit OTP, emails it to the authenticated user.
        — 200 (no leak whether email/account is valid; user is the active
          session, so we can be specific about the purpose label).

    POST /auth/step-up           { purpose, otp_code }
        — validates the OTP, issues a 5-minute single-use step-up token.
        — 200 with { token, expires_at } on success; 400 on bad OTP.

The returned token is then sent as `X-Step-Up-Token` on the protected
endpoint (e.g. `POST /payroll/runs/{run_id}/finalize`).
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core import config
from core.dependencies import get_current_user
from core.model import User
from core.step_up import (
    ALLOWED_PURPOSES,
    consume_otp_and_issue_token,
    issue_step_up_otp,
)
from services.email_service import send_step_up_otp


router = APIRouter(prefix="/auth", tags=["Step-up Auth"])


class StepUpRequestIn(BaseModel):
    purpose: str = Field(..., description=f"One of: {sorted(ALLOWED_PURPOSES)}")


class StepUpVerifyIn(BaseModel):
    purpose: str
    otp_code: str = Field(..., min_length=6, max_length=6)


class StepUpVerifyOut(BaseModel):
    token: str
    expires_at: datetime
    purpose: str


@router.post("/step-up/request", status_code=200)
def request_step_up_otp(
    body: StepUpRequestIn,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Issue a step-up OTP for the authenticated user. The OTP is emailed.

    Returns 200 with no token — the caller must follow up with
    POST /auth/step-up containing the OTP code.
    """
    if body.purpose not in ALLOWED_PURPOSES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown step-up purpose: {body.purpose}. Allowed: {sorted(ALLOWED_PURPOSES)}",
        )

    if not current_user.email:
        raise HTTPException(
            status_code=400,
            detail="Account has no email on file; cannot send step-up OTP.",
        )

    otp = issue_step_up_otp(db, current_user, body.purpose)

    # Dev-only: log the OTP to the server console so local devs don't need
    # to dig through Mailtrap. Gated on DEV_LOG_OTP=true OR
    # ENVIRONMENT in {dev, development, local}. Never logged in prod —
    # leaking step-up codes in centralized log aggregation would defeat the
    # whole point of the 5-minute single-use guard.
    import os
    _env = (os.environ.get("ENVIRONMENT") or "").lower()
    if (os.environ.get("DEV_LOG_OTP", "").lower() == "true"
            or _env in {"dev", "development", "local"}):
        import logging as _logging
        _logging.getLogger("kontokaz.step_up").warning(
            "[DEV] step-up OTP for user_id=%s purpose=%s → %s (5 min, single use)",
            current_user.user_id, body.purpose, otp,
        )

    try:
        send_step_up_otp(current_user.email, body.purpose, otp)
    except Exception as exc:
        # Email failed but OTP is in DB — let the user retry; don't leak the OTP.
        import logging
        logging.getLogger("kontokaz.step_up").error(
            "step_up email failed",
            extra={"user_id": current_user.user_id, "error": str(exc)},
        )
        raise HTTPException(
            status_code=502,
            detail="Step-up OTP could not be delivered. Try again or contact support.",
        )

    return {"status": "sent", "purpose": body.purpose}


@router.post("/step-up", response_model=StepUpVerifyOut)
def verify_step_up_otp(
    body: StepUpVerifyIn,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Verify the OTP and return a 5-minute single-use step-up token.

    Send this token as `X-Step-Up-Token` on the protected endpoint.
    """
    token, expires_at = consume_otp_and_issue_token(
        db, current_user, body.purpose, body.otp_code
    )
    return StepUpVerifyOut(token=token, expires_at=expires_at, purpose=body.purpose)
