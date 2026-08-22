"""
Reports & Analytics API
GET /reports/company/{company_id}
Returns monthly trend data for charts: headcount, attendance, leave, OT cost, disputes.
"""

from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, extract, case, cast, Numeric as SANumeric
from datetime import datetime, timezone, date

from core import config
from core.model import (
    Job, TimeLog, Leave, UserRight, PrivateUser, Salary, User, PayrollRun, Payslip
)
from api.v1.user import get_current_user

router = APIRouter(prefix="/reports", tags=["Reports"])


def _month_label(year: int, month: int) -> str:
    """Return e.g. 'Jan 25' from year=2025, month=1."""
    return datetime(year, month, 1).strftime("%b %y")


def _last_n_months(n: int):
    """Return list of (year, month) tuples for the last n months, oldest first."""
    now = datetime.now(timezone.utc)
    months = []
    for i in range(n - 1, -1, -1):
        # Subtract i months from now without dateutil
        month = now.month - i
        year = now.year
        while month <= 0:
            month += 12
            year -= 1
        while month > 12:
            month -= 12
            year += 1
        months.append((year, month))
    return months


def _year_months(year: int):
    """Return (year, month) tuples for Jan..Dec of `year`, oldest first — or
    Jan..the current month if `year` is the current year (no point showing
    empty future months)."""
    now = datetime.now(timezone.utc)
    last_month = now.month if year == now.year else 12
    return [(year, m) for m in range(1, last_month + 1)]


@router.get("/company/{company_id}", status_code=200)
async def get_company_reports(
    company_id: int,
    months: int = Query(default=6, ge=1, le=24),
    year: Optional[int] = Query(default=None, description="If set, show Jan-Dec of this year instead of the rolling `months` window"),
    department_id: Optional[int] = Query(default=None, description="Narrow every chart to one department"),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Aggregated monthly analytics for the company.
    Returns:
      - headcount_trend: employees added per month (cumulative)
      - attendance_by_month: total hours worked per month
      - leave_utilization: approved leave counts by type
      - ot_cost_by_month: estimated OT cost per month
      - dispute_resolution: opened vs closed disputes per month
      - payroll_cost_by_month: finalized payroll gross per month
      - turnover_by_month: terminations per month + rate vs that month's headcount
      - summary: quick KPI snapshot
    """
    # Authorize company access. This route previously had NO auth check — any
    # authenticated user could pass any company_id and read its analytics
    # (cross-company leak). Flag off ⇒ company admin/owner only (fixes the leak);
    # flag on ⇒ the view_reports permission (owner/admin bypass inside).
    from core.auth_guards import require_company_admin
    from core.permission_guards import company_rbac_enabled, assert_company_permission
    if company_rbac_enabled():
        assert_company_permission(current_user, company_id, "view_reports", db,
                                  endpoint="/reports/company", method="GET")
    else:
        require_company_admin(current_user, company_id, db)

    month_list = _year_months(year) if year else _last_n_months(months)
    labels = [_month_label(y, m) for y, m in month_list]
    now = datetime.now(timezone.utc)
    start_dt = datetime(month_list[0][0], month_list[0][1], 1, tzinfo=timezone.utc)

    # ─── Helper: all private_user_ids in this company ──────────────────────────
    direct_ids = db.query(PrivateUser.private_user_id).filter(
        PrivateUser.company_id == company_id
    )
    job_ids = db.query(Job.private_user_id).filter(
        Job.company_id == company_id,
        Job.private_user_id.isnot(None),
    )
    all_ids_q = direct_ids.union(job_ids)
    all_ids = [r[0] for r in all_ids_q.all()]

    # Department scoping — narrow the employee set to those holding a job in
    # the chosen department. `all_ids` feeds leave_utilization directly and
    # (once department_id is set) dispute_resolution below; the per-month
    # queries that already join Job add their own Job.department_id filter.
    if department_id:
        dept_ids = {
            r[0] for r in db.query(Job.private_user_id).filter(
                Job.company_id == company_id,
                Job.department_id == department_id,
                Job.private_user_id.isnot(None),
            ).all()
        }
        all_ids = [uid for uid in all_ids if uid in dept_ids]

    # ─── 1. Headcount Trend ─────────────────────────────────────────────────────
    # Count employees whose job was created in each month (new hires per month)
    # Return both new_hires and cumulative total
    hire_q = db.query(
        extract("year", Job.created_at).label("yr"),
        extract("month", Job.created_at).label("mo"),
        func.count(Job.job_id).label("new_hires"),
    ).filter(
        Job.company_id == company_id,
        Job.private_user_id.isnot(None),
        Job.created_at >= start_dt,
    )
    if department_id:
        hire_q = hire_q.filter(Job.department_id == department_id)
    hire_rows = hire_q.group_by("yr", "mo").all()
    hire_map = {(int(r.yr), int(r.mo)): int(r.new_hires) for r in hire_rows}

    # Baseline: employees hired BEFORE the window
    baseline_q = db.query(func.count(Job.job_id)).filter(
        Job.company_id == company_id,
        Job.private_user_id.isnot(None),
        Job.created_at < start_dt,
    )
    if department_id:
        baseline_q = baseline_q.filter(Job.department_id == department_id)
    baseline = baseline_q.scalar() or 0
    headcount_trend = []
    cumulative = baseline
    for y, m in month_list:
        new = hire_map.get((y, m), 0)
        cumulative += new
        headcount_trend.append({"label": _month_label(y, m), "total": cumulative, "new_hires": new})

    # ─── 2. Attendance by Month (total hours worked) ────────────────────────────
    att_q = (
        db.query(
            extract("year", TimeLog.start_time).label("yr"),
            extract("month", TimeLog.start_time).label("mo"),
            func.coalesce(func.sum(TimeLog.hours_worked), 0).label("hours"),
            func.count(TimeLog.timelog_id).label("sessions"),
        )
        .join(Job, Job.job_id == TimeLog.job_id)
        .filter(
            Job.company_id == company_id,
            TimeLog.start_time >= start_dt,
            TimeLog.end_time.isnot(None),
        )
    )
    if department_id:
        att_q = att_q.filter(Job.department_id == department_id)
    att_rows = att_q.group_by("yr", "mo").all()
    att_map = {(int(r.yr), int(r.mo)): {"hours": float(r.hours), "sessions": int(r.sessions)} for r in att_rows}
    attendance_by_month = [
        {
            "label": _month_label(y, m),
            "hours": round(att_map.get((y, m), {}).get("hours", 0), 1),
            "sessions": att_map.get((y, m), {}).get("sessions", 0),
        }
        for y, m in month_list
    ]

    # ─── 3. Leave Utilization ───────────────────────────────────────────────────
    leave_rows = (
        db.query(
            Leave.leave_type,
            func.count(Leave.leave_id).label("total"),
            func.sum(case((Leave.status == "approved", 1), else_=0)).label("approved"),
            func.sum(case((Leave.status == "pending", 1), else_=0)).label("pending"),
            func.sum(case((Leave.status == "rejected", 1), else_=0)).label("rejected"),
        )
        .filter(
            Leave.private_user_id.in_(all_ids),
            Leave.created_at >= start_dt,
        )
        .group_by(Leave.leave_type)
        .all()
    )
    leave_utilization = [
        {
            "type": r.leave_type,
            "total": int(r.total or 0),
            "approved": int(r.approved or 0),
            "pending": int(r.pending or 0),
            "rejected": int(r.rejected or 0),
        }
        for r in leave_rows
    ]

    # ─── 4. OT Cost by Month ────────────────────────────────────────────────────
    # OT cost estimate: join Salary for the hourly rate; OT cost = ot_hours × rate × 1.5.
    # Only count overtime the employer has CONFIRMED (and not rejected) — matching the
    # payroll engine's gate — so pending/rejected OT does not inflate the report.
    # (This is an estimate; authoritative OT pay comes from a payroll run.)
    ot_q = (
        db.query(
            extract("year", TimeLog.start_time).label("yr"),
            extract("month", TimeLog.start_time).label("mo"),
            func.coalesce(func.sum(TimeLog.hours_worked), 0).label("total_hours"),
            func.coalesce(
                func.sum(
                    case(
                        (
                            (TimeLog.is_overtime == True)
                            & (TimeLog.overtime_confirmed_by_employer == True)
                            & (TimeLog.overtime_rejected == False),
                            TimeLog.hours_worked,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("ot_hours"),
            func.avg(
                case(
                    (cast(Salary.monthly_hours, SANumeric) > 0,
                     cast(Salary.salary, SANumeric) / cast(Salary.monthly_hours, SANumeric)),
                    else_=0,
                )
            ).label("avg_hourly_rate"),
        )
        .join(Job, Job.job_id == TimeLog.job_id)
        .outerjoin(Salary, Salary.job_id == Job.job_id)
        .filter(
            Job.company_id == company_id,
            TimeLog.start_time >= start_dt,
            TimeLog.end_time.isnot(None),
        )
    )
    if department_id:
        ot_q = ot_q.filter(Job.department_id == department_id)
    ot_rows = ot_q.group_by("yr", "mo").all()
    ot_map = {}
    for r in ot_rows:
        ot_h = float(r.ot_hours or 0)
        rate = float(r.avg_hourly_rate or 0)
        ot_map[(int(r.yr), int(r.mo))] = {
            "ot_hours": round(ot_h, 1),
            "ot_cost": round(ot_h * rate * 1.5, 2),
        }
    ot_cost_by_month = [
        {
            "label": _month_label(y, m),
            "ot_hours": ot_map.get((y, m), {}).get("ot_hours", 0),
            "ot_cost": ot_map.get((y, m), {}).get("ot_cost", 0),
        }
        for y, m in month_list
    ]

    # ─── 5. Dispute Resolution by Month ─────────────────────────────────────────
    dispute_open_q = (
        db.query(
            extract("year", UserRight.created_at).label("yr"),
            extract("month", UserRight.created_at).label("mo"),
            func.count(UserRight.right_id).label("opened"),
        )
        .join(PrivateUser, PrivateUser.private_user_id == UserRight.private_user_id)
        .filter(
            PrivateUser.company_id == company_id,
            UserRight.created_at >= start_dt,
        )
    )
    dispute_closed_q = (
        db.query(
            extract("year", UserRight.closed_at).label("yr"),
            extract("month", UserRight.closed_at).label("mo"),
            func.count(UserRight.right_id).label("closed"),
        )
        .join(PrivateUser, PrivateUser.private_user_id == UserRight.private_user_id)
        .filter(
            PrivateUser.company_id == company_id,
            UserRight.closed_at.isnot(None),
            UserRight.closed_at >= start_dt,
        )
    )
    if department_id:
        # PrivateUser.company_id doesn't distinguish departments — narrow to
        # the already department-scoped `all_ids` on top of the company filter.
        dispute_open_q = dispute_open_q.filter(UserRight.private_user_id.in_(all_ids or [-1]))
        dispute_closed_q = dispute_closed_q.filter(UserRight.private_user_id.in_(all_ids or [-1]))
    dispute_open_rows = dispute_open_q.group_by("yr", "mo").all()
    dispute_closed_rows = dispute_closed_q.group_by("yr", "mo").all()
    opened_map = {(int(r.yr), int(r.mo)): int(r.opened) for r in dispute_open_rows}
    closed_map = {(int(r.yr), int(r.mo)): int(r.closed) for r in dispute_closed_rows}
    dispute_resolution = [
        {
            "label": _month_label(y, m),
            "opened": opened_map.get((y, m), 0),
            "closed": closed_map.get((y, m), 0),
        }
        for y, m in month_list
    ]

    # ─── 6. Payroll Cost by Month ───────────────────────────────────────────────
    # Only finalized runs — a draft run's numbers aren't authoritative, so a
    # month with only draft runs correctly shows 0 rather than a provisional
    # figure that could change before the run is actually finalized.
    payroll_q = (
        db.query(
            extract("year", PayrollRun.period_start).label("yr"),
            extract("month", PayrollRun.period_start).label("mo"),
            func.coalesce(func.sum(Payslip.gross), 0).label("gross"),
        )
        .join(Payslip, Payslip.payroll_run_id == PayrollRun.id)
        .filter(
            PayrollRun.company_id == company_id,
            PayrollRun.status == "finalized",
            PayrollRun.period_start >= start_dt.date(),
        )
    )
    if department_id:
        payroll_q = payroll_q.join(Job, Job.job_id == Payslip.job_id).filter(Job.department_id == department_id)
    payroll_rows = payroll_q.group_by("yr", "mo").all()
    payroll_map = {(int(r.yr), int(r.mo)): float(r.gross) for r in payroll_rows}
    payroll_cost_by_month = [
        {"label": _month_label(y, m), "gross": round(payroll_map.get((y, m), 0), 2)}
        for y, m in month_list
    ]

    # ─── 7. Turnover by Month ───────────────────────────────────────────────────
    # Rate = terminations that month ÷ that month's (end-of-month) headcount —
    # a simple proxy, not an average-headcount HR-standard turnover rate.
    term_q = db.query(
        extract("year", Job.end_date).label("yr"),
        extract("month", Job.end_date).label("mo"),
        func.count(Job.job_id).label("terminations"),
    ).filter(
        Job.company_id == company_id,
        Job.end_date.isnot(None),
        Job.end_date >= start_dt.date(),
    )
    if department_id:
        term_q = term_q.filter(Job.department_id == department_id)
    term_rows = term_q.group_by("yr", "mo").all()
    term_map = {(int(r.yr), int(r.mo)): int(r.terminations) for r in term_rows}
    turnover_by_month = []
    for idx, (y, m) in enumerate(month_list):
        terms = term_map.get((y, m), 0)
        hc = headcount_trend[idx]["total"] if idx < len(headcount_trend) else 0
        rate = round((terms / hc) * 100, 1) if hc > 0 else 0.0
        turnover_by_month.append({"label": _month_label(y, m), "terminations": terms, "rate": rate})

    # ─── 8. Summary KPIs ────────────────────────────────────────────────────────
    total_employees = len(all_ids)
    total_hours = sum(r["hours"] for r in attendance_by_month)
    total_ot_cost = sum(r["ot_cost"] for r in ot_cost_by_month)
    total_leave_approved = sum(r["approved"] for r in leave_utilization)
    total_payroll_cost = sum(r["gross"] for r in payroll_cost_by_month)
    total_terminations = sum(r["terminations"] for r in turnover_by_month)
    open_disputes_q = (
        db.query(func.count(UserRight.right_id))
        .join(PrivateUser, PrivateUser.private_user_id == UserRight.private_user_id)
        .filter(
            PrivateUser.company_id == company_id,
            UserRight.closed_at.is_(None),
        )
    )
    if department_id:
        open_disputes_q = open_disputes_q.filter(UserRight.private_user_id.in_(all_ids or [-1]))
    open_disputes = open_disputes_q.scalar() or 0

    return {
        "labels": labels,
        "months": months,
        "headcount_trend": headcount_trend,
        "attendance_by_month": attendance_by_month,
        "leave_utilization": leave_utilization,
        "ot_cost_by_month": ot_cost_by_month,
        "dispute_resolution": dispute_resolution,
        "payroll_cost_by_month": payroll_cost_by_month,
        "turnover_by_month": turnover_by_month,
        "summary": {
            "total_employees": total_employees,
            "total_hours_period": round(total_hours, 1),
            "total_ot_cost_period": round(total_ot_cost, 2),
            "total_leave_approved_period": total_leave_approved,
            "open_disputes": int(open_disputes),
            "total_payroll_cost_period": round(total_payroll_cost, 2),
            "terminations_period": int(total_terminations),
        },
    }
