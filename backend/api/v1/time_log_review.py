"""M3 — Admin clock-in review endpoints.

Surfaces:

  * GET    /companies/{cid}/time-logs                     — list w/ filters
  * PATCH  /time-logs/{id}                                — admin edits hours
  * POST   /companies/{cid}/time-logs/approve             — bulk approve
  * POST   /companies/{cid}/time-logs/reject              — bulk reject (reason ≥ 20 chars)
  * POST   /time-logs/{id}/dispute                        — employee disputes
  * POST   /time-logs/{id}/dispute/resolve                — admin resolves
  * GET    /companies/{cid}/time-logs/audit-export        — CSV for regulator

Wage-theft mitigations baked in:

  * reject reason validated min_length=20 (no silent rejections)
  * push notification + Notification row on every reject
  * employee dispute path that flips the log into a "disputed" state
    payroll engine cannot finalize over
  * regulator-friendly CSV export from existing AuditLog rows

Bulk approves write a single AuditLog row covering all ids in meta to
keep audit volume sane (a 50-employee × 22-day month would otherwise
produce 1100 rows per cycle).
"""

from __future__ import annotations

import csv
import io
from datetime import date, datetime, timezone, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from core import config
from core.auth_guards import require_company_admin
from core.dependencies import get_current_user
from core.model import (
    AuditLog,
    Job,
    PrivateUser,
    TimeLog,
    TimeLogDispute,
    User,
)
from services.notification_service import NotificationService


router = APIRouter(tags=["Time Log Review"])


def _require_company_admin_gated(actor, company_id, db, permission="view_attendance"):
    """Flag-aware company gate. When COMPANY_RBAC_ENABLED is on, enforces a
    company permission (default view_attendance — the clock-in review floor;
    owner/admin bypass inside). Flag off ⇒ require_company_admin as today. Dispute
    resolution layers resolve_dispute via assert_company_permission separately."""
    from core.permission_guards import company_rbac_enabled, assert_company_permission
    if company_rbac_enabled():
        assert_company_permission(actor, company_id, permission, db)
        return
    require_company_admin(actor, company_id, db)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class TimeLogReviewItem(BaseModel):
    timelog_id: int
    private_user_id: int
    employee_name: str
    employee_code: Optional[str] = None
    day: Optional[date]
    start_time: Optional[datetime]
    end_time: Optional[datetime]
    hours_worked: Optional[float]
    is_overtime: bool
    overtime_confirmed_by_employer: bool
    admin_approved: bool
    admin_approved_at: Optional[datetime]
    admin_rejected: bool
    admin_rejected_at: Optional[datetime]
    admin_rejected_reason: Optional[str]
    dispute_status: Optional[str]  # 'pending' | 'approved' | 'rejection_upheld' | None
    # M30 — provenance + auto-close signal so the review UI can filter by
    # source (kiosk-pending fast-track banner) and surface "this was
    # auto-closed by the missed-clockout cron, not a real clock-out".
    created_source: str = "mobile"
    auto_closed: bool = False
    # v1.7 — buddy-punching deterrents surfaced to admin. photo_path is
    # the relative URL under /uploads/<path>; UI builds the full src.
    kiosk_photo_path: Optional[str] = None
    out_of_schedule: bool = False
    # Late START (after scheduled start + grace, still in shift) — distinct
    # from out_of_schedule (early/after-shift). late_reason is the employee's
    # own explanation, collected via a mobile prompt; always None for kiosk
    # clock-ins (no text-entry step on a shared tablet).
    is_late: bool = False
    late_reason: Optional[str] = None
    # Geofencing v3 — true when the punch was recorded outside every active
    # fence (or with an unverifiable fix) in flag mode. Surfaces a badge in
    # the review UI so admins decide whether to approve/reject.
    out_of_geofence: bool = False
    # #21 (light) — the employee's scheduled shift window (company-local HH:MM),
    # so the review UI can show "scheduled 09:00–17:00" beside a session that ran
    # beyond it. Display-only context; payroll OT stays threshold-driven.
    scheduled_start: Optional[str] = None
    scheduled_end: Optional[str] = None


class TimeLogPatch(BaseModel):
    """Admin-only edit. Editing flips an approved log back to pending; the
    admin must re-approve once they're confident in the corrected hours."""
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    hours_worked: Optional[float] = None
    overtime_confirmed_by_employer: Optional[bool] = None
    overtime_rejected: Optional[bool] = None


class BulkIdsPayload(BaseModel):
    time_log_ids: List[int] = Field(min_length=1, max_length=500)


class BulkRejectPayload(BulkIdsPayload):
    reason: str = Field(
        min_length=20,
        max_length=500,
        description="Mandatory rejection reason. Visible to the employee.",
    )


class BulkApproveResult(BaseModel):
    approved_count: int
    skipped_count: int  # already approved
    audit_log_id: Optional[int]


class BulkRejectResult(BaseModel):
    rejected_count: int
    skipped_count: int  # already rejected
    audit_log_id: Optional[int]
    notifications_sent: int


class DisputeCreate(BaseModel):
    comment: str = Field(min_length=20, max_length=1000)


class DisputeResolve(BaseModel):
    decision: str = Field(description="'approved' or 'rejection_upheld'")
    admin_response: str = Field(min_length=1, max_length=1000)


class DisputeRead(BaseModel):
    id: int
    time_log_id: int
    employee_user_id: Optional[int]
    employee_comment: str
    created_at: datetime
    resolution: str
    admin_response: Optional[str]
    resolved_at: Optional[datetime]
    resolved_by_user_id: Optional[int]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _to_review_item(tl: TimeLog, employee_name: str, employee_code: Optional[str] = None) -> TimeLogReviewItem:
    dispute_status = tl.dispute.resolution if tl.dispute is not None else None
    job = getattr(tl, "job", None)
    sched_start = job.work_start_time.strftime("%H:%M") if job and job.work_start_time else None
    sched_end = job.work_end_time.strftime("%H:%M") if job and job.work_end_time else None
    return TimeLogReviewItem(
        timelog_id=tl.timelog_id,
        private_user_id=tl.private_user_id,
        employee_name=employee_name,
        employee_code=employee_code,
        day=tl.start_time.date() if tl.start_time else None,
        start_time=tl.start_time,
        end_time=tl.end_time,
        hours_worked=float(tl.hours_worked) if tl.hours_worked is not None else None,
        is_overtime=bool(tl.is_overtime),
        overtime_confirmed_by_employer=bool(tl.overtime_confirmed_by_employer),
        admin_approved=bool(tl.admin_approved),
        admin_approved_at=tl.admin_approved_at,
        admin_rejected=bool(tl.admin_rejected),
        admin_rejected_at=tl.admin_rejected_at,
        admin_rejected_reason=tl.admin_rejected_reason,
        dispute_status=dispute_status,
        created_source=getattr(tl, "created_source", None) or "mobile",
        auto_closed=bool(getattr(tl, "auto_closed", False)),
        kiosk_photo_path=getattr(tl, "kiosk_photo_path", None),
        out_of_schedule=bool(getattr(tl, "out_of_schedule", False)),
        is_late=bool(getattr(tl, "is_late", False)),
        late_reason=getattr(tl, "late_reason", None),
        out_of_geofence=bool(getattr(tl, "out_of_geofence", False)),
        scheduled_start=sched_start,
        scheduled_end=sched_end,
    )


def _month_range(month: str) -> tuple[datetime, datetime]:
    """Parse 'YYYY-MM' into a [start, end) UTC range."""
    try:
        year_str, month_str = month.split("-")
        year, mnum = int(year_str), int(month_str)
        start = datetime(year, mnum, 1, tzinfo=timezone.utc)
    except Exception:
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    if mnum == 12:
        end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(year, mnum + 1, 1, tzinfo=timezone.utc)
    return start, end


def _ensure_logs_belong_to_company(
    db: Session, company_id: int, time_log_ids: List[int],
) -> List[TimeLog]:
    """Fetch logs by id and verify they all belong to the given company.
    Cross-company ids are silently dropped (callers see them in the skipped
    count) — never leak cross-tenant existence info."""
    rows = (
        db.query(TimeLog)
        .options(joinedload(TimeLog.dispute), joinedload(TimeLog.job))
        .join(Job, Job.job_id == TimeLog.job_id)
        .filter(
            TimeLog.timelog_id.in_(time_log_ids),
            Job.company_id == company_id,
        )
        .all()
    )
    return rows


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/companies/{company_id}/time-logs",
    response_model=List[TimeLogReviewItem],
)
def list_time_logs(
    company_id: int,
    month: str = Query(..., description="YYYY-MM"),
    private_user_id: Optional[int] = Query(None),
    status: str = Query(
        "all",
        description="all | pending | approved | rejected | disputed",
    ),
    source: Optional[str] = Query(
        None,
        description="M30 — optional source filter: mobile | web | kiosk | admin",
    ),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    _require_company_admin_gated(current_user, company_id, db, "edit_hours")
    start, end = _month_range(month)

    q = (
        db.query(TimeLog, PrivateUser)
        .options(joinedload(TimeLog.dispute), joinedload(TimeLog.job))
        .join(Job, Job.job_id == TimeLog.job_id)
        .join(PrivateUser, PrivateUser.private_user_id == TimeLog.private_user_id)
        .filter(Job.company_id == company_id)
        .filter(TimeLog.start_time >= start, TimeLog.start_time < end)
    )
    if private_user_id is not None:
        q = q.filter(TimeLog.private_user_id == private_user_id)
    # M30 — kiosk-pending fast-track filter on the review dashboard.
    if source is not None:
        if source not in {"mobile", "web", "kiosk", "admin"}:
            raise HTTPException(status_code=400, detail=f"Unknown source filter: {source}")
        q = q.filter(TimeLog.created_source == source)

    if status == "pending":
        q = q.filter(TimeLog.admin_approved.is_(False), TimeLog.admin_rejected.is_(False))
    elif status == "approved":
        q = q.filter(TimeLog.admin_approved.is_(True))
    elif status == "rejected":
        q = q.filter(TimeLog.admin_rejected.is_(True))
    elif status == "disputed":
        q = q.join(TimeLogDispute, TimeLogDispute.time_log_id == TimeLog.timelog_id).filter(
            TimeLogDispute.resolution == "pending",
        )
    elif status != "all":
        raise HTTPException(status_code=400, detail=f"Unknown status filter: {status}")

    rows = q.order_by(TimeLog.start_time).all()
    return [
        _to_review_item(tl, f"{pu.first_name} {pu.last_name}".strip(), pu.employee_code)
        for tl, pu in rows
    ]


@router.patch("/time-logs/{time_log_id}", response_model=TimeLogReviewItem)
def patch_time_log(
    time_log_id: int,
    payload: TimeLogPatch,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Admin edits hours / overtime flags. Re-approval required if log
    was previously approved (admin_approved is reset to false)."""
    tl = (
        db.query(TimeLog)
        .options(joinedload(TimeLog.dispute), joinedload(TimeLog.job))
        .join(Job, Job.job_id == TimeLog.job_id)
        .filter(TimeLog.timelog_id == time_log_id)
        .one_or_none()
    )
    if tl is None:
        raise HTTPException(status_code=404, detail=f"TimeLog {time_log_id} not found")
    _require_company_admin_gated(current_user, tl.job.company_id, db, "edit_hours")

    update = payload.model_dump(exclude_unset=True)
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")

    for k, v in update.items():
        setattr(tl, k, v)

    if tl.start_time and tl.end_time and tl.end_time <= tl.start_time:
        raise HTTPException(status_code=400, detail="end_time must be after start_time")

    if tl.start_time and tl.end_time:
        from services.time_log_service import TimeLogService
        conflict = TimeLogService.find_overlapping_time_log(
            db, tl.private_user_id, tl.start_time, tl.end_time,
            exclude_timelog_id=tl.timelog_id,
        )
        if conflict is not None:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"This edit overlaps another clock-in for this employee "
                    f"(timelog {conflict.timelog_id}, "
                    f"{conflict.start_time.isoformat()} – {conflict.end_time.isoformat()}). "
                    "Fix or remove that entry first."
                ),
            )

    # Same rule as create_assignment in salary_structures.py: a finalized
    # payroll period is locked (already paid + filed), so an edit that lands
    # a log inside one isn't allowed — the fix there is a retroactive
    # adjustment in the next open run, not editing history.
    if tl.start_time:
        from core.model import PayrollRun
        log_date = tl.start_time.date()
        finalized = (
            db.query(PayrollRun)
            .filter(
                PayrollRun.company_id == tl.job.company_id,
                PayrollRun.status == "finalized",
                PayrollRun.period_start <= log_date,
                PayrollRun.period_end >= log_date,
            )
            .first()
        )
        if finalized is not None:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"That date is inside a finalized payroll period "
                    f"({finalized.period_start} → {finalized.period_end}), which is "
                    "locked. Editing a clock-in there isn't allowed — post a "
                    "retroactive adjustment in the next open run instead."
                ),
            )

    # Editing start_time/end_time without also passing hours_worked would
    # otherwise leave hours_worked stale (it isn't derived — see create_time_log
    # in db_models/crud/job.py, which uses the same formula on the create path).
    if ("start_time" in update or "end_time" in update) and "hours_worked" not in update:
        if tl.start_time and tl.end_time:
            worked_seconds = max((tl.end_time - tl.start_time).total_seconds(), 0)
            tl.hours_worked = round(worked_seconds / 3600, 2)

    # Edit returns the log to pending review.
    was_approved = tl.admin_approved
    if was_approved:
        tl.admin_approved = False
        tl.admin_approved_at = None
        tl.admin_approved_by_user_id = None

    db.add(
        AuditLog(
            actor_user_id=current_user.user_id,
            action="time_log.edit",
            target_type="time_logs",
            target_id=str(tl.timelog_id),
            meta={
                "changes": {
                    k: (v.isoformat() if isinstance(v, datetime) else v)
                    for k, v in update.items()
                },
                "was_approved": was_approved,
            },
        )
    )
    db.commit()
    db.refresh(tl)

    pu = db.query(PrivateUser).filter(PrivateUser.private_user_id == tl.private_user_id).one()
    return _to_review_item(tl, f"{pu.first_name} {pu.last_name}".strip(), pu.employee_code)


@router.post(
    "/companies/{company_id}/time-logs/approve",
    response_model=BulkApproveResult,
)
def approve_time_logs(
    company_id: int,
    payload: BulkIdsPayload,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    _require_company_admin_gated(current_user, company_id, db, "edit_hours")
    rows = _ensure_logs_belong_to_company(db, company_id, payload.time_log_ids)
    rows_by_id = {r.timelog_id: r for r in rows}

    approved = 0
    skipped = 0
    notif_targets: list[tuple[int, int]] = []  # (employee user_id, time_log_id)
    now = datetime.now(timezone.utc)
    for tl_id in payload.time_log_ids:
        tl = rows_by_id.get(tl_id)
        if tl is None:
            skipped += 1
            continue
        # If a dispute is pending, approving the log resolves the dispute too.
        if tl.dispute is not None and tl.dispute.resolution == "pending":
            tl.dispute.resolution = "approved"
            tl.dispute.admin_response = "Approved via bulk approve"
            tl.dispute.resolved_at = now
            tl.dispute.resolved_by_user_id = current_user.user_id
        if tl.admin_approved:
            skipped += 1
            continue
        tl.admin_approved = True
        tl.admin_approved_at = now
        tl.admin_approved_by_user_id = current_user.user_id
        # Approving clears any prior rejection.
        tl.admin_rejected = False
        tl.admin_rejected_at = None
        tl.admin_rejected_by_user_id = None
        tl.admin_rejected_reason = None
        approved += 1
        # Notify the employee their clock-in was approved (it now feeds payroll).
        emp_user_id = (
            db.query(PrivateUser.user_id)
            .filter(PrivateUser.private_user_id == tl.private_user_id)
            .scalar()
        )
        if emp_user_id:
            notif_targets.append((emp_user_id, tl.timelog_id))

    audit = AuditLog(
        actor_user_id=current_user.user_id,
        action="time_log.bulk_approve",
        target_type="time_logs",
        target_id=str(company_id),
        meta={
            "company_id": company_id,
            "time_log_ids": payload.time_log_ids,
            "approved_count": approved,
            "skipped_count": skipped,
        },
    )
    db.add(audit)
    db.commit()
    db.refresh(audit)

    # Event notification → in-app record + device push. Post-commit and
    # best-effort: a push failure must never roll back the approval.
    for user_id, tl_id in notif_targets:
        NotificationService.create_notification(
            db=db, user_id=user_id,
            title="Clock-in approved",
            message="Your clock-in was approved by your employer and will be included in payroll.",
            notification_type="time_log.approved",
            meta={"time_log_id": tl_id},
        )

    return BulkApproveResult(
        approved_count=approved, skipped_count=skipped, audit_log_id=audit.id,
    )


@router.post(
    "/companies/{company_id}/time-logs/reject",
    response_model=BulkRejectResult,
)
def reject_time_logs(
    company_id: int,
    payload: BulkRejectPayload,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Reject one or more time logs.

    Wage-theft mitigation:
      * reason is validated min_length=20 (Pydantic), so silent rejections
        are not possible.
      * each rejected log emits a Notification to the employee with the
        reason and a "Tap to dispute" hint.
    """
    _require_company_admin_gated(current_user, company_id, db, "edit_hours")
    rows = _ensure_logs_belong_to_company(db, company_id, payload.time_log_ids)
    rows_by_id = {r.timelog_id: r for r in rows}

    rejected = 0
    skipped = 0
    notifications_sent = 0
    now = datetime.now(timezone.utc)
    notif_targets: list[tuple[int, int]] = []  # (user_id, time_log_id)

    for tl_id in payload.time_log_ids:
        tl = rows_by_id.get(tl_id)
        if tl is None:
            skipped += 1
            continue
        if tl.admin_rejected and tl.admin_rejected_reason == payload.reason:
            # Idempotent — same rejection already recorded.
            skipped += 1
            continue
        tl.admin_rejected = True
        tl.admin_rejected_at = now
        tl.admin_rejected_by_user_id = current_user.user_id
        tl.admin_rejected_reason = payload.reason
        # Rejecting clears any prior approval.
        if tl.admin_approved:
            tl.admin_approved = False
            tl.admin_approved_at = None
            tl.admin_approved_by_user_id = None
        rejected += 1

        # Resolve the employee's User row for notification.
        emp_user_id = (
            db.query(PrivateUser.user_id)
            .filter(PrivateUser.private_user_id == tl.private_user_id)
            .scalar()
        )
        if emp_user_id:
            notif_targets.append((emp_user_id, tl.timelog_id))

    notifications_sent = len(notif_targets)

    audit = AuditLog(
        actor_user_id=current_user.user_id,
        action="time_log.bulk_reject",
        target_type="time_logs",
        target_id=str(company_id),
        meta={
            "company_id": company_id,
            "time_log_ids": payload.time_log_ids,
            "rejected_count": rejected,
            "skipped_count": skipped,
            "reason": payload.reason,
        },
    )
    db.add(audit)
    db.commit()
    db.refresh(audit)

    # Event notification → in-app record + device push. Post-commit and
    # best-effort: a push failure must never roll back the rejection.
    for user_id, tl_id in notif_targets:
        NotificationService.create_notification(
            db=db, user_id=user_id,
            title="Clock-in rejected",
            message=(
                "Your clock-in was rejected by your employer. "
                f"Reason: {payload.reason}. Tap to dispute."
            ),
            notification_type="time_log.rejected",
            meta={"time_log_id": tl_id, "reason": payload.reason},
        )

    return BulkRejectResult(
        rejected_count=rejected,
        skipped_count=skipped,
        audit_log_id=audit.id,
        notifications_sent=notifications_sent,
    )


@router.post("/time-logs/{time_log_id}/dispute", response_model=DisputeRead)
def create_dispute(
    time_log_id: int,
    payload: DisputeCreate,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Employee disputes a rejected log.

    Open disputes block payroll finalization for the period.
    """
    tl = (
        db.query(TimeLog)
        .options(joinedload(TimeLog.dispute), joinedload(TimeLog.job))
        .filter(TimeLog.timelog_id == time_log_id)
        .one_or_none()
    )
    if tl is None:
        raise HTTPException(status_code=404, detail=f"TimeLog {time_log_id} not found")

    # Only the owning employee can file the dispute.
    owning_user_id = (
        db.query(PrivateUser.user_id)
        .filter(PrivateUser.private_user_id == tl.private_user_id)
        .scalar()
    )
    if owning_user_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Only the employee can dispute their own clock-in")

    if not tl.admin_rejected:
        raise HTTPException(
            status_code=400,
            detail="Only rejected logs can be disputed",
        )

    if tl.dispute is not None:
        if tl.dispute.resolution == "pending":
            raise HTTPException(
                status_code=409,
                detail="A dispute is already open for this log",
            )
        # Resolved dispute exists — overwrite with a fresh one
        # (employee has new info after the previous resolution).
        d = tl.dispute
        d.employee_comment = payload.comment
        d.created_at = datetime.now(timezone.utc)
        d.resolution = "pending"
        d.admin_response = None
        d.resolved_at = None
        d.resolved_by_user_id = None
    else:
        d = TimeLogDispute(
            time_log_id=tl.timelog_id,
            employee_user_id=current_user.user_id,
            employee_comment=payload.comment,
        )
        db.add(d)

    db.add(
        AuditLog(
            actor_user_id=current_user.user_id,
            action="time_log.dispute_opened",
            target_type="time_logs",
            target_id=str(tl.timelog_id),
            meta={"comment": payload.comment},
        )
    )
    db.commit()
    db.refresh(d)
    return DisputeRead(**{
        "id": d.id,
        "time_log_id": d.time_log_id,
        "employee_user_id": d.employee_user_id,
        "employee_comment": d.employee_comment,
        "created_at": d.created_at,
        "resolution": d.resolution,
        "admin_response": d.admin_response,
        "resolved_at": d.resolved_at,
        "resolved_by_user_id": d.resolved_by_user_id,
    })


@router.post("/time-logs/{time_log_id}/dispute/resolve", response_model=DisputeRead)
def resolve_dispute(
    time_log_id: int,
    payload: DisputeResolve,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Admin resolves a pending dispute.

    decision='approved'           → log flips back to approved
    decision='rejection_upheld'   → log stays rejected
    """
    if payload.decision not in ("approved", "rejection_upheld"):
        raise HTTPException(
            status_code=400,
            detail="decision must be 'approved' or 'rejection_upheld'",
        )

    tl = (
        db.query(TimeLog)
        .options(joinedload(TimeLog.dispute), joinedload(TimeLog.job))
        .join(Job, Job.job_id == TimeLog.job_id)
        .filter(TimeLog.timelog_id == time_log_id)
        .one_or_none()
    )
    if tl is None:
        raise HTTPException(status_code=404, detail=f"TimeLog {time_log_id} not found")
    _require_company_admin_gated(current_user, tl.job.company_id, db, "edit_hours")

    if tl.dispute is None or tl.dispute.resolution != "pending":
        raise HTTPException(status_code=400, detail="No pending dispute on this log")

    d = tl.dispute
    now = datetime.now(timezone.utc)
    d.resolution = payload.decision
    d.admin_response = payload.admin_response
    d.resolved_at = now
    d.resolved_by_user_id = current_user.user_id

    # Resolve underlying log state.
    if payload.decision == "approved":
        tl.admin_approved = True
        tl.admin_approved_at = now
        tl.admin_approved_by_user_id = current_user.user_id
        tl.admin_rejected = False
        tl.admin_rejected_at = None
        tl.admin_rejected_by_user_id = None
        tl.admin_rejected_reason = None

    db.add(
        AuditLog(
            actor_user_id=current_user.user_id,
            action="time_log.dispute_resolved",
            target_type="time_logs",
            target_id=str(tl.timelog_id),
            meta={"decision": payload.decision, "admin_response": payload.admin_response},
        )
    )
    db.commit()
    db.refresh(d)

    # Event notification → in-app record + device push (post-commit, best-effort).
    if d.employee_user_id:
        verb = "approved" if payload.decision == "approved" else "upheld"
        NotificationService.create_notification(
            db=db, user_id=d.employee_user_id,
            title=f"Dispute {verb}",
            message=(
                f"Your dispute for the clock-in was {verb}. "
                f"Admin note: {payload.admin_response}"
            ),
            notification_type="time_log.dispute_resolved",
            meta={"time_log_id": tl.timelog_id, "decision": payload.decision},
        )

    return DisputeRead(**{
        "id": d.id,
        "time_log_id": d.time_log_id,
        "employee_user_id": d.employee_user_id,
        "employee_comment": d.employee_comment,
        "created_at": d.created_at,
        "resolution": d.resolution,
        "admin_response": d.admin_response,
        "resolved_at": d.resolved_at,
        "resolved_by_user_id": d.resolved_by_user_id,
    })


@router.get("/companies/{company_id}/time-logs/audit-export")
def audit_export(
    company_id: int,
    from_date: date = Query(..., alias="from"),
    to_date: date = Query(..., alias="to"),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Streamed CSV export for regulator / wage-claim audits.

    Pulls every time_log.{edit, bulk_approve, bulk_reject, dispute_opened,
    dispute_resolved} AuditLog row in the date range, joined onto the
    TimeLog so the regulator sees the affected employee.
    """
    _require_company_admin_gated(current_user, company_id, db, "edit_hours")
    if to_date < from_date:
        raise HTTPException(status_code=400, detail="to must be >= from")

    start = datetime.combine(from_date, datetime.min.time(), tzinfo=timezone.utc)
    end = datetime.combine(to_date, datetime.max.time(), tzinfo=timezone.utc) + timedelta(microseconds=1)

    rows = (
        db.query(AuditLog)
        .filter(AuditLog.target_type == "time_logs")
        .filter(AuditLog.created_at >= start, AuditLog.created_at < end)
        .filter(AuditLog.action.in_([
            "time_log.bulk_approve",
            "time_log.bulk_reject",
            "time_log.edit",
            "time_log.dispute_opened",
            "time_log.dispute_resolved",
        ]))
        .order_by(AuditLog.created_at)
        .all()
    )

    # Filter to the company by checking each row's target — bulk rows
    # store target_id=str(company_id); per-log rows resolve via TimeLog.
    company_id_str = str(company_id)
    filtered: list[AuditLog] = []
    for r in rows:
        if r.action.startswith("time_log.bulk_"):
            if r.target_id == company_id_str:
                filtered.append(r)
        else:
            tl = (
                db.query(TimeLog)
                .join(Job, Job.job_id == TimeLog.job_id)
                .filter(
                    TimeLog.timelog_id == int(r.target_id) if r.target_id and r.target_id.isdigit() else False,
                    Job.company_id == company_id,
                )
                .one_or_none()
            )
            if tl is not None:
                filtered.append(r)

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "audit_id", "created_at", "action", "actor_user_id",
        "time_log_id", "company_id", "meta",
    ])
    for r in filtered:
        writer.writerow([
            r.id,
            r.created_at.isoformat() if r.created_at else "",
            r.action,
            r.actor_user_id,
            r.target_id if not r.action.startswith("time_log.bulk_") else "",
            company_id if r.action.startswith("time_log.bulk_") else "",
            str(r.meta) if r.meta else "",
        ])
    buf.seek(0)
    filename = f"timelog_audit_{company_id}_{from_date}_{to_date}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
