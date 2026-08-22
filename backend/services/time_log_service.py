import logging
from datetime import datetime, time, timezone, timedelta
from zoneinfo import ZoneInfo
from sqlalchemy.orm import Session
from core.model import Company, TimeLog, Job, PrivateUser, Salary, User
from services.notification_service import NotificationService
from db_models.crud.audit import create_audit_log
from typing import List, Optional

logger = logging.getLogger(__name__)

# M27 — system fallback when no per-job, per-user, or per-company max-shift
# value is set. 12h matches the most common labor-law shift cap and is
# strictly tighter than the prior blanket 24h (which let runaway sessions
# accrue half-a-shift of phantom time before closure).
_SYSTEM_DEFAULT_MAX_SHIFT_HOURS = 12.0

# Smart schedule-anchored auto-close: how long after a scheduled work_end_time an
# unclaimed (non-overtime) session is left open before being auto-closed AT the
# scheduled end. The grace window is the employee's chance to confirm overtime
# (which keeps the session running) or clock out themselves; the max-shift cap is
# the harder backstop.
_SCHEDULE_AUTOCLOSE_GRACE_MINUTES = 15


def _to_utc(dt: datetime) -> datetime:
    """Ensure a datetime is timezone-aware in UTC."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _is_workday(work_days: Optional[dict], local_dt: datetime) -> bool:
    """work_days is a JSONB dict keyed by day name. Keys may be capitalized
    ('Monday') or lowercase; a scheduled day is present with a non-off value
    (the profile stores hours like '8' and removes the key when toggled off)."""
    if not work_days:
        return False
    name = local_dt.strftime("%A")  # 'Monday'
    for key in (name, name.lower()):
        if key in work_days:
            v = work_days[key]
            return bool(v) and str(v).strip().lower() not in ("off", "false", "0", "")
    return False

class TimeLogService:
    @staticmethod
    def resolve_max_shift_hours(
        job: Optional[Job],
        private_user: Optional[PrivateUser],
        company_default: Optional[float],
        system_default_hours: float = _SYSTEM_DEFAULT_MAX_SHIFT_HOURS,
    ) -> float:
        """M27 — single source of truth for "how long is a session allowed
        to run before the cron auto-closes it".

        Fallback chain (most-specific wins):
          Job.max_shift_hours → PrivateUser.max_shift_hours →
          Company.default_max_shift_hours → 12h system constant.

        Each level is independently nullable so admins can configure
        whichever granularity matches their workforce (security guards on
        12h shifts via PrivateUser; a delivery-driver job at 6h via Job;
        a whole-company night-shift policy via Company).
        """
        if job is not None and job.max_shift_hours is not None:
            return float(job.max_shift_hours)
        if private_user is not None and private_user.max_shift_hours is not None:
            return float(private_user.max_shift_hours)
        if company_default is not None:
            return float(company_default)
        return system_default_hours

    @staticmethod
    def _finalize_active_log(active_log: TimeLog, close_at: datetime, auto_closed: bool = False):
        if not active_log.start_time:
            return

        start_utc = _to_utc(active_log.start_time)
        close_at = _to_utc(close_at)
        if close_at < start_utc:
            close_at = start_utc

        active_log.end_time = close_at
        active_log.hours_worked = round(max((active_log.end_time - start_utc).total_seconds() / 3600, 0), 2)
        if auto_closed:
            # M27 — distinguish a cron-closed runaway from a real clock-out
            # so admins (and the dispute flow) can tell them apart.
            active_log.auto_closed = True
        logger.info(f"Auto-closed redundant or runaway session {active_log.timelog_id} at {close_at.isoformat()}")

    @staticmethod
    def cleanup_active_time_logs(db: Session, private_user_id: Optional[int] = None) -> int:
        """Close redundant active time logs and any active sessions whose
        elapsed time exceeds the resolved max-shift cap.

        Pre-M27 this was a blanket 24h. The cap now resolves per session
        through ``resolve_max_shift_hours`` (Job → PrivateUser → Company
        → 12h), and auto-closed sessions get ``auto_closed=True`` plus a
        notification to the company admin so the dispute flow can pick
        them up.

        Returns the count of sessions auto-closed.
        """
        query = db.query(TimeLog).filter(TimeLog.end_time.is_(None))
        if private_user_id is not None:
            query = query.filter(TimeLog.private_user_id == private_user_id)

        active_logs = query.order_by(TimeLog.private_user_id, TimeLog.start_time.asc()).all()
        if not active_logs:
            return 0

        now = datetime.now(timezone.utc)
        closed_count = 0
        autoclosed_for_notification: List[TimeLog] = []
        logs_by_user: dict[int, List[TimeLog]] = {}

        for active_log in active_logs:
            logs_by_user.setdefault(active_log.private_user_id, []).append(active_log)

        for logs in logs_by_user.values():
            # Runaway pass: close anything past the resolved cap.
            for active_log in logs:
                if not active_log.start_time:
                    continue
                start_utc = _to_utc(active_log.start_time)
                # Lazy-loaded — fine inside the session, single SELECT per row.
                # If this becomes hot, add joinedload(TimeLog.job, TimeLog.private_user)
                # to the initial query.
                company = active_log.private_user.company if active_log.private_user else None
                resolved_hours = TimeLogService.resolve_max_shift_hours(
                    job=active_log.job,
                    private_user=active_log.private_user,
                    company_default=company.default_max_shift_hours if company else None,
                )
                if (now - start_utc).total_seconds() >= resolved_hours * 3600:
                    TimeLogService._finalize_active_log(
                        active_log,
                        start_utc + timedelta(hours=resolved_hours),
                        auto_closed=True,
                    )
                    TimeLogService._audit_auto_close(db, active_log, reason="max_shift")
                    autoclosed_for_notification.append(active_log)
                    closed_count += 1

            # Redundancy pass: if a single user still has multiple open
            # sessions, keep the newest and close the rest. These are
            # NOT auto_closed — they're operator/data hygiene closures,
            # not "you forgot to clock out" closures.
            remaining = [log for log in logs if log.end_time is None]
            if len(remaining) <= 1:
                continue

            remaining.sort(key=lambda log: _to_utc(log.start_time) if log.start_time else datetime.min.replace(tzinfo=timezone.utc), reverse=True)
            for redundant_log in remaining[1:]:
                start_utc = _to_utc(redundant_log.start_time)
                close_at = now if now > start_utc else start_utc
                TimeLogService._finalize_active_log(redundant_log, close_at, auto_closed=False)
                closed_count += 1

        if closed_count > 0:
            db.commit()
            # Notify after commit so the audit + notification volume only
            # reflects what actually persisted.
            for closed_log in autoclosed_for_notification:
                try:
                    TimeLogService._notify_admin_of_auto_close(db, closed_log)
                except Exception:
                    logger.exception(
                        "auto-close admin notification failed for timelog %s",
                        closed_log.timelog_id,
                    )
        return closed_count

    @staticmethod
    def close_past_schedule_unclaimed(db: Session, private_user_id: Optional[int] = None) -> int:
        """Smart schedule-anchored auto-close.

        If an active session is past the employee's scheduled ``work_end_time``
        by more than ``_SCHEDULE_AUTOCLOSE_GRACE_MINUTES`` AND the session has NOT
        been confirmed as overtime, close it AT ``work_end_time``
        (``auto_closed=True``). Sessions the employee confirmed as overtime
        (``is_overtime``) are left running — they fall through to the max-shift
        safety net in ``cleanup_active_time_logs``. This is what preserves real
        overtime while still closing a forgotten clock-out at the scheduled end.

        Anchored to the clock-in day in the company's timezone. Applies whenever
        the job has a ``work_end_time`` (NOT gated on ``work_days`` — an open
        session already proves work happened, and ``work_days`` is empty on most
        imported/onboarded jobs). The end only rolls to the next day for a genuine
        overnight shift (``work_end_time < work_start_time``). Sessions with no
        usable scheduled end fall through to the day-boundary backstop. Returns the
        count auto-closed.
        """
        query = db.query(TimeLog).filter(TimeLog.end_time.is_(None))
        if private_user_id is not None:
            query = query.filter(TimeLog.private_user_id == private_user_id)
        active_logs = query.all()
        if not active_logs:
            return 0

        now_utc = datetime.now(timezone.utc)
        grace = timedelta(minutes=_SCHEDULE_AUTOCLOSE_GRACE_MINUTES)
        closed: List[TimeLog] = []

        for log in active_logs:
            # Per-log isolation — one malformed row (bad relationship, tz, etc.)
            # must never abort the whole sweep and leave every OTHER session open.
            try:
                if log.is_overtime:
                    continue  # employee confirmed overtime — keep their session open
                if not log.start_time:
                    continue
                job = log.job
                pu = log.private_user
                company = pu.company if pu else None
                tz_name = (getattr(company, "timezone", None) or "Indian/Mauritius")
                try:
                    tz = ZoneInfo(tz_name)
                except Exception:
                    tz = ZoneInfo("Indian/Mauritius")
                start_local = _to_utc(log.start_time).astimezone(tz)
                now_local = now_utc.astimezone(tz)

                # 1. Scheduled-end close — the job defines a shift end. A session
                # still open past that end (+grace), not confirmed as overtime, is
                # a forgotten clock-out: close it AT the scheduled end. NOT gated
                # on work_days — an open session already proves the employee
                # worked, and work_days is empty ({}/NULL) on most imported/
                # onboarded jobs, which would otherwise suppress the close and let
                # the clock tick to midnight.
                if job and job.work_end_time:
                    end_local = start_local.replace(
                        hour=job.work_end_time.hour, minute=job.work_end_time.minute,
                        second=0, microsecond=0,
                    )
                    # Only roll the end to the NEXT day for a genuine overnight
                    # shift (end clock-time earlier than start clock-time). Using
                    # work_start_time tells this apart from a same-day LATE clock-in,
                    # which must not push the end to tomorrow (the old bug).
                    is_overnight = (
                        job.work_start_time is not None
                        and job.work_end_time < job.work_start_time
                    )
                    if is_overnight and end_local <= start_local:
                        end_local += timedelta(days=1)
                    if end_local > start_local:
                        end_utc = end_local.astimezone(timezone.utc)
                        if now_utc >= end_utc + grace:
                            TimeLogService._finalize_active_log(log, end_utc, auto_closed=True)
                            TimeLogService._audit_auto_close(db, log, reason="schedule")
                            closed.append(log)
                        continue
                    # Clocked in at/after the shift end on a day shift — no sensible
                    # scheduled anchor ahead. Fall through to the day-boundary
                    # backstop so the session still closes (by local midnight at the
                    # latest) instead of being pinned to ~0 duration at its start.

                # 2. Day-boundary backstop — no usable scheduled end ahead, but the
                # session has crossed into a new local day. A forgotten clock-out
                # must never stay "active" overnight, so close it at the end of the
                # day it started. (The max-shift cap in cleanup_active_time_logs
                # runs first and is the longer safety net.)
                if now_local.date() > start_local.date():
                    end_local = start_local.replace(hour=23, minute=59, second=59, microsecond=0)
                    end_utc = end_local.astimezone(timezone.utc)
                    TimeLogService._finalize_active_log(log, end_utc, auto_closed=True)
                    TimeLogService._audit_auto_close(db, log, reason="day_boundary")
                    closed.append(log)
            except Exception:
                logger.exception(
                    "schedule auto-close failed for timelog %s; skipping",
                    getattr(log, "timelog_id", "?"),
                )
                continue

        if closed:
            db.commit()
            for log in closed:
                try:
                    TimeLogService._notify_admin_of_auto_close(db, log)
                except Exception:
                    logger.exception("schedule auto-close notify failed for %s", log.timelog_id)
        return len(closed)

    @staticmethod
    def resolve_stale_for_user(db: Session, private_user_id: int) -> int:
        """Close any stale open session for this employee BEFORE a fresh clock-in
        (kiosk OR mobile): max-shift runaway first, then schedule-end /
        day-boundary. This is what guarantees a previous-day or past-shift
        session never blocks a new clock-in — the same rule on both paths."""
        # System-initiated cleanup scoped to one known user. The work closes
        # over PK-based relationship loads (private_users / jobs / companies)
        # that carry no company_id filter, so wrap it in the same tenant-guard
        # bypass the background sweep uses — otherwise every clock-in / kiosk
        # lookup logs a tenant_guard warning.
        from core.tenant_context import bypass_tenant_guard
        with bypass_tenant_guard(
            "stale-session resolve before clock-in (system cleanup, single user)"
        ):
            n = TimeLogService.cleanup_active_time_logs(db, private_user_id)
            n += TimeLogService.close_past_schedule_unclaimed(db, private_user_id)
        return n

    @staticmethod
    def _audit_auto_close(db: Session, timelog: TimeLog, reason: str) -> None:
        """Append-only audit row for a system-initiated auto-close.

        actor_user_id is NULL (no human actor — the cleanup loop did this).
        ``reason`` is the load-bearing field: ``"max_shift"`` (runaway cap)
        or ``"schedule"`` (scheduled end + grace). Written with commit=False
        so it flushes atomically with the close in the caller's transaction.
        """
        try:
            company_id = (
                timelog.private_user.company.company_id
                if timelog.private_user and timelog.private_user.company
                else None
            )
            create_audit_log(
                db,
                None,  # system action — no human actor
                "time_log.auto_closed",
                "time_logs",
                timelog.timelog_id,
                {
                    "reason": reason,
                    "private_user_id": timelog.private_user_id,
                    "company_id": company_id,
                    "job_id": timelog.job_id,
                    "hours_worked": float(timelog.hours_worked) if timelog.hours_worked is not None else None,
                    "closed_at": _to_utc(timelog.end_time).isoformat() if timelog.end_time else None,
                },
                commit=False,
            )
        except Exception:
            logger.exception("auto-close audit write failed for timelog %s", timelog.timelog_id)

    @staticmethod
    def _notify_admin_of_auto_close(db: Session, timelog: TimeLog) -> None:
        """M27 — surface a missed-clockout closure to the company admin so
        they can review (and the employee can dispute via the existing
        time_log_disputes flow if their actual end time was different).

        Mirrors the company-admin lookup pattern in
        ``NotificationService.notify_employer_overtime``. Since the cron
        won't re-process closed sessions (TimeLog.end_time is no longer
        NULL), there's no need to dedupe — each closure produces exactly
        one notification.
        """
        if timelog.private_user is None or timelog.private_user.company is None:
            return
        company = timelog.private_user.company
        if company is None or company.company_id is None:
            return

        # Fan out to everyone who can act on attendance (view_attendance) + owner.
        recipients = NotificationService._members_with_permission(db, company.company_id, 'view_attendance')
        if not recipients:
            return

        employee_name = (
            f"{timelog.private_user.first_name} {timelog.private_user.last_name}".strip()
            or "An employee"
        )
        end_local = _to_utc(timelog.end_time).strftime("%Y-%m-%d %H:%M UTC") if timelog.end_time else "—"
        hours = float(timelog.hours_worked) if timelog.hours_worked is not None else 0.0

        NotificationService.create_notification_fanout(
            db=db,
            user_ids=recipients,
            title=f"Auto-closed clock-in — {employee_name}",
            message=(
                f"{employee_name} did not clock out. The session was auto-closed at "
                f"{end_local} after {hours:.2f}h (resolved max-shift cap). "
                f"Review on the time-logs dashboard; the employee can dispute the closure."
            ),
            notification_type="time_log_auto_closed",
            meta={
                "timelog_id": timelog.timelog_id,
                "private_user_id": timelog.private_user_id,
                "job_id": timelog.job_id,
                "hours_worked": hours,
            },
            company_id=company.company_id,
        )

    @staticmethod
    def close_runaway_sessions(db: Session, private_user_id: Optional[int] = None) -> int:
        return TimeLogService.cleanup_active_time_logs(db, private_user_id)

    @staticmethod
    async def check_for_missed_clockouts(db: Session, private_user_id: int):
        """
        Checks if the user has an active clock-in that has exceeded their
        scheduled business hours or the 24-hour runaway limit.
        """
        closed_sessions = TimeLogService.close_runaway_sessions(db, private_user_id)
        if closed_sessions > 0:
            return

        # Smart schedule-anchored close: a session past work_end_time + grace that
        # the employee did NOT confirm as overtime is closed AT the scheduled end.
        # Confirmed-overtime sessions are skipped (kept running). This runs before
        # the reminder so the grace window is the employee's chance to act.
        schedule_closed = TimeLogService.close_past_schedule_unclaimed(db, private_user_id)
        if schedule_closed > 0:
            return

        active_log = db.query(TimeLog).filter(
            TimeLog.private_user_id == private_user_id,
            TimeLog.end_time.is_(None)
        ).first()

        if not active_log:
            return

        now = datetime.now(timezone.utc)
        job = active_log.job
        if not job or not job.work_end_time:
            return

        start_utc = _to_utc(active_log.start_time)
        duration_hours = (now - start_utc).total_seconds() / 3600
        current_time = now.time()
        is_past_shift = job.work_end_time and current_time > job.work_end_time
        is_past_normal_hours = False

        try:
            salary = db.query(Salary).filter(Salary.job_id == job.job_id).first()
            if salary and salary.monthly_hours:
                monthly_hours_val = float(salary.monthly_hours or 195)
                days_per_month = float(salary.days_of_work_per_month or 22)
                if days_per_month <= 0:
                    days_per_month = 22
                threshold_hours = monthly_hours_val / days_per_month
                if duration_hours > threshold_hours:
                    is_past_normal_hours = True
        except Exception:
            pass

        if is_past_shift or is_past_normal_hours:
            from core.model import Notification, NotificationRecipient
            existing_reminder = (
                db.query(NotificationRecipient)
                .join(Notification, Notification.notification_id == NotificationRecipient.notification_id)
                .filter(
                    NotificationRecipient.user_id == active_log.private_user.user_id,
                    Notification.type == "clock_out_reminder",
                    Notification.created_at >= datetime.combine(now.date(), time.min).replace(tzinfo=timezone.utc),
                )
                .first()
            )

            if not existing_reminder:
                reason = "past your scheduled hours" if is_past_shift else "past your normal daily hours"
                NotificationService.create_notification(
                    db=db,
                    user_id=active_log.private_user.user_id,
                    title="Time to Clock Out?",
                    message=f"You are still clocked in {reason}. Would you like to clock out or mark this as overtime?",
                    notification_type="clock_out_reminder",
                    meta={"timelog_id": active_log.timelog_id, "job_id": job.job_id}
                )
                logger.info(f"Missed clock-out reminder sent to user {active_log.private_user.user_id}")

    @staticmethod
    def mark_as_overtime(db: Session, timelog_id: int, reason: Optional[str] = None):
        """
        Explicitly marks a time log session as overtime and notifies the employer.
        Idempotent: if already marked, returns existing record without re-notifying.
        """
        timelog = db.query(TimeLog).filter(TimeLog.timelog_id == timelog_id).first()
        if not timelog:
            return None

        # Idempotency guard
        if timelog.is_overtime:
            return timelog

        timelog.is_overtime = True
        timelog.marked_as_overtime_at = datetime.now(timezone.utc)
        timelog.overtime_reason = reason

        db.commit()
        db.refresh(timelog)
        
        # Notify both parties
        NotificationService.notify_employer_overtime(db, timelog, reason=reason)
        NotificationService.notify_employee_overtime_confirmation(db, timelog, reason=reason)

        return timelog

    @staticmethod
    def find_overlapping_time_log(
        db: Session,
        private_user_id: int,
        start_time: datetime,
        end_time: datetime,
        exclude_timelog_id: Optional[int] = None,
    ) -> Optional[TimeLog]:
        """Returns another CLOSED TimeLog for this employee whose range
        collides with [start_time, end_time), or None.

        A row that's still open (end_time IS NULL) is excluded — a genuinely
        conflicting open session is already caught separately by the
        active-session guard in create_time_log; this is specifically about
        two CLOSED ranges overlapping, which nothing was checking before.
        Adjacency (one ends exactly when the other starts) is allowed, same
        as the payroll-time defense-in-depth check this mirrors
        (overtime_engine._assert_no_overlaps).

        This is the write-time gate that overtime_engine._assert_no_overlaps's
        docstring has always claimed exists in api.v1.job — it didn't, until
        now. Call this from every path that creates or edits a TimeLog's
        start_time/end_time (admin edit, mobile create/update) so a bad
        overlap is rejected at the moment it's introduced, with a clear
        error, instead of silently reaching payroll compute and aborting an
        entire company's run days or weeks later.
        """
        start_time = _to_utc(start_time)
        end_time = _to_utc(end_time)
        if start_time is None or end_time is None or end_time <= start_time:
            return None

        q = db.query(TimeLog).filter(
            TimeLog.private_user_id == private_user_id,
            TimeLog.end_time.isnot(None),
            TimeLog.start_time < end_time,
            TimeLog.end_time > start_time,
        )
        if exclude_timelog_id is not None:
            q = q.filter(TimeLog.timelog_id != exclude_timelog_id)
        return q.first()
