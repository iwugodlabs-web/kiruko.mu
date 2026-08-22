"""Session binding + continuous anomaly signal (device/IP binding on JWT).

Binds the access token to the client device (``X-Device-Id``) and source IP at
login, then re-checks them on every authenticated request via
:func:`check_session_anomaly` (called from the two ``get_current_user``
dependencies). A token replayed from a different device is the strongest
stolen-token signal; an IP change is weaker (mobile clients roam across
networks) so it is audited but never blocks.

Mode (``SESSION_ANOMALY_MODE``), read at request time so it can be flipped
without a redeploy:

  * ``off``    (default) — no binding claims are minted; behaviour unchanged.
  * ``audit``  — mint claims; on mismatch write an AuditLog row + log.warning,
                 but allow the request.
  * ``block``  — mint claims; on DEVICE mismatch reject 401. IP-only mismatch
                 is audited only (never blocks).

Device binding only applies to clients that send ``X-Device-Id`` (the mobile
app does, on every request — see mobile/services/apiClient.tsx). Web clients
send no device header, so their tokens carry IP only and never hit the
device-mismatch block path.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

from fastapi import HTTPException, Request, status
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

_OFF = "off"
_AUDIT = "audit"
_BLOCK = "block"
_VALID_MODES = (_OFF, _AUDIT, _BLOCK)

DEVICE_CLAIM = "sess_dev"
IP_CLAIM = "sess_ip"


def session_anomaly_mode() -> str:
    """Current mode. Read per call so it can be flipped without a redeploy;
    invalid/unset values fall back to 'off' (fail closed, no behaviour change)."""
    mode = os.environ.get("SESSION_ANOMALY_MODE", _OFF).strip().lower()
    return mode if mode in _VALID_MODES else _OFF


def get_client_ip(request: Request) -> Optional[str]:
    """Resolve the client IP, preferring the first hop of X-Forwarded-For
    (set by a reverse proxy) over the socket peer. Mirrors the kiosk
    dependency's extraction in core/dependencies.py."""
    fwd = request.headers.get("X-Forwarded-For")
    if fwd:
        return fwd.split(",")[0].strip() or None
    return request.client.host if request.client else None


def device_signal(request: Request) -> Optional[str]:
    """The device identity used for binding. Only ``X-Device-Id`` is trusted —
    the mobile app sends it on every request; web does not, so web tokens carry
    no device claim and never hit the device-mismatch block."""
    dev = (request.headers.get("X-Device-Id") or "").strip()
    return dev or None


def session_binding_claims(
    *,
    device: Optional[str] = None,
    ip: Optional[str] = None,
) -> dict:
    """The claims to merge into the access token's ``user`` dict at login /
    refresh. Missing values are omitted (web → no device claim)."""
    claims = {}
    if device:
        claims[DEVICE_CLAIM] = device
    if ip:
        claims[IP_CLAIM] = ip
    return claims


def _write_anomaly_audit(
    db: Session,
    *,
    user_id: Optional[int],
    dev_changed: bool,
    ip_changed: bool,
    expected_dev: Optional[str],
    current_dev: Optional[str],
    expected_ip: Optional[str],
    current_ip: Optional[str],
    path: str,
) -> None:
    """Best-effort audit row. Never raises — the request the audit describes
    has already been decided; we shouldn't 500 trying to log it."""
    try:
        from db_models.crud.audit import create_audit_log

        create_audit_log(
            db,
            user_id=user_id,
            action="session.anomaly",
            resource_type="session",
            resource_id=None,
            details={
                "device_changed": dev_changed,
                "ip_changed": ip_changed,
                "expected_device": expected_dev,
                "current_device": current_dev,
                "expected_ip": expected_ip,
                "current_ip": current_ip,
                "path": path,
            },
            commit=True,
        )
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass


def check_session_anomaly(db: Session, request: Request, token_data: dict) -> None:
    """Compare the request's device/IP against the token's binding claims.

    Called from both ``get_current_user`` dependencies on every authenticated
    request. Raises 401 only when the mode is 'block' AND the device identity
    changed; every other outcome is audit-only (log + AuditLog row) or a no-op
    for legacy tokens minted without binding claims.
    """
    mode = session_anomaly_mode()
    if mode == _OFF:
        return

    user_claims = token_data.get("user") or {}
    expected_dev = user_claims.get(DEVICE_CLAIM)
    expected_ip = user_claims.get(IP_CLAIM)
    if not expected_dev and not expected_ip:
        return  # legacy token minted before binding — leave it alone

    current_dev = device_signal(request)
    current_ip = get_client_ip(request)
    dev_changed = bool(expected_dev) and current_dev != expected_dev
    ip_changed = bool(expected_ip) and current_ip != expected_ip

    if not dev_changed and not ip_changed:
        return

    user_id = user_claims.get("user_id") or user_claims.get("user_uid")

    logger.warning(
        "session.anomaly",
        extra={
            "user_id": user_id,
            "device_changed": dev_changed,
            "ip_changed": ip_changed,
            "expected_device": expected_dev,
            "current_device": current_dev,
            "expected_ip": expected_ip,
            "current_ip": current_ip,
            "path": str(request.url.path),
            "alert": "session.anomaly",
        },
    )

    _write_anomaly_audit(
        db,
        user_id=user_id,
        dev_changed=dev_changed,
        ip_changed=ip_changed,
        expected_dev=expected_dev,
        current_dev=current_dev,
        expected_ip=expected_ip,
        current_ip=current_ip,
        path=str(request.url.path),
    )

    if mode == _BLOCK and dev_changed:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session is no longer valid on this device. Please log in again.",
        )
