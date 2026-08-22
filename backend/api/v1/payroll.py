"""Payroll runs + payslips API.

Endpoints:
    POST   /payroll/runs                      — create a draft run
    POST   /payroll/runs/{run_id}/finalize    — finalize a draft run
    POST   /payroll/runs/{run_id}/cancel      — cancel a run
    GET    /payroll/runs                      — list (filter by company, status)
    GET    /payroll/runs/{run_id}             — single run with payslips embedded
    GET    /payslips/{payslip_id}             — single payslip
    GET    /payslips/employee/{user_id}       — payslips for one employee

Authorization:
    Currently any authenticated user can read; write endpoints require
    employer-admin or platform-admin. Tighter scoping per company is a
    follow-up (mirrors profile_lock._user_is_admin_for).
"""

from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from core import config
from core.dependencies import get_current_user
from core.idempotency import require_idempotency_key
from core.model import Company, PayrollRun, Payslip, User
from core.step_up import require_step_up_token
from schema.payroll_schema import (
    PayrollRunCreate,
    PayrollRunRead,
    PayrollRunSummary,
    PayslipRead,
)
from services import payroll_engine, payroll_rules


router = APIRouter(tags=["Payroll"])


# ---------------------------------------------------------------------------
# M5 — overtime previews (worker-facing + employer-facing)
# ---------------------------------------------------------------------------


@router.get("/overtime/preview-shift")
def preview_shift_pay(
    private_user_id: int = Query(...),
    shift_date: str = Query(..., description="ISO date YYYY-MM-DD"),
    start_hhmm: str = Query(..., description="local start, HH:MM"),
    end_hhmm: str = Query(..., description="local end, HH:MM"),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Project the pay buckets for a *hypothetical* shift, using the worker's
    actual same-week clock-ins for accurate weekly-threshold context. Lets a
    worker see 'if I take this Saturday shift, it pays 2× rest-day' before
    accepting it."""
    from datetime import date as _date, datetime as _dt, time as _time, timedelta as _td, timezone as _tz
    from core.model import PrivateUser, Job, Salary, TimeLog, PublicHoliday
    from services import overtime_engine

    target = db.query(PrivateUser).filter(PrivateUser.private_user_id == private_user_id).one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    # Worker sees own; admin sees their company's.
    if current_user.user_id != target.user_id:
        if target.company_id is None:
            raise HTTPException(status_code=403, detail="Forbidden")
        _require_admin_for_company(current_user, target.company_id, db, permission="view_overtime")

    company = db.query(Company).filter(Company.company_id == target.company_id).one_or_none()
    if company is None:
        raise HTTPException(status_code=400, detail="Employee has no company")
    try:
        d = _date.fromisoformat(shift_date)
        sh, sm = [int(x) for x in start_hhmm.split(":")]
        eh, em = [int(x) for x in end_hhmm.split(":")]
    except (ValueError, IndexError):
        raise HTTPException(status_code=400, detail="Bad date/time format")

    rule = payroll_rules.resolve_overtime_rule(db, company.country_code, d)
    job, salary = payroll_engine._active_job_with_salary(db, private_user_id)  # noqa: SLF001
    if salary is None or salary.hourly_rate is None:
        raise HTTPException(status_code=400, detail="Preview only for hourly-paid employees")

    tz = getattr(company, "timezone", None) or "Indian/Mauritius"
    import zoneinfo
    z = zoneinfo.ZoneInfo(tz)
    start_local = _dt.combine(d, _time(sh, sm), tzinfo=z)
    end_local = _dt.combine(d, _time(eh, em), tzinfo=z)
    if end_local <= start_local:
        end_local += _td(days=1)

    # Same-week actual logs for accumulator context (Mon-anchored week).
    week_start = d - _td(days=d.isoweekday() - 1)
    existing = (
        db.query(TimeLog)
        .filter(TimeLog.private_user_id == private_user_id)
        .filter(TimeLog.start_time >= _dt.combine(week_start, _time.min, tzinfo=_tz.utc))
        .filter(TimeLog.start_time < _dt.combine(d, _time.min, tzinfo=_tz.utc))
        .all()
    )
    logs = [
        overtime_engine.BucketerTimeLog(
            timelog_id=t.timelog_id, start_utc=t.start_time, end_utc=t.end_time,
            is_overtime=bool(t.is_overtime), overtime_confirmed=bool(t.overtime_confirmed_by_employer),
        )
        for t in existing if t.start_time and t.end_time
    ]
    logs.append(overtime_engine.BucketerTimeLog(
        timelog_id=-1, start_utc=start_local.astimezone(zoneinfo.ZoneInfo("UTC")),
        end_utc=end_local.astimezone(zoneinfo.ZoneInfo("UTC")),
        is_overtime=False, overtime_confirmed=False,
    ))
    holidays = frozenset(
        (h.observed_date or h.date)
        for h in db.query(PublicHoliday)
        .filter(PublicHoliday.country_code == company.country_code)
        .filter(PublicHoliday.date >= week_start).filter(PublicHoliday.date <= d).all()
    )
    # A shift that crosses midnight (e.g. 22:00–06:00) emits slices on both the
    # start date and the next day. The bucketer drops slices whose observed_date
    # lies outside [period_start, period_end], so the window must extend to the
    # shift's *local* end date — otherwise the post-midnight hours vanish and an
    # overnight shift is badly under-priced. end_local is already in company tz.
    buckets, _flags = overtime_engine.bucket(
        logs=logs, breaks_by_log={}, rule=rule, holidays_by_observed_date=holidays,
        period_start=d, period_end=end_local.date(),
        weekly_rest_day_dow=int(getattr(job, "weekly_rest_day_dow", 7) or 7),
        contracted_hours_per_week=getattr(job, "contracted_hours_per_week", None),
        overtime_eligibility=getattr(job, "overtime_eligibility", "HOURLY") or "HOURLY",
        monthly_basic=None, company_timezone=tz,
    )
    rate = Decimal(salary.hourly_rate)
    rows = [
        {
            "code": b.code, "label": payroll_engine._bucket_label(b.code),  # noqa: SLF001
            "hours": str(b.hours), "multiplier": str(b.multiplier),
            "amount": str(b.amount(rate)),
        }
        for b in buckets
    ]
    total = sum((b.amount(rate) for b in buckets), Decimal("0.00"))
    return {"shift_date": shift_date, "currency": company_currency(db, company), "buckets": rows, "total": str(total)}


@router.get("/payroll/timelogs/{timelog_id}/overtime-cost-preview")
def overtime_cost_preview(
    timelog_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Wage impact of confirming this clock-in as overtime, for the company
    time-log approval row. Buckets the shift in its real same-week context
    (so the weekly-threshold tier is accurate) and reports the pay it adds
    plus the premium above base rate.

    Admin-only: only someone who can confirm OT should see its cost."""
    from datetime import datetime as _dt, time as _time, timedelta as _td, timezone as _tz
    from core.model import PrivateUser, TimeLog, PublicHoliday
    from services import overtime_engine

    log = db.query(TimeLog).filter(TimeLog.timelog_id == timelog_id).one_or_none()
    if log is None:
        raise HTTPException(status_code=404, detail="Time log not found")
    if not log.start_time or not log.end_time:
        raise HTTPException(status_code=400, detail="Time log has no start/end")
    target = db.query(PrivateUser).filter(PrivateUser.private_user_id == log.private_user_id).one_or_none()
    if target is None or target.company_id is None:
        raise HTTPException(status_code=400, detail="Time log has no company employee")
    _require_admin_for_company(current_user, target.company_id, db, permission="view_overtime")

    company = db.query(Company).filter(Company.company_id == target.company_id).one_or_none()
    rule = payroll_rules.resolve_overtime_rule(db, company.country_code, log.start_time.date())
    job, salary = payroll_engine._active_job_with_salary(db, log.private_user_id)  # noqa: SLF001
    if salary is None or salary.hourly_rate is None:
        raise HTTPException(status_code=400, detail="Preview only for hourly-paid employees")

    tz = getattr(company, "timezone", None) or "Indian/Mauritius"
    import zoneinfo
    d = log.start_time.date()
    # A clock-in that crosses midnight emits slices on the next day too. The
    # bucketer drops slices whose observed_date lies outside [period_start,
    # period_end], so the window must reach the shift's *local* end date or the
    # post-midnight hours — and the OT cost they carry — silently vanish.
    period_end = log.end_time.astimezone(zoneinfo.ZoneInfo(tz)).date()
    week_start = d - _td(days=d.isoweekday() - 1)
    # Same-week sibling logs for accumulator context, excluding this one.
    siblings = (
        db.query(TimeLog)
        .filter(TimeLog.private_user_id == log.private_user_id)
        .filter(TimeLog.timelog_id != timelog_id)
        .filter(TimeLog.start_time >= _dt.combine(week_start, _time.min, tzinfo=_tz.utc))
        .filter(TimeLog.start_time <= log.start_time)
        .all()
    )
    logs = [
        overtime_engine.BucketerTimeLog(
            timelog_id=t.timelog_id, start_utc=t.start_time, end_utc=t.end_time,
            is_overtime=bool(t.is_overtime), overtime_confirmed=bool(t.overtime_confirmed_by_employer),
        )
        for t in siblings if t.start_time and t.end_time
    ]
    # This log, forced as confirmed OT — the scenario we're costing.
    logs.append(overtime_engine.BucketerTimeLog(
        timelog_id=timelog_id, start_utc=log.start_time, end_utc=log.end_time,
        is_overtime=True, overtime_confirmed=True,
    ))
    holidays = frozenset(
        (h.observed_date or h.date)
        for h in db.query(PublicHoliday)
        .filter(PublicHoliday.country_code == company.country_code)
        .filter(PublicHoliday.date >= week_start).filter(PublicHoliday.date <= d).all()
    )
    buckets, _flags = overtime_engine.bucket(
        logs=logs, breaks_by_log={}, rule=rule, holidays_by_observed_date=holidays,
        period_start=d, period_end=period_end,
        weekly_rest_day_dow=int(getattr(job, "weekly_rest_day_dow", 7) or 7),
        contracted_hours_per_week=getattr(job, "contracted_hours_per_week", None),
        overtime_eligibility=getattr(job, "overtime_eligibility", "HOURLY") or "HOURLY",
        monthly_basic=None, company_timezone=tz,
    )
    rate = Decimal(salary.hourly_rate)
    # Only buckets sourced from this clock-in count toward "what confirming adds".
    mine = [b for b in buckets if timelog_id in (b.source_timelog_ids or [])]
    rows = []
    added_total = Decimal("0.00")
    premium_above_base = Decimal("0.00")
    for b in mine:
        amt = b.amount(rate)
        added_total += amt
        if b.multiplier and b.multiplier > 1:
            premium_above_base += (amt * (1 - 1 / b.multiplier))
        rows.append({
            "code": b.code, "label": payroll_engine._bucket_label(b.code),  # noqa: SLF001
            "hours": str(b.hours), "multiplier": str(b.multiplier), "amount": str(amt),
        })
    return {
        "timelog_id": timelog_id,
        "currency": company_currency(db, company),
        "buckets": rows,
        "added_total": str(added_total.quantize(Decimal("0.01"))),
        "premium_above_base": str(premium_above_base.quantize(Decimal("0.01"))),
    }


def company_currency(db: Session, company: Company) -> str:
    from core.model import Country
    c = db.query(Country).filter(Country.code == company.country_code).one_or_none()
    return c.currency if c and c.currency else "MUR"


# ---------------------------------------------------------------------------
# Authorization helper
# ---------------------------------------------------------------------------


def _require_admin_for_company(actor: User, company_id: int, db: Session, permission: Optional[str] = None) -> None:
    """Accepts platform admin, company owner, AND company admins via
    CompanyUserRole. When the RBAC flag is ON and a ``permission`` is given,
    enforces that fine-grained company permission instead (owner/admin bypass
    inside assert_company_permission); flag OFF ⇒ admin-only as today, so passing
    a permission is a no-op until the flag is flipped."""
    if permission:
        from core.permission_guards import company_rbac_enabled, assert_company_permission
        if company_rbac_enabled():
            assert_company_permission(actor, company_id, permission, db)
            return
    from core.auth_guards import require_company_admin
    require_company_admin(actor, company_id, db)


# ---------------------------------------------------------------------------
# Run endpoints
# ---------------------------------------------------------------------------


@router.post("/payroll/runs", response_model=PayrollRunRead, status_code=201)
def create_draft_run(
    payload: PayrollRunCreate,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin_for_company(current_user, payload.company_id, db, permission="manage_payroll")
    try:
        run = payroll_engine.create_draft_run(db, payload, actor_user_id=current_user.user_id)
    except payroll_rules.MissingOvertimeRule as e:
        # M2 fail-safe: silently applying base-rate-everything for an unseeded
        # country would be wage theft. Force the admin to seed first.
        raise HTTPException(
            status_code=422,
            detail={
                "code": "NO_OVERTIME_RULE_FOR_COUNTRY",
                "message": str(e),
                "country_code": e.country_code,
                "period_start": e.period_start.isoformat(),
                "remediation": "Run scripts/seed_overtime_rules_{country}.py or supersede an existing rule via the admin UI.",
            },
        )
    db.commit()
    db.refresh(run)
    return run


@router.post("/payroll/runs/{run_id}/finalize", response_model=PayrollRunRead)
def finalize_run(
    run_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    _idempotency_key: str = Depends(require_idempotency_key),
    _step_up: str = Depends(require_step_up_token("payroll_finalize")),
):
    run = db.query(PayrollRun).filter(PayrollRun.id == run_id).one_or_none()
    if run is None:
        raise HTTPException(status_code=404, detail=f"PayrollRun {run_id} not found")
    _require_admin_for_company(current_user, run.company_id, db, permission="finalize_payroll")
    finalized = payroll_engine.finalize_run(db, run_id, actor_user_id=current_user.user_id)
    db.commit()
    db.refresh(finalized)
    return finalized


@router.post("/payroll/runs/{run_id}/cancel", response_model=PayrollRunRead)
def cancel_run(
    run_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    run = db.query(PayrollRun).filter(PayrollRun.id == run_id).one_or_none()
    if run is None:
        raise HTTPException(status_code=404, detail=f"PayrollRun {run_id} not found")
    _require_admin_for_company(current_user, run.company_id, db, permission="manage_payroll")
    cancelled = payroll_engine.cancel_run(db, run_id)
    db.commit()
    db.refresh(cancelled)
    return cancelled


@router.post("/payroll/runs/{run_id}/redo", response_model=PayrollRunRead, status_code=201)
def redo_run(
    run_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Void a FINALIZED run and start a fresh draft for the same period.

    A finalized run is the frozen payroll record and can't be recomputed in
    place. When one came out wrong (e.g. zero pay because clock-ins weren't
    approved before finalizing), this cancels it — the old payslips are kept
    for audit, but the run stops being the source of truth and the period is
    freed — and immediately creates a new draft for the same company/period.
    The admin then fixes the data, re-runs, and re-finalizes.

    Cancel + create happen in one transaction so the period is never left
    without a run. Destructive: confirm on the client before calling.

    Redo is a dev/testing tool — the production correction path is a
    per-employee payslip correction, not voiding a whole run. Gated behind
    ENABLE_PAYROLL_REDO (default off) so it can't be used in production.
    """
    import os
    if os.getenv("ENABLE_PAYROLL_REDO", "false").strip().lower() not in ("1", "true", "yes", "on"):
        raise HTTPException(
            status_code=403,
            detail="Payroll Redo is a dev/testing tool and is disabled in this environment.",
        )
    run = db.query(PayrollRun).filter(PayrollRun.id == run_id).one_or_none()
    if run is None:
        raise HTTPException(status_code=404, detail=f"PayrollRun {run_id} not found")
    _require_admin_for_company(current_user, run.company_id, db, permission="manage_payroll")
    if run.status == "cancelled":
        raise HTTPException(status_code=409, detail="Run is already cancelled — start a new run instead.")

    # 1. Void the old run (flush so create's "non-cancelled run exists" guard
    #    sees the new status). 2. Recreate a draft for the same period.
    payroll_engine.cancel_run(db, run_id)
    db.flush()
    payload = PayrollRunCreate(
        company_id=run.company_id,
        period_start=run.period_start,
        period_end=run.period_end,
        notes=run.notes,
    )
    try:
        fresh = payroll_engine.create_draft_run(db, payload, actor_user_id=current_user.user_id)
    except payroll_rules.MissingOvertimeRule as e:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "NO_OVERTIME_RULE_FOR_COUNTRY",
                "message": str(e),
                "country_code": e.country_code,
                "period_start": e.period_start.isoformat(),
                "remediation": "Run scripts/seed_overtime_rules_{country}.py or supersede an existing rule via the admin UI.",
            },
        )
    db.commit()
    db.refresh(fresh)
    return fresh


@router.post("/payroll/runs/{run_id}/recompute", response_model=PayrollRunRead)
def recompute_run(
    run_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Re-run a single DRAFT in place against current data.

    Voids and rebuilds this run's payslips using the latest clock-ins,
    salaries, and rules — preserving the run id and period. Finalized runs
    are frozen and rejected (409). Used by the "Re-run" button on the
    payroll-runs dashboard so an admin can re-check pay after approving
    clock-ins / closing shifts / confirming overtime.
    """
    run = db.query(PayrollRun).filter(PayrollRun.id == run_id).one_or_none()
    if run is None:
        raise HTTPException(status_code=404, detail=f"PayrollRun {run_id} not found")
    _require_admin_for_company(current_user, run.company_id, db, permission="manage_payroll")
    try:
        recomputed = payroll_engine.recompute_draft_run(db, run_id, actor_user_id=current_user.user_id)
    except payroll_rules.MissingOvertimeRule as e:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "NO_OVERTIME_RULE_FOR_COUNTRY",
                "message": str(e),
                "country_code": e.country_code,
                "period_start": e.period_start.isoformat(),
                "remediation": "Run scripts/seed_overtime_rules_{country}.py or supersede an existing rule via the admin UI.",
            },
        )
    db.commit()
    db.refresh(recomputed)
    return recomputed


@router.post("/payroll/runs/{run_id}/payslips/{payslip_id}/adjustment", status_code=201)
def create_payslip_adjustment(
    run_id: int,
    payslip_id: int,
    body: dict = Body(default={}),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Correct ONE employee's finalized payslip — ledger-only.

    Recomputes the employee for the run's period against CURRENT data (after the
    employer fixed whatever was wrong) and, if it differs from the original,
    creates an ADJUSTMENT payslip holding the signed DELTA, linked to the
    immutable original (never mutated). The employer settles the actual money
    (top-up / claw-back) outside the app — there is no payment tracking yet.
    """
    from decimal import Decimal as _D
    from core.model import Payslip as _Payslip

    run = db.query(PayrollRun).filter(PayrollRun.id == run_id).one_or_none()
    if run is None:
        raise HTTPException(status_code=404, detail=f"PayrollRun {run_id} not found")
    _require_admin_for_company(current_user, run.company_id, db, permission="manage_payroll")
    if run.status != "finalized":
        raise HTTPException(status_code=409, detail="Corrections apply to a FINALIZED run. For a draft, use Re-run.")

    original = (
        db.query(_Payslip)
        .filter(_Payslip.id == payslip_id, _Payslip.payroll_run_id == run_id)
        .one_or_none()
    )
    if original is None:
        raise HTTPException(status_code=404, detail="Payslip not found in this run.")
    if original.is_adjustment:
        raise HTTPException(status_code=409, detail="Cannot correct an adjustment payslip directly; correct the original.")

    corrected = payroll_engine.recompute_employee_for_run(db, run, original.private_user_id)
    if corrected is None:
        raise HTTPException(status_code=422, detail="Employee resolves to no payslip for this period; nothing to correct.")

    def _d(v):
        return _D(str(v if v is not None else 0))

    money_fields = [
        "gross", "taxable_income", "paye", "bonus", "allowances_total",
        "deductions_total", "loan_repayments", "leave_impact", "net_pay",
    ]

    # Double-correction guard. Each adjustment holds a signed DELTA, so the
    # payslip's current effective value is the original plus every adjustment
    # already booked against it. We net the recompute against that effective
    # state — not the bare original — so re-clicking with no data change yields
    # a zero delta (no_change, idempotent), and a genuine follow-up correction
    # books only its incremental difference rather than re-applying the whole
    # gap on top of a correction that already landed.
    prior_adjustments = (
        db.query(_Payslip)
        .filter(_Payslip.parent_payslip_id == original.id, _Payslip.is_adjustment.is_(True))
        .all()
    )

    def _effective(field):
        base = _d(getattr(original, field))
        for adj in prior_adjustments:
            base += _d(getattr(adj, field))
        return base

    deltas = {
        f: (_d(corrected.get(f)) - _effective(f)).quantize(_D("0.01"))
        for f in money_fields
    }

    def _effective_stat(attr):
        merged: dict = {}
        for src in [getattr(original, attr)] + [getattr(a, attr) for a in prior_adjustments]:
            for k, v in (src or {}).items():
                merged[k] = merged.get(k, _D("0")) + _d(v)
        return merged

    def _stat_delta(new_map, old_map):
        out = {}
        for k in set((new_map or {}).keys()) | set((old_map or {}).keys()):
            d = (_d((new_map or {}).get(k)) - _d((old_map or {}).get(k))).quantize(_D("0.01"))
            if d != 0:
                out[k] = str(d)
        return out

    stat_ee = _stat_delta(corrected.get("statutory_employee"), _effective_stat("statutory_employee"))
    stat_er = _stat_delta(corrected.get("statutory_employer"), _effective_stat("statutory_employer"))

    if all(v == 0 for v in deltas.values()) and not stat_ee and not stat_er:
        return {
            "status": "no_change",
            "message": (
                "Recompute matches the payslip's current settled value "
                f"({len(prior_adjustments)} prior adjustment(s)) — no adjustment created."
            ),
        }

    # Before/after diff so the employer reviews exactly what's changing and
    # confirms it — a conscious decision, not a blind one-click. Only the
    # fields that actually moved are surfaced.
    current_net = _effective("net_pay")
    settled_net = (current_net + deltas["net_pay"]).quantize(_D("0.01"))
    diff = {
        f: {
            "was": str(_effective(f).quantize(_D("0.01"))),
            "now": str(_d(corrected.get(f)).quantize(_D("0.01"))),
            "delta": str(deltas[f]),
        }
        for f in money_fields
        if deltas[f] != 0
    }

    # preview=true → compute and return the diff WITHOUT booking the adjustment,
    # notifying the employee, or generating a PDF. The client shows this for
    # confirmation, then re-POSTs with preview omitted to actually apply it.
    if body.get("preview"):
        return {
            "status": "preview",
            "original_payslip_id": original.id,
            "prior_adjustments": len(prior_adjustments),
            "diff": diff,
            "statutory_employee": stat_ee,
            "statutory_employer": stat_er,
            "net_delta": str(deltas["net_pay"]),
            "current_net_pay": str(current_net.quantize(_D("0.01"))),
            "settled_net_pay": str(settled_net),
            "currency": original.currency,
        }

    adjustment = _Payslip(
        payroll_run_id=run.id,
        private_user_id=original.private_user_id,
        job_id=original.job_id,
        is_adjustment=True,
        parent_payslip_id=original.id,
        adjustment_reason=(body.get("reason") or None),
        currency=original.currency,
        statutory_employee=stat_ee or None,
        statutory_employer=stat_er or None,
        components=[{
            "code": "ADJUSTMENT",
            "label": "Payslip correction",
            "kind": "earning" if deltas["net_pay"] >= 0 else "deduction",
            "category": "adjustment",
            "amount": str(deltas["net_pay"]),
            # Required by the PayslipComponent schema — without these the
            # adjustment payslip fails read-time validation (500 on every
            # get/list). It's a net settlement line, not a taxable earning;
            # the tax/statutory deltas live in their own fields above.
            "is_taxable": False,
            "is_basic": False,
            "source": "adjustment",
        }],
        **{f: deltas[f] for f in money_fields},
    )
    db.add(adjustment)
    db.commit()
    db.refresh(adjustment)

    # Render the Correction Note PDF now so the download button appears on both
    # clients (they gate on pdf_url). Best-effort — the ledger row is the
    # source of truth; a render failure is regenerated on demand by the PDF
    # endpoint and must never undo a committed correction.
    try:
        from jobs import payslip_pdf
        payslip_pdf.generate_for_payslip(db, adjustment.id)
        db.commit()
        db.refresh(adjustment)
    except Exception:
        db.rollback()

    # Tell the employee their finalized payslip changed — the correction is
    # invisible to them otherwise (the adjustment row shows in their list, but
    # nothing surfaces it). Best-effort: never let a notification failure undo
    # a committed correction. The service commits its own session.
    from services.notification_service import NotificationService
    NotificationService.notify_employee_payslip_corrected(
        db,
        private_user_id=original.private_user_id,
        adjustment=adjustment,
        original=original,
        period_label=run.period_start.strftime("%B %Y"),
        currency=original.currency,
    )

    # Tie the correction back to any open dispute it resolves: record it on the
    # dispute thread and advance the status where the state machine allows, so
    # corrected disputes don't sit "open" forever. Best-effort.
    dispute_updates = 0
    try:
        from core.model import UserRight
        from core.concern_states import ConcernStatus
        linked = (
            db.query(UserRight)
            .filter(
                UserRight.payslip_id == original.id,
                UserRight.status.notin_(["resolved", "rejected", "closed"]),
            )
            .all()
        )
        note = (
            f"Payslip correction applied: net Δ {deltas['net_pay']} {original.currency} "
            f"(adjustment payslip #{adjustment.id})."
        )
        for ur in linked:
            ur.internal_notes = f"{ur.internal_notes}\n{note}" if ur.internal_notes else note
            # Only a transition the state machine permits (investigating → action_taken).
            if ur.status == ConcernStatus.INVESTIGATING.value:
                ur.status = ConcernStatus.ACTION_TAKEN.value
            dispute_updates += 1
        if linked:
            db.commit()
    except Exception:
        db.rollback()

    return {
        "status": "adjusted",
        "adjustment_payslip_id": adjustment.id,
        "original_payslip_id": original.id,
        "delta": {
            **{f: str(deltas[f]) for f in money_fields},
            "statutory_employee": stat_ee,
            "statutory_employer": stat_er,
        },
        "settled_net_pay": str((_effective("net_pay") + deltas["net_pay"]).quantize(_D("0.01"))),
        "linked_disputes_updated": dispute_updates,
        "note": "Ledger record only — settle the delta with the employee outside the app.",
    }


@router.post("/payroll/runs/recompute-drafts")
def recompute_draft_runs(
    company_id: int = Query(...),
    period_overlap_after: Optional[str] = Query(None, description="ISO date; only recompute drafts whose period_end >= this"),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """M6 — recompute open DRAFT runs after a country rule was corrected.

    Voids each matching draft's payslips and recreates them with the
    current snapshot. Finalized runs are NEVER touched (they're frozen by
    snapshot). Returns per-run results.
    """
    _require_admin_for_company(current_user, company_id, db, permission="manage_payroll")
    from datetime import date as _date
    q = (
        db.query(PayrollRun)
        .filter(PayrollRun.company_id == company_id)
        .filter(PayrollRun.status == "draft")
    )
    if period_overlap_after:
        try:
            cutoff = _date.fromisoformat(period_overlap_after)
        except ValueError:
            raise HTTPException(status_code=400, detail="period_overlap_after must be ISO date")
        q = q.filter(PayrollRun.period_end >= cutoff)

    drafts = q.all()
    results = []
    for run in drafts:
        recreated = payroll_engine.recompute_draft_run(db, run.id, actor_user_id=current_user.user_id)
        results.append({"run_id": run.id, "payslips": len(recreated.payslips)})
    db.commit()
    return {"recomputed": len(results), "runs": results}


@router.get("/payroll/runs", response_model=List[PayrollRunSummary])
def list_runs(
    company_id: int = Query(...),
    status: Optional[str] = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin_for_company(current_user, company_id, db, permission="view_payslip")

    # A3 — single grouped query joining each PayrollRun to its aggregated
    # payslip count + sum. Outer join so runs with zero payslips still appear.
    payslip_count = func.count(Payslip.id).label("payslip_count")
    payslip_net = func.coalesce(func.sum(Payslip.net_pay), 0).label("payslip_net")

    q = (
        db.query(PayrollRun, payslip_count, payslip_net)
        .outerjoin(Payslip, Payslip.payroll_run_id == PayrollRun.id)
        .filter(PayrollRun.company_id == company_id)
    )
    if status:
        q = q.filter(PayrollRun.status == status)
    q = (
        q.group_by(PayrollRun.id)
        .order_by(desc(PayrollRun.period_start))
        .limit(limit)
        .offset(offset)
    )

    rows = q.all()

    # Resolve the `u<id>:` prefixes in the flags to employee names in ONE query
    # (across all runs) so the UI can say WHICH employee each warning is about.
    import re as _re
    from core.model import PrivateUser as _PU
    pid_re = _re.compile(r"^u(\d+):")
    all_pids: set[int] = set()
    for r, _c, _n in rows:
        for f in (r.compliance_flags or []):
            m = pid_re.match(f)
            if m:
                all_pids.add(int(m.group(1)))
    names: dict[int, str] = {}
    if all_pids:
        for pu in db.query(_PU).filter(_PU.private_user_id.in_(all_pids)).all():
            names[pu.private_user_id] = f"{pu.first_name or ''} {pu.last_name or ''}".strip() or f"Employee #{pu.private_user_id}"

    return [
        PayrollRunSummary(
            id=r.id,
            company_id=r.company_id,
            period_start=r.period_start,
            period_end=r.period_end,
            status=r.status,
            currency=r.currency,
            payslip_count=count or 0,
            total_net=Decimal(net or 0),
            warning_count=len(r.compliance_flags or []),
            warnings=list(r.compliance_flags or []),
            warning_subjects={
                str(pid): names[pid]
                for f in (r.compliance_flags or [])
                if (m := pid_re.match(f)) and (pid := int(m.group(1))) in names
            },
            finalized_at=r.finalized_at,
            created_at=r.created_at,
        )
        for r, count, net in rows
    ]


@router.get("/payroll/runs/{run_id}", response_model=PayrollRunRead)
def get_run(
    run_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    run = db.query(PayrollRun).filter(PayrollRun.id == run_id).one_or_none()
    if run is None:
        raise HTTPException(status_code=404, detail=f"PayrollRun {run_id} not found")
    _require_admin_for_company(current_user, run.company_id, db, permission="view_payslip")

    out = PayrollRunRead.model_validate(run)
    # Batch-resolve employee name/code for every embedded payslip in one
    # query — the run-level ORM relationship has no employee_name/code
    # column to fall back on, and _enrich_payslip's per-payslip version
    # (also computing a leave-balance) would be wasteful N+1 here.
    from core.model import PrivateUser as _PU
    private_user_ids = {p.private_user_id for p in run.payslips}
    if private_user_ids:
        rows = (
            db.query(_PU.private_user_id, _PU.first_name, _PU.last_name, _PU.employee_code)
            .filter(_PU.private_user_id.in_(private_user_ids))
            .all()
        )
        by_id = {r[0]: r for r in rows}
        for ps in out.payslips:
            row = by_id.get(ps.private_user_id)
            if row is not None:
                ps.employee_name = f"{row[1] or ''} {row[2] or ''}".strip() or None
                ps.employee_code = row[3]
    return out


@router.get("/payroll/runs/{run_id}/export.csv")
def export_run_csv(
    run_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Download a FINALIZED payroll run as CSV: one row per payslip (money
    fields) with a dynamic column per statutory code (employee & employer),
    plus a TOTALS row. Gated on `export_payroll`."""
    import csv, io
    from decimal import Decimal as _D
    from fastapi.responses import Response
    from core.model import PrivateUser as _PU

    run = db.query(PayrollRun).filter(PayrollRun.id == run_id).one_or_none()
    if run is None:
        raise HTTPException(status_code=404, detail=f"PayrollRun {run_id} not found")
    _require_admin_for_company(current_user, run.company_id, db, permission="export_payroll")
    if run.status != "finalized":
        raise HTTPException(
            status_code=409,
            detail={
                "code": "RUN_NOT_FINALIZED",
                "message": "Payroll run is still a draft. Finalize it to export.",
                "run_status": run.status,
            },
        )

    payslips = list(run.payslips or [])
    names = {
        pu.private_user_id: f"{pu.first_name or ''} {pu.last_name or ''}".strip()
        for pu in db.query(_PU).filter(
            _PU.private_user_id.in_({p.private_user_id for p in payslips} or {0})
        ).all()
    }

    # Dynamic statutory columns = sorted union of codes across payslips, with
    # employee and employer kept as separate columns (e.g. CSG_EE vs CSG_ER).
    ee_codes, er_codes = set(), set()
    for p in payslips:
        ee_codes.update((p.statutory_employee or {}).keys())
        er_codes.update((p.statutory_employer or {}).keys())
    ee_cols, er_cols = sorted(ee_codes), sorted(er_codes)

    money_fields = [
        ("Gross", "gross"), ("Taxable Income", "taxable_income"), ("PAYE", "paye"),
        ("Bonus", "bonus"), ("Allowances", "allowances_total"),
        ("Deductions", "deductions_total"), ("Loan Repayments", "loan_repayments"),
        ("Leave Impact", "leave_impact"), ("Net Pay", "net_pay"),
    ]
    header = (
        ["Employee", "Period Start", "Period End", "Currency"]
        + [label for label, _ in money_fields]
        + ee_cols + er_cols
    )

    def _d(v):
        try:
            return _D(str(v if v is not None else 0))
        except Exception:
            return _D("0")

    def _fmt(v):
        return str(_d(v).quantize(_D("0.01")))

    totals = {label: _D("0") for label, _ in money_fields}
    ee_totals = {c: _D("0") for c in ee_cols}
    er_totals = {c: _D("0") for c in er_cols}

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    for p in sorted(payslips, key=lambda ps: names.get(ps.private_user_id, "").lower()):
        row = [
            names.get(p.private_user_id, f"#{p.private_user_id}"),
            run.period_start.isoformat(),
            run.period_end.isoformat(),
            p.currency or run.currency,
        ]
        for label, attr in money_fields:
            v = getattr(p, attr, None)
            totals[label] += _d(v)
            row.append(_fmt(v))
        for c in ee_cols:
            v = (p.statutory_employee or {}).get(c)
            ee_totals[c] += _d(v)
            row.append(_fmt(v))
        for c in er_cols:
            v = (p.statutory_employer or {}).get(c)
            er_totals[c] += _d(v)
            row.append(_fmt(v))
        w.writerow(row)

    total_row = ["TOTALS", "", "", ""]
    total_row += [_fmt(totals[label]) for label, _ in money_fields]
    total_row += [_fmt(ee_totals[c]) for c in ee_cols]
    total_row += [_fmt(er_totals[c]) for c in er_cols]
    w.writerow(total_row)

    filename = f"payroll_{run.company_id}_{run.period_start.isoformat()}_{run.period_end.isoformat()}.csv"
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/payroll/runs/{run_id}/payslips.zip")
def export_run_payslips_zip(
    run_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Download all payslip PDFs for a FINALIZED run as a single ZIP.
    Resolves each PDF like `stream_payslip_pdf` (local file or remote URL),
    regenerating a missing one once. Gated on `export_payroll`."""
    import io, os, urllib.request, zipfile
    from fastapi.responses import Response
    from core.model import PrivateUser as _PU

    run = db.query(PayrollRun).filter(PayrollRun.id == run_id).one_or_none()
    if run is None:
        raise HTTPException(status_code=404, detail=f"PayrollRun {run_id} not found")
    _require_admin_for_company(current_user, run.company_id, db, permission="export_payroll")
    if run.status != "finalized":
        raise HTTPException(
            status_code=409,
            detail={
                "code": "RUN_NOT_FINALIZED",
                "message": "Finalize the run to export payslips.",
                "run_status": run.status,
            },
        )

    payslips = list(run.payslips or [])
    names = {
        pu.private_user_id: f"{pu.first_name or ''} {pu.last_name or ''}".strip()
        for pu in db.query(_PU).filter(
            _PU.private_user_id.in_({p.private_user_id for p in payslips} or {0})
        ).all()
    }
    backend_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    def _pdf_bytes(ps) -> Optional[bytes]:
        def _read():
            if not ps.pdf_url:
                return None
            if ps.pdf_url.startswith("http://") or ps.pdf_url.startswith("https://"):
                try:
                    with urllib.request.urlopen(ps.pdf_url, timeout=30) as r:
                        return r.read()
                except Exception:
                    return None
            abs_path = os.path.join(backend_root, ps.pdf_url.lstrip("/"))
            if os.path.exists(abs_path):
                with open(abs_path, "rb") as f:
                    return f.read()
            return None

        data = _read()
        if data is None:
            try:
                from jobs import payslip_pdf
                payslip_pdf.generate_for_payslip(db, ps.id)
                db.commit()
                db.refresh(ps)
                data = _read()
            except Exception:
                data = None
        return data

    buf = io.BytesIO()
    included = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for ps in payslips:
            pdf = _pdf_bytes(ps)
            if pdf is None:
                continue
            base = names.get(ps.private_user_id, f"employee_{ps.private_user_id}") or f"employee_{ps.private_user_id}"
            safe = "".join(c if c.isalnum() or c in " -_" else "_" for c in base).strip() or f"employee_{ps.private_user_id}"
            zf.writestr(f"{safe}_payslip_{ps.id}.pdf", pdf)
            included += 1

    if included == 0:
        raise HTTPException(status_code=503, detail="No payslip PDFs could be generated for this run.")

    filename = f"payslips_{run.period_start.isoformat()}_{run.period_end.isoformat()}.zip"
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Payslip endpoints
# ---------------------------------------------------------------------------


def _enrich_payslip(ps: Payslip, db: Session) -> PayslipRead:
    """Read-time enrichment: attach employer name + BRN + pay period
    pulled from the (still-mutable) Company and PayrollRun rows. The
    payslip's own components/statutory JSONB and hash_sha256 remain the
    immutable record; these fields are convenience for renderers."""
    run = db.query(PayrollRun).filter(PayrollRun.id == ps.payroll_run_id).one_or_none()
    company = (
        db.query(Company).filter(Company.company_id == run.company_id).one_or_none()
        if run is not None else None
    )
    out = PayslipRead.model_validate(ps)
    if run is not None:
        out.period_start = run.period_start
        out.period_end = run.period_end
        out.run_status = run.status
        out.finalized_at = run.finalized_at
        # Pull this employee's flags out of the run-level list (entries are
        # prefixed `u{private_user_id}:` by create_draft_run) and strip the
        # prefix so the viewer can explain a zero/odd payslip.
        prefix = f"u{ps.private_user_id}:"
        out.flags = [
            f[len(prefix):] for f in (run.compliance_flags or [])
            if isinstance(f, str) and f.startswith(prefix)
        ] or None
        # Year-to-date leave balance guide for the period's year. Best-effort —
        # an employee with no derivable allowance just has no balance section.
        try:
            from services.leave_balance import compute_leave_balance
            bal = compute_leave_balance(db, ps.private_user_id, run.period_end.year)
            out.leave_balance = bal.get("balances") or None
        except Exception:
            out.leave_balance = None
    if company is not None:
        out.employer_name = company.company_name
        out.employer_brn = company.brn
    # Resolve the employee's display name so the viewer can show who it's about.
    from core.model import PrivateUser as _PU
    pu = db.query(_PU).filter(_PU.private_user_id == ps.private_user_id).one_or_none()
    if pu is not None:
        out.employee_name = f"{pu.first_name or ''} {pu.last_name or ''}".strip() or None
        out.employee_code = pu.employee_code
    # Branch/site name for the payslip — resolved from the SNAPSHOTTED
    # home_geofence_id so a mid-period transfer or a renamed site never
    # rewrites what the payslip said at run time.
    if ps.home_geofence_id is not None:
        from core.model import CompanyGeofence as _CG
        site = db.query(_CG).filter(_CG.geofence_id == ps.home_geofence_id).one_or_none()
        out.home_site_name = site.name if site is not None else None
    return out


@router.get("/payslips/{payslip_id}", response_model=PayslipRead)
def get_payslip(
    payslip_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    ps = db.query(Payslip).filter(Payslip.id == payslip_id).one_or_none()
    if ps is None:
        raise HTTPException(status_code=404, detail=f"Payslip {payslip_id} not found")
    # Employees can read their own payslips; admins for the company can read all.
    if current_user.user_id != ps.private_user.user_id:
        run = db.query(PayrollRun).filter(PayrollRun.id == ps.payroll_run_id).one()
        _require_admin_for_company(current_user, run.company_id, db, permission="view_payslip")
    return _enrich_payslip(ps, db)


@router.get("/payslips/employee/{private_user_id}", response_model=List[PayslipRead])
def list_employee_payslips(
    private_user_id: int,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    from core.model import PrivateUser
    target = db.query(PrivateUser).filter(PrivateUser.private_user_id == private_user_id).one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail=f"PrivateUser {private_user_id} not found")
    is_self = current_user.user_id == target.user_id
    if not is_self:
        # Not the employee themselves — must be an admin for the employee's company.
        if target.company_id is None:
            raise HTTPException(status_code=403, detail="Forbidden")
        _require_admin_for_company(current_user, target.company_id, db, permission="view_payslip")

    query = db.query(Payslip).filter(Payslip.private_user_id == private_user_id)
    if is_self:
        # Employees only ever see FINALIZED payslips. Draft-run payslips are an
        # internal admin artifact whose figures still move (clock-in approvals,
        # flag corrections, recompute) before finalization — surfacing them
        # unlabelled invites "the app said I'd get X" disputes. Pre-final numbers
        # have a dedicated, watermarked channel (the estimated payslip). Admins
        # viewing an employee keep full visibility (drafts included).
        query = query.join(PayrollRun, PayrollRun.id == Payslip.payroll_run_id).filter(
            PayrollRun.status == "finalized"
        )

    rows = (
        query
        .order_by(desc(Payslip.created_at))
        .limit(limit)
        .offset(offset)
        .all()
    )
    return [_enrich_payslip(p, db) for p in rows]


@router.get("/payslips/{payslip_id}/pdf")
def stream_payslip_pdf(
    payslip_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Stream the rendered payslip PDF. Authenticated — same access rules
    as GET /payslips/{id}. Local-storage paths (`/uploads/...`) are read
    off disk; remote URLs (S3 https://...) are 302-redirected so the
    client downloads directly from the CDN."""
    from fastapi.responses import FileResponse, RedirectResponse
    import os

    ps = db.query(Payslip).filter(Payslip.id == payslip_id).one_or_none()
    if ps is None:
        raise HTTPException(status_code=404, detail=f"Payslip {payslip_id} not found")
    run = db.query(PayrollRun).filter(PayrollRun.id == ps.payroll_run_id).one()
    if current_user.user_id != ps.private_user.user_id:
        _require_admin_for_company(current_user, run.company_id, db, permission="view_payslip")

    # Estimated (draft) payslips are not downloadable. The official PDF
    # is only minted after the run is finalized — clients should hide
    # the download button when run_status != 'finalized'.
    if run.status != "finalized":
        raise HTTPException(
            status_code=409,
            detail={
                "code": "PAYSLIP_NOT_FINALIZED",
                "message": "Payslip is still an estimate. Finalize the payroll run to enable download.",
                "run_status": run.status,
            },
        )

    def _regen_and_reload() -> None:
        """Regenerate the PDF on demand. Used when pdf_url is null
        (run finalized before M21 PDF gen, or generation previously
        failed) OR when the file is missing on disk (volume wiped, S3
        object deleted). Updates ps.pdf_url + commits."""
        from jobs import payslip_pdf
        payslip_pdf.generate_for_payslip(db, ps.id)
        db.commit()
        db.refresh(ps)

    if not ps.pdf_url:
        _regen_and_reload()
        if not ps.pdf_url:
            raise HTTPException(
                status_code=503,
                detail="PDF could not be generated. Check backend logs for the WeasyPrint error.",
            )

    # S3 / external URL → 302 to the CDN; client downloads directly.
    if ps.pdf_url.startswith("http://") or ps.pdf_url.startswith("https://"):
        return RedirectResponse(url=ps.pdf_url, status_code=302)

    # Local storage — pdf_url is a path like "/uploads/payslips/.../X.pdf".
    # Translate to the on-disk path under the backend's working dir.
    backend_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # api/v1 → api → backend
    backend_root = os.path.dirname(backend_root)  # → backend root

    def _abs_from_rel(rel_url: str) -> str:
        return os.path.join(backend_root, rel_url.lstrip("/"))

    abs_path = _abs_from_rel(ps.pdf_url)
    if not os.path.exists(abs_path):
        # File vanished from disk (volume wiped on rebuild, etc.). Regen.
        _regen_and_reload()
        abs_path = _abs_from_rel(ps.pdf_url) if ps.pdf_url else abs_path
        if not os.path.exists(abs_path):
            raise HTTPException(
                status_code=503,
                detail="PDF file missing on server and regeneration failed.",
            )

    filename = f"payslip_{payslip_id}.pdf"
    return FileResponse(
        abs_path,
        media_type="application/pdf",
        filename=filename,
    )


def _remittance_data(db: Session, company_id: int, year: int, month: int) -> dict:
    """Statutory remittance totals for a month — the PAYE / CSG / NSF an employer
    must remit. Aggregates every FINALIZED-run payslip whose period falls in the
    month, including adjustments (signed) so corrections are reflected. Pure;
    no auth (callers gate)."""
    from calendar import monthrange
    from datetime import date as _date
    from decimal import Decimal as _D
    from core.model import PrivateUser as _PU

    start = _date(year, month, 1)
    end = _date(year, month, monthrange(year, month)[1])
    runs = (
        db.query(PayrollRun)
        .filter(
            PayrollRun.company_id == company_id,
            PayrollRun.status == "finalized",
            PayrollRun.period_start <= end,
            PayrollRun.period_end >= start,
        )
        .all()
    )
    run_ids = [r.id for r in runs]
    currency = runs[0].currency if runs else "MUR"
    payslips = (
        db.query(Payslip).filter(Payslip.payroll_run_id.in_(run_ids)).all() if run_ids else []
    )

    def _d(v):
        try:
            return _D(str(v if v is not None else 0))
        except Exception:
            return _D("0")

    paye_total = sum((_d(p.paye) for p in payslips), _D("0"))
    # base statutory code (CSG_EE → CSG) → {employee, employer}
    stat: dict = {}
    for p in payslips:
        for code, amt in (p.statutory_employee or {}).items():
            base = code.rsplit("_", 1)[0]
            stat.setdefault(base, {"employee": _D("0"), "employer": _D("0")})["employee"] += _d(amt)
        for code, amt in (p.statutory_employer or {}).items():
            base = code.rsplit("_", 1)[0]
            stat.setdefault(base, {"employee": _D("0"), "employer": _D("0")})["employer"] += _d(amt)

    statutory = [
        {
            "code": k,
            "employee": str(v["employee"].quantize(_D("0.01"))),
            "employer": str(v["employer"].quantize(_D("0.01"))),
            "total": str((v["employee"] + v["employer"]).quantize(_D("0.01"))),
        }
        for k, v in sorted(stat.items())
    ]
    stat_grand = sum((v["employee"] + v["employer"] for v in stat.values()), _D("0"))
    grand_total = (paye_total + stat_grand).quantize(_D("0.01"))

    # Per-employee breakdown (drives the CSV). Names resolved in one query.
    names = {
        pu.private_user_id: f"{pu.first_name} {pu.last_name}".strip()
        for pu in db.query(_PU).filter(
            _PU.private_user_id.in_({p.private_user_id for p in payslips} or {0})
        ).all()
    }
    per_emp: dict = {}
    for p in payslips:
        row = per_emp.setdefault(p.private_user_id, {"name": names.get(p.private_user_id, f"#{p.private_user_id}"), "paye": _D("0"), "stat": {}})
        row["paye"] += _d(p.paye)
        for code, amt in (p.statutory_employee or {}).items():
            row["stat"][code] = row["stat"].get(code, _D("0")) + _d(amt)
        for code, amt in (p.statutory_employer or {}).items():
            row["stat"][code] = row["stat"].get(code, _D("0")) + _d(amt)
    employees = [
        {
            "name": r["name"],
            "paye": str(r["paye"].quantize(_D("0.01"))),
            "statutory": {k: str(v.quantize(_D("0.01"))) for k, v in sorted(r["stat"].items())},
        }
        for r in sorted(per_emp.values(), key=lambda x: x["name"].lower())
    ]

    return {
        "period": f"{year}-{month:02d}",
        "currency": currency,
        "finalized": bool(runs),
        "run_ids": run_ids,
        "employee_count": len({p.private_user_id for p in payslips}),
        "paye_total": str(paye_total.quantize(_D("0.01"))),
        "statutory": statutory,
        "grand_total": str(grand_total),
        "employees": employees,
    }


@router.get("/payroll/companies/{company_id}/remittance")
def statutory_remittance(
    company_id: int,
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """JSON remittance summary (drives the Reports UI + CSV)."""
    _require_admin_for_company(current_user, company_id, db, permission="view_payslip")
    return _remittance_data(db, company_id, year, month)


@router.get("/payroll/companies/{company_id}/remittance.pdf")
def statutory_remittance_pdf(
    company_id: int,
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Printable statutory-remittance filing document (PDF)."""
    from fastapi.responses import Response
    from services import remittance_pdf

    _require_admin_for_company(current_user, company_id, db, permission="view_payslip")
    data = _remittance_data(db, company_id, year, month)
    if not data["finalized"]:
        raise HTTPException(status_code=409, detail="No finalized payroll run for this period.")
    company = db.query(Company).filter(Company.company_id == company_id).one_or_none()
    try:
        pdf = remittance_pdf.render(data, company)
    except remittance_pdf.PdfRenderUnavailable as e:
        raise HTTPException(status_code=503, detail=f"PDF renderer unavailable: {e}")
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="remittance_{year}-{month:02d}.pdf"'},
    )
