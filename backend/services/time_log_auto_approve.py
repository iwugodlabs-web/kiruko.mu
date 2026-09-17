"""Review-by-exception P2 — auto-approve clean clock-ins (opt-in per company).

On clock-out finalize, if the company set ``auto_approve_clean_clockins`` and
the session classifies as clean (``needs_review is False``) and was NOT pulled
into the random-sample audit, the session is auto-approved with a system marker
(``admin_approved_by_user_id`` stays NULL, audit ``time_log.auto_approved``).

Respects the existing approval gate: a company that mandates manual approval
(``require_approved_clockins_for_payroll``) simply leaves this flag false.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from services.time_log_classifier import is_sampled_for_review


def _company_of(db, tl):
    from core.model import Company, Job

    job = getattr(tl, "job", None)
    if job is not None and getattr(job, "company_id", None) is not None:
        company_id = job.company_id
    else:
        job_id = getattr(tl, "job_id", None)
        if job_id is None:
            return None
        job = db.query(Job).filter(Job.job_id == job_id).first()
        if job is None or getattr(job, "company_id", None) is None:
            return None
        company_id = job.company_id
    return db.query(Company).filter(Company.company_id == company_id).first()


def maybe_auto_approve(db, tl) -> bool:
    """Auto-approve a just-finalized clean session. Returns True if it
    auto-approved. Caller is responsible for the commit."""
    if tl is None or getattr(tl, "end_time", None) is None:
        return False
    if getattr(tl, "admin_approved", False) or getattr(tl, "admin_rejected", False):
        return False
    # Only clean sessions auto-approve; None (unclassified) is NOT clean.
    if getattr(tl, "needs_review", None) is not False:
        return False

    company = _company_of(db, tl)
    if company is None or not getattr(company, "auto_approve_clean_clockins", False):
        return False

    sample_pct = int(getattr(company, "review_sample_pct", 0) or 0)
    if sample_pct and is_sampled_for_review(company.company_id, tl.timelog_id, sample_pct):
        return False  # sampled for audit — do NOT auto-approve

    now = datetime.now(timezone.utc)
    tl.admin_approved = True
    tl.admin_approved_at = now
    tl.admin_approved_by_user_id = None  # system marker, not a human
    tl.admin_rejected = False
    tl.admin_rejected_at = None
    tl.admin_rejected_by_user_id = None
    tl.admin_rejected_reason = None

    from core.model import AuditLog

    db.add(
        AuditLog(
            actor_user_id=None,
            action="time_log.auto_approved",
            target_type="time_logs",
            target_id=str(tl.timelog_id),
            meta={"company_id": company.company_id},
        )
    )
    return True


def clean_pending_ids(db, company_id: int, start, end) -> list[int]:
    """Timelog ids in [start, end) that are clean, pending, and NOT sampled —
    the "approve all clean this month" set. Used by the bulk endpoint."""
    from core.model import Company, Job, TimeLog

    company = db.query(Company).filter(Company.company_id == company_id).first()
    sample_pct = int(getattr(company, "review_sample_pct", 0) or 0) if company else 0

    rows = (
        db.query(TimeLog)
        .join(Job, Job.job_id == TimeLog.job_id)
        .filter(
            Job.company_id == company_id,
            TimeLog.start_time >= start,
            TimeLog.start_time < end,
            TimeLog.needs_review.is_(False),
            TimeLog.admin_approved.is_(False),
            TimeLog.admin_rejected.is_(False),
        )
        .all()
    )

    ids: list[int] = []
    for tl in rows:
        if sample_pct and is_sampled_for_review(company_id, tl.timelog_id, sample_pct):
            continue  # audit sample stays for human review
        ids.append(tl.timelog_id)
    return ids
