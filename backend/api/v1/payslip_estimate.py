"""M4 — Employee estimated payslip download.

GET /private-users/me/payslips/estimated.pdf

Server-clamped to the current month. Streams a watermarked PDF computed
from the employee's clock-ins, ignoring admin-approval state. Visually
and legally distinct from the official payslip — see
services/payslip_estimate_service for the template fork.

Real-world guardrails baked in:
  * Authz: caller can only fetch their own (private_user_id matches
    current_user). 403 otherwise.
  * Period clamp: month is server-fixed. 404 if pre-employment.
  * Override-by-official: 409 + redirect hint if a finalized Payslip
    exists for the current month.
  * Rate limit: 5/min per user via the existing core.limiter Limiter.
  * Audit: AuditLog row per successful download (action='estimated_payslip.download').
  * No persistence: PDF is built in-memory and streamed; never written
    to backend/uploads or S3.
  * Holdback: ESTIMATED_PAYSLIP_ENABLED env var (default 'false') gates
    production rollout until counsel signs off on the localized disclaimer
    translations (EN/FR/MG).
"""

from __future__ import annotations

import logging
import os
from datetime import date, datetime, timezone, timedelta
from decimal import Decimal

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from core import config
from core.dependencies import get_current_user
from core.limiter import limiter, RATE_LIMITING_ENABLED
from core.model import AuditLog, Company, Job, Payslip, PayrollRun, PrivateUser, User
from services import payslip_estimate_service
from services.payslip_pdf_service import PdfRenderUnavailable
from sqlalchemy.orm import Session


logger = logging.getLogger(__name__)


router = APIRouter(tags=["Estimated Payslip"])


def _current_month_window() -> tuple[date, date]:
    """Today's calendar month (UTC) → (period_start, period_end_inclusive)."""
    today = datetime.now(timezone.utc).date()
    start = today.replace(day=1)
    if start.month == 12:
        end_exclusive = date(start.year + 1, 1, 1)
    else:
        end_exclusive = date(start.year, start.month + 1, 1)
    return start, end_exclusive - timedelta(days=1)


def _target_window(
    db: Session, company_id: int,
    period_start: Optional[date] = None, period_end: Optional[date] = None,
) -> tuple[date, date]:
    """Period the estimate should reflect, in priority order:
      1. explicit period_start+period_end (caller override), else
      2. the company's currently-OPEN payroll run (draft/review) — so the
         estimate follows the month being run, not whatever the calendar says, else
      3. the current calendar month (default for day-to-day employee use).
    Period-close discipline guarantees at most one open run, so (2) is
    unambiguous."""
    if period_start and period_end:
        return period_start, period_end
    open_run = (
        db.query(PayrollRun)
        .filter(PayrollRun.company_id == company_id)
        .filter(PayrollRun.status.in_(["draft", "review"]))
        .order_by(PayrollRun.period_start.desc())
        .first()
    )
    if open_run is not None:
        return open_run.period_start, open_run.period_end
    return _current_month_window()


def _is_enabled() -> bool:
    """Holdback flag default. Reads ESTIMATED_PAYSLIP_ENABLED at request
    time (not import time) so tests / staging can flip it without
    re-importing the module."""
    raw = os.getenv("ESTIMATED_PAYSLIP_ENABLED", "false").strip().lower()
    return raw in ("1", "true", "yes", "on")


@router.get("/private-users/me/payslips/estimated.pdf")
@(limiter.limit("5/minute") if RATE_LIMITING_ENABLED else lambda f: f)
def download_estimated_payslip(
    request: Request,  # required by limiter
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Stream the watermarked, current-month estimated payslip PDF for
    the authenticated employee. See module docstring for guardrails."""
    if not _is_enabled():
        raise HTTPException(
            status_code=503,
            detail="Estimated payslip is not enabled in this environment.",
        )

    if not current_user.private_user:
        raise HTTPException(
            status_code=403,
            detail="Only employees can download an estimated payslip.",
        )
    employee: PrivateUser = current_user.private_user

    if not employee.company_id:
        raise HTTPException(status_code=400, detail="Employee has no company yet.")
    company = (
        db.query(Company).filter(Company.company_id == employee.company_id).one_or_none()
    )
    if company is None:
        raise HTTPException(status_code=400, detail="Employee company not found.")

    period_start, period_end = _current_month_window()

    # Pre-employment guard: latest Job's first_date_of_employment.
    latest_job = (
        db.query(Job)
        .filter(Job.private_user_id == employee.private_user_id)
        .order_by(Job.created_at.desc())
        .first()
    )
    if latest_job and latest_job.first_date_of_employment:
        emp_start = latest_job.first_date_of_employment.date() if hasattr(latest_job.first_date_of_employment, "date") else latest_job.first_date_of_employment
        if emp_start > period_end:
            raise HTTPException(
                status_code=404,
                detail="Period is before your employment start date.",
            )

    # Already-finalized override: real payslip supersedes any estimate.
    finalized = (
        db.query(Payslip)
        .join(PayrollRun, PayrollRun.id == Payslip.payroll_run_id)
        .filter(Payslip.private_user_id == employee.private_user_id)
        .filter(PayrollRun.company_id == company.company_id)
        .filter(PayrollRun.period_start == period_start)
        .filter(PayrollRun.status == "finalized")
        .first()
    )
    if finalized is not None:
        # Diagnostic — what exactly matched (no PII), so we can see whether a
        # real finalized run/payslip exists for this employee+month.
        try:
            run = (
                db.query(PayrollRun)
                .filter(PayrollRun.id == finalized.payroll_run_id)
                .one_or_none()
            )
            logger.debug(
                "official-exists diag: pid=%s company_id=%s period_start=%s "
                "payslip_id=%s run_id=%s run_status=%s run_period_start=%s",
                employee.private_user_id, company.company_id, period_start,
                finalized.id, finalized.payroll_run_id,
                getattr(run, "status", None), getattr(run, "period_start", None),
            )
        except Exception:
            logger.exception("official-exists diag logging failed")
        raise HTTPException(
            status_code=409,
            detail={
                "code": "OFFICIAL_PAYSLIP_EXISTS",
                "message": "An official payslip exists for this month — opening it instead.",
                "payslip_id": finalized.id,
            },
        )

    # Locale comes off the User row (M18 preferred_locale). Falls back to EN.
    locale = (getattr(current_user, "preferred_locale", None) or "en").lower()
    if locale not in {"en", "fr", "mg"}:
        locale = "en"

    # Compute the estimate once. If it has no pay (e.g. an hourly worker with
    # no *completed* shifts this period — only open clock-ins, which the engine
    # can't value — or no salary configured), don't ship a misleading 0-value
    # PDF; block with a clear message instead. Salaried workers always have a
    # gross > 0 here regardless of clock-ins.
    context = payslip_estimate_service.build_context(
        db,
        employee=employee,
        company=company,
        job=latest_job,
        period_start=period_start,
        period_end=period_end,
        locale=locale,
    )
    if (context.get("gross_decimal") or 0) <= 0:
        # Distinguish the two zero-pay causes so the worker gets an accurate
        # explanation. If they logged real hours this month but pay still
        # computes to 0, the problem is a missing pay basis (no salary
        # structure / hourly rate set up), not their clock-ins.
        if (context.get("clockin_hours_decimal") or 0) > 0:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "NO_PAY_BASIS_CONFIGURED",
                    "message": "We can't estimate your pay yet because your salary or hourly rate hasn't been set up. Ask your employer to configure it.",
                    "period_start": period_start.isoformat(),
                    "period_end": period_end.isoformat(),
                },
            )
        raise HTTPException(
            status_code=409,
            detail={
                "code": "NO_CLOCKINS_FOR_PERIOD",
                "message": "No estimable pay yet this month — clock out of any open shifts to generate an estimate.",
                "period_start": period_start.isoformat(),
                "period_end": period_end.isoformat(),
            },
        )

    try:
        pdf_bytes = payslip_estimate_service.render_pdf(
            db,
            employee=employee,
            company=company,
            job=latest_job,
            period_start=period_start,
            period_end=period_end,
            locale=locale,
            context=context,
        )
    except PdfRenderUnavailable as e:
        logger.warning("Estimated PDF render unavailable: %s", e)
        raise HTTPException(
            status_code=503,
            detail="PDF renderer unavailable. Try again later.",
        )

    # Audit — captures who downloaded what when. Useful for disputes.
    db.add(AuditLog(
        actor_user_id=current_user.user_id,
        action="estimated_payslip.download",
        target_type="private_users",
        target_id=str(employee.private_user_id),
        meta={
            "month": period_start.isoformat(),
            "company_id": company.company_id,
            "size_bytes": len(pdf_bytes),
        },
    ))
    db.commit()

    generated_at = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    filename = (
        f"kontokaz_estimated_payslip_"
        f"{employee.private_user_id}_{period_start.strftime('%Y-%m')}_{generated_at}.pdf"
    )

    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


@router.get("/private-users/me/payslips/estimate")
def get_own_estimate_json(
    period_start: Optional[date] = Query(None, description="Override the estimated period start (defaults to the open payroll run's month, else the current month)."),
    period_end: Optional[date] = Query(None, description="Override the estimated period end."),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Self-service alias — resolves the caller's own private_user_id
    instead of requiring the client to know and pass it. Mirrors the same
    'me' pattern the PDF route below already uses.

    MUST be registered before the /{private_user_id}/... route: Starlette
    matches routes in registration order, and "me" would otherwise match
    that route's path shape first (then fail int-parsing with a 422) —
    which is exactly what happened before this route existed. Mobile's
    payroll.getEstimate() has always called this literal "me" path; there
    was previously no handler for it at all (only the .pdf variant had a
    "me" alias), so every call 422'd and the client silently fell back to
    its own local, less-authoritative calculation.
    """
    if not current_user.private_user:
        raise HTTPException(status_code=400, detail="No employee profile linked to this account.")
    return get_employee_estimate_json(
        private_user_id=current_user.private_user.private_user_id,
        period_start=period_start,
        period_end=period_end,
        db=db,
        current_user=current_user,
    )


@router.get("/private-users/{private_user_id}/payslips/estimate")
def get_employee_estimate_json(
    private_user_id: int,
    period_start: Optional[date] = Query(None, description="Override the estimated period start (defaults to the open payroll run's month, else the current month)."),
    period_end: Optional[date] = Query(None, description="Override the estimated period end."),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Estimate for ONE employee, as JSON — the correct,
    mode-aware figures (gross/net + earnings/deductions; for a clock-in-paid
    company this includes per-day absence docking). This is the source the
    employer breakdown should use instead of recomputing payroll in the UI.

    Authz: a company admin for the employee may always view it; the employee
    themselves only when the estimate holdback flag is on (so the employer
    breakdown isn't blocked by the employee-facing rollout gate).
    """
    from core.roles import is_company_admin_for

    employee = (
        db.query(PrivateUser)
        .filter(PrivateUser.private_user_id == private_user_id)
        .one_or_none()
    )
    if employee is None:
        raise HTTPException(status_code=404, detail="Employee not found.")

    is_self = bool(
        current_user.private_user
        and current_user.private_user.private_user_id == private_user_id
    )
    from core.permission_guards import has_company_permission
    is_admin = bool(
        employee.company_id
        and has_company_permission(current_user, employee.company_id, 'view_payslip', db)
    )
    if not (is_admin or is_self):
        raise HTTPException(status_code=403, detail="Not authorized to view this estimate.")
    if is_self and not is_admin and not _is_enabled():
        raise HTTPException(
            status_code=503,
            detail="Estimated payslip is not enabled in this environment.",
        )
    if not employee.company_id:
        raise HTTPException(status_code=400, detail="Employee has no company yet.")
    company = (
        db.query(Company).filter(Company.company_id == employee.company_id).one_or_none()
    )
    if company is None:
        raise HTTPException(status_code=400, detail="Employee company not found.")

    # Follow the month being run (open draft/review run) when one exists, so the
    # employer's estimate matches the payroll they're working on — not the
    # calendar month. Falls back to current month for day-to-day use.
    period_start, period_end = _target_window(db, company.company_id, period_start, period_end)
    job = (
        db.query(Job)
        .filter(Job.private_user_id == private_user_id)
        .order_by(Job.created_at.desc())
        .first()
    )
    locale = (getattr(current_user, "preferred_locale", None) or "en").lower()
    if locale not in {"en", "fr", "mg"}:
        locale = "en"

    ctx = payslip_estimate_service.build_context(
        db, employee=employee, company=company, job=job,
        period_start=period_start, period_end=period_end, locale=locale,
    )

    # Distinguish WHY gross is 0, same two causes the PDF route already
    # blocks on (payslip_estimate.py's download_estimated_payslip, above) —
    # but this JSON route must still render (it feeds the employer profile
    # card), so surface the reason instead of raising. Without this the
    # frontend can't tell "no salary configured" from "hourly worker, no
    # completed shifts yet" from a genuine, correctly-computed zero.
    zero_reason = None
    if (ctx.get("gross_decimal") or 0) <= 0:
        if (ctx.get("clockin_hours_decimal") or 0) > 0:
            zero_reason = "no_pay_basis"
        else:
            zero_reason = "no_clockins"

    attendance_details = ctx.get("attendance_details") or {}
    return {
        "currency": ctx["currency"],
        "period": ctx["period"],
        "gross": str(ctx["gross_decimal"]),
        "net": str(ctx["net_decimal"]),
        "earnings": ctx["earnings"],
        "deductions": ctx["deductions"],
        # Approved leave taken in the period (paid + unpaid), so the estimate can
        # show a "Leave taken" line like the finalized payslip does. Unpaid leave
        # already appears in `deductions`; this surfaces PAID leave too.
        "leave_summary": ctx.get("leave_summary", []),
        "pay_is_hours_driven": ctx["pay_is_hours_driven"],
        # 'no_pay_basis' | 'no_clockins' | None — see comment above.
        "zero_reason": zero_reason,
        # Day-count breakdown for salaried (monthly) staff at a company that
        # requires clock-ins for payroll — {} (all fields absent) when not
        # applicable (hourly/daily pay, clock-ins not required, or the
        # employee has never clocked in at all so absence can't be told apart
        # from untracked). Lets the UI show "N/M days present" instead of a
        # bare, easily-misread hours total next to the pay figure.
        "attendance": {
            "scheduled_days": attendance_details.get("scheduled_days"),
            "present_days": attendance_details.get("present_days"),
            "absent_days": attendance_details.get("absent_days"),
        } if attendance_details else None,
        "is_estimate": True,
    }
