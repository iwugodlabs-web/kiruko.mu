"""Device-binding (trust-on-first-use) for OTP login.

Threat we're mitigating: a Mauritian mobile number gets recycled by the
carrier; new owner requests an OTP; without binding, they take over the
original passwordless account. With binding, the new owner gets:

    HTTP 403  {"detail": "new_device_requires_approval"}

…and has to involve an admin or the existing device.

The whole policy lives in :func:`check_or_bind` so the route handler
stays thin and tests can drive it directly.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Literal, Tuple

from sqlalchemy.orm import Session

from core.model import TrustedDevice, User

logger = logging.getLogger(__name__)

DeviceCheckOutcome = Literal["bound", "trusted", "needs_approval", "skipped"]


def _active_devices(db: Session, user_id: int) -> list[TrustedDevice]:
    return (
        db.query(TrustedDevice)
        .filter(TrustedDevice.user_id == user_id)
        .filter(TrustedDevice.revoked_at.is_(None))
        .all()
    )


def check_or_bind(
    *,
    db: Session,
    user: User,
    device_id: str | None,
    device_name: str | None,
) -> Tuple[DeviceCheckOutcome, TrustedDevice | None]:
    """Run the TOFU policy for a successful OTP verify.

    Returns:
        ``("skipped", None)``           — policy not applicable (user has
            password set, OR no device_id sent by the client). Login
            proceeds.
        ``("bound", row)``              — first device for this user (TOFU)
            OR password-fallback-eligible user adding a new device. Row
            was inserted. Login proceeds.
        ``("trusted", row)``            — device was already on file;
            ``last_seen_at`` bumped. Login proceeds.
        ``("needs_approval", None)``    — passwordless user trying to use
            a new device while other devices are already active. Caller
            must reject the login with 403 ``new_device_requires_approval``.
    """
    # No device_id header from the client: degrade open. We don't want
    # to lock out legitimate users running a client version that
    # pre-dates the header. Pilot deployments can flip this to "closed"
    # via a future REQUIRE_TRUSTED_DEVICE env var once all clients are
    # rolled out.
    if not device_id:
        logger.info("trusted_device: skipped (no X-Device-Id) user_id=%s", user.user_id)
        return ("skipped", None)

    has_password = bool(getattr(user, "password_hash", None))

    existing = (
        db.query(TrustedDevice)
        .filter(TrustedDevice.device_id == device_id)
        .filter(TrustedDevice.user_id == user.user_id)
        .filter(TrustedDevice.revoked_at.is_(None))
        .first()
    )
    if existing:
        existing.last_seen_at = datetime.now(timezone.utc)
        # Keep the human-readable name fresh too (laptops get renamed).
        if device_name and existing.device_name != device_name:
            existing.device_name = device_name[:120]
        db.commit()
        return ("trusted", existing)

    actives = _active_devices(db, user.user_id)
    if not actives:
        # TOFU — first OTP login for this user, no prior devices.
        row = _bind(db, user.user_id, device_id, device_name)
        logger.info(
            "trusted_device: bound (TOFU first-device) user_id=%s device_id=%s",
            user.user_id, device_id,
        )
        return ("bound", row)

    if has_password:
        # User can always log in with password; adding their new device
        # silently is fine because the password is the fallback if this
        # was actually a recycled-number attack (the real owner just
        # logs in with password and revokes the rogue device).
        row = _bind(db, user.user_id, device_id, device_name)
        logger.info(
            "trusted_device: bound (password-fallback eligible) user_id=%s device_id=%s",
            user.user_id, device_id,
        )
        return ("bound", row)

    # Passwordless user + new device + other devices already active →
    # the only signal we have for "is this really you?" is the OTP,
    # which the recycled-number attacker also receives. Lock it down.
    logger.warning(
        "trusted_device: needs_approval user_id=%s new_device_id=%s active_count=%d",
        user.user_id, device_id, len(actives),
    )
    return ("needs_approval", None)


def _bind(
    db: Session, user_id: int, device_id: str, device_name: str | None
) -> TrustedDevice:
    row = TrustedDevice(
        device_id=device_id[:80],
        user_id=user_id,
        device_name=(device_name or "")[:120] or None,
    )
    db.add(row)
    db.commit()
    return row


def list_devices(db: Session, user_id: int, include_revoked: bool = False) -> list[TrustedDevice]:
    q = db.query(TrustedDevice).filter(TrustedDevice.user_id == user_id)
    if not include_revoked:
        q = q.filter(TrustedDevice.revoked_at.is_(None))
    return q.order_by(TrustedDevice.last_seen_at.desc()).all()


def revoke_device(db: Session, user_id: int, device_id: str) -> bool:
    """Soft-revoke. Returns True if a row was updated."""
    row = (
        db.query(TrustedDevice)
        .filter(TrustedDevice.user_id == user_id)
        .filter(TrustedDevice.device_id == device_id)
        .filter(TrustedDevice.revoked_at.is_(None))
        .first()
    )
    if not row:
        return False
    row.revoked_at = datetime.now(timezone.utc)
    db.commit()
    logger.info("trusted_device: revoked user_id=%s device_id=%s", user_id, device_id)
    return True
