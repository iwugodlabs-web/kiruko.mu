import logging
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import func, case
from core.model import Schedule, TimeLog, Leave, PrivateUser, Job, schedule_assignments, User, Salary, BreakLog
from datetime import datetime, date, timezone

logger = logging.getLogger(__name__)


def _to_utc(dt):
    """Normalise a datetime to UTC-aware. Returns None if dt is None."""
    if dt is None:
        return None
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    # date objects — convert to midnight UTC
    return datetime(dt.year, dt.month, dt.day, tzinfo=timezone.utc)

def get_dashboard_stats_from_db(db: Session, company_id: int, period: str = None, department_id: int = None):
    import traceback

    # HEAD COUNT LOGIC FIRST (to get all user IDs)
    try:
        from sqlalchemy import or_, text, extract
        # Get all PrivateUser IDs associated with the company either directly or via a Job
        # Direct association
        direct_user_ids_q = db.query(PrivateUser.private_user_id).filter(PrivateUser.company_id == company_id)
        # Via Job association
        job_user_ids_q = db.query(Job.private_user_id).filter(Job.company_id == company_id, Job.private_user_id.isnot(None))
        
        # Combine using union to get unique set
        all_company_user_ids_q = direct_user_ids_q.union(job_user_ids_q)
        # Execute to get list of IDs for IN clauses
        all_user_ids = [r[0] for r in all_company_user_ids_q.all()]

        # Optional department filter — narrow the employee set to those holding a
        # job in the chosen department. Scopes headcount + leave stats; the
        # time-log queries below add their own Job.department_id filter.
        if department_id:
            dept_user_ids = {
                r[0] for r in db.query(Job.private_user_id).filter(
                    Job.company_id == company_id,
                    Job.department_id == department_id,
                    Job.private_user_id.isnot(None),
                ).all()
            }
            all_user_ids = [uid for uid in all_user_ids if uid in dept_user_ids]

        # Head Count Stats — total verified employees. Exclude owner/admin so the
        # count matches the Team Members list (which excludes them) — the company
        # owner is not a team member/headcount entry. Kept as an ID set (not just
        # a count) so the department breakdown below can be scoped to the exact
        # same qualifying employees — otherwise an unverified user or an
        # owner/admin who also holds a Job would be counted per-department but
        # not in the total, making "sum of departments" disagree with it.
        if all_user_ids:
            qualifying_pu_ids = {
                r[0] for r in db.query(PrivateUser.private_user_id)
                .join(User, User.user_id == PrivateUser.user_id)
                .filter(User.user_verified == True)
                .filter(PrivateUser.private_user_id.in_(all_user_ids))
                .filter(or_(PrivateUser.role.is_(None), PrivateUser.role.notin_(['owner', 'admin'])))
                .distinct().all()
            }
        else:
            qualifying_pu_ids = set()
        total_employees = len(qualifying_pu_ids)

        # Department breakdown. Resolves each qualifying employee's EFFECTIVE
        # department the same way EmployeesSection.tsx does client-side:
        # their Job's department_id if set, else PrivateUser.department_id
        # directly (`rawDeptId = job?.department_id ?? ... ?? u.private_user
        # ?.department_id`). The old version here only ever looked at
        # Job.department_id — any employee whose department lived on
        # PrivateUser.department_id instead (real data: bulk-imported or
        # onboarded via a path that didn't also stamp Job.department_id) was
        # miscounted as "No department" here while the Employees page
        # correctly attributed them to their real department. Confirmed live:
        # a company showing "Operations: 11" on Employees showed "Operations:
        # 2" / "No department: 20" on this dashboard.
        from core.model import Department

        pu_dept_fallback = {
            r.private_user_id: r.department_id
            for r in db.query(PrivateUser.private_user_id, PrivateUser.department_id)
            .filter(PrivateUser.private_user_id.in_(qualifying_pu_ids or [-1]))
            .all()
        }
        # One Job per employee (mirrors the frontend's "first job at this
        # company, else first job" pick-one behavior) — a person with >1 Job
        # row here is an edge case, not the common shape this dict assumes.
        job_by_pu: dict[int, object] = {}
        for r in (
            db.query(Job.private_user_id, Job.department_id, Job.job_title, Job.first_date_of_employment)
            .filter(Job.company_id == company_id, Job.private_user_id.in_(qualifying_pu_ids or [-1]))
            .order_by(Job.job_id.asc())
            .all()
        ):
            job_by_pu.setdefault(r.private_user_id, r)

        # Every Department row appears even with zero employees (e.g.
        # freshly-seeded Management/Operations) — legacy companies with no
        # departments naturally return an empty list and the frontend
        # renders its empty state.
        company_departments = db.query(Department).filter(Department.company_id == company_id).all()
        departments_map: dict[str, dict] = {
            d.name: {"name": d.name, "count": 0, "roles": []} for d in company_departments if d.name
        }
        dept_lookup = {d.department_id: d.name for d in company_departments}

        role_counts: dict[tuple, dict] = {}
        no_dept_count = 0
        now_ts = datetime.now(timezone.utc)

        for pu_id in qualifying_pu_ids:
            job = job_by_pu.get(pu_id)
            effective_dept_id = (job.department_id if job else None) or pu_dept_fallback.get(pu_id)
            dept_name = dept_lookup.get(effective_dept_id) if effective_dept_id else None
            if not dept_name:
                no_dept_count += 1
                continue
            bucket = departments_map.setdefault(dept_name, {"name": dept_name, "count": 0, "roles": []})
            bucket["count"] += 1

            job_title = (job.job_title if job else None) or "No Title"
            key = (dept_name, job_title)
            rc = role_counts.setdefault(key, {"count": 0, "tenure_years_sum": 0.0})
            rc["count"] += 1
            fd = job.first_date_of_employment if job else None
            if fd:
                fd_dt = fd if isinstance(fd, datetime) else datetime(fd.year, fd.month, fd.day, tzinfo=timezone.utc)
                if fd_dt.tzinfo is None:
                    fd_dt = fd_dt.replace(tzinfo=timezone.utc)
                rc["tenure_years_sum"] += (now_ts - fd_dt).total_seconds() / (365.25 * 24 * 60 * 60)

        for (dept_name, job_title), rc in role_counts.items():
            avg_years = rc["tenure_years_sum"] / rc["count"] if rc["count"] else 0.0
            departments_map[dept_name]["roles"].append({
                "title": job_title,
                "count": rc["count"],
                "tenure": f"{avg_years:.1f} years",
                "description": "",
            })

        # Name avoids the frontend's placeholder-name filter (which hides
        # literal "unassigned"/"none"/etc.) — mirrors the "No department"
        # label EmployeesSection.tsx already uses.
        if no_dept_count:
            departments_map["No department"] = {
                "name": "No department",
                "count": no_dept_count,
                "roles": [],
            }

        head_count = {"totalEmployees": total_employees, "departments": list(departments_map.values())}

    except Exception:
        logger.exception("Dashboard head-count block failed for company_id=%s", company_id)
        head_count = {"totalEmployees": 0, "departments": []}
        all_user_ids = []

    # Compute period filter range (used by Overview, Leaves etc.)
    from datetime import timedelta
    now = datetime.now(timezone.utc)
    date_from = None
    if period == 'daily':
        date_from = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == 'weekly':
        date_from = (now - timedelta(days=7))
    elif period == 'monthly':
        date_from = (now - timedelta(days=30))

    # Overview Stats
    try:

        base_schedule_filters = [Schedule.company_id == company_id, Schedule.status.in_(['pending', 'started'])]
        if date_from:
            from sqlalchemy import or_
            base_schedule_filters.append(or_(Schedule.start_time >= date_from, Schedule.created_at >= date_from))

        assigned_tasks = db.query(Schedule).filter(*base_schedule_filters).count()

        scheduled_employees = db.query(schedule_assignments.c.private_user_id)\
            .join(Schedule, Schedule.schedule_id == schedule_assignments.c.schedule_id)\
            .filter(*base_schedule_filters)\
            .distinct().count()

        clocked_in_employees = db.query(TimeLog.private_user_id)\
            .join(Job, Job.job_id == TimeLog.job_id)\
            .filter(Job.company_id == company_id, TimeLog.end_time == None)\
            .distinct().count()

        # UPDATED: Use all_user_ids for leave count to catch all employees + period filter
        pending_leave_filters = [Leave.private_user_id.in_(all_user_ids), Leave.status == 'pending']
        if date_from:
            pending_leave_filters.append(Leave.created_at >= date_from)
        pending_requests = db.query(Leave).filter(*pending_leave_filters).count()

        open_positions = db.query(Job).filter(Job.company_id == company_id).count()

        # NEW ALERTS: Overdue Tasks & Overtime
        # Overdue Tasks: Status not completed/cancelled AND end_time < now
        overdue_tasks_query = db.query(Schedule)\
            .filter(Schedule.company_id == company_id)\
            .filter(Schedule.status.notin_(['completed', 'cancelled']))\
            .filter(Schedule.end_time < now).order_by(Schedule.end_time.asc()).limit(50).all()

        overdue_tasks_count = len(overdue_tasks_query)
        overdue_tasks_details = []
        for task in overdue_tasks_query:
            overdue_tasks_details.append({
                "id": task.schedule_id,
                "title": task.title,
                "due_date": task.end_time,
                "assignee": "Unassigned" 
            })

        # ── Live sessions + honest attendance/overtime signals ──
        # Replaces the old "elapsed-time > monthly_hours/days threshold" heuristic,
        # which ignored breaks, was inflated by forgotten clock-outs, and was then
        # aliased to two different alerts. We derive three distinct, honest numbers:
        #   • activeSessions    — who's clocked in now (worked = elapsed − breaks)
        #   • clockInAnomalies  — forgotten clock-outs (open past a sane cap)
        #   • activeOvertime    — overtime genuinely awaiting employer approval
        STALE_SHIFT_HOURS = 16.0  # an open session longer than this = forgotten clock-out

        open_logs_query = (
            db.query(TimeLog, PrivateUser.first_name, PrivateUser.last_name, Job.job_title)
            .join(Job, Job.job_id == TimeLog.job_id)
            .join(PrivateUser, PrivateUser.private_user_id == Job.private_user_id)
            .filter(Job.company_id == company_id)
            .filter(TimeLog.end_time == None)
        )
        if department_id:
            open_logs_query = open_logs_query.filter(Job.department_id == department_id)
        open_logs = open_logs_query.limit(200).all()

        # All breaks for the open sessions in one query (no N+1).
        open_log_ids = [log.timelog_id for (log, *_rest) in open_logs]
        breaks_by_log = {}
        if open_log_ids:
            for b in db.query(BreakLog).filter(BreakLog.timelog_id.in_(open_log_ids)).all():
                breaks_by_log.setdefault(b.timelog_id, []).append(b)

        def _break_hours(timelog_id):
            total = 0.0
            for b in breaks_by_log.get(timelog_id, []):
                b_start = _to_utc(b.start_time)
                if b_start is None:
                    continue
                # An open break is still running → count up to now.
                b_end = _to_utc(b.end_time) if b.end_time is not None else now
                total += max(0.0, (b_end - b_start).total_seconds() / 3600)
            return total

        active_sessions = []
        clockin_anomaly_details = []  # forgotten clock-outs → "Attendance Gaps"
        for log, first, last, job_title in open_logs:
            start = _to_utc(log.start_time)
            if start is None:
                continue
            elapsed = (now - start).total_seconds() / 3600
            worked = max(0.0, elapsed - _break_hours(log.timelog_id))
            info = {
                "user_id": log.private_user_id,
                "name": f"{first or ''} {last or ''}".strip() or "Unknown Employee",
                "job_title": job_title or "Employee",
                "start_time": log.start_time,
                "duration_hours": round(worked, 1),
            }
            if elapsed > STALE_SHIFT_HOURS:
                # Forgotten clock-out — a real attendance anomaly, not live work.
                clockin_anomaly_details.append({**info, "elapsed_hours": round(elapsed, 1)})
            else:
                active_sessions.append(info)

        clockin_anomaly_count = len(clockin_anomaly_details)

        # Overtime genuinely awaiting employer approval — matches the dashboard's
        # "Overtime Pending — awaiting approval" alert + Approve action. NULLs in
        # the flags are coalesced to False (treated as not-yet-acted-on).
        pending_ot_query = (
            db.query(TimeLog, PrivateUser.first_name, PrivateUser.last_name, Job.job_title)
            .join(Job, Job.job_id == TimeLog.job_id)
            .join(PrivateUser, PrivateUser.private_user_id == Job.private_user_id)
            .filter(Job.company_id == company_id)
            .filter(TimeLog.is_overtime.is_(True))
            .filter(func.coalesce(TimeLog.overtime_confirmed_by_employer, False).is_(False))
            .filter(func.coalesce(TimeLog.overtime_rejected, False).is_(False))
        )
        if department_id:
            pending_ot_query = pending_ot_query.filter(Job.department_id == department_id)
        if date_from:
            pending_ot_query = pending_ot_query.filter(TimeLog.start_time >= date_from)

        active_overtime_details = []
        for log, first, last, job_title in pending_ot_query.limit(100).all():
            active_overtime_details.append({
                "user_id": log.private_user_id,
                "name": f"{first or ''} {last or ''}".strip() or "Unknown Employee",
                "job_title": job_title or "Employee",
                "start_time": log.start_time,
                "duration_hours": round(float(log.hours_worked or 0.0), 1),
            })
        active_overtime_count = len(active_overtime_details)

        # --- Payroll Stats — flat-rate estimate of gross from logged hours.
        # Rate comes from the LATEST Salary row per job only; the old plain
        # outerjoin multiplied every TimeLog row when a job had >1 Salary row
        # (no unique constraint on salaries.job_id), inflating hours and gross.
        latest_salary_sq = (
            db.query(Salary.job_id.label("job_id"), func.max(Salary.salary_id).label("sid"))
            .group_by(Salary.job_id)
            .subquery()
        )
        payroll_logs = (
            db.query(TimeLog.hours_worked, Salary.salary, Salary.monthly_hours)
            .join(Job, Job.job_id == TimeLog.job_id)
            .outerjoin(latest_salary_sq, latest_salary_sq.c.job_id == Job.job_id)
            .outerjoin(Salary, Salary.salary_id == latest_salary_sq.c.sid)
            .filter(Job.company_id == company_id)
        )
        if department_id:
            payroll_logs = payroll_logs.filter(Job.department_id == department_id)
        if date_from:
            payroll_logs = payroll_logs.filter(TimeLog.start_time >= date_from)

        total_gross_payroll = 0.0
        total_work_hours = 0.0
        for hours_worked, sal, m_hours in payroll_logs.all():
            hours = float(hours_worked or 0.0)
            total_work_hours += hours
            try:
                salary_val = float(sal or 0)
                monthly_hours_val = float(m_hours or 195)
                if monthly_hours_val <= 0:
                    monthly_hours_val = 195
                total_gross_payroll += hours * (salary_val / monthly_hours_val)
            except (ValueError, TypeError):
                pass


    except Exception:
        traceback.print_exc()
        assigned_tasks = 0
        scheduled_employees = 0
        clocked_in_employees = 0
        pending_requests = 0
        open_positions = 0
        overdue_tasks_count = 0
        overdue_tasks_details = []
        active_overtime_count = 0
        active_overtime_details = []
        clockin_anomaly_count = 0
        clockin_anomaly_details = []
        active_sessions = []
        total_gross_payroll = 0.0
        total_work_hours = 0.0

    # Recent Activity Feed
    try:
        from sqlalchemy import desc
        recent_activity = []

        # 1. New Employee Joins (Recent Jobs)
        recent_jobs = db.query(Job, PrivateUser.first_name, PrivateUser.last_name)\
            .join(PrivateUser, PrivateUser.private_user_id == Job.private_user_id)\
            .filter(Job.company_id == company_id)\
            .order_by(Job.created_at.desc()).limit(5).all()
        
        for job, first, last in recent_jobs:
            name = f"{first or ''} {last or ''}".strip() or "New Employee"
            recent_activity.append({
                "type": "enrollment",
                "title": "New Hire Onboarded",
                "description": f"{name} joined as {job.job_title}",
                "timestamp": _to_utc(job.created_at),
                "icon": "Users"
            })

        # 2. Recent Leave Requests
        recent_leaves = db.query(Leave, PrivateUser.first_name, PrivateUser.last_name)\
            .join(PrivateUser, PrivateUser.private_user_id == Leave.private_user_id)\
            .filter(PrivateUser.company_id == company_id)\
            .order_by(Leave.created_at.desc()).limit(5).all()
        
        for leave, first, last in recent_leaves:
            name = f"{first or ''} {last or ''}".strip() or "Employee"
            recent_activity.append({
                "type": "leave",
                "title": "Leave Request",
                "description": f"{name} requested {leave.leave_type}",
                "timestamp": _to_utc(leave.created_at),
                "icon": "FileText"
            })

        # 3. Recent Clock-ins (Anomalies or just latest)
        recent_logs = db.query(TimeLog, PrivateUser.first_name, PrivateUser.last_name)\
            .join(PrivateUser, PrivateUser.private_user_id == TimeLog.private_user_id)\
            .join(Job, Job.job_id == TimeLog.job_id)\
            .filter(Job.company_id == company_id, TimeLog.end_time.is_(None))\
            .order_by(TimeLog.start_time.desc()).limit(5).all()

        for log, first, last in recent_logs:
            name = f"{first or ''} {last or ''}".strip() or "Employee"
            recent_activity.append({
                "type": "attendance",
                "title": "Shift Started",
                "description": f"{name} clocked in",
                "timestamp": _to_utc(log.start_time),
                "icon": "Clock"
            })

        # Sort by timestamp, newest first. Some rows can have a null timestamp
        # (missing created_at / start_time) — sort those last instead of letting
        # None vs datetime raise a TypeError (which silently dropped the whole
        # activity feed and spammed the log).
        recent_activity.sort(
            key=lambda x: x['timestamp'].timestamp() if x.get('timestamp') else float('-inf'),
            reverse=True,
        )
        # Take top 8
        recent_activity = recent_activity[:8]

    except Exception:
        traceback.print_exc()
        recent_activity = []

    # Expiring Documents Mock Logic (e.g. employees on tourist visas)
    try:
        expiring_docs_count = db.query(Job).filter(Job.company_id == company_id, Job.working_on_tourist_visa == True).count()
        # Fetch actual details if needed for alerts
        expiring_docs_details = []
        if expiring_docs_count > 0:
            bad_jobs = db.query(Job, PrivateUser.first_name, PrivateUser.last_name)\
                .join(PrivateUser, PrivateUser.private_user_id == Job.private_user_id)\
                .filter(Job.company_id == company_id, Job.working_on_tourist_visa == True).all()
            for j, f, l in bad_jobs:
                expiring_docs_details.append({
                    "id": j.job_id,
                    "title": "Tourist Visa Conflict",
                    "assignee": f"{f} {l}",
                    "due_date": j.created_at # Placeholder
                })
    except Exception:
        expiring_docs_count = 0
        expiring_docs_details = []

    # Leave Management (UPDATED to use all_user_ids + optional period filter)
    try:
        leave_filter = [Leave.private_user_id.in_(all_user_ids)]
        if date_from:
            leave_filter.append(Leave.created_at >= date_from)
        leave_stats_query = db.query(
            Leave.leave_type,
            func.count(Leave.leave_id).label('total'),
            func.sum(case((Leave.status == 'pending', 1), else_=0)).label('pending'),
            func.sum(case((Leave.status == 'approved', 1), else_=0)).label('approved'),
            func.sum(case((Leave.status == 'rejected', 1), else_=0)).label('rejected')
        ).filter(*leave_filter).group_by(Leave.leave_type).all()

        leave_management = {
            row.leave_type: {
                "total": row.total or 0,
                "pending": row.pending or 0,
                "approved": row.approved or 0,
                "rejected": row.rejected or 0
            } for row in leave_stats_query
        }
    except Exception:
        traceback.print_exc()
        leave_management = {}

    # Final Overview Construction
    overview = {
        "assignedTasks": assigned_tasks,
        "scheduledEmployees": scheduled_employees,
        "clockedInEmployees": clocked_in_employees,
        "pendingRequests": pending_requests,
        "openPositions": open_positions,
        "overdueTasks": overdue_tasks_count,
        "activeOvertime": active_overtime_count,      # overtime awaiting approval
        "clockInAnomalies": clockin_anomaly_count,    # forgotten clock-outs
        "expiringDocuments": expiring_docs_count,
        "totalGrossPayroll": round(total_gross_payroll, 2),
        "totalWorkHours": round(total_work_hours, 1)
    }
    
    # Final Alert Details Construction
    alert_details = {
        "overtime": active_overtime_details,        # pending OT approvals
        "attendance": clockin_anomaly_details,      # forgotten clock-outs
        "overdueTasks": overdue_tasks_details,
        "docs": expiring_docs_details
    }

    return {
        "overview": overview,
        "alertDetails": alert_details,
        "leaveManagement": leave_management,
        "headCount": head_count,
        "recentActivity": recent_activity,
        "activeSessions": active_sessions
    }


def get_dashboard_trend_deltas(db: Session, company_id: int, period: Optional[str], department_id: int = None):
    """Period-over-period deltas for a few headline Home-page numbers — hours
    worked, payroll gross, leave requests submitted. Self-contained: does NOT
    touch get_dashboard_stats_from_db's queries above, it just re-runs the
    same shape of query over two adjacent windows (the current `period`
    window vs the immediately-preceding window of equal length).

    Deliberately excludes "live" numbers like clocked-in count — those are a
    snapshot of who's clocked in right now, and we don't retroactively know
    who was clocked in a week ago (no historical snapshot table), so there is
    no honest "prior period" to diff against.

    Returns None if `period` isn't one of daily/weekly/monthly (no window to
    compare against).
    """
    from datetime import timedelta

    length = {'daily': timedelta(days=1), 'weekly': timedelta(days=7), 'monthly': timedelta(days=30)}.get(period)
    if not length:
        return None

    now = datetime.now(timezone.utc)
    current_start = now - length
    prior_start = current_start - length
    prior_end = current_start

    def _pct_delta(current, prior):
        # prior == 0 has no meaningful "% change" (division by zero) — return
        # None so the frontend can render "—"/"New" instead of a fabricated number.
        if not prior:
            return None
        return round((current - prior) / prior * 100, 1)

    # Employee set — mirrors the head-count block in get_dashboard_stats_from_db.
    direct_ids = db.query(PrivateUser.private_user_id).filter(PrivateUser.company_id == company_id)
    job_ids = db.query(Job.private_user_id).filter(Job.company_id == company_id, Job.private_user_id.isnot(None))
    all_user_ids = [r[0] for r in direct_ids.union(job_ids).all()]
    if department_id:
        dept_ids = {
            r[0] for r in db.query(Job.private_user_id).filter(
                Job.company_id == company_id,
                Job.department_id == department_id,
                Job.private_user_id.isnot(None),
            ).all()
        }
        all_user_ids = [uid for uid in all_user_ids if uid in dept_ids]

    # Hours worked + payroll gross — same latest-Salary-per-job join as the
    # main stats query's payroll block, run once per window.
    latest_salary_sq = (
        db.query(Salary.job_id.label("job_id"), func.max(Salary.salary_id).label("sid"))
        .group_by(Salary.job_id)
        .subquery()
    )

    def _hours_and_payroll(window_start, window_end):
        q = (
            db.query(TimeLog.hours_worked, Salary.salary, Salary.monthly_hours)
            .join(Job, Job.job_id == TimeLog.job_id)
            .outerjoin(latest_salary_sq, latest_salary_sq.c.job_id == Job.job_id)
            .outerjoin(Salary, Salary.salary_id == latest_salary_sq.c.sid)
            .filter(
                Job.company_id == company_id,
                TimeLog.start_time >= window_start,
                TimeLog.start_time < window_end,
            )
        )
        if department_id:
            q = q.filter(Job.department_id == department_id)
        hours_sum = 0.0
        gross_sum = 0.0
        for hours_worked, sal, m_hours in q.all():
            hours = float(hours_worked or 0.0)
            hours_sum += hours
            try:
                salary_val = float(sal or 0)
                monthly_hours_val = float(m_hours or 195)
                if monthly_hours_val <= 0:
                    monthly_hours_val = 195
                gross_sum += hours * (salary_val / monthly_hours_val)
            except (ValueError, TypeError):
                pass
        return hours_sum, gross_sum

    def _leave_count(window_start, window_end):
        return db.query(Leave).filter(
            Leave.private_user_id.in_(all_user_ids or [-1]),
            Leave.created_at >= window_start,
            Leave.created_at < window_end,
        ).count()

    current_hours, current_payroll = _hours_and_payroll(current_start, now)
    prior_hours, prior_payroll = _hours_and_payroll(prior_start, prior_end)
    current_leave = _leave_count(current_start, now)
    prior_leave = _leave_count(prior_start, prior_end)

    return {
        "hours_worked": {"current": round(current_hours, 1), "delta_pct": _pct_delta(current_hours, prior_hours)},
        "payroll_gross": {"current": round(current_payroll, 2), "delta_pct": _pct_delta(current_payroll, prior_payroll)},
        "leave_requests": {"current": current_leave, "delta_pct": _pct_delta(current_leave, prior_leave)},
    }