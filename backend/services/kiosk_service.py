"""M26 — Kiosk service layer.

Static-method-on-class to match `TimeLogService` and `NotificationService`.
The class owns:

  * Device lifecycle  — register, validate, rotate, deactivate, list
  * Employee lookup   — company-scoped, capped at 5 results
  * PIN management    — set (admin), verify (kiosk request path)
  * Clock-in          — replay-safe via kiosk_idempotency; delegates to the
                        existing `create_time_log` CRUD so the "already
                        clocked in" guard and `cleanup_active_time_logs`
                        side-effects still fire
  * Idempotency TTL   — 7-day sweep helper invoked by whatever scheduler
                        runs the email worker (no pg_cron in this project)

Token format
------------
The raw token returned at registration is ``f"{device_id}.{secret}"``. On
validation we split on the first dot, PK-look-up the device row by UUID,
then bcrypt-compare the secret against ``api_token_hash`` exactly once.
This eliminates the O(active-devices) bcrypt loop a naive
"compare-against-all-hashes" implementation would force. See the plan's
Risk §3 (resolved).

Audit
-----
Kiosk-originated audit rows write ``actor_user_id=NULL`` — that matches
the codebase's existing convention for system actors (see
``core/permission_guards.py`` and the audit_user_id=None calls throughout
``backend/tests/``). Device and employee context lives in ``meta``.
"""

from __future__ import annotations

import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from typing import Optional

from fastapi import HTTPException
from passlib.context import CryptContext
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.model import (
    Job,
    KioskDevice,
    KioskIdempotency,
    PrivateUser,
    TimeLog,
    User,
)
from db_models.crud.audit import create_audit_log


logger = logging.getLogger(__name__)


# Match the project's existing bcrypt convention (see core/security.py and
# core/step_up.py). Tokens and PINs are independent contexts so a future
# rounds-bump on one doesn't disturb the other.
_token_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
_pin_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


# Token lifecycle: 30-day TTL. Rotation issues a new (token, expires_at)
# pair; the previous token stops validating immediately on rotation.
_TOKEN_TTL = timedelta(days=30)

# Idempotency rows older than this are eligible for the nightly sweep.
_IDEMPOTENCY_TTL = timedelta(days=7)

# Employee lookup result cap. Five is enough for disambiguation by photo+name
# but small enough that the kiosk UI can render full candidates at tablet-readable
# font sizes.
_LOOKUP_CAP = 5


@dataclass(frozen=True)
class KioskContext:
    """Returned by the ``get_kiosk_context`` FastAPI dependency. Frozen so a
    handler can't accidentally mutate the device row picked up from the
    auth path."""
    device_id: uuid.UUID
    company_id: int
    device: KioskDevice


# ---------------------------------------------------------------------------
# Device lifecycle
# ---------------------------------------------------------------------------


class KioskService:

    @staticmethod
    def register_device(
        db: Session,
        company_id: int,
        device_name: str,
        location: Optional[dict],
        created_by_user_id: Optional[int],
    ) -> "tuple[KioskDevice, str, str]":
        """Create a new kiosk device and return ``(device, raw_token, admin_pin)``.

        The raw token is shown to the admin exactly once at registration —
        the DB only ever sees the bcrypt hash. Format: ``f"{uuid}.{secret}"``.
        """
        device_id = uuid.uuid4()
        secret = secrets.token_urlsafe(32)
        api_token_hash = _token_ctx.hash(secret)
        # 4-digit admin PIN, shown once with the token. Hashed at rest.
        admin_pin = f"{secrets.randbelow(10_000):04d}"
        admin_pin_hash = _pin_ctx.hash(admin_pin)

        device = KioskDevice(
            device_id=device_id,
            company_id=company_id,
            device_name=device_name,
            location=location,
            api_token_hash=api_token_hash,
            admin_pin_hash=admin_pin_hash,
            token_expires_at=datetime.now(timezone.utc) + _TOKEN_TTL,
            is_active=True,
            created_by_user_id=created_by_user_id,
        )
        db.add(device)
        db.flush()  # surface UniqueConstraint violations before audit write

        create_audit_log(
            db,
            user_id=created_by_user_id,
            action="kiosk_device_registered",
            resource_type="KioskDevice",
            resource_id=None,  # device_id is a UUID, not the int the helper expects
            details={
                "device_id": str(device_id),
                "device_name": device_name,
                "company_id": company_id,
            },
            commit=False,
        )
        db.commit()
        db.refresh(device)

        raw_token = f"{device_id}.{secret}"
        return device, raw_token, admin_pin

    @staticmethod
    def verify_admin_pin(device: KioskDevice, pin: Optional[str]) -> bool:
        """Check a 4-digit admin PIN against the device's stored hash.

        Devices registered before this feature have no admin_pin_hash — return
        False so the caller can fall back to the tablet's locally-cached PIN.
        """
        if not device or not getattr(device, "admin_pin_hash", None) or not pin:
            return False
        try:
            return _pin_ctx.verify(pin, device.admin_pin_hash)
        except Exception:
            return False

    @staticmethod
    def validate_kiosk_token(
        db: Session,
        raw_token: Optional[str],
        request_ip: Optional[str] = None,
    ) -> Optional[KioskDevice]:
        """Look up + verify a kiosk token. Returns the active KioskDevice on
        success, None on every failure mode (missing, malformed, unknown
        device, inactive, expired, wrong secret).

        Thin wrapper over :meth:`validate_kiosk_token_verbose` for callers that
        only need the device, not the reason.
        """
        device, _reason = KioskService.validate_kiosk_token_verbose(
            db, raw_token, request_ip=request_ip
        )
        return device

    # Distinct failure reasons, so callers (e.g. get_kiosk_context) can turn a
    # generic 403 into a SPECIFIC, actionable message for the operator.
    KIOSK_TOKEN_REASONS = ("ok", "malformed", "not_found", "deactivated", "expired", "wrong_secret")

    @staticmethod
    def validate_kiosk_token_verbose(
        db: Session,
        raw_token: Optional[str],
        request_ip: Optional[str] = None,
    ) -> "tuple[Optional[KioskDevice], str]":
        """Like :meth:`validate_kiosk_token` but also returns a machine-readable
        reason: one of ``KIOSK_TOKEN_REASONS``. On success returns
        ``(device, "ok")``; on failure ``(None, <reason>)``.

        Best-effort: ``last_seen_at`` / ``last_seen_ip`` are bumped on success,
        but a write failure here must not break the request path.
        """
        if not raw_token or "." not in raw_token:
            return None, "malformed"

        device_id_str, _, secret = raw_token.partition(".")
        try:
            device_id = uuid.UUID(device_id_str)
        except (ValueError, AttributeError):
            return None, "malformed"

        device = (
            db.query(KioskDevice)
            .filter(KioskDevice.device_id == device_id)
            .first()
        )
        if device is None:
            return None, "not_found"
        if not device.is_active:
            return None, "deactivated"
        if device.token_expires_at <= datetime.now(timezone.utc):
            return None, "expired"

        try:
            if not _token_ctx.verify(secret, device.api_token_hash):
                return None, "wrong_secret"
        except Exception:
            # Malformed hash etc — treat as failure, don't 500 the request
            logger.exception("kiosk token verify raised for device %s", device_id)
            return None, "wrong_secret"

        # Best-effort heartbeat. A row-version race here is fine; missing
        # one heartbeat per request doesn't break monitoring.
        try:
            device.last_seen_at = datetime.now(timezone.utc)
            if request_ip:
                device.last_seen_ip = request_ip
            db.commit()
        except Exception:
            logger.warning("failed to update kiosk last_seen_at for %s", device_id, exc_info=True)
            db.rollback()

        return device, "ok"

    @staticmethod
    def rotate_token(
        db: Session,
        device_id: uuid.UUID,
        actor_user_id: Optional[int],
    ) -> str:
        """Replace a device's token + expiry; previous token invalidates
        immediately. Returns the new raw token."""
        device = (
            db.query(KioskDevice)
            .filter(KioskDevice.device_id == device_id)
            .first()
        )
        if device is None:
            raise HTTPException(status_code=404, detail="kiosk_device_not_found")

        secret = secrets.token_urlsafe(32)
        device.api_token_hash = _token_ctx.hash(secret)
        device.token_expires_at = datetime.now(timezone.utc) + _TOKEN_TTL

        create_audit_log(
            db,
            user_id=actor_user_id,
            action="kiosk_token_rotated",
            resource_type="KioskDevice",
            resource_id=None,
            details={"device_id": str(device_id), "company_id": device.company_id},
            commit=False,
        )
        db.commit()
        return f"{device_id}.{secret}"

    @staticmethod
    def rotate_admin_pin(
        db: Session,
        device_id: uuid.UUID,
        actor_user_id: Optional[int],
    ) -> str:
        """Regenerate the device's 4-digit admin PIN; the previous PIN stops
        working. Returns the new raw PIN (shown once)."""
        device = (
            db.query(KioskDevice)
            .filter(KioskDevice.device_id == device_id)
            .first()
        )
        if device is None:
            raise HTTPException(status_code=404, detail="kiosk_device_not_found")

        admin_pin = f"{secrets.randbelow(10_000):04d}"
        device.admin_pin_hash = _pin_ctx.hash(admin_pin)

        create_audit_log(
            db,
            user_id=actor_user_id,
            action="kiosk_admin_pin_rotated",
            resource_type="KioskDevice",
            resource_id=None,
            details={"device_id": str(device_id), "company_id": device.company_id},
            commit=False,
        )
        db.commit()
        return admin_pin

    @staticmethod
    def deactivate_device(
        db: Session,
        device_id: uuid.UUID,
        actor_user_id: Optional[int],
    ) -> None:
        device = (
            db.query(KioskDevice)
            .filter(KioskDevice.device_id == device_id)
            .first()
        )
        if device is None:
            raise HTTPException(status_code=404, detail="kiosk_device_not_found")

        device.is_active = False
        create_audit_log(
            db,
            user_id=actor_user_id,
            action="kiosk_device_deactivated",
            resource_type="KioskDevice",
            resource_id=None,
            details={"device_id": str(device_id), "company_id": device.company_id},
            commit=False,
        )
        db.commit()

    @staticmethod
    def list_devices(
        db: Session,
        company_id: int,
        include_inactive: bool = False,
    ) -> list[KioskDevice]:
        q = db.query(KioskDevice).filter(KioskDevice.company_id == company_id)
        if not include_inactive:
            q = q.filter(KioskDevice.is_active.is_(True))
        return q.order_by(KioskDevice.created_at.desc()).all()

    # -----------------------------------------------------------------------
    # Employee lookup + PIN
    # -----------------------------------------------------------------------

    # v1.6.4 — roles that should NEVER appear in the kiosk candidate
    # picker. Owners + admins manage the platform; they don't punch a
    # clock. Managers stay visible by default (some companies have
    # working managers who do clock in); if a pilot company asks, we
    # can extend this list per-company later.
    _KIOSK_EXCLUDED_ROLES: frozenset[str] = frozenset({"owner", "admin"})

    @staticmethod
    def find_employees(
        db: Session,
        company_id: int,
        query: str,
    ) -> list[PrivateUser]:
        """Case-insensitive prefix-or-contains match on the employee's email
        or phone, **always** filtered by the device's company. Capped at
        ``_LOOKUP_CAP`` so a stolen tablet can't dump the workforce.

        v1.6.4 — company owners + admins are excluded (`role NOT IN
        ('owner', 'admin')`) so the picker only surfaces line workers.
        Without this, admins clutter the picker and an employee can
        accidentally tap the wrong one.
        """
        if not query or not query.strip():
            return []

        like_pattern = f"%{query.strip().lower()}%"
        return (
            db.query(PrivateUser)
            .join(User, User.user_id == PrivateUser.user_id)
            .filter(PrivateUser.company_id == company_id)
            .filter(PrivateUser.role.notin_(KioskService._KIOSK_EXCLUDED_ROLES))
            .filter(
                or_(
                    func.lower(User.email).like(like_pattern),
                    func.lower(PrivateUser.phone).like(like_pattern),
                )
            )
            .limit(_LOOKUP_CAP)
            .all()
        )

    @staticmethod
    def set_pin(
        db: Session,
        private_user_id: int,
        pin: str,
        actor_user_id: Optional[int],
    ) -> None:
        """Admin-driven PIN set/reset. PIN must be 4 numeric digits — caller
        validates shape; we just hash + persist."""
        if not pin or len(pin) != 4 or not pin.isdigit():
            raise HTTPException(status_code=400, detail="pin_must_be_4_digits")

        private_user = (
            db.query(PrivateUser)
            .filter(PrivateUser.private_user_id == private_user_id)
            .first()
        )
        if private_user is None:
            raise HTTPException(status_code=404, detail="private_user_not_found")

        private_user.kiosk_pin_hash = _pin_ctx.hash(pin)

        create_audit_log(
            db,
            user_id=actor_user_id,
            action="kiosk_pin_set",
            resource_type="PrivateUser",
            resource_id=private_user_id,
            details={"private_user_id": private_user_id},
            commit=False,
        )
        db.commit()

    @staticmethod
    def generate_pin(
        db: Session,
        private_user_id: int,
        actor_user_id: Optional[int],
    ) -> str:
        """v1.6 polish — admin-initiated PIN generation. Server picks a
        random 4-digit code, stores the hash, returns the raw digits
        exactly once so the admin can share them with the employee
        (verbally, on paper, or via whatever channel works for the
        company). The employee is expected to change it to one they
        remember on first kiosk use via `change_pin_self_serve`.

        Cryptographically random (`secrets.randbelow(10000)`) so the
        admin can't predict or reuse digits — eliminates the "admin
        chooses 0000 for everyone" failure mode of free-typed PINs.
        """
        # Zero-padded so 7 → "0007"; uniform 4-digit space.
        pin = f"{secrets.randbelow(10_000):04d}"

        private_user = (
            db.query(PrivateUser)
            .filter(PrivateUser.private_user_id == private_user_id)
            .first()
        )
        if private_user is None:
            raise HTTPException(status_code=404, detail="private_user_not_found")

        private_user.kiosk_pin_hash = _pin_ctx.hash(pin)

        create_audit_log(
            db,
            user_id=actor_user_id,
            action="kiosk_pin_generated",
            resource_type="PrivateUser",
            resource_id=private_user_id,
            details={"private_user_id": private_user_id},
            commit=False,
        )
        db.commit()
        return pin

    @staticmethod
    def change_pin_self_serve(
        db: Session,
        private_user_id: int,
        current_pin: str,
        new_pin: str,
    ) -> None:
        """v1.6 polish — employee-initiated PIN change via the kiosk.
        Requires the current PIN as proof of identity (otherwise a
        stolen tablet user could overwrite anyone's PIN).
        Caller (kiosk endpoint) must verify the device token first.
        """
        if not new_pin or len(new_pin) != 4 or not new_pin.isdigit():
            raise HTTPException(status_code=400, detail="pin_must_be_4_digits")
        if not KioskService.verify_pin(db, private_user_id, current_pin):
            raise HTTPException(status_code=400, detail="current_pin_invalid")

        private_user = (
            db.query(PrivateUser)
            .filter(PrivateUser.private_user_id == private_user_id)
            .first()
        )
        if private_user is None:
            raise HTTPException(status_code=404, detail="private_user_not_found")

        private_user.kiosk_pin_hash = _pin_ctx.hash(new_pin)

        create_audit_log(
            db,
            user_id=None,  # employee self-serve via kiosk — no user JWT
            action="kiosk_pin_changed_by_employee",
            resource_type="PrivateUser",
            resource_id=private_user_id,
            details={"private_user_id": private_user_id, "source": "kiosk"},
            commit=False,
        )
        db.commit()

    @staticmethod
    def verify_pin(
        db: Session,
        private_user_id: int,
        pin: str,
    ) -> bool:
        """Constant-time-on-miss PIN check. False on missing employee,
        unset PIN, or wrong PIN — caller can't distinguish (no info leak)."""
        if not pin:
            return False
        private_user = (
            db.query(PrivateUser)
            .filter(PrivateUser.private_user_id == private_user_id)
            .first()
        )
        if private_user is None:
            _pin_ctx.dummy_verify()
            return False
        if not private_user.kiosk_pin_hash:
            _pin_ctx.dummy_verify()
            return False
        try:
            return _pin_ctx.verify(pin, private_user.kiosk_pin_hash)
        except Exception:
            logger.exception("kiosk pin verify raised for private_user %s", private_user_id)
            return False

    # -----------------------------------------------------------------------
    # v1.7 — schedule-aware flagging (buddy-punching deterrent)
    # -----------------------------------------------------------------------

    @staticmethod
    def is_out_of_schedule(
        job: Optional["Job"],
        company_timezone: Optional[str] = None,
        clock_in_at: Optional[datetime] = None,
        grace_minutes: int = 30,
    ) -> bool:
        """Returns True if `clock_in_at` (default: now) falls OUTSIDE
        the job's configured work-hours window in the company's local
        timezone, with a +/- grace buffer at both ends.

        Examples (job 09:00-17:00, 30-min grace, company TZ Indian/Mauritius):
          * Clock-in at 08:40 local → in schedule (within grace)
          * Clock-in at 17:25 local → in schedule (within grace)
          * Clock-in at 07:30 local → OUT of schedule (flagged — > 30 min early)
          * Clock-in at 14:00 local → in schedule

        Conservative defaults: if the job has no work_start_time /
        work_end_time configured, we return False (treat as in-schedule)
        so we don't flag every clock-in on a poorly-configured employee.
        Same if the timezone string is invalid — log + return False
        rather than blocking.
        """
        if job is None or not getattr(job, "work_start_time", None) or not getattr(job, "work_end_time", None):
            return False

        try:
            from zoneinfo import ZoneInfo
            tz = ZoneInfo(company_timezone or "Indian/Mauritius")
        except Exception:
            logger.warning("kiosk schedule check: bad timezone %r, defaulting to in-schedule", company_timezone)
            return False

        now = (clock_in_at or datetime.now(timezone.utc))
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)
        local_now = now.astimezone(tz)
        local_time = local_now.time()

        start = job.work_start_time
        end = job.work_end_time

        # Build the grace-extended window. Use today's local date as the
        # anchor so we can do proper datetime arithmetic across midnight.
        anchor = local_now.date()
        start_dt = datetime.combine(anchor, start) - timedelta(minutes=grace_minutes)
        end_dt = datetime.combine(anchor, end) + timedelta(minutes=grace_minutes)
        now_dt_naive = datetime.combine(anchor, local_time)

        if end >= start:
            # Standard day shift (e.g. 09:00-17:00). Within window if
            # start - grace <= now <= end + grace.
            return not (start_dt <= now_dt_naive <= end_dt)
        else:
            # Overnight shift (e.g. 22:00-06:00). Within window if
            # >= start-grace OR <= end-grace.
            return not (now_dt_naive >= start_dt or now_dt_naive <= end_dt)

    @staticmethod
    def is_late_start(
        job: Optional["Job"],
        company_timezone: Optional[str] = None,
        clock_in_at: Optional[datetime] = None,
        grace_minutes: int = 30,
    ) -> bool:
        """Returns True if `clock_in_at` is a LATE START: after the shift's
        start (beyond grace) but still INSIDE the shift window. Distinct from
        out_of_schedule (early / after-shift / non-work-day) — a late start is
        normal-pay work begun late, so the employee is prompted for a REASON
        rather than an overtime confirmation.

        (job 09:00-17:00, 30-min grace): 09:15 → not late (grace), 09:45 →
        late, 18:00 → NOT late (after-shift = out_of_schedule). Conservative:
        no schedule, bad tz, or overnight shift → False.
        """
        if job is None or not getattr(job, "work_start_time", None) or not getattr(job, "work_end_time", None):
            return False
        try:
            from zoneinfo import ZoneInfo
            tz = ZoneInfo(company_timezone or "Indian/Mauritius")
        except Exception:
            return False
        now = (clock_in_at or datetime.now(timezone.utc))
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)
        local_now = now.astimezone(tz)
        start, end = job.work_start_time, job.work_end_time
        if end < start:
            return False  # overnight shift — don't infer lateness
        anchor = local_now.date()
        now_dt = datetime.combine(anchor, local_now.time())
        late_after = datetime.combine(anchor, start) + timedelta(minutes=grace_minutes)
        end_dt = datetime.combine(anchor, end) + timedelta(minutes=grace_minutes)
        return late_after < now_dt <= end_dt

    @staticmethod
    def effective_paid_start(
        work_start_time: Optional[time],
        work_end_time: Optional[time],
        company_timezone: Optional[str],
        actual_start: datetime,
    ) -> datetime:
        """The earliest a session starts counting toward PAID hours: the
        later of the actual clock-in and the job's scheduled shift start.

        is_late/is_out_of_schedule (above) only classify a session for
        review — this is what actually changes what gets paid. An
        employee who clocks in 30 minutes early is flagged but, without
        this, still gets paid for those 30 minutes; this clamps that.

        Takes raw `time` values (not a `Job` object) so it's cheap to call
        per-row in a bulk query without hydrating an ORM instance per row.
        Conservative like the flags above: no schedule configured, a bad
        timezone string, or an overnight shift (end < start) all return
        `actual_start` unchanged rather than guessing at a boundary.
        """
        if work_start_time is None or work_end_time is None:
            return actual_start
        if work_end_time < work_start_time:
            return actual_start  # overnight shift — don't infer a boundary
        try:
            from zoneinfo import ZoneInfo
            tz = ZoneInfo(company_timezone or "Indian/Mauritius")
        except Exception:
            return actual_start

        start = actual_start
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        local_start = start.astimezone(tz)
        anchor = local_start.date()
        scheduled_start_local = datetime.combine(anchor, work_start_time, tzinfo=tz)
        if local_start >= scheduled_start_local:
            return actual_start  # not early — no clamp needed
        # Both sides are absolute instants; convert back to actual_start's
        # tzinfo purely so callers doing `effective - actual_start` get a
        # predictable representation (the duration itself is unaffected).
        return scheduled_start_local.astimezone(start.tzinfo)

    # -----------------------------------------------------------------------
    # Clock-in
    # -----------------------------------------------------------------------

    @staticmethod
    def _resolve_active_job_id(db: Session, private_user_id: int) -> int:
        """v1 single-active-job assumption (plan Risk §1). 409 if zero or
        more than one — surfaced to the kiosk as a clear message. v2 (M33)
        will add the paid multi-job picker; v1 endpoint payload already
        accepts an optional ``job_id`` so M33 is non-breaking."""
        active_jobs = (
            db.query(Job)
            .filter(Job.private_user_id == private_user_id)
            .filter(Job.end_date.is_(None))  # active = no termination date
            .all()
        )
        if len(active_jobs) == 0:
            raise HTTPException(status_code=409, detail="no_active_job")
        if len(active_jobs) > 1:
            raise HTTPException(status_code=409, detail="multi_job_not_supported_in_v1")
        return active_jobs[0].job_id

    @staticmethod
    async def create_kiosk_timelog(
        db: Session,
        device: KioskDevice,
        private_user: PrivateUser,
        location: dict,
        idempotency_key: str,
        photo_b64: Optional[str] = None,
    ) -> TimeLog:
        """Replay-safe kiosk clock-in.

        Race window: between the cache miss and the idempotency-row insert
        a parallel request with the same key could create a duplicate
        TimeLog. We catch the PK conflict on the second insert, log a
        warning, and return the original TimeLog. The duplicate row stays
        for admin to reject via the existing /dashboard/time-logs review
        flow. v1 accepts this; full serialization (e.g. advisory locks) is
        out of scope.
        """
        if not idempotency_key or len(idempotency_key) > 64:
            raise HTTPException(status_code=400, detail="idempotency_key_required")

        # 1. Cache check.
        existing = (
            db.query(KioskIdempotency)
            .filter(KioskIdempotency.device_id == device.device_id)
            .filter(KioskIdempotency.idempotency_key == idempotency_key)
            .first()
        )
        if existing is not None:
            cached = (
                db.query(TimeLog)
                .filter(TimeLog.timelog_id == existing.timelog_id)
                .first()
            )
            if cached is not None:
                return cached
            # If the cached TimeLog was deleted out from under us, fall
            # through and create a fresh one. Don't try to be clever about
            # cleanup — the orphaned idempotency row will be swept on TTL.

        # 2. Resolve job. May raise 409.
        job_id = KioskService._resolve_active_job_id(
            db, private_user.private_user_id
        )

        # 3. Build the schema + call the existing async CRUD so its
        #    side-effects (cleanup_active_time_logs, "already clocked in"
        #    400 guard, hours_worked calc) still fire. created_source
        #    flows through to TimeLogORM via the M26 schema extension.
        from db_models.crud.job import create_time_log
        from schema.job_schema import CreateTimeLog
        now = datetime.now(timezone.utc)
        clockin = CreateTimeLog(
            job_id=job_id,
            private_user_id=private_user.private_user_id,
            day_of_week=now.strftime('%A'),
            start_time=now,
            end_time=None,
            location=location,
            created_source='kiosk',
        )
        timelog = await create_time_log(clockin, db)

        # 3b. v1.7 — compute schedule flag + save photo (both best-effort:
        #     a failure on either side MUST NOT roll back the clock-in).
        try:
            job_for_check = db.query(Job).filter(Job.job_id == job_id).first()
            company = job_for_check.company if job_for_check else None
            company_tz = company.timezone if company else None
            out_of_schedule = KioskService.is_out_of_schedule(
                job=job_for_check,
                company_timezone=company_tz,
                clock_in_at=now,
            )
            timelog.out_of_schedule = out_of_schedule
        except Exception:
            logger.exception("kiosk v1.7: schedule check failed for timelog %s", timelog.timelog_id)

        try:
            from services.kiosk_photo_storage import save_kiosk_photo
            photo_path = save_kiosk_photo(timelog.timelog_id, photo_b64)
            if photo_path:
                timelog.kiosk_photo_path = photo_path
        except Exception:
            logger.exception("kiosk v1.7: photo save failed for timelog %s", timelog.timelog_id)

        # Persist the flag + photo path. Failure here also non-fatal —
        # the clock-in itself already committed.
        try:
            db.commit()
        except Exception:
            db.rollback()
            logger.exception("kiosk v1.7: failed to persist photo/schedule on timelog %s", timelog.timelog_id)

        # 4. Record idempotency.
        try:
            db.add(KioskIdempotency(
                device_id=device.device_id,
                idempotency_key=idempotency_key,
                timelog_id=timelog.timelog_id,
            ))
            db.commit()
        except IntegrityError:
            db.rollback()
            logger.warning(
                "kiosk idempotency race: device=%s key=%s — duplicate TimeLog %d created, "
                "admin can reject via review flow",
                device.device_id, idempotency_key, timelog.timelog_id,
            )
            # Re-fetch the winning row + return its TimeLog for client consistency.
            winner = (
                db.query(KioskIdempotency)
                .filter(KioskIdempotency.device_id == device.device_id)
                .filter(KioskIdempotency.idempotency_key == idempotency_key)
                .first()
            )
            if winner is not None:
                winning_log = (
                    db.query(TimeLog)
                    .filter(TimeLog.timelog_id == winner.timelog_id)
                    .first()
                )
                if winning_log is not None:
                    return winning_log
            # Edge case: neither cache nor winner resolves — return our row
            # rather than 500. Audit + dispute flow handles cleanup.

        # 5. Audit.
        create_audit_log(
            db,
            user_id=None,  # codebase convention for system actors
            action="kiosk_clock_in",
            resource_type="TimeLog",
            resource_id=timelog.timelog_id,
            details={
                "device_id": str(device.device_id),
                "company_id": device.company_id,
                "private_user_id": private_user.private_user_id,
                "source": "kiosk",
            },
            commit=True,
        )

        return timelog

    # -----------------------------------------------------------------------
    # Clock-out (M32)
    # -----------------------------------------------------------------------

    @staticmethod
    async def clock_out_active_session(
        db: Session,
        device: KioskDevice,
        private_user: PrivateUser,
        location: dict,
        idempotency_key: str,
    ) -> TimeLog:
        """Close the employee's single active session at now().

        Mirrors create_kiosk_timelog's replay-safety: idempotency cache
        hit returns the previously closed TimeLog. 409 no_active_session
        if there's nothing open (most common cause: M27's auto-close
        already closed it via the missed-clockout cron).

        Naturally idempotent at the data layer too — once end_time is
        set, a parallel duplicate request would have to find an active
        session to close, find none, and 409. Cache+409 is just nicer
        UX (replay returns the existing closure rather than an error).
        """
        if not idempotency_key or len(idempotency_key) > 64:
            raise HTTPException(status_code=400, detail="idempotency_key_required")

        # 1. Cache hit → return the prior closed log (kiosk-side retry).
        existing = (
            db.query(KioskIdempotency)
            .filter(KioskIdempotency.device_id == device.device_id)
            .filter(KioskIdempotency.idempotency_key == idempotency_key)
            .first()
        )
        if existing is not None:
            cached = (
                db.query(TimeLog)
                .filter(TimeLog.timelog_id == existing.timelog_id)
                .first()
            )
            if cached is not None:
                return cached

        # 2. Find the active session. If zero → 409; if multiple
        #    (shouldn't happen post-cleanup_active_time_logs, but
        #    defensively), close the newest and leave the rest for
        #    the cron to mop up.
        from sqlalchemy import desc
        active = (
            db.query(TimeLog)
            .filter(TimeLog.private_user_id == private_user.private_user_id)
            .filter(TimeLog.end_time.is_(None))
            .order_by(desc(TimeLog.start_time))
            .first()
        )
        if active is None:
            raise HTTPException(status_code=409, detail="no_active_session")

        # 3. Close at now() (or floor at start_time if clock skew somehow
        #    yields a negative duration — defensive).
        now = datetime.now(timezone.utc)
        start_utc = active.start_time
        if start_utc is not None and start_utc.tzinfo is None:
            start_utc = start_utc.replace(tzinfo=timezone.utc)
        close_at = now if (start_utc is None or now > start_utc) else start_utc

        active.end_time = close_at
        if start_utc is not None:
            hours = max((close_at - start_utc).total_seconds() / 3600, 0)
            active.hours_worked = round(hours, 2)
        # NOT auto_closed — this was a real human-initiated close, not
        # the missed-clockout cron. The auto_closed flag stays whatever
        # it was (false in the common case).
        db.commit()
        db.refresh(active)

        # 4. Record idempotency.
        try:
            db.add(KioskIdempotency(
                device_id=device.device_id,
                idempotency_key=idempotency_key,
                timelog_id=active.timelog_id,
            ))
            db.commit()
        except IntegrityError:
            db.rollback()
            # Race resolved itself — log + continue. The TimeLog is
            # already closed, no harm done.
            logger.warning(
                "kiosk clock-out idempotency race: device=%s key=%s timelog=%d",
                device.device_id, idempotency_key, active.timelog_id,
            )

        # 5. Audit.
        create_audit_log(
            db,
            user_id=None,
            action="kiosk_clock_out",
            resource_type="TimeLog",
            resource_id=active.timelog_id,
            details={
                "device_id": str(device.device_id),
                "company_id": device.company_id,
                "private_user_id": private_user.private_user_id,
                "source": "kiosk",
                "hours_worked": float(active.hours_worked) if active.hours_worked is not None else None,
            },
            commit=True,
        )

        return active

    @staticmethod
    def has_active_session(db: Session, private_user_id: int) -> bool:
        """Lookup helper — does this employee currently have an open
        TimeLog? Used by /kiosk/employee-lookup to tell the UI whether
        the next action should be clock-in or clock-out."""
        return (
            db.query(TimeLog.timelog_id)
            .filter(TimeLog.private_user_id == private_user_id)
            .filter(TimeLog.end_time.is_(None))
            .first()
        ) is not None

    # -----------------------------------------------------------------------
    # Idempotency cleanup
    # -----------------------------------------------------------------------

    @staticmethod
    def purge_old_idempotency_rows(db: Session) -> int:
        """Delete kiosk_idempotency rows older than the TTL. Returns the
        number of rows deleted. Hook this into whatever scheduler already
        runs (e.g. the email worker tick) — there's no pg_cron in this
        project."""
        cutoff = datetime.now(timezone.utc) - _IDEMPOTENCY_TTL
        deleted = (
            db.query(KioskIdempotency)
            .filter(KioskIdempotency.created_at < cutoff)
            .delete(synchronize_session=False)
        )
        db.commit()
        if deleted:
            logger.info("kiosk idempotency sweep: removed %d rows older than %s", deleted, cutoff)
        return deleted
