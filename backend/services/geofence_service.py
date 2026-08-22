"""Geofencing v3 — single source of truth for location-based clock-in/out
enforcement.

Used by every punch path (mobile clock-in/out, kiosk) so the rules are
identical everywhere:

  * ``company.geofence_default_mode`` is the master switch:
      - 'off'   → record only, no enforcement (existing behaviour)
      - 'block' → reject punches outside every active fence (HTTP 403)
      - 'flag'  → allow but mark ``out_of_geofence`` for admin review
  * Per-fence ``mode`` ('block' | 'flag') overrides the company default
    for a specific site. A punch outside every fence is judged against the
    *nearest* active fence's mode.
  * QR / Wi-Fi anchors verify presence without trusting GPS (indoor sites,
    weak tablet GPS).
  * A fix that is too imprecise, too stale, or mock-injected is treated as
    unverifiable and judged against the company default mode.

Design notes (from the geofencing plan):
  * Server-side enforcement is authoritative; the mobile app additionally
    pre-checks for good UX, but a spoofed client can never bypass the fence.
  * Kiosk punches are trusted (the device IS the fence — Brikly model), so
    weak tablet GPS can never lock out employees. The registered device
    position is recorded for audit, never used to block.
  * Every decision is returned as an audit pack so callers can persist
    ``geofence_check_json`` on the TimeLog and mirror blocks to AuditLog.
"""
from __future__ import annotations

import hmac
import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from core.model import Company, CompanyGeofence

# Maximum acceptable GPS accuracy (metres) for an enforcement decision.
ACCURACY_THRESHOLD_M = 150.0
# Oldest acceptable GPS fix (seconds). A stale cached fix (the mobile app
# prefers last-known position) can't be trusted to decide block/flag.
MAX_FIX_AGE_SECONDS = 120.0

BLOCK_CODES = {"outside_geofence", "unverifiable_location", "mock_detected"}


@dataclass
class PunchContext:
    """Everything the enforcement decision needs about one punch.

    ``source`` distinguishes mobile vs kiosk. ``kiosk_latitude/longitude``
    are the registered device position (audit only — kiosk is trusted).
    """
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    accuracy_m: Optional[float] = None
    fix_timestamp: Optional[datetime] = None
    mock_detected: bool = False
    qr_token: Optional[str] = None
    wifi_bssid: Optional[str] = None
    device_id: Optional[str] = None
    os: Optional[str] = None
    app_version: Optional[str] = None
    ip_address: Optional[str] = None
    source: str = "mobile"  # 'mobile' | 'kiosk' | 'web'
    kiosk_latitude: Optional[float] = None
    kiosk_longitude: Optional[float] = None
    # The employee's assigned home site (company_geofences.geofence_id). When
    # set + active, the punch is judged against THIS fence only — clocking in
    # at a different branch is "outside". None → any active fence governs.
    home_geofence_id: Optional[int] = None


@dataclass
class GeofenceOutcome:
    """The result of evaluating one punch against a company's fences."""
    inside: bool
    mode: Optional[str] = None          # effective mode: None (disabled), 'block', 'flag'
    fence_id: Optional[int] = None
    fence_name: Optional[str] = None
    distance_m: Optional[float] = None
    reason: str = "disabled"            # see resolve_punch for the vocabulary
    flagged: bool = False               # caller should set out_of_geofence=True
    verified_by: str = "none"           # 'gps' | 'qr' | 'wifi' | 'kiosk_device' | 'none'
    audit: dict = field(default_factory=dict)


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance between two coordinates in metres."""
    r_earth = 6_371_000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lng2 - lng1)
    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    )
    return 2 * r_earth * math.asin(math.sqrt(a))


def _safe_eq(a: Optional[str], b: Optional[str]) -> bool:
    return bool(a and b) and hmac.compare_digest(a, b)


def _wifi_matches(fence: CompanyGeofence, bssid: Optional[str]) -> bool:
    if not bssid or not fence.anchor_wifi_bssids:
        return False
    wanted = {str(b).strip().upper() for b in fence.anchor_wifi_bssids if b}
    return bssid.strip().upper() in wanted


def _audit_base(ctx: PunchContext) -> dict:
    return {
        "source": ctx.source,
        "mock_detected": ctx.mock_detected,
        "accuracy_m": ctx.accuracy_m,
        "fix_timestamp": ctx.fix_timestamp.isoformat() if ctx.fix_timestamp else None,
        "device_id": ctx.device_id,
        "os": ctx.os,
        "app_version": ctx.app_version,
        "ip_address": ctx.ip_address,
        "qr_token": bool(ctx.qr_token),
        "wifi_bssid": ctx.wifi_bssid,
        "kiosk_latitude": ctx.kiosk_latitude,
        "kiosk_longitude": ctx.kiosk_longitude,
    }


def _pack(outcome: "GeofenceOutcome", base: dict, mode, fence_id, distance_m) -> "GeofenceOutcome":
    """Stamp the audit pack with the decision fields and return the outcome."""
    outcome.audit = {
        **base,
        "mode": mode,
        "fence_id": fence_id,
        "distance_m": distance_m,
        "reason": outcome.reason,
        "inside": outcome.inside,
        "verified_by": outcome.verified_by,
    }
    return outcome


def get_company_geofences(company_id: int, db: Session) -> List[CompanyGeofence]:
    """All fences for a company, ordered by id (stable for tests)."""
    return (
        db.query(CompanyGeofence)
        .filter(CompanyGeofence.company_id == company_id)
        .filter(CompanyGeofence.deleted_at.is_(None))
        .order_by(CompanyGeofence.geofence_id.asc())
        .all()
    )


def employee_home_fence_id(db: Session, private_user_id: int) -> Optional[int]:
    """The employee's assigned home site id (or None) for punch enforcement."""
    from core.model import PrivateUser
    return db.query(PrivateUser.home_geofence_id).filter(
        PrivateUser.private_user_id == private_user_id,
    ).scalar()


def resolve_punch(
    company: Company,
    fences: List[CompanyGeofence],
    ctx: PunchContext,
) -> GeofenceOutcome:
    """Evaluate one punch against the company's geofencing config.

    Returns an outcome with enough info for the caller to persist the audit
    pack and (in flag mode) set ``out_of_geofence``. Never raises — the
    caller decides whether to block via ``outcome.mode``/``outcome.inside``.
    """
    base = _audit_base(ctx)

    # 1. Feature off, or no active fences → record only.
    active = [f for f in fences if f.active]
    if company.geofence_default_mode == "off" or not active:
        outcome = GeofenceOutcome(inside=True, mode=None, reason="disabled", verified_by="none")
        return _pack(outcome, base, None, None, None)

    effective_mode = company.geofence_default_mode  # 'block' | 'flag'

    # Home-site assignment (optional). When set and the fence is active, the
    # punch is judged against THIS site only — a Port-Louis employee at HQ is
    # outside. Falls back to any-active-fence when unset/inactive so a stale
    # or soft-deleted assignment never locks an employee out.
    home = next((f for f in active if f.geofence_id == ctx.home_geofence_id), None)

    # 2. Kiosk is trusted — the registered device position IS the fence.
    #    Weak tablet GPS can never lock out employees (Brikly model). When a
    #    home site is assigned, the kiosk position must still be inside it.
    if ctx.source == "kiosk":
        if home is None or ctx.latitude is None or ctx.longitude is None:
            outcome = GeofenceOutcome(
                inside=True,
                mode=effective_mode,
                reason="kiosk_device",
                verified_by="kiosk_device",
            )
            return _pack(outcome, base, effective_mode, None, None)
        d = haversine_m(ctx.latitude, ctx.longitude, home.latitude, home.longitude)
        mode = home.mode or effective_mode
        if d <= home.radius_meters:
            outcome = GeofenceOutcome(
                inside=True, mode=mode, fence_id=home.geofence_id,
                fence_name=home.name, distance_m=d, reason="inside",
                verified_by="kiosk_device",
            )
            return _pack(outcome, base, mode, home.geofence_id, d)
        outcome = GeofenceOutcome(
            inside=False, mode=mode, fence_id=home.geofence_id,
            fence_name=home.name, distance_m=d, reason="outside",
            flagged=mode == "flag", verified_by="kiosk_device",
        )
        return _pack(outcome, base, mode, home.geofence_id, d)

    # 3. QR / Wi-Fi anchors verify presence without trusting GPS. Only the
    #    assigned site's anchors count when a home site is set.
    anchors = [home] if home is not None else active
    for f in anchors:
        if _safe_eq(ctx.qr_token, f.anchor_qr_token):
            outcome = GeofenceOutcome(
                inside=True, mode=f.mode or effective_mode, fence_id=f.geofence_id,
                fence_name=f.name, distance_m=0.0, reason="anchor_qr", verified_by="qr",
            )
            return _pack(outcome, base, outcome.mode, f.geofence_id, 0.0)
    for f in anchors:
        if _wifi_matches(f, ctx.wifi_bssid):
            outcome = GeofenceOutcome(
                inside=True, mode=f.mode or effective_mode, fence_id=f.geofence_id,
                fence_name=f.name, distance_m=0.0, reason="anchor_wifi", verified_by="wifi",
            )
            return _pack(outcome, base, outcome.mode, f.geofence_id, 0.0)

    # 4. No coordinates at all → unverifiable.
    if ctx.latitude is None or ctx.longitude is None:
        return _unverifiable(base, effective_mode, reason="no_location")

    # 5. Mock-injected location → unverifiable (fraud signal).
    if ctx.mock_detected:
        return _unverifiable(base, effective_mode, reason="mock_detected")

    # 6. Accuracy / staleness gate — a low-confidence fix can't be trusted.
    if ctx.accuracy_m is not None and ctx.accuracy_m > ACCURACY_THRESHOLD_M:
        return _unverifiable(base, effective_mode, reason="unverifiable_accuracy")
    if ctx.fix_timestamp is not None:
        age_seconds = (datetime.now(timezone.utc) - _to_utc(ctx.fix_timestamp)).total_seconds()
        if age_seconds > MAX_FIX_AGE_SECONDS:
            return _unverifiable(base, effective_mode, reason="stale_fix")

    # 7. GPS verdict. With a home site the single fence governs inside AND
    #    outside; without one, inside-any-fence wins and the nearest fence
    #    decides for outside punches.
    if home is not None:
        d = haversine_m(ctx.latitude, ctx.longitude, home.latitude, home.longitude)
        mode = home.mode or effective_mode
        if d <= home.radius_meters:
            outcome = GeofenceOutcome(
                inside=True, mode=mode, fence_id=home.geofence_id,
                fence_name=home.name, distance_m=d, reason="inside", verified_by="gps",
            )
            return _pack(outcome, base, mode, home.geofence_id, d)
        outcome = GeofenceOutcome(
            inside=False, mode=mode, fence_id=home.geofence_id,
            fence_name=home.name, distance_m=d, reason="outside",
            flagged=mode == "flag", verified_by="gps",
        )
        return _pack(outcome, base, mode, home.geofence_id, d)

    nearest: Optional[CompanyGeofence] = None
    nearest_distance = float("inf")
    for f in active:
        d = haversine_m(ctx.latitude, ctx.longitude, f.latitude, f.longitude)
        if d <= f.radius_meters:
            outcome = GeofenceOutcome(
                inside=True, mode=f.mode or effective_mode, fence_id=f.geofence_id,
                fence_name=f.name, distance_m=d, reason="inside", verified_by="gps",
            )
            return _pack(outcome, base, outcome.mode, f.geofence_id, d)
        if d < nearest_distance:
            nearest, nearest_distance = f, d

    # 8. Outside every fence → nearest active fence's mode decides.
    assert nearest is not None
    mode = nearest.mode or effective_mode
    flagged = mode == "flag"
    outcome = GeofenceOutcome(
        inside=False, mode=mode, fence_id=nearest.geofence_id,
        fence_name=nearest.name, distance_m=nearest_distance,
        reason="outside", flagged=flagged, verified_by="gps",
    )
    return _pack(outcome, base, mode, nearest.geofence_id, nearest_distance)


def _to_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _unverifiable(base: dict, effective_mode: str, reason: str) -> GeofenceOutcome:
    """A fix we can't trust (no coords / poor accuracy / stale / mock).

    Judged against the company's default mode: 'block' refuses, 'flag'
    allows but flags the punch for review.
    """
    flagged = effective_mode == "flag"
    outcome = GeofenceOutcome(
        inside=False, mode=effective_mode, reason=reason,
        flagged=flagged, verified_by="none",
    )
    return _pack(outcome, base, effective_mode, None, None)


def block_message(outcome: GeofenceOutcome) -> dict:
    """Human + machine readable payload for the HTTP 403 raised on a block.

    ``code`` lets clients (mobile pre-check backstop) detect the specific
    reason; ``message`` is display-ready.
    """
    messages = {
        "outside_geofence": "You are outside your company's allowed clock-in area.",
        "unverifiable_location": (
            "Your location could not be verified (GPS is off or too imprecise). "
            "Please enable GPS and try again closer to your workplace."
        ),
        "mock_detected": (
            "Your device is reporting a mocked location. Disable mock GPS / "
            "Developer options and try again."
        ),
    }
    if outcome.reason in ("outside", "no_location", "unverifiable_accuracy", "stale_fix"):
        code = "outside_geofence" if outcome.reason == "outside" else "unverifiable_location"
    else:
        code = outcome.reason
    payload = {
        "code": code,
        "message": messages.get(code, "Clock-in/out blocked by your company's geofence."),
        "distance_m": outcome.distance_m,
        "fence": outcome.fence_name,
        "reason": outcome.reason,
    }
    return payload


def enforce_punch(
    company: Company,
    fences: List[CompanyGeofence],
    ctx: PunchContext,
) -> GeofenceOutcome:
    """Enforce the geofence for one punch.

    Raises ``HTTPException(403)`` when the effective mode is 'block' and the
    punch is not verified (outside / unverifiable / mock). Returns the
    outcome otherwise so the caller can persist the audit pack + flag.
    """
    outcome = resolve_punch(company, fences, ctx)
    if outcome.mode == "block" and not outcome.inside:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=block_message(outcome),
        )
    return outcome