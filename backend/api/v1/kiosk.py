"""M26 — Kiosk MVP endpoints.

Two surfaces in one router:

  * **Admin** (company-scoped, gated by ``require_company_admin``) — device
    lifecycle + employee PIN management. Mounted under the company URL
    pattern that matches ``api/v1/time_log_review.py`` so the existing
    web admin app can pick it up.

  * **Kiosk** (device-token-scoped, gated by ``get_kiosk_context``) — the
    runtime path the tablet hits: employee lookup → PIN-protected
    clock-in. Idempotency-Key required on clock-in so a frontend retry
    can't double-create.

The detailed contract for each endpoint lives in
``KIOSK_IMPLEMENTATION_PLAN.md`` (Backend → Routes). Wage-theft /
governance posture mirrors ``time_log_review.py``: every kiosk-created
log flows into the existing approval surface, filterable by
``created_source='kiosk'`` (added in M30).
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, List, Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Path
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from core import config
from core.auth_guards import require_company_admin, require_platform_admin
from core.dependencies import get_current_user, get_kiosk_context
from core.model import KioskDevice, PrivateUser, User
from services.kiosk_service import KioskContext, KioskService


router = APIRouter(tags=["Kiosk"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class KioskRegisterRequest(BaseModel):
    device_name: str = Field(..., min_length=1, max_length=120)
    location: Optional[dict] = None


class KioskRegisterResponse(BaseModel):
    device_id: uuid.UUID
    device_name: str
    api_token: str = Field(..., description="Shown once — copy immediately.")
    admin_pin: str = Field(..., description="Shown once — the admin enters this on the tablet to manage the kiosk.")
    token_expires_at: datetime


class KioskListItem(BaseModel):
    device_id: uuid.UUID
    device_name: str
    location: Optional[dict] = None
    is_active: bool
    last_seen_at: Optional[datetime] = None
    token_expires_at: datetime
    created_at: datetime


class KioskRotateResponse(BaseModel):
    device_id: uuid.UUID
    api_token: str = Field(..., description="Shown once — copy immediately.")
    token_expires_at: datetime


class KioskRotatePinResponse(BaseModel):
    device_id: uuid.UUID
    admin_pin: str = Field(..., description="Shown once — the admin enters this on the tablet.")


class KioskPinRequest(BaseModel):
    pin: str = Field(..., min_length=4, max_length=4, pattern=r"^\d{4}$")


class KioskLookupRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=120)


class KioskLookupCandidate(BaseModel):
    """Restricted projection — does NOT echo the raw email/phone so a
    stolen tablet can't be used to dump the employee directory.

    M32 — `has_active_session` lets the kiosk UI decide between calling
    /kiosk/clock-in vs /kiosk/clock-out after PIN verify without a
    second roundtrip.

    kiosk v1.6 — `preferred_locale` (M18 column on `User`) is included
    so the kiosk client can switch into the employee's language for the
    PIN + success/error screens once they're identified. NULL when the
    employee hasn't set a preference; client falls back to the device
    cookie locale.

    kiosk v1.6.3 — `department_name` + `job_title` shown beneath the
    name on the candidate picker so two employees with the same first
    name can be told apart. Both are workplace-meaningful (not PII like
    email/phone) so they're safe to surface even on a stolen tablet.
    """
    private_user_id: int
    display_name: str
    has_pin: bool
    has_active_session: bool = False
    preferred_locale: Optional[str] = None
    department_name: Optional[str] = None
    job_title: Optional[str] = None


class KioskClockInRequest(BaseModel):
    private_user_id: int
    pin: str = Field(..., min_length=4, max_length=4, pattern=r"^\d{4}$")
    location: dict
    # v1.7 — optional base64-encoded selfie captured by the kiosk's
    # front camera. Buddy-punching deterrent: stored, not used for
    # auth. Accepts data-URL ("data:image/jpeg;base64,...") or raw
    # base64. NULL when the kiosk has no camera / permission denied.
    photo_b64: Optional[str] = None


class KioskClockInResponse(BaseModel):
    status: str
    timelog_id: int
    message: str
    clocked_in_at: datetime
    created_source: str


# M32 — clock-out shares the auth/body shape but carries close-time + duration.
class KioskClockOutResponse(BaseModel):
    status: str
    timelog_id: int
    message: str
    clocked_out_at: datetime
    hours_worked: Optional[float]


# ---------------------------------------------------------------------------
# Admin endpoints (company-scoped)
# ---------------------------------------------------------------------------


@router.post(
    "/companies/{company_id}/kiosks/register",
    response_model=KioskRegisterResponse,
    status_code=201,
)
def register_kiosk_device(
    company_id: int,
    body: KioskRegisterRequest,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Register a new kiosk device for the company. Returns the raw API
    token exactly once — store it immediately; the DB only keeps the hash.

    Platform-admin only: companies don't provision their own kiosk hardware;
    Kiruko registers devices on their behalf."""
    require_platform_admin(current_user, db)

    try:
        device, raw_token, admin_pin = KioskService.register_device(
            db=db,
            company_id=company_id,
            device_name=body.device_name,
            location=body.location,
            created_by_user_id=current_user.user_id,
        )
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"A device named “{body.device_name}” already exists for this company. Choose a different name.",
        )
    return KioskRegisterResponse(
        device_id=device.device_id,
        device_name=device.device_name,
        api_token=raw_token,
        admin_pin=admin_pin,
        token_expires_at=device.token_expires_at,
    )


@router.get(
    "/companies/{company_id}/kiosks",
    response_model=List[KioskListItem],
)
def list_kiosk_devices(
    company_id: int,
    include_inactive: bool = False,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """List kiosk devices for the company. By default hides deactivated
    ones; pass ?include_inactive=true to see them for audit purposes.

    Platform-admin only (device management is a Kiruko-side concern)."""
    require_platform_admin(current_user, db)
    devices = KioskService.list_devices(db, company_id, include_inactive=include_inactive)
    return [
        KioskListItem(
            device_id=d.device_id,
            device_name=d.device_name,
            location=d.location,
            is_active=d.is_active,
            last_seen_at=d.last_seen_at,
            token_expires_at=d.token_expires_at,
            created_at=d.created_at,
        )
        for d in devices
    ]


def _resolve_device_for_admin(
    device_id: uuid.UUID,
    db: Session,
    current_user: User,
) -> KioskDevice:
    """Shared lookup for rotate / deactivate. Platform-admin only — device
    lifecycle is a Kiruko-side concern, not a company self-serve action."""
    device = db.query(KioskDevice).filter(KioskDevice.device_id == device_id).first()
    if device is None:
        raise HTTPException(status_code=404, detail="kiosk_device_not_found")
    require_platform_admin(current_user, db)
    return device


@router.post(
    "/kiosks/{device_id}/rotate-token",
    response_model=KioskRotateResponse,
)
def rotate_kiosk_token(
    device_id: uuid.UUID = Path(...),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Issue a fresh 30-day token. The previous token stops validating
    immediately. Use after suspected token leakage or on a regular cadence."""
    device = _resolve_device_for_admin(device_id, db, current_user)
    raw_token = KioskService.rotate_token(db, device.device_id, actor_user_id=current_user.user_id)
    db.refresh(device)
    return KioskRotateResponse(
        device_id=device.device_id,
        api_token=raw_token,
        token_expires_at=device.token_expires_at,
    )


@router.post(
    "/kiosks/{device_id}/rotate-admin-pin",
    response_model=KioskRotatePinResponse,
)
def rotate_kiosk_admin_pin(
    device_id: uuid.UUID = Path(...),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Regenerate the device's admin PIN. The previous PIN stops working; the
    admin must enter the new one on the tablet (it's shown once here)."""
    device = _resolve_device_for_admin(device_id, db, current_user)
    admin_pin = KioskService.rotate_admin_pin(db, device.device_id, actor_user_id=current_user.user_id)
    return KioskRotatePinResponse(device_id=device.device_id, admin_pin=admin_pin)


@router.post(
    "/kiosks/{device_id}/deactivate",
    status_code=204,
)
def deactivate_kiosk_device(
    device_id: uuid.UUID = Path(...),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Permanently disable a device. Tokens stop validating immediately.
    For stolen-tablet revocation."""
    device = _resolve_device_for_admin(device_id, db, current_user)
    KioskService.deactivate_device(db, device.device_id, actor_user_id=current_user.user_id)


@router.post(
    "/private-users/{private_user_id}/kiosk-pin",
    status_code=204,
)
def set_kiosk_pin(
    private_user_id: int,
    body: KioskPinRequest,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Admin sets/resets an employee's 4-digit kiosk PIN. v1 PIN reset
    path — see plan Risk §2."""
    pu = db.query(PrivateUser).filter(PrivateUser.private_user_id == private_user_id).first()
    if pu is None:
        raise HTTPException(status_code=404, detail="private_user_not_found")
    if pu.company_id is None:
        raise HTTPException(status_code=400, detail="employee_not_assigned_to_company")
    require_company_admin(current_user, pu.company_id, db)
    KioskService.set_pin(db, private_user_id, body.pin, actor_user_id=current_user.user_id)


# v1.6 polish — admin GENERATES a PIN instead of typing one. Returns
# the digits exactly once; admin shares with employee verbally / printed.
# Employee changes to one they remember via /kiosk/change-pin on first use.
class KioskPinGenerateResponse(BaseModel):
    pin: str = Field(..., description="4 digits, shown once — share with employee then they change it.")


@router.post(
    "/private-users/{private_user_id}/kiosk-pin/generate",
    response_model=KioskPinGenerateResponse,
)
def generate_kiosk_pin(
    private_user_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Admin asks the server to generate a fresh 4-digit PIN. Returned
    in plaintext on this response only — never exposed again. The
    employee changes it at the kiosk on first use via /kiosk/change-pin."""
    pu = db.query(PrivateUser).filter(PrivateUser.private_user_id == private_user_id).first()
    if pu is None:
        raise HTTPException(status_code=404, detail="private_user_not_found")
    if pu.company_id is None:
        raise HTTPException(status_code=400, detail="employee_not_assigned_to_company")
    require_company_admin(current_user, pu.company_id, db)
    pin = KioskService.generate_pin(db, private_user_id, actor_user_id=current_user.user_id)
    return KioskPinGenerateResponse(pin=pin)


# v1.6 polish — employee self-serve PIN change at the kiosk. Requires
# the current PIN (so a stolen tablet can't reset anyone's PIN).
class KioskChangePinRequest(BaseModel):
    private_user_id: int
    current_pin: str = Field(..., min_length=4, max_length=4, pattern=r"^\d{4}$")
    new_pin: str = Field(..., min_length=4, max_length=4, pattern=r"^\d{4}$")


@router.post(
    "/kiosk/change-pin",
    status_code=204,
)
def kiosk_change_pin(
    body: KioskChangePinRequest,
    db: Session = Depends(config.get_db),
    ctx: KioskContext = Depends(get_kiosk_context),
):
    """v1.6 polish — employee changes their own PIN at the kiosk.
    Verifies current PIN before accepting the new one. Same auth as
    other /kiosk/* endpoints (device-token + tenant context)."""
    pu = (
        db.query(PrivateUser)
        .filter(PrivateUser.private_user_id == body.private_user_id)
        .filter(PrivateUser.company_id == ctx.company_id)
        .first()
    )
    if pu is None:
        raise HTTPException(status_code=404, detail="employee_not_found_in_company")
    KioskService.change_pin_self_serve(db, pu.private_user_id, body.current_pin, body.new_pin)


# ---------------------------------------------------------------------------
# Kiosk runtime endpoints (device-token-scoped)
# ---------------------------------------------------------------------------


@router.post(
    "/kiosk/employee-lookup",
    response_model=List[KioskLookupCandidate],
)
def kiosk_employee_lookup(
    body: KioskLookupRequest,
    db: Session = Depends(config.get_db),
    ctx: KioskContext = Depends(get_kiosk_context),
):
    """Look up an employee by email or phone substring, scoped to this
    device's company. Result is capped at 5 candidates and intentionally
    omits raw email/phone to limit info-leak from a stolen tablet."""
    employees = KioskService.find_employees(db, ctx.company_id, body.query)
    # Close any stale session per candidate first (max-shift / scheduled-end /
    # day-boundary) so a forgotten previous-day session doesn't make the kiosk
    # show "clock out" instead of a fresh clock-in — the same rule the mobile
    # path applies. Bounded at 5 candidates; best-effort.
    from services.time_log_service import TimeLogService
    for e in employees:
        try:
            TimeLogService.resolve_stale_for_user(db, e.private_user_id)
        except Exception:
            logging.getLogger(__name__).exception(
                "kiosk lookup stale-resolve failed for %s", e.private_user_id
            )
    return [
        KioskLookupCandidate(
            private_user_id=e.private_user_id,
            display_name=f"{e.first_name} {e.last_name}".strip(),
            has_pin=bool(e.kiosk_pin_hash),
            # M32 — drives the kiosk UI's clock-in vs clock-out branch.
            # Capped at 5 candidates so the N+1 here is bounded.
            has_active_session=KioskService.has_active_session(db, e.private_user_id),
            # kiosk v1.6 — preferred_locale lives on User (M18), one hop
            # via the existing PrivateUser.user relationship. find_employees
            # already joins User for the email match so this is no extra
            # query — just attribute access on the loaded relationship.
            preferred_locale=getattr(e.user, "preferred_locale", None) if e.user else None,
            # kiosk v1.6.3 — disambiguators when two employees share a
            # first/last name. Department from the PrivateUser.department
            # relationship; job title from the most recent Job assignment.
            department_name=(e.department.name if getattr(e, "department", None) else None),
            job_title=_pick_primary_job_title(e),
        )
        for e in employees
    ]


def _pick_primary_job_title(employee) -> Optional[str]:
    """v1.6.3 — best-effort job title for the kiosk picker disambiguation.
    Walks the existing PrivateUser.jobs relationship (already loaded
    by SQLAlchemy when accessed) and picks the most recent active one.
    Falls through to None if no jobs — kiosk UI hides the field then."""
    jobs = getattr(employee, "jobs", None) or []
    if not jobs:
        return None
    # Prefer active jobs (end_date is None), then most recent start.
    active = [j for j in jobs if getattr(j, "end_date", None) is None]
    pool = active if active else list(jobs)
    pool.sort(
        key=lambda j: getattr(j, "first_date_of_employment", None) or 0,
        reverse=True,
    )
    return pool[0].job_title if pool else None


@router.post(
    "/kiosk/clock-in",
    response_model=KioskClockInResponse,
)
async def kiosk_clock_in(
    body: KioskClockInRequest,
    idempotency_key: str = Header(..., alias="Idempotency-Key", max_length=64),
    db: Session = Depends(config.get_db),
    ctx: KioskContext = Depends(get_kiosk_context),
):
    """Create a clock-in TimeLog tagged ``created_source='kiosk'``.

    Mandatory ``Idempotency-Key`` header — the kiosk client generates one
    per attempt and reuses it on retry of the same attempt so a network
    hiccup can't double-create. See plan Deviation #5 and Risk §7.

    Errors surfaced cleanly to the tablet:
      * 400  — body validation, or PIN wrong
      * 401  — missing token (raised by dependency)
      * 403  — invalid token (raised by dependency)
      * 409  — no_active_job / multi_job_not_supported_in_v1 / already
               clocked in (the existing CRUD's 400 is re-mapped here for
               clarity)
      * 429  — per-device rate limit
    """
    pu = (
        db.query(PrivateUser)
        .filter(PrivateUser.private_user_id == body.private_user_id)
        .filter(PrivateUser.company_id == ctx.company_id)
        .first()
    )
    if pu is None:
        # Same response shape as "not found" so a stolen tablet can't
        # enumerate which IDs belong to other companies.
        raise HTTPException(status_code=404, detail="employee_not_found_in_company")

    if not KioskService.verify_pin(db, pu.private_user_id, body.pin):
        raise HTTPException(status_code=400, detail="pin_invalid")

    try:
        timelog = await KioskService.create_kiosk_timelog(
            db=db,
            device=ctx.device,
            private_user=pu,
            location=body.location,
            idempotency_key=idempotency_key,
            photo_b64=body.photo_b64,
        )
    except HTTPException as exc:
        # Re-map the existing CRUD's 400-on-active-session into a 409 so the
        # kiosk UI can present it distinctly from a "PIN wrong" 400.
        if (
            exc.status_code == 400
            and isinstance(exc.detail, str)
            and "active clock-in session" in exc.detail.lower()
        ):
            raise HTTPException(status_code=409, detail="already_clocked_in") from exc
        raise

    start_time = timelog.start_time or datetime.now(timezone.utc)
    return KioskClockInResponse(
        status="ok",
        timelog_id=timelog.timelog_id,
        message=f"Clocked in at {start_time.strftime('%H:%M')}",
        clocked_in_at=start_time,
        created_source=timelog.created_source,
    )


@router.post(
    "/kiosk/clock-out",
    response_model=KioskClockOutResponse,
)
async def kiosk_clock_out(
    body: KioskClockInRequest,  # same shape — {private_user_id, pin, location}
    idempotency_key: str = Header(..., alias="Idempotency-Key", max_length=64),
    db: Session = Depends(config.get_db),
    ctx: KioskContext = Depends(get_kiosk_context),
):
    """M32 — close the employee's active TimeLog at now().

    Same auth + idempotency contract as /kiosk/clock-in. PIN required
    (a stolen tablet shouldn't be able to close anyone's session).

    Errors:
      * 400 pin_invalid       — wrong PIN
      * 401 / 403             — token issue (dependency)
      * 404 employee_not_found_in_company
      * 409 no_active_session — most commonly because M27's auto-close
                                cron already closed the session
      * 429                   — rate limited
    """
    pu = (
        db.query(PrivateUser)
        .filter(PrivateUser.private_user_id == body.private_user_id)
        .filter(PrivateUser.company_id == ctx.company_id)
        .first()
    )
    if pu is None:
        raise HTTPException(status_code=404, detail="employee_not_found_in_company")
    if not KioskService.verify_pin(db, pu.private_user_id, body.pin):
        raise HTTPException(status_code=400, detail="pin_invalid")

    timelog = await KioskService.clock_out_active_session(
        db=db,
        device=ctx.device,
        private_user=pu,
        location=body.location,
        idempotency_key=idempotency_key,
    )
    end_time = timelog.end_time or datetime.now(timezone.utc)
    return KioskClockOutResponse(
        status="ok",
        timelog_id=timelog.timelog_id,
        message=f"Clocked out at {end_time.strftime('%H:%M')}",
        clocked_out_at=end_time,
        hours_worked=float(timelog.hours_worked) if timelog.hours_worked is not None else None,
    )


@router.get("/kiosk/heartbeat", status_code=200)
def kiosk_heartbeat(
    ctx: KioskContext = Depends(get_kiosk_context),
):
    """No-op endpoint that bumps ``last_seen_at`` (done inside
    ``validate_kiosk_token``). Admin UI uses this to show device freshness."""
    return {"status": "ok", "device_id": str(ctx.device_id), "checked_at": datetime.now(timezone.utc).isoformat()}


@router.post("/kiosk/verify-admin-pin", status_code=200)
def kiosk_verify_admin_pin(
    pin: str = Body(..., embed=True, max_length=8),
    ctx: KioskContext = Depends(get_kiosk_context),
):
    """Verify the admin PIN for the token's device. The tablet calls this at
    setup (token still valid) to confirm the operator typed the right PIN, then
    caches it locally for offline / dead-token re-onboarding."""
    if not KioskService.verify_admin_pin(ctx.device, pin):
        raise HTTPException(status_code=403, detail="admin_pin_invalid")
    return {"status": "ok"}
