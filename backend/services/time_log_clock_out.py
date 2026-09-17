"""Offline clock-out reconciliation (Feature 1).

The employee clock-out is a foreground PUT that throws on network failure; the
offline queue replays it later via POST /job/time-log/{id}/clock-out. This
module is that replay's server side: it applies the real end_time when it's
safe, and defers to admin review when it's not (paid/approved/locked data).

Integrity guards (see the plan doc):
  #1 never rewrite paid/approved/finalized data — defer to a TimeLogDispute.
  #2 trust nothing from the device wall clock — clamp to [start, sync_now]
     and flag skew for review.
  #3 idempotency is handled by the Idempotency-Key middleware (POST).
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

# |end_time - sync_now| or |end_time - fix_timestamp| beyond this is "skew".
SKEW_THRESHOLD_SECONDS = 15 * 60


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _extract_fix_ts(geo_check: Any) -> Optional[datetime]:
    if not isinstance(geo_check, dict):
        return None
    raw = geo_check.get("fix_timestamp")
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return _as_utc(raw)
    if isinstance(raw, str):
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def _human_edited(db, timelog_id: int) -> bool:
    """A session may be auto_closed=True yet already hand-corrected by an admin
    via the review PATCH (or admin-forced clock-out). Detect that via the audit
    trail so we never overwrite an admin's edit with the employee's offline time."""
    from core.model import AuditLog

    return (
        db.query(AuditLog.id)
        .filter(
            AuditLog.action == "time_log.edit",
            AuditLog.target_type == "time_logs",
            AuditLog.target_id == str(timelog_id),
        )
        .first()
        is not None
    )


def _defer_to_dispute(db, tl, end_time: datetime, location: Any, reason: str, current_user) -> None:
    """Create (or append to) a pending TimeLogDispute carrying the real clock-out
    so the correction lands in admin review rather than rewriting closed data."""
    from core.model import AuditLog, PrivateUser, TimeLogDispute
    from services.time_log_classifier import recompute as _recompute

    emp_user_id = (
        db.query(PrivateUser.user_id)
        .filter(PrivateUser.private_user_id == tl.private_user_id)
        .scalar()
    )
    note = (
        f"Deferred clock-out correction — real end_time={end_time.isoformat() if end_time else None}, "
        f"location={json.dumps(location, default=str) if location else None}. {reason}"
    )

    existing = getattr(tl, "dispute", None)
    if existing is None:
        existing = (
            db.query(TimeLogDispute)
            .filter(TimeLogDispute.time_log_id == tl.timelog_id)
            .first()
        )

    if existing is not None and existing.resolution == "pending":
        existing.employee_comment = f"{existing.employee_comment or ''} | {note}"
        d = existing
    else:
        d = TimeLogDispute(
            time_log_id=tl.timelog_id,
            employee_user_id=emp_user_id,
            employee_comment=note,
            resolution="pending",
        )
        db.add(d)

    tl.dispute = d
    _recompute(tl)  # surfaces as "disputed" in review-by-exception

    db.add(
        AuditLog(
            actor_user_id=getattr(current_user, "user_id", None),
            action="time_log.clock_out_adjustment_deferred",
            target_type="time_logs",
            target_id=str(tl.timelog_id),
            meta={
                "end_time": end_time.isoformat() if end_time else None,
                "location": location,
                "reason": reason,
            },
        )
    )


async def clock_out(
    db,
    tl,
    end_time: datetime,
    location: Any,
    geo_check: Any,
    *,
    current_user,
    client_ip: Optional[str] = None,
) -> dict:
    """Apply a (possibly queued) clock-out. Returns a result dict consumed by the
    POST route's ClockOutResult response model."""
    from core.model import Job
    from services.payroll_period import session_in_finalized_period

    sync_now = _now_utc()
    original = _as_utc(end_time)

    # --- Guard #2: clamp to [start, sync_now] + detect skew (before clamp) ---
    # Skew means the DEVICE wall clock disagrees with an independent authority —
    # not that the sync was delayed (the offline queue legitimately replays hours
    # or days later). Signals:
    #   * end_time in the future (impossible, so the clock is wrong);
    #   * end_time before start (wrong clock);
    #   * |end_time - GPS fix_timestamp| > threshold (GPS time is hard to spoof).
    skew = False
    clamped = original
    if original is not None:
        if original > sync_now:
            clamped = sync_now
            skew = True
        start_utc = _as_utc(tl.start_time)
        if start_utc is not None and clamped < start_utc:
            clamped = start_utc
            skew = True
        fix_ts = _extract_fix_ts(geo_check)
        if fix_ts is not None and abs((original - fix_ts).total_seconds()) > SKEW_THRESHOLD_SECONDS:
            skew = True

    # --- Guard #1: never rewrite data that's already decided/paid ---
    job = getattr(tl, "job", None)
    if job is None:
        job = db.query(Job).filter(Job.job_id == tl.job_id).first()
    company_id = getattr(job, "company_id", None)

    finalized = session_in_finalized_period(db, company_id, tl.start_time) if company_id else None

    if tl.admin_approved:
        reason = "session already approved."
    elif tl.admin_rejected:
        reason = "session already rejected."
    elif finalized is not None:
        reason = (
            f"start_time falls inside finalized payroll period "
            f"({finalized.period_start} → {finalized.period_end})."
        )
    else:
        reason = None

    if reason is not None or (tl.auto_closed and _human_edited(db, tl.timelog_id)):
        _defer_to_dispute(
            db,
            tl,
            clamped,
            location,
            reason or "session was edited by an admin.",
            current_user,
        )
        db.commit()
        from core.analytics import capture

        capture(
            "time_log.clock_out_deferred",
            getattr(current_user, "user_id", None),
            {
                "timelog_id": tl.timelog_id,
                "job_id": tl.job_id,
                "private_user_id": tl.private_user_id,
                "company_id": company_id,
                "reason": reason or "admin-edited",
                "time_skew": skew,
            },
        )
        return {
            "timelog_id": tl.timelog_id,
            "deferred": True,
            "deferred_reason": reason or "admin-edited",
            "time_skew": skew,
            "end_time": clamped,
        }

    # --- Normal / supersede clock-out via the existing CRUD (reuses geo
    #     enforcement, hours-with-breaks, and classification recompute). ---
    was_auto_closed = bool(tl.auto_closed)
    from db_models.crud.job import update_time_log

    update_payload: dict = {"end_time": clamped}
    if location is not None:
        update_payload["location"] = location
    if geo_check is not None:
        update_payload["geo_check"] = geo_check

    # commit=False — this apply plus the supersede mutations below (clear
    # auto_closed, supersede audit, skew stamp, reclassify, auto-approve) commit
    # together as ONE transaction. A crash between them can no longer leave the
    # real end_time persisted while auto_closed is still True with no audit.
    updated = await update_time_log(
        tl.timelog_id,
        update_payload,
        db,
        client_ip=client_ip,
        commit=False,
    )

    if was_auto_closed:
        # Supersede the cron's synthetic end_time with the employee's real one.
        updated.auto_closed = False
        from core.model import AuditLog

        db.add(
            AuditLog(
                actor_user_id=getattr(current_user, "user_id", None),
                action="time_log.clock_out_superseded_auto_close",
                target_type="time_logs",
                target_id=str(updated.timelog_id),
                meta={"end_time": clamped.isoformat() if clamped else None},
            )
        )

    if skew:
        # Stamp the skew reason so review-by-exception surfaces it for admin
        # judgment rather than letting it flow through clean.
        updated.geofence_check_json = {
            **(updated.geofence_check_json or {}),
            "time_skew": True,
        }

    # Always recompute: supersede cleared auto_closed, and skew added a reason —
    # the classification computed inside update_time_log is stale after either.
    from services.time_log_classifier import recompute as _recompute
    _recompute(updated)

    # P2 — auto-approve a now-clean superseded/offline clock-out if opted in.
    from services.time_log_auto_approve import maybe_auto_approve
    maybe_auto_approve(db, updated)

    db.commit()
    db.refresh(updated)
    from core.analytics import capture

    capture(
        "time_log.clock_out_superseded" if was_auto_closed else "time_log.clock_out",
        getattr(current_user, "user_id", None),
        {
            "timelog_id": updated.timelog_id,
            "job_id": updated.job_id,
            "private_user_id": updated.private_user_id,
            "company_id": company_id,
            "superseded": was_auto_closed,
            "time_skew": skew,
        },
    )
    return {
        "timelog_id": updated.timelog_id,
        "deferred": False,
        "deferred_reason": None,
        "time_skew": skew,
        "end_time": clamped,
    }
