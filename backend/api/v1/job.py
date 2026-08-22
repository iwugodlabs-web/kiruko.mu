from db_models.crud.job import (create_job, create_time_log, get_job_by_id, get_all_jobs, get_jobs_by_company, update_job, delete_job, get_all_time_logs, get_time_logs_by_user, get_time_logs_by_job, get_time_logs_by_company, get_job_history, update_job_simple, create_salary, update_salary, create_schedule, get_schedule, get_schedules_by_company, delete_schedule, update_schedule, update_my_schedule_status, verify_schedule_completion, update_time_log, create_break_log, update_break_log)
from fastapi import APIRouter, Depends, status, HTTPException, Query, UploadFile, File, Request
import fastapi as _fastapi
import logging
import sys
from sqlalchemy.exc import SQLAlchemyError
from datetime import datetime, timedelta
from typing import Optional, List

from core import config
from core.dependencies import get_current_user, require_company_read_access, require_company_scope, assert_company_access
from core.model import Salary as SalaryORM, User
from schema.job_schema import  CreateJob, CreateTimeLog, Job, CreateSalary, Salary, ShowJob, ShowTimeLog, TimeLog, ShowJobHistory, ShowSalary, CreateSchedule, ShowSchedule, UpdateSchedule, UpdateMyTaskStatus, VerifyCompletionResult, ShowBreakLog, PendingEmployee
from sqlalchemy.orm import Session
from core.exceptions import EnrollmentException as onbording_exceptions
from pydantic import BaseModel as PydanticBaseModel

class OvertimeRequest(PydanticBaseModel):
    reason: Optional[str] = None

logger = logging.getLogger()

router = APIRouter(
    prefix="/job",
    tags=['Job']
)


# --- IDOR tenant-scope helpers (write tier) ------------------------------------
# A by-resource-id mutation must verify the resource belongs to the caller's
# company, else a user from company A can pass an id owned by company B. These
# resolve the resource's company and delegate to assert_company_access (raises
# 403/404 unless the caller is a member/admin of that company).
def _assert_job_access(job_id: int, current_user, db):
    """Tenant-scope a by-job-id mutation. Returns the Job row."""
    from core.model import Job as JobORM
    job = db.query(JobORM).filter(JobORM.job_id == job_id).first()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    assert_company_access(current_user, getattr(job, 'company_id', None), db)
    return job


def _assert_timelog_access(timelog_id: int, current_user, db):
    """Tenant-scope a by-timelog-id mutation via TimeLog.job_id -> Job.company_id."""
    from core.model import TimeLog as TimeLogORM, Job as JobORM
    tl = db.query(TimeLogORM).filter(TimeLogORM.timelog_id == timelog_id).first()
    if not tl:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Time log not found")
    job = db.query(JobORM).filter(JobORM.job_id == tl.job_id).first()
    assert_company_access(current_user, getattr(job, 'company_id', None), db)
    return tl


def _assert_schedule_access(schedule_id: int, current_user, db):
    """Tenant-scope a by-schedule-id mutation. Returns the Schedule row."""
    from core.model import Schedule as ScheduleORM
    sched = db.query(ScheduleORM).filter(ScheduleORM.schedule_id == schedule_id).first()
    if not sched:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schedule not found")
    assert_company_access(current_user, getattr(sched, 'company_id', None), db)
    return sched


def _assert_salary_access(salary_id: int, current_user, db):
    """Tenant-scope a by-salary-id mutation via Salary.job_id -> Job.company_id."""
    from core.model import Salary as SalaryORM2, Job as JobORM
    sal = db.query(SalaryORM2).filter(SalaryORM2.salary_id == salary_id).first()
    if not sal:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Salary not found")
    job = db.query(JobORM).filter(JobORM.job_id == sal.job_id).first()
    assert_company_access(current_user, getattr(job, 'company_id', None), db)
    return sal


def _gate_company_attendance(current_user, company_id: int, db, permission: str = "view_attendance") -> None:
    """Flag-aware gate for company-wide reads. Flag off ⇒ company admin/owner
    (closes the pre-existing no-auth leaks); flag on ⇒ the given permission
    (default view_attendance; owner/admin bypass inside)."""
    from core.permission_guards import company_rbac_enabled, assert_company_permission
    if company_rbac_enabled():
        assert_company_permission(current_user, company_id, permission, db)
        return
    from core.auth_guards import require_company_admin
    require_company_admin(current_user, company_id, db)

# --- Salary Endpoints ---
@router.post('/salary', status_code=201, response_model=ShowSalary)
async def create_salary_endpoint(salary: Salary, db: Session = Depends(config.get_db)):
    """Create a salary record for a job"""
    try:
        created_salary = await create_salary(salary, db)
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"something is wrong with your query")
    except Exception as ex:
        logger.error("Unexpected Error:", sys.exc_info())
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
    return created_salary

@router.get('/salary/{job_id}', status_code=200, response_model=ShowSalary)
async def get_salary_by_job_id(job_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(config.get_db)):
    """Get salary record for a specific job. Scoped to the job's company."""
    try:
        salary = db.query(SalaryORM).filter(SalaryORM.job_id == job_id).first()
        if not salary:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Salary not found for this job")
        from core.model import Job as JobORM
        _job = db.query(JobORM).filter(JobORM.job_id == job_id).first()
        assert_company_access(current_user, getattr(_job, 'company_id', None), db)
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"something is wrong with your query")
    except Exception as ex:
        logger.error("Unexpected Error:", sys.exc_info())
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
    return salary

@router.put('/salary/update/{salary_id}', status_code=200, response_model=ShowSalary)
async def update_salary_endpoint(salary_id: int, salary: dict = _fastapi.Body(...), current_user: User = Depends(get_current_user), db: Session = Depends(config.get_db)):
    """Update an existing salary record. Scoped to the salary's company."""
    try:
        _assert_salary_access(salary_id, current_user, db)
        updated_salary = await update_salary(salary_id, salary, db)
        db.commit()
        db.refresh(updated_salary)
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="something is wrong with your query")
    except Exception as ex:
        logger.error("Unexpected Error:", sys.exc_info())
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
    return updated_salary


def _resolve_company_employee_roster(db: Session, company_id: int, *, onboarding_status: Optional[str] = "approved"):
    """Resolve the employee roster for a company: users linked via
    PrivateUser.company_id OR Job.company_id OR a Job.employer_brn match on
    this company's BRN, deduped by private_user_id.

    Shared by get_company_salaries and get_company_salary_earnings so "who
    counts as this company's employee" can't silently diverge between them —
    two independent answers to that exact question is what caused the
    Department Breakdown dashboard count mismatch elsewhere in this app.

    `onboarding_status` defaults to strict "approved" — matching
    get_company_salaries' original inline query, which this was extracted
    from (used by the web dashboard). Pass None for the LOOSER "not
    rejected" semantics (pending/approved/NULL all included) that
    get_users_by_company (db_models/crud/user.py:277) applies when called
    with no status filter — that's what mobile's Salaries screen has always
    shown via getUsersByCompany(companyId), and get_company_salary_earnings
    must match it, not silently narrow to approved-only (a real regression
    that dropped pending employees from the mobile earnings list).

    Returns (roster, company_brn) where roster is a
    List[Tuple[UserORM, PrivateUserORM]]. Stops at roster resolution, before
    any job-picking — callers that need a job do their own lookup, since
    get_company_salaries wants one representative job per employee while
    get_company_salary_earnings needs ALL of an employee's jobs (picking only
    one would silently under-count a multi-job employee's earnings).
    """
    from core.model import Job as JobORM, PrivateUser as PrivateUserORM
    from core.model import User as UserORM, Company as CompanyORM
    from sqlalchemy import or_, func
    from sqlalchemy.orm import joinedload

    company_obj = db.query(CompanyORM).filter(CompanyORM.company_id == company_id).first()
    company_brn = company_obj.brn.strip() if company_obj and company_obj.brn else None

    link_filter = or_(
        PrivateUserORM.company_id == company_id,
        JobORM.company_id == company_id,
    )
    if company_brn:
        link_filter = or_(link_filter, func.lower(JobORM.employer_brn) == company_brn.lower())

    onboarding_filter = (
        UserORM.company_onboarding_status == onboarding_status
        if onboarding_status
        else or_(
            UserORM.company_onboarding_status.is_(None),
            UserORM.company_onboarding_status != 'rejected',
        )
    )

    users_query = (
        db.query(UserORM)
        .options(
            joinedload(UserORM.private_user)
            .subqueryload(PrivateUserORM.jobs)
            .subqueryload(JobORM.salaries),
            joinedload(UserORM.private_user).joinedload(PrivateUserORM.department),
        )
        .join(UserORM.private_user)
        .outerjoin(JobORM, JobORM.private_user_id == PrivateUserORM.private_user_id)
        .filter(
            link_filter,
            UserORM.user_type == 'private',
            onboarding_filter,
        )
        .distinct()
    )

    roster = []
    seen_private_user_ids = set()
    for user_obj in users_query.all():
        pu = user_obj.private_user
        if not pu:
            continue
        if pu.private_user_id in seen_private_user_ids:
            continue
        seen_private_user_ids.add(pu.private_user_id)
        roster.append((user_obj, pu))

    return roster, company_brn


@router.get('/salary/company/{company_id}', status_code=200)
async def get_company_salaries(
    company_id: int,
    department_id: Optional[int] = Query(None),
    missing_only: bool = Query(False, description="Return only employees without a salary configured"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List all employees in a company with their salary configuration.
    Matches the same employee set as /user/users/company/{id}?status=approved:
      - User.company_onboarding_status == 'approved'
      - linked via PrivateUser.company_id OR Job.company_id OR Job.employer_brn
    Used by the web dashboard Salary Management page.
    """
    try:
        roster, company_brn = _resolve_company_employee_roster(db, company_id)

        # For each approved user, find the job that belongs to this company
        results = []
        for user_obj, pu in roster:
            # Pick the job most relevant to this company
            company_job = None
            for j in (pu.jobs or []):
                if j.company_id == company_id:
                    company_job = j
                    break
            if company_job is None and company_brn:
                for j in (pu.jobs or []):
                    if j.employer_brn and j.employer_brn.strip().lower() == company_brn.lower():
                        company_job = j
                        break
            # If still no direct job link, use first job (edge case for legacy data)
            if company_job is None and pu.jobs:
                company_job = pu.jobs[0]

            job = company_job

            if department_id and (not job or job.department_id != department_id):
                continue

            # Salary: latest record on this job
            salary = None
            if job and job.salaries:
                try:
                    salary = max(job.salaries, key=lambda s: s.created_at or datetime.min)
                except Exception:
                    salary = job.salaries[0] if job.salaries else None

            has_salary = salary is not None
            if missing_only and has_salary:
                continue

            dept_name = None
            if job and job.department:
                dept_name = job.department.name
            elif pu.department:
                dept_name = pu.department.name

            hourly_rate = None
            if salary:
                try:
                    salary_val = float(salary.salary or 0)
                    eff_hours = float(salary.monthly_hours or 0) or (
                        int(salary.days_of_work_per_month or 0) * 8
                    )
                    hourly_rate = round(salary_val / eff_hours, 2) if eff_hours else None
                except (ValueError, ZeroDivisionError):
                    hourly_rate = None

            results.append({
                "job_id": job.job_id if job else None,
                "private_user_id": pu.private_user_id,
                "user_id": user_obj.user_id,
                "employee_name": f"{pu.first_name} {pu.last_name}".strip() or user_obj.email or "Unknown",
                "employee_code": pu.employee_code,
                "email": user_obj.email,
                "phone": pu.phone,
                "gender": pu.gender,
                "date_of_birth": pu.date_of_birth.isoformat() if pu.date_of_birth else None,
                "passport_number": pu.pass_port_number,
                "job_title": job.job_title if job else None,
                "employer_brn": job.employer_brn if job else None,
                "first_date_of_employment": job.first_date_of_employment.isoformat() if (job and job.first_date_of_employment) else None,
                "department": dept_name,
                "department_id": job.department_id if job else None,
                "has_salary": has_salary,
                "salary_id": salary.salary_id if salary else None,
                "salary": str(salary.salary) if salary and salary.salary is not None else None,
                "revenue": str(salary.revenue) if salary and salary.revenue is not None else None,
                "currency": salary.currency if salary else None,
                "monthly_hours": str(salary.monthly_hours) if salary and salary.monthly_hours is not None else None,
                "days_of_work_per_month": salary.days_of_work_per_month if salary else None,
                "break_in_minutes_per_day": salary.break_in_minutes_per_day if salary else None,
                "allowance": str(salary.allowance) if salary and salary.allowance is not None else None,
                "hourly_rate": hourly_rate,
            })

        total = len(results)
        page_results = results[offset: offset + limit]

        return {
            "total": total,
            "limit": limit,
            "offset": offset,
            "missing_count": sum(1 for r in results if not r["has_salary"]),
            "data": page_results,
        }

    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"DB error in company salaries: {e}")
        raise HTTPException(status_code=500, detail="Database error fetching salaries.")
    except Exception:
        logger.error("Unexpected error in company salaries:", exc_info=True)
        raise HTTPException(status_code=500, detail="Unexpected server error.")


# Mirrors shared/utils/payroll.ts's DEFAULT_MONTHLY_HOURS — used whenever a
# monthly-hours figure isn't otherwise available (modern structure system, or
# a legacy Salary row with no monthly_hours set).
_DEFAULT_MONTHLY_HOURS = 195


def _bucket_earnings_time_logs(logs, hourly_rate, period_start, period_end, tz, holiday_dates):
    """Bucket a job's time logs into regular/overtime/holiday pay for one
    calendar period, in the company's local timezone.

    Precedence (mirrors mobile/app/company_dashboard/salaries.tsx exactly):
    a log flagged as overtime buckets as overtime EVEN IF it also falls on a
    holiday date — holiday only applies to non-overtime logs. Getting this
    backwards would silently misclassify every overtime-on-a-holiday shift
    now that holiday detection is real (it was previously always-false, so
    this precedence never mattered in production).
    """
    from decimal import Decimal

    OVERTIME_MULTIPLIER = Decimal("1.5")
    HOLIDAY_MULTIPLIER = Decimal("2.0")

    regular = Decimal("0.00")
    overtime = Decimal("0.00")
    holiday = Decimal("0.00")
    overtime_hours = Decimal("0.00")
    total_hours = Decimal("0.00")

    for log in logs:
        if log.start_time is None:
            continue
        local_date = log.start_time.astimezone(tz).date()
        if not (period_start <= local_date <= period_end):
            continue

        if log.hours_worked is not None:
            hours = Decimal(str(log.hours_worked))
        elif log.end_time is not None:
            hours = Decimal(str((log.end_time - log.start_time).total_seconds() / 3600))
        else:
            hours = Decimal("0")
        if hours <= 0:
            continue
        total_hours += hours

        is_overtime = bool(log.is_overtime) and log.overtime_confirmed_by_employer is not False and not log.overtime_rejected
        if is_overtime:
            overtime_hours += hours
            overtime += hours * hourly_rate * OVERTIME_MULTIPLIER
        elif local_date in holiday_dates:
            holiday += hours * hourly_rate * HOLIDAY_MULTIPLIER
        else:
            regular += hours * hourly_rate

    return regular, overtime, holiday, overtime_hours, total_hours


@router.get('/salary/company/{company_id}/earnings', status_code=200)
async def get_company_salary_earnings(
    company_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Aggregate earnings-tracker endpoint for the mobile Salaries screen.

    Replaces a per-employee/per-job N+1 fetch pattern (~60-90 HTTP requests
    for a 30-employee company: a salary-structure preview call per employee,
    plus a salary + time-log call per job) with one request that computes
    everything server-side, for the current calendar month in the company's
    own local timezone:
      - totalIncome: modern SalaryStructure resolution via
        salary_resolver.resolve_components(), resolved ONCE per employee
        (not per job — a previous bug re-applied the same resolved income to
        every one of a multi-job employee's jobs), falling back per-job to
        the legacy `Salary` table when no active assignment exists (that
        legacy fallback IS summed per-job, matching mobile's existing
        behavior — different jobs can genuinely have different legacy rows).
      - estimatedEarnings: time-log-based regular/overtime/holiday pay,
        using real `PublicHoliday` dates (previously dead code client-side,
        since `TimeLog` has no `is_holiday` column) and the company's own
        `timezone` to classify which calendar day/month each log belongs to.
    Response shape matches mobile's `EmployeeFinancials` fields exactly.
    """
    from datetime import date, datetime, time as _time, timedelta, timezone as _timezone
    from decimal import Decimal
    from zoneinfo import ZoneInfo
    from core.model import Job as JobORM, TimeLog as TimeLogORM, PublicHoliday as PublicHolidayORM, Company as CompanyORM
    from services import salary_resolver

    _gate_company_attendance(current_user, company_id, db, permission="view_salary")

    try:
        company_obj = db.query(CompanyORM).filter(CompanyORM.company_id == company_id).first()
        if not company_obj:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")

        tz_name = company_obj.timezone or "Indian/Mauritius"
        try:
            tz = ZoneInfo(tz_name)
        except Exception:
            tz = ZoneInfo("Indian/Mauritius")

        now_local = datetime.now(tz)
        period_start = date(now_local.year, now_local.month, 1)
        next_month_first = (
            date(now_local.year + 1, 1, 1) if now_local.month == 12
            else date(now_local.year, now_local.month + 1, 1)
        )
        period_end = next_month_first - timedelta(days=1)

        # UTC bounds derived FROM the local calendar month (not the other way
        # round) — a naive UTC comparison would misclassify logs near
        # midnight for MU (UTC+4) or TZ (UTC+3) into the wrong local month.
        utc_lower = datetime.combine(period_start, _time.min, tzinfo=tz).astimezone(_timezone.utc)
        utc_upper = datetime.combine(period_end, _time.max, tzinfo=tz).astimezone(_timezone.utc)

        # onboarding_status=None: mobile's Salaries screen has always shown
        # pending employees too (getUsersByCompany(companyId) with no status
        # filter excludes only 'rejected') — this must match that, not the
        # web dashboard's stricter approved-only roster (the helper's default).
        roster, _company_brn = _resolve_company_employee_roster(db, company_id, onboarding_status=None)
        pu_ids = [pu.private_user_id for _, pu in roster]

        # All jobs per employee, bulk — not one job per employee like the
        # legacy endpoint's roster helper stops at. Needed so a multi-job
        # employee's earnings are summed across every job, not just one.
        jobs_by_pu: dict = {}
        if pu_ids:
            for j in db.query(JobORM).filter(JobORM.private_user_id.in_(pu_ids)).all():
                jobs_by_pu.setdefault(j.private_user_id, []).append(j)

        # Bulk time logs in 2 queries total (not N): jobbed employees via
        # their job_ids, zero-job employees via direct private_user_id.
        all_job_ids = [j.job_id for jobs in jobs_by_pu.values() for j in jobs]
        logs_by_job: dict = {}
        if all_job_ids:
            for r in (
                db.query(TimeLogORM)
                .filter(TimeLogORM.job_id.in_(all_job_ids))
                .filter(TimeLogORM.start_time >= utc_lower)
                .filter(TimeLogORM.start_time <= utc_upper)
                .all()
            ):
                logs_by_job.setdefault(r.job_id, []).append(r)

        zero_job_pu_ids = [pid for pid in pu_ids if not jobs_by_pu.get(pid)]
        logs_by_pu_direct: dict = {}
        if zero_job_pu_ids:
            for r in (
                db.query(TimeLogORM)
                .filter(TimeLogORM.private_user_id.in_(zero_job_pu_ids))
                .filter(TimeLogORM.start_time >= utc_lower)
                .filter(TimeLogORM.start_time <= utc_upper)
                .all()
            ):
                logs_by_pu_direct.setdefault(r.private_user_id, []).append(r)

        # Real holiday dates for this company's country, classified against
        # observed_date (falling back to date) — the same column the actual
        # overtime engine classifies against, not the raw `date` column.
        holiday_dates = set()
        if company_obj.country_code:
            for h in (
                db.query(PublicHolidayORM)
                .filter(PublicHolidayORM.country_code == company_obj.country_code)
                .filter(PublicHolidayORM.date >= period_start)
                .filter(PublicHolidayORM.date <= period_end)
                .all()
            ):
                holiday_dates.add(h.observed_date or h.date)

        results = []
        for user_obj, pu in roster:
            pu_jobs = jobs_by_pu.get(pu.private_user_id, [])

            total_income_all_jobs = Decimal("0.00")
            total_salary_all_jobs = Decimal("0.00")
            regular_pay_all = Decimal("0.00")
            overtime_pay_all = Decimal("0.00")
            holiday_pay_all = Decimal("0.00")
            overtime_hours_all = Decimal("0.00")
            total_hours_all = Decimal("0.00")
            primary_position = "No Job Assigned"
            main_job_id = 0
            # FTE-scaled fallback: PrivateUser.fte (0.000-1.000, default
            # 1.000) is the one per-employee signal for part-time status that
            # already exists in the data model. A flat 195 for a 0.5-FTE
            # employee would understate their hourly rate ~2x and cascade
            # into every overtime/holiday estimate that multiplies by it —
            # used wherever the flat constant would otherwise be the
            # fallback (never overrides an explicitly-set legacy
            # Salary.monthly_hours, which already reflects that job's actual
            # arrangement).
            default_monthly_hours = Decimal(str(_DEFAULT_MONTHLY_HOURS)) * Decimal(str(pu.fte or 1))
            primary_monthly_hours = default_monthly_hours
            primary_department = "Unassigned"

            if pu_jobs:
                primary_position = " / ".join(j.job_title for j in pu_jobs if j.job_title) or "No Job Assigned"
                main_job_id = pu_jobs[0].job_id
                if pu_jobs[0].department:
                    primary_department = pu_jobs[0].department.name
                elif pu.department:
                    primary_department = pu.department.name

                # Resolved ONCE per employee, reused across every job below —
                # this is the multi-job double-count fix. `assignment_id`
                # is None when there's no active assignment, signalling the
                # per-job legacy fallback inside the loop.
                resolved = salary_resolver.resolve_components(db, pu.private_user_id, period_start)
                structure_basic = None
                structure_allowance = None
                if resolved.assignment_id is not None:
                    structure_basic = salary_resolver.basic_amount(resolved)
                    structure_allowance = salary_resolver.gross_earnings(resolved) - structure_basic
                    # Applied ONCE here, outside the per-job loop below — the
                    # loop still runs per job (to bucket each job's own time
                    # logs), but must NOT re-add this employee-level income
                    # on every iteration, or a multi-job employee's income
                    # gets counted once per job (the bug this endpoint fixes).
                    total_income_all_jobs += structure_basic + structure_allowance
                    total_salary_all_jobs += structure_basic

                for idx, job in enumerate(pu_jobs):
                    if structure_basic is not None:
                        salary_val = structure_basic
                        allowance_val = structure_allowance
                        monthly_hours_val = default_monthly_hours
                    else:
                        # Legacy fallback, per job — mirrors mobile's existing
                        # behavior for this case (unlike the structure case
                        # above, summing per job here IS correct: different
                        # jobs can genuinely have different legacy Salary rows).
                        latest_salary = None
                        for s in (job.salaries or []):
                            if latest_salary is None or (s.created_at or datetime.min) > (latest_salary.created_at or datetime.min):
                                latest_salary = s
                        salary_val = Decimal(str(latest_salary.salary)) if latest_salary and latest_salary.salary is not None else Decimal("0.00")
                        allowance_val = Decimal(str(latest_salary.allowance)) if latest_salary and latest_salary.allowance is not None else Decimal("0.00")
                        monthly_hours_val = (
                            Decimal(str(latest_salary.monthly_hours))
                            if latest_salary and latest_salary.monthly_hours
                            else default_monthly_hours
                        )
                        # Legacy income IS per-job (unlike the structure case
                        # above) — different jobs can genuinely have
                        # different legacy Salary rows, so this accumulates
                        # inside the loop, once per job.
                        total_income_all_jobs += salary_val + allowance_val
                        total_salary_all_jobs += salary_val

                    if idx == 0:
                        primary_monthly_hours = monthly_hours_val

                    job_hourly_rate = (
                        salary_val / monthly_hours_val
                        if salary_val > 0 and monthly_hours_val > 0
                        else Decimal("0.00")
                    )

                    job_regular, job_overtime, job_holiday, job_overtime_hours, job_hours = _bucket_earnings_time_logs(
                        logs_by_job.get(job.job_id, []), job_hourly_rate, period_start, period_end, tz, holiday_dates,
                    )

                    regular_pay_all += job_regular
                    overtime_pay_all += job_overtime
                    holiday_pay_all += job_holiday
                    overtime_hours_all += job_overtime_hours
                    total_hours_all += job_hours
            else:
                # Zero-job employee — still shown (not silently dropped),
                # hours-only from their direct private_user_id time logs,
                # matching mobile's existing fallback branch exactly.
                for log in logs_by_pu_direct.get(pu.private_user_id, []):
                    if log.start_time is None:
                        continue
                    local_date = log.start_time.astimezone(tz).date()
                    if not (period_start <= local_date <= period_end):
                        continue
                    if log.hours_worked is not None:
                        hours = Decimal(str(log.hours_worked))
                    elif log.end_time is not None:
                        hours = Decimal(str((log.end_time - log.start_time).total_seconds() / 3600))
                    else:
                        hours = Decimal("0")
                    if hours > 0:
                        total_hours_all += hours

            estimated_earnings_all_jobs = regular_pay_all + overtime_pay_all + holiday_pay_all
            display_rate = (
                total_salary_all_jobs / primary_monthly_hours
                if total_salary_all_jobs > 0 and primary_monthly_hours > 0
                else Decimal("0.00")
            )
            name = f"{pu.first_name} {pu.last_name}".strip() or user_obj.email or f"User ID: {pu.private_user_id}"

            results.append({
                "id": pu.private_user_id,
                "jobId": main_job_id,
                "name": name,
                "department": primary_department,
                "position": primary_position,
                "totalIncome": float(total_income_all_jobs),
                "estimatedEarnings": float(estimated_earnings_all_jobs),
                "totalHoursWorked": float(total_hours_all),
                "hourlyRate": float(display_rate),
                "monthlyHours": float(primary_monthly_hours),
                "regularPay": float(regular_pay_all),
                "overtimePay": float(overtime_pay_all),
                "holidayPay": float(holiday_pay_all),
                "overtimeHours": float(overtime_hours_all),
            })

        return results

    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"DB error in company salary earnings: {e}")
        raise HTTPException(status_code=500, detail="Database error fetching salary earnings.")
    except Exception:
        logger.error("Unexpected error in company salary earnings:", exc_info=True)
        raise HTTPException(status_code=500, detail="Unexpected server error.")


@router.get('/compliance/company/{company_id}', status_code=200)
async def get_company_compliance(
    company_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Company-wide compliance dashboard data.

    For each approved employee returns:
      - permit type, expiry date (from vault), days until expiry
      - permit status: valid | expiring_soon | expired | tourist_visa | no_data
      - has_permission_to_work flag
      - salary vs minimum-wage check
      - compliance score (0-100) per employee
      - company aggregate: overall_score, counts by status, expiring-soon list

    Minimum wages used:
      MUR  11,275 / month  (Mauritius)
      MGA  258,960 / month  (Madagascar)
    """
    # SECURITY: was unauthorized — any caller could read any company's permit/
    # immigration compliance. Company admin (flag off) / view_compliance (flag on).
    _gate_company_attendance(current_user, company_id, db, "view_compliance")
    from core.model import Job as JobORM, PrivateUser as PrivateUserORM, DocumentVault as VaultORM, User as UserORM, Company as CompanyORM
    from sqlalchemy import or_ as _or
    from datetime import date, timezone as tz

    MIN_WAGES = {"MUR": 11275, "MGA": 258960}
    TODAY = date.today()

    try:
        # Resolve company BRN for the link filter
        company_obj = db.query(CompanyORM).filter(CompanyORM.company_id == company_id).first()
        company_brn = company_obj.brn if company_obj else None

        # Query approved employees (same filter as salary endpoint to avoid verification_status mismatch)
        from sqlalchemy.orm import subqueryload as _sql
        approved_users = (
            db.query(UserORM)
            .filter(UserORM.company_onboarding_status == "approved")
            .join(PrivateUserORM, UserORM.user_id == PrivateUserORM.user_id)
            .filter(
                _or(
                    PrivateUserORM.company_id == company_id,
                    PrivateUserORM.private_user_id.in_(
                        db.query(JobORM.private_user_id).filter(
                            _or(
                                JobORM.company_id == company_id,
                                JobORM.employer_brn == company_brn,
                            )
                        )
                    ),
                )
            )
            .options(
                _sql(UserORM.private_user).subqueryload(PrivateUserORM.jobs).subqueryload(JobORM.salaries),
                _sql(UserORM.private_user).subqueryload(PrivateUserORM.vault_docs),
            )
            .all()
        )

        # Build a set of private_user_ids to deduplicate
        seen_pu_ids: set = set()
        jobs = []
        for u in approved_users:
            pu = u.private_user
            if not pu or pu.private_user_id in seen_pu_ids:
                continue
            seen_pu_ids.add(pu.private_user_id)
            # Pick the job for this company
            job = next(
                (j for j in (pu.jobs or []) if j.company_id == company_id),
                next(
                    (j for j in (pu.jobs or []) if company_brn and j.employer_brn == company_brn),
                    (pu.jobs or [None])[0],
                ),
            )
            if job:
                jobs.append(job)

        employees = []
        for job in jobs:
            pu = job.private_user

            # ── Permit info from vault ──────────────────────────────────────
            # Look for the most recent work_permit doc with an expiry date
            permit_doc = None
            latest_expiry = None
            if pu:
                permit_docs = [
                    d for d in pu.vault_docs
                    if d.doc_type == "work_permit" and d.expiry_date
                ]
                if permit_docs:
                    permit_docs.sort(key=lambda d: d.expiry_date, reverse=True)
                    permit_doc = permit_docs[0]
                    try:
                        latest_expiry = date.fromisoformat(permit_doc.expiry_date)
                    except ValueError:
                        latest_expiry = None

            days_until_expiry = (latest_expiry - TODAY).days if latest_expiry else None

            # ── Permit status ───────────────────────────────────────────────
            permit_type = job.work_permit_type or ""
            tourist_visa = job.working_on_tourist_visa

            if tourist_visa:
                permit_status = "tourist_visa"
            elif not job.has_permission_to_work or not permit_type:
                permit_status = "no_data"
            elif latest_expiry and latest_expiry < TODAY:
                permit_status = "expired"
            elif days_until_expiry is not None and days_until_expiry <= 30:
                permit_status = "expiring_soon"
            elif latest_expiry:
                permit_status = "valid"
            else:
                permit_status = "no_data"

            # ── Salary / minimum wage ────────────────────────────────────────
            salary_obj = max(job.salaries, key=lambda s: s.created_at or datetime.min) if job.salaries else None
            currency = salary_obj.currency if salary_obj else None
            total_pay = None
            below_min_wage = False
            if salary_obj:
                try:
                    # Gross = salary + allowance. (`revenue` is now the derived
                    # gross itself, so the old `salary + revenue` double-counted.)
                    total_pay = float(salary_obj.salary or 0) + float(salary_obj.allowance or 0)
                    min_wage = MIN_WAGES.get(currency or "")
                    if min_wage and total_pay > 0 and total_pay < min_wage:
                        below_min_wage = True
                except (ValueError, TypeError):
                    pass

            # ── Department ──────────────────────────────────────────────────
            dept_name = None
            if job.department:
                dept_name = job.department.name
            elif pu and pu.department:
                dept_name = pu.department.name

            # ── Per-employee compliance score (0-100, 5 checks × 20) ────────
            score = 0
            if job.has_permission_to_work:
                score += 20
            if permit_type and permit_type.lower() not in ("tourist_visa", "none", ""):
                score += 20
            if latest_expiry and latest_expiry >= TODAY:
                score += 20
            if days_until_expiry is None or days_until_expiry > 30:
                score += 20
            if not below_min_wage and total_pay is not None:
                score += 20
            elif total_pay is None:
                # No salary data — treat as neutral (don't penalise twice)
                score += 10

            employees.append({
                "job_id": job.job_id,
                "private_user_id": job.private_user_id,
                "employee_name": f"{pu.first_name} {pu.last_name}" if pu else "Unknown",
                "employee_code": pu.employee_code if pu else None,
                "passport_number": pu.pass_port_number if pu else None,
                "job_title": job.job_title,
                "department": dept_name,
                "department_id": job.department_id,
                "permit_type": permit_type or None,
                "has_permission_to_work": job.has_permission_to_work,
                "working_on_tourist_visa": tourist_visa,
                "expiry_date": latest_expiry.isoformat() if latest_expiry else None,
                "days_until_expiry": days_until_expiry,
                "permit_status": permit_status,
                "permit_doc_id": permit_doc.doc_id if permit_doc else None,
                "permit_doc_url": permit_doc.file_url if permit_doc else None,
                "currency": currency,
                "total_monthly_pay": total_pay,
                "below_min_wage": below_min_wage,
                "compliance_score": score,
            })

        # ── Aggregate ───────────────────────────────────────────────────────
        count = len(employees)
        overall_score = round(sum(e["compliance_score"] for e in employees) / count) if count else 100

        status_counts = {
            "valid": sum(1 for e in employees if e["permit_status"] == "valid"),
            "expiring_soon": sum(1 for e in employees if e["permit_status"] == "expiring_soon"),
            "expired": sum(1 for e in employees if e["permit_status"] == "expired"),
            "tourist_visa": sum(1 for e in employees if e["permit_status"] == "tourist_visa"),
            "no_data": sum(1 for e in employees if e["permit_status"] == "no_data"),
        }

        # Employees expiring in next 90 days sorted by soonest first
        expiring_90 = sorted(
            [e for e in employees if e["days_until_expiry"] is not None and 0 <= e["days_until_expiry"] <= 90],
            key=lambda e: e["days_until_expiry"],
        )

        return {
            "overall_score": overall_score,
            "total_employees": count,
            "status_counts": status_counts,
            "below_min_wage_count": sum(1 for e in employees if e["below_min_wage"]),
            "expiring_90_days": expiring_90,
            "employees": employees,
        }

    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"DB error in compliance: {e}")
        raise HTTPException(status_code=500, detail="Database error fetching compliance data.")
    except Exception:
        logger.error("Unexpected error in compliance:", exc_info=True)
        raise HTTPException(status_code=500, detail="Unexpected server error.")


@router.post('/create', status_code=201, response_model=ShowJob)
async def register_job(job: CreateJob, db: Session = Depends(config.get_db)):
    """Create a new job profile for a user"""
    try:
        created_job = await create_job(job, db)
        # Persist the created job so it is visible to other sessions
        db.commit()
        db.refresh(created_job)
    except (onbording_exceptions.EmailExist):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST)

    except SQLAlchemyError as e:
        logger.error(e)
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"something is wrong with your query")
    except Exception:
        logger.error("Unexpected Error:", sys.exc_info())
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
    return created_job

@router.get('/all', status_code=200, response_model=List[ShowJob])
async def get_all_job_profiles(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(config.get_db),
):
    """Was unauthenticated + returned EVERY job across all companies (cross-tenant
    leak). Now requires auth and scopes to the caller's company; platform admins
    (PlatformRole holders) still see all."""
    try:
        from db_models.crud.role import get_roles_for_user
        if get_roles_for_user(current_user.user_id, db):
            jobs = await get_all_jobs(db)
        else:
            company_id = None
            if getattr(current_user, 'company', None):
                company_id = current_user.company.company_id
            elif getattr(current_user, 'private_user', None) and current_user.private_user.company_id:
                company_id = current_user.private_user.company_id
            jobs = await get_jobs_by_company(company_id, db) if company_id else []
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"something is wrong with your query")
    except Exception:
        logger.error("Unexpected Error: %s", sys.exc_info())
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
    return jobs

@router.get('/company/{company_id}', status_code=200, response_model=List[ShowJob])
async def get_jobs_by_company_endpoint(company_id: int, db: Session = Depends(config.get_db), _=Depends(require_company_read_access)):
    """Get all jobs for a specific company. Scoped: caller must belong to the
    company (require_company_read_access) — was an open cross-tenant read."""
    try:
        jobs = await get_jobs_by_company(company_id, db)
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"something is wrong with your query")
    except Exception:
        logger.error("Unexpected Error", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
    return jobs

@router.get('/{private_user_id}', status_code=200, response_model=Optional[ShowJob])
async def get_user_job_by_id(private_user_id: int, db: Session = Depends(config.get_db)):
    """Return the user's job, or null when they have no job linked yet.

    A user who just signed up but hasn't been added to a company has no Job
    row — that's an expected empty state, not a not-found error. Returning
    null (200) instead of 404 keeps the log clean and lets the frontend
    distinguish "user has no job" from "real error".
    """
    try:
        # The CRUD helper raises HTTPException(404) when no row matches. Catch
        # it specifically so the "no job yet" case becomes a clean 200/null.
        try:
            user_job = await get_job_by_id(private_user_id, db)
        except HTTPException as exc:
            if exc.status_code == status.HTTP_404_NOT_FOUND:
                return None
            raise
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"something is wrong with your query")
    except Exception:
        logger.error("Unexpected Error", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
    return user_job  # Ensure this matches the ShowJob schema


@router.post('/create-time-log', status_code=201, response_model=ShowTimeLog)
async def create_daily_time_log(job: CreateTimeLog, request: Request, db: Session = Depends(config.get_db)):
    # Log the incoming payload for debugging
    print(f"Incoming payload for create-time-log: {job}")
    sys.stdout.flush()

    client_ip = request.client.host if request.client else None

    try:
        work_hours = await create_time_log(job, db, client_ip=client_ip)
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    except Exception as ex:
        logging.error("Unexpected Error:", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(ex))
    return work_hours

@router.put('/{job_id}', status_code=200, response_model=ShowJob)
async def update_job_profile(
    job_id: int,
    job_data: CreateJob,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(config.get_db),
    change_reason: Optional[str] = Query(None, description="Reason for the job update"),
    changed_by: Optional[str] = Query(None, description="User who made the change")
):
    """Update job profile information with optional history tracking. Scoped to the job's company."""
    # Tenant-scope BEFORE the try — the broad `except Exception` fallback below
    # would otherwise swallow the 403 and fall through to the simple update.
    _assert_job_access(job_id, current_user, db)
    try:
        # Try the history-enabled update first
        updated_job = await update_job(
            job_id, 
            job_data.dict(exclude_unset=True), 
            db, 
            change_reason=change_reason,
            changed_by=changed_by
        )
    except Exception as history_error:
        logger.warning(f"History update failed, falling back to simple update: {history_error}")
        # Fallback to simple update without history
        try:
            updated_job = await update_job_simple(
                job_id, 
                job_data.dict(exclude_unset=True), 
                db
            )
        except SQLAlchemyError as e:
            logger.error(e)
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                                detail=f"Database error occurred")
        except Exception as ex:
            logger.error("Unexpected Error:", sys.exc_info())
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                                detail=f"An unexpected error occurred")
    return updated_job

@router.put('/simple/{job_id}', status_code=200, response_model=ShowJob)
async def update_job_profile_simple(
    job_id: int,
    job_data: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(config.get_db)
):
    """Update individual job fields without history tracking. Scoped to the job's company."""
    _assert_job_access(job_id, current_user, db)
    try:
        updated_job = await update_job_simple(
            job_id,
            job_data,
            db
        )
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"Database error occurred")
    except Exception as ex:
        logger.error("Unexpected Error:", sys.exc_info())
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"An unexpected error occurred")
    return updated_job

@router.delete('/{job_id}', status_code=200)
async def delete_job_profile(job_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(config.get_db)):
    """Delete job profile. Scoped to the job's company."""
    _assert_job_access(job_id, current_user, db)
    try:
        result = await delete_job(job_id, db)
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"something is wrong with your query")
    except:
        logger.error("Unexpected Error:", sys.exc_info())
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
    return result

@router.get('/time-logs/all', status_code=200, response_model=List[ShowTimeLog])
async def get_all_time_logs_route(db: Session = Depends(config.get_db), current_user: User = Depends(get_current_user)):
    """Get all time logs — PLATFORM ADMIN ONLY (returns EVERY company's attendance).

    SECURITY: this was unauthenticated — a cross-company attendance-data leak."""
    from db_models.crud.role import user_has_role_by_user_id
    if not (getattr(current_user, "is_superuser", False) or
            user_has_role_by_user_id(current_user.user_id, "platform_admin", db)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Platform admin only.")
    try:
        time_logs = await get_all_time_logs(db)
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"something is wrong with your query")
    except:
        logger.error("Unexpected Error:", sys.exc_info())
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
    return time_logs

@router.get('/time-logs/company/{company_id}', status_code=200, response_model=List[ShowTimeLog])
async def get_time_logs_by_company_route(company_id: int, db: Session = Depends(config.get_db), current_user: User = Depends(get_current_user)):
    """Get all time logs for a specific company.

    SECURITY: this was unauthenticated — any caller could read any company's
    attendance. Now company admin (flag off) / view_attendance (flag on)."""
    _gate_company_attendance(current_user, company_id, db)
    try:
        time_logs = await get_time_logs_by_company(company_id, db)
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"something is wrong with your query")
    except:
        logger.error("Unexpected Error:", sys.exc_info())
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
    return time_logs

@router.get('/time-logs/company/{company_id}/dashboard', status_code=200)
async def get_company_time_logs_dashboard(
    company_id: int,
    start_date: Optional[str] = Query(None, description="ISO date YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="ISO date YYYY-MM-DD"),
    department_id: Optional[int] = Query(None),
    private_user_id: Optional[int] = Query(None, description="Filter to a single employee."),
    source: Optional[str] = Query(None, description="Filter clock-ins by origin: mobile | web | kiosk | admin."),
    overtime: Optional[str] = Query(None, description="Filter to overtime: any | pending | approved | auto. 'pending'/'approved' = manually-flagged OT awaiting/with employer confirmation; 'auto' = engine-detected OT (worked hours beyond the daily statutory limit); 'any' = either."),
    active_only: bool = Query(False, description="Ignore the date range and return only currently-active (not clocked-out) sessions. Used by the Live Sessions view so 'who is clocked in now' doesn't depend on the history date filter."),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    _gate_company_attendance(current_user, company_id, db)
    """
    Rich time-log endpoint for the web dashboard.

    Returns paginated, filterable time logs with denormalised employee/dept names
    and break summaries.  Fields:
      timelog_id, employee_name, job_title, department, date, start_time,
      end_time, hours_worked, break_minutes, is_overtime,
      overtime_confirmed_by_employer, location, status, breaks[]
    """
    from core.model import TimeLog as TimeLogORM, Job as JobORM, PrivateUser as PrivateUserORM, Department as DeptORM, BreakLog, Company as CompanyORM, CountryOvertimeRule as OTRuleORM
    from sqlalchemy import and_, or_
    from datetime import timezone as tz
    from zoneinfo import ZoneInfo

    try:
        # Daily statutory OT threshold for the company's country — lets us surface
        # the SAME overtime the payroll engine auto-detects (worked hours beyond
        # the daily limit), not just manually-flagged OT. Defaults to 8h.
        _co = db.query(CompanyORM).filter(CompanyORM.company_id == company_id).first()
        _country = (_co.country_code if _co else None) or "MU"
        _ot_rule = (
            db.query(OTRuleORM)
            .filter(OTRuleORM.country_code == _country, OTRuleORM.effective_to.is_(None))
            .order_by(OTRuleORM.effective_from.desc())
            .first()
        )
        daily_ot_threshold = float(_ot_rule.daily_threshold_h) if _ot_rule and _ot_rule.daily_threshold_h is not None else 8.0

        query = (
            db.query(TimeLogORM)
            .join(JobORM, TimeLogORM.job_id == JobORM.job_id)
            .join(PrivateUserORM, TimeLogORM.private_user_id == PrivateUserORM.private_user_id)
            .filter(JobORM.company_id == company_id)
        )

        if active_only:
            # "Who is clocked in right now" — independent of the date range, so
            # an active session that started yesterday (or just after local
            # midnight) still appears in Live Sessions.
            query = query.filter(TimeLogORM.end_time.is_(None))
        else:
            # Date filters — anchored to the COMPANY's local day, not UTC. A
            # clock-in at 00:02 local in UTC+4 is 20:02 the previous day in UTC;
            # naive-UTC boundaries dropped such near-midnight sessions out of the
            # range the admin selected (and with them, their kiosk photos).
            _company = db.query(CompanyORM).filter(CompanyORM.company_id == company_id).first()
            try:
                local_tz = ZoneInfo(_company.timezone) if _company and _company.timezone else ZoneInfo("UTC")
            except Exception:
                local_tz = ZoneInfo("UTC")

            if start_date:
                try:
                    # Start of the selected local day → UTC.
                    sd = datetime.fromisoformat(start_date).replace(tzinfo=local_tz).astimezone(tz.utc)
                    query = query.filter(TimeLogORM.start_time >= sd)
                except ValueError:
                    raise HTTPException(status_code=400, detail="Invalid start_date format. Use YYYY-MM-DD.")

            if end_date:
                try:
                    # End of the selected local day (23:59:59) → UTC.
                    ed = datetime.fromisoformat(end_date).replace(
                        hour=23, minute=59, second=59, tzinfo=local_tz
                    ).astimezone(tz.utc)
                    query = query.filter(TimeLogORM.start_time <= ed)
                except ValueError:
                    raise HTTPException(status_code=400, detail="Invalid end_date format. Use YYYY-MM-DD.")

        # Department filter — filter on the job's department_id
        if department_id:
            query = query.filter(JobORM.department_id == department_id)

        # Employee filter
        if private_user_id:
            query = query.filter(TimeLogORM.private_user_id == private_user_id)

        # Source filter (clock-in origin)
        if source in ("mobile", "web", "kiosk", "admin"):
            query = query.filter(TimeLogORM.created_source == source)

        if overtime:
            ot = overtime.lower()
            _auto = TimeLogORM.hours_worked > daily_ot_threshold          # engine-detected
            _flagged = TimeLogORM.is_overtime.is_(True)                   # manually flagged
            if ot in ("pending", "review"):
                query = query.filter(_flagged, TimeLogORM.overtime_confirmed_by_employer.is_(False))
            elif ot == "approved":
                query = query.filter(_flagged, TimeLogORM.overtime_confirmed_by_employer.is_(True))
            elif ot == "auto":
                query = query.filter(TimeLogORM.is_overtime.is_(False), _auto)
            elif ot in ("any", "all", "yes", "overtime"):
                query = query.filter(or_(_flagged, _auto))

        total = query.count()

        logs = (
            query.order_by(TimeLogORM.start_time.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )

        results = []
        for log in logs:
            job = log.job
            pu = log.private_user

            # Department name (job.department takes priority, fall back to pu.department)
            dept_name = None
            if job and job.department:
                dept_name = job.department.name
            elif pu and pu.department:
                dept_name = pu.department.name

            employee_name = f"{pu.first_name} {pu.last_name}" if pu else "Unknown"
            job_title = job.job_title if job else None

            # Break total in minutes
            break_minutes = 0
            breaks_out = []
            for b in log.breaks:
                if b.start_time and b.end_time:
                    delta = (b.end_time - b.start_time).total_seconds() / 60
                    break_minutes += int(delta)
                breaks_out.append({
                    "break_id": b.break_id,
                    "start_time": b.start_time.isoformat() if b.start_time else None,
                    "end_time": b.end_time.isoformat() if b.end_time else None,
                })

            # Engine-detected OT: worked hours beyond the daily statutory limit,
            # even when the shift was never manually flagged. This is what the
            # payroll engine actually pays, so the employer sees it here too.
            _hw = float(log.hours_worked) if log.hours_worked else 0.0
            auto_overtime = (not log.is_overtime) and _hw > daily_ot_threshold
            overtime_hours = round(_hw - daily_ot_threshold, 2) if _hw > daily_ot_threshold else 0.0

            # Derive status
            if log.start_time and not log.end_time:
                log_status = "active"
            elif log.is_overtime or auto_overtime:
                log_status = "overtime"
            elif log.end_time is None:
                log_status = "incomplete"
            else:
                log_status = "complete"

            results.append({
                "timelog_id": log.timelog_id,
                "employee_name": employee_name,
                "employee_code": pu.employee_code if pu else None,
                "private_user_id": log.private_user_id,
                "job_id": log.job_id,
                "job_title": job_title,
                "department": dept_name,
                "date": log.start_time.date().isoformat() if log.start_time else None,
                "start_time": log.start_time.isoformat() if log.start_time else None,
                "end_time": log.end_time.isoformat() if log.end_time else None,
                "hours_worked": float(log.hours_worked) if log.hours_worked else None,
                "break_minutes": break_minutes,
                "is_overtime": log.is_overtime,
                "overtime_confirmed_by_employer": log.overtime_confirmed_by_employer,
                "auto_overtime": auto_overtime,
                "overtime_hours": overtime_hours,
                "overtime_source": ("flagged" if log.is_overtime else ("auto" if auto_overtime else None)),
                "location": log.location,
                "status": log_status,
                "breaks": breaks_out,
                # Provenance + kiosk selfie so the attendance drawer can show
                # where the punch came from and the captured photo.
                "created_source": getattr(log, "created_source", None) or "mobile",
                "kiosk_photo_path": getattr(log, "kiosk_photo_path", None),
                "out_of_schedule": bool(getattr(log, "out_of_schedule", False)),
                "is_late": bool(getattr(log, "is_late", False)),
                "late_reason": getattr(log, "late_reason", None),
            })

        return {
            "total": total,
            "limit": limit,
            "offset": offset,
            "data": results,
        }

    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"DB error in time-logs dashboard: {e}")
        raise HTTPException(status_code=500, detail="Database error fetching time logs.")
    except Exception:
        logger.error("Unexpected error in time-logs dashboard:", exc_info=True)
        raise HTTPException(status_code=500, detail="Unexpected server error.")


@router.get('/time-logs/user/{private_user_id}', status_code=200, response_model=List[ShowTimeLog])
async def get_user_time_logs_route(
    private_user_id: int, 
    date_from: Optional[str] = Query(None), 
    date_to: Optional[str] = Query(None), 
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user)
):
    """Get time logs for a specific user with optional date filtering"""
    from services.time_log_service import TimeLogService
    from core.model import UserType

    # Self-healing auto-clock-out: when the user polls their OWN logs, resolve any
    # stale/past-schedule session FIRST (close at scheduled end + grace, max-shift,
    # day boundary) so the app reflects an auto-clock-out on its very next poll —
    # no dependence on the 5-min background cron's timing.
    # NB: user_type is an Enum, so compare to UserType.private, not the string
    # 'private' (the old `== 'private'` was always False, so this never ran).
    is_self = (
        current_user.user_type == UserType.private
        and current_user.private_user
        and current_user.private_user.private_user_id == private_user_id
    )
    if is_self:
        try:
            TimeLogService.resolve_stale_for_user(db, private_user_id)
        except Exception as _e:
            logger.warning(f"resolve_stale_for_user failed (non-fatal): {_e}")
    else:
        # Not the employee themselves → require company attendance access for the
        # target's company. This was previously UNAUTHORIZED — any user could read
        # any employee's attendance.
        from core.model import PrivateUser as _PU
        target = db.query(_PU).filter(_PU.private_user_id == private_user_id).one_or_none()
        if target is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")
        if target.company_id is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
        _gate_company_attendance(current_user, target.company_id, db)
        
    try:
        logger.info(
            "🔧 Backend: get_user_time_logs_route",
            extra={
                "private_user_id": private_user_id,
                "date_from": date_from,
                "date_to": date_to,
            },
        )
        time_logs = await get_time_logs_by_user(private_user_id, db, date_from=date_from, date_to=date_to)
        logger.info(
            "✅ Backend: get_user_time_logs_route returned",
            extra={
                "private_user_id": private_user_id,
                "count": len(time_logs),
                "sample": [
                    {
                        "timelog_id": log.timelog_id,
                        "start_time": log.start_time.isoformat() if log.start_time else None,
                        "end_time": log.end_time.isoformat() if log.end_time else None,
                        "hours_worked": log.hours_worked,
                        "break_count": len(log.breaks) if getattr(log, "breaks", None) is not None else 0,
                    }
                    for log in time_logs[:8]
                ],
            },
        )
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"something is wrong with your query")
    except:
        logger.error("Unexpected Error:", sys.exc_info())
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
    return time_logs

@router.get('/time-logs/job/{job_id}', status_code=200, response_model=List[ShowTimeLog])
async def get_job_time_logs_route(job_id: int, db: Session = Depends(config.get_db), current_user: User = Depends(get_current_user)):
    """Get time logs for a specific job.

    SECURITY: was unauthenticated — any caller could read a job's attendance.
    Now requires company attendance access for the job's company."""
    from core.model import Job as _Job
    _job = db.query(_Job).filter(_Job.job_id == job_id).one_or_none()
    if _job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    if _job.company_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    _gate_company_attendance(current_user, _job.company_id, db)
    try:
        time_logs = await get_time_logs_by_job(job_id, db)
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"something is wrong with your query")
    except:
        logger.error("Unexpected Error:", sys.exc_info())
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
    return time_logs

@router.put('/time-log/{time_log_id}', status_code=200, response_model=ShowTimeLog)
async def update_time_log_endpoint(
    time_log_id: int,
    time_log_data: dict,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(config.get_db)
):
    """Update a time log entry (e.g., for clock-out or breaks). Scoped to the log's company."""
    _assert_timelog_access(time_log_id, current_user, db)
    client_ip = request.client.host if request.client else None
    try:
        updated_log = await update_time_log(time_log_id, time_log_data, db, client_ip=client_ip)
        if not updated_log:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Time log not found")
        return updated_log
    except HTTPException as e:
        # Re-raise HTTPException to ensure FastAPI handles it correctly
        raise e
    except Exception as e:
        logger.error(f"Error updating time log {time_log_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@router.post('/time-log/{timelog_id}/start-break', status_code=201, response_model=ShowBreakLog)
async def start_break_endpoint(timelog_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(config.get_db)):
    """Start a new break for an active time log. Scoped to the log's company."""
    _assert_timelog_access(timelog_id, current_user, db)
    try:
        new_break = await create_break_log(timelog_id, db)
        return new_break
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Error starting break for time log {timelog_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@router.put('/time-log/{timelog_id}/end-break', status_code=200, response_model=ShowBreakLog)
async def end_break_endpoint(timelog_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(config.get_db)):
    """End the current active break for a time log. Scoped to the log's company."""
    _assert_timelog_access(timelog_id, current_user, db)
    try:
        ended_break = await update_break_log(timelog_id, db)
        return ended_break
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Error ending break for time log {timelog_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@router.post('/time-log/{timelog_id}/overtime', status_code=200, response_model=ShowTimeLog)
async def mark_overtime_endpoint(
    timelog_id: int,
    body: OvertimeRequest,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user)
):
    """Explicitly mark a time log session as overtime."""
    from services.time_log_service import TimeLogService
    from core.model import TimeLog as TimeLogORM, PrivateUser
    try:
        timelog = db.query(TimeLogORM).filter(TimeLogORM.timelog_id == timelog_id).first()
        if not timelog:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Time log not found")
        # Ownership check: timelog must belong to the requesting private user
        private_user = db.query(PrivateUser).filter(PrivateUser.user_id == current_user.user_id).first()
        if not private_user or timelog.private_user_id != private_user.private_user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to mark this time log as overtime")
        updated_log = TimeLogService.mark_as_overtime(db, timelog_id, reason=body.reason)
        if not updated_log:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Time log not found")
        return updated_log
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error marking overtime for time log {timelog_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@router.put('/time-log/{timelog_id}/overtime/confirm', status_code=200, response_model=ShowTimeLog)
async def confirm_overtime_endpoint(
    timelog_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user)
):
    """Employer confirms an overtime session for an employee."""
    from core.model import TimeLog as TimeLogORM, Company, Job as JobORM, UserType
    from services.notification_service import NotificationService
    try:
        if current_user.user_type != UserType.company:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only company users can confirm overtime")
        timelog = db.query(TimeLogORM).filter(TimeLogORM.timelog_id == timelog_id).first()
        if not timelog:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Time log not found")
        # Verify the caller belongs to the company that owns this time log's job.
        # (The previous guard's `and user_type != company` clause was always false
        # for a company user, so it never blocked cross-company confirmation.)
        job = db.query(JobORM).filter(JobORM.job_id == timelog.job_id).first()
        assert_company_access(current_user, getattr(job, 'company_id', None), db)
        from datetime import timezone as _tz
        # Confirming also promotes an off-hours "review" session (is_overtime=False)
        # into a paid overtime record, so the employer can approve off-schedule
        # work the employee never explicitly marked as overtime.
        timelog.is_overtime = True
        timelog.overtime_rejected = False
        timelog.overtime_confirmed_by_employer = True
        timelog.marked_as_overtime_at = datetime.now(_tz.utc)
        db.commit()
        db.refresh(timelog)
        NotificationService.notify_employee_overtime_confirmed(db, timelog)
        return timelog
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error confirming overtime for time log {timelog_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@router.put('/time-log/{timelog_id}/overtime/reject', status_code=200, response_model=ShowTimeLog)
async def reject_overtime_endpoint(
    timelog_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user)
):
    """Employer rejects an overtime session for an employee."""
    from core.model import TimeLog as TimeLogORM, Company, Job as JobORM, UserType
    from services.notification_service import NotificationService
    try:
        if current_user.user_type != UserType.company:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only company users can reject overtime")
        timelog = db.query(TimeLogORM).filter(TimeLogORM.timelog_id == timelog_id).first()
        if not timelog:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Time log not found")
        # Verify the caller belongs to the company that owns this time log's job
        # (same always-false-clause bug as confirm; close the cross-company hole).
        job = db.query(JobORM).filter(JobORM.job_id == timelog.job_id).first()
        assert_company_access(current_user, getattr(job, 'company_id', None), db)
        # Revert overtime flag and stamp rejection time for audit trail
        from datetime import timezone as _tz
        timelog.is_overtime = False
        timelog.overtime_confirmed_by_employer = False
        timelog.overtime_rejected = True
        timelog.marked_as_overtime_at = datetime.now(_tz.utc)
        db.commit()
        db.refresh(timelog)
        NotificationService.notify_employee_overtime_rejected(db, timelog)
        return timelog
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error rejecting overtime for time log {timelog_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@router.get('/time-logs/company/{company_id}/overtime', status_code=200)
async def get_company_overtime(
    company_id: int,
    ot_status: Optional[str] = Query("pending", description="review | pending | approved | rejected | all"),
    department_id: Optional[int] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Company-wide overtime logs for the web dashboard.
    Returns overtime sessions with salary data for cost estimation.

    ot_status values:
      review   — out_of_schedule=True, is_overtime=False, rejected=False
                 (off-hours work the server flagged but nobody marked as OT yet)
      pending  — is_overtime=True, confirmed=False, rejected=False
      approved — is_overtime=True, confirmed=True
      rejected — overtime_rejected=True
      all      — any OT record (pending + approved + rejected)
    """
    from core.model import (
        TimeLog as TimeLogORM, Job as JobORM, PrivateUser as PrivateUserORM,
        Department as DeptORM, Salary as SalaryModel, Company, UserType,
    )
    from sqlalchemy import or_, and_

    try:
        if current_user.user_type != UserType.company:
            raise HTTPException(status_code=403, detail="Company users only")

        base_q = (
            db.query(TimeLogORM)
            .join(JobORM, TimeLogORM.job_id == JobORM.job_id)
            .join(PrivateUserORM, TimeLogORM.private_user_id == PrivateUserORM.private_user_id)
            .filter(JobORM.company_id == company_id)
        )

        # Status filter
        if ot_status == "pending":
            base_q = base_q.filter(
                TimeLogORM.is_overtime == True,
                TimeLogORM.overtime_confirmed_by_employer == False,
                TimeLogORM.overtime_rejected == False,
            )
        elif ot_status == "approved":
            base_q = base_q.filter(
                TimeLogORM.is_overtime == True,
                TimeLogORM.overtime_confirmed_by_employer == True,
            )
        elif ot_status == "rejected":
            base_q = base_q.filter(TimeLogORM.overtime_rejected == True)
        elif ot_status == "review":
            # Off-hours sessions the server flagged at clock-in but nobody has
            # marked as overtime yet. Surfacing these lets the employer always
            # see off-schedule work even when the employee dismissed the prompt.
            base_q = base_q.filter(
                TimeLogORM.out_of_schedule == True,
                TimeLogORM.is_overtime == False,
                TimeLogORM.overtime_rejected == False,
            )
        else:  # all
            base_q = base_q.filter(
                or_(
                    TimeLogORM.is_overtime == True,
                    TimeLogORM.overtime_rejected == True,
                )
            )

        if department_id:
            base_q = base_q.filter(JobORM.department_id == department_id)

        if start_date:
            from datetime import date
            base_q = base_q.filter(TimeLogORM.start_time >= start_date)
        if end_date:
            base_q = base_q.filter(TimeLogORM.start_time <= end_date + " 23:59:59")

        total = base_q.count()
        logs = base_q.order_by(TimeLogORM.start_time.desc()).offset(offset).limit(limit).all()

        rows = []
        for log in logs:
            job = log.job
            pu = log.private_user
            dept_name = None
            if job and job.department_id:
                dept = db.query(DeptORM).filter(DeptORM.department_id == job.department_id).first()
                dept_name = dept.name if dept else None

            # Fetch latest salary for cost calculation
            salary = (
                db.query(SalaryModel)
                .filter(SalaryModel.job_id == log.job_id)
                .order_by(SalaryModel.salary_id.desc())
                .first()
            )
            hourly_rate = None
            estimated_cost = None
            if salary and salary.salary and salary.monthly_hours:
                try:
                    monthly_hours = float(salary.monthly_hours)
                    if monthly_hours > 0:
                        hourly_rate = float(salary.salary) / monthly_hours
                except (ValueError, TypeError):
                    pass

            ot_hours = float(log.hours_worked) if log.hours_worked else None
            if hourly_rate and ot_hours:
                estimated_cost = round(hourly_rate * ot_hours * 1.5, 2)

            # Derive status string
            if log.overtime_rejected:
                derived_status = "rejected"
            elif log.overtime_confirmed_by_employer:
                derived_status = "approved"
            elif log.is_overtime:
                derived_status = "pending"      # employee-marked, awaiting employer
            else:
                derived_status = "review"       # off-hours, awaiting employer decision

            rows.append({
                "timelog_id": log.timelog_id,
                "job_id": log.job_id,
                "employee_name": f"{pu.first_name} {pu.last_name}" if pu else "Unknown",
                "employee_code": pu.employee_code if pu else None,
                "job_title": job.job_title if job else None,
                "department": dept_name,
                "date": log.start_time.date().isoformat() if log.start_time else None,
                "start_time": log.start_time.isoformat() if log.start_time else None,
                "end_time": log.end_time.isoformat() if log.end_time else None,
                "hours_worked": ot_hours,
                "hourly_rate": hourly_rate,
                "estimated_cost": estimated_cost,
                "currency": salary.currency if salary else None,
                "ot_status": derived_status,
                "is_overtime": log.is_overtime,
                "out_of_schedule": bool(getattr(log, "out_of_schedule", False)),
                "overtime_confirmed_by_employer": log.overtime_confirmed_by_employer,
                "overtime_rejected": log.overtime_rejected,
                "marked_as_overtime_at": log.marked_as_overtime_at.isoformat() if log.marked_as_overtime_at else None,
                "overtime_reason": log.overtime_reason,
                "location": log.location,
            })

        return {"total": total, "offset": offset, "limit": limit, "records": rows}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching company overtime: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class BulkOvertimeAction(PydanticBaseModel):
    timelog_ids: List[int]
    action: str  # "approve" | "reject"


@router.put('/time-logs/company/{company_id}/overtime/bulk', status_code=200)
async def bulk_overtime_action(
    company_id: int,
    body: BulkOvertimeAction,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Bulk approve or reject overtime sessions for a company."""
    from core.model import TimeLog as TimeLogORM, Job as JobORM, Company, UserType
    from services.notification_service import NotificationService

    try:
        if current_user.user_type != UserType.company:
            raise HTTPException(status_code=403, detail="Company users only")

        if body.action not in ("approve", "reject"):
            raise HTTPException(status_code=400, detail="action must be 'approve' or 'reject'")

        updated = []
        for tid in body.timelog_ids:
            log = db.query(TimeLogORM).filter(TimeLogORM.timelog_id == tid).first()
            if not log:
                continue
            job = db.query(JobORM).filter(JobORM.job_id == log.job_id).first()
            if not job or job.company_id != company_id:
                continue  # skip logs not belonging to this company

            from datetime import timezone as _tz
            now_utc = datetime.now(_tz.utc)
            if body.action == "approve":
                log.is_overtime = True  # promote off-hours review sessions to OT
                log.overtime_confirmed_by_employer = True
                log.overtime_rejected = False
                log.marked_as_overtime_at = now_utc
                try:
                    NotificationService.notify_employee_overtime_confirmed(db, log)
                except Exception:
                    pass
            else:
                log.is_overtime = False
                log.overtime_confirmed_by_employer = False
                log.overtime_rejected = True
                log.marked_as_overtime_at = now_utc  # stamp rejection time for audit trail
                try:
                    NotificationService.notify_employee_overtime_rejected(db, log)
                except Exception:
                    pass
            updated.append(tid)

        db.commit()
        return {"updated": len(updated), "timelog_ids": updated}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Bulk OT action error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/history/{job_id}', status_code=200, response_model=List[ShowJobHistory])
async def get_job_history_route(job_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(config.get_db)):
    """Get history records for a specific job. Scoped to the job's company."""
    try:
        from core.model import Job as JobORM
        _job = db.query(JobORM).filter(JobORM.job_id == job_id).first()
        assert_company_access(current_user, getattr(_job, 'company_id', None), db)
        history_records = await get_job_history(job_id, db)
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"something is wrong with your query")
    except:
        logger.error("Unexpected Error:", sys.exc_info())
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
    return history_records

# --- Schedule Endpoints ---

@router.post('/schedule', status_code=status.HTTP_201_CREATED, response_model=ShowSchedule)
async def create_schedule_endpoint(schedule_data: CreateSchedule, db: Session = Depends(config.get_db)):
    """Create a new job schedule and assign employees."""
    try:
        new_schedule = await create_schedule(schedule_data, db)
        return new_schedule
    except HTTPException as e:
        # Re-raise HTTPException to preserve status code and detail
        raise e
    except Exception as e:
        logger.error(f"Error in create_schedule_endpoint: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="An unexpected error occurred while creating the schedule.")

@router.get('/schedule/{schedule_id}', status_code=status.HTTP_200_OK, response_model=ShowSchedule)
async def get_schedule_endpoint(schedule_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(config.get_db)):
    """Get a specific schedule by its ID. Scoped to the schedule's company."""
    schedule = await get_schedule(schedule_id, db)
    if not schedule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schedule not found")
    assert_company_access(current_user, getattr(schedule, 'company_id', None), db)
    return schedule

@router.get('/schedules/company/{company_id}', status_code=status.HTTP_200_OK, response_model=List[ShowSchedule])
async def get_company_schedules_endpoint(
    company_id: int,
    start_date: Optional[str] = Query(None, description="ISO date YYYY-MM-DD — filter shifts starting on or after this date"),
    end_date: Optional[str] = Query(None, description="ISO date YYYY-MM-DD — filter shifts starting on or before this date"),
    db: Session = Depends(config.get_db),
    _=Depends(require_company_read_access),
):
    """Get all schedules for a specific company, optionally filtered to a date window."""
    from core.model import Schedule as ScheduleModel
    from sqlalchemy.orm import joinedload as jl

    if start_date or end_date:
        try:
            q = db.query(ScheduleModel).options(
                jl(ScheduleModel.assigned_employees),
                jl(ScheduleModel.assignee_statuses),
            ).filter(ScheduleModel.company_id == company_id)
            if start_date:
                q = q.filter(ScheduleModel.start_time >= start_date)
            if end_date:
                q = q.filter(ScheduleModel.start_time <= end_date + " 23:59:59")
            return q.order_by(ScheduleModel.start_time.asc()).all()
        except Exception as e:
            logger.error(f"Error fetching filtered schedules: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    schedules = await get_schedules_by_company(company_id, db)
    return schedules

@router.put('/schedule/{schedule_id}', status_code=status.HTTP_200_OK, response_model=ShowSchedule)
async def update_schedule_endpoint(schedule_id: int, schedule_data: UpdateSchedule, current_user: User = Depends(get_current_user), db: Session = Depends(config.get_db)):
    """Update an existing schedule. Scoped to the schedule's company."""
    _assert_schedule_access(schedule_id, current_user, db)
    try:
        updated_schedule = await update_schedule(schedule_id, schedule_data, db)
        if not updated_schedule:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schedule not found")
        return updated_schedule
    except HTTPException as e:
        # Re-raise HTTPException to preserve status code and detail
        raise e
    except Exception as e:
        logger.error(f"Error in update_schedule_endpoint: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="An unexpected error occurred while updating the schedule.")

@router.put('/schedule/{schedule_id}/my-status', status_code=status.HTTP_200_OK, response_model=ShowSchedule)
async def update_my_task_status_endpoint(
    schedule_id: int,
    status_data: UpdateMyTaskStatus,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user)
):
    """Employee marks their own progress on an assigned task (pending → started → completed).

    - Each assignee tracks their own state independently.
    - When ALL assignees mark 'completed', the global task status auto-sets to 'completed'.
    - When the first assignee marks 'started', the global status advances from 'pending' to 'started'.
    - Managers can still override the global status via PUT /schedule/{id}.
    """
    allowed = {'pending', 'started', 'completed'}
    if status_data.status not in allowed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Invalid status. Must be one of: {allowed}")

    if not (current_user.user_type.value == 'private' and current_user.private_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Only employee accounts can use this endpoint.")

    private_user_id = current_user.private_user.private_user_id
    result = await update_my_schedule_status(schedule_id, private_user_id, status_data.status, db, note=status_data.note)
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schedule not found.")
    return result

@router.post('/schedule/{schedule_id}/proof', status_code=status.HTTP_200_OK)
async def upload_task_proof_endpoint(
    schedule_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """#4 — employee attaches a photo as proof of completion for their assigned
    task. Stored per-assignee on schedule_assignee_statuses.proof_image_url."""
    if not (current_user.user_type.value == 'private' and current_user.private_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Only employee accounts can upload task proof.")

    from core.model import ScheduleAssigneeStatus
    private_user_id = current_user.private_user.private_user_id
    row = db.query(ScheduleAssigneeStatus).filter(
        ScheduleAssigneeStatus.schedule_id == schedule_id,
        ScheduleAssigneeStatus.private_user_id == private_user_id,
    ).first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="You are not assigned to this task.")

    from services.storage_service import get_storage_service
    url = await get_storage_service().upload_file(file, folder="task_proofs")
    if not url:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Upload failed.")

    row.proof_image_url = url
    db.add(row)
    db.commit()
    return {"schedule_id": schedule_id, "proof_image_url": url}


@router.post('/schedule/{schedule_id}/verify-completion', status_code=status.HTTP_200_OK, response_model=VerifyCompletionResult)
async def verify_schedule_completion_endpoint(
    schedule_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Employer verifies a completed task and books its additional remuneration
    (one-off allowance) for each completed assignee. Verify-before-pay: this
    employer action is the gate — self-marked completion alone never pays.
    Idempotent (already-paid assignees are skipped)."""
    schedule = await get_schedule(schedule_id, db)
    if not schedule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schedule not found")
    # Books a one-off allowance (pay) per completed assignee — gate on the same
    # permission as one-off allowances so a people-ops role (HR) that the catalogue
    # grants `manage_allowances` can verify+pay, not just owners/admins. RBAC off
    # ⇒ owner/admin-only as before (permission is a no-op until the flag flips).
    from core.permission_guards import company_rbac_enabled, assert_company_permission
    if company_rbac_enabled():
        assert_company_permission(current_user, schedule.company_id, "manage_allowances", db)
    else:
        from core.auth_guards import require_company_admin
        require_company_admin(current_user, schedule.company_id, db)
    result = await verify_schedule_completion(schedule_id, current_user.user_id, db)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schedule not found")
    return result


@router.delete('/schedule/{schedule_id}', status_code=status.HTTP_204_NO_CONTENT)
async def delete_schedule_endpoint(schedule_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(config.get_db)):
    """Delete a schedule. Scoped to the schedule's company."""
    _assert_schedule_access(schedule_id, current_user, db)
    success = await delete_schedule(schedule_id, db)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schedule not found")
    return _fastapi.Response(status_code=status.HTTP_204_NO_CONTENT)

# --- Employee Verification Endpoints ---

@router.get('/company-brn/{company_brn}', status_code=200, response_model=List[PendingEmployee])
def get_jobs_by_company_brn(company_brn: str, db: Session = Depends(config.get_db)):
    """Get all job profiles for employees who claim to work for a company (by BRN)"""
    try:
        from core.model import Job, PrivateUser, User
        from schema.job_schema import PendingEmployee

        # Join Job with PrivateUser and User to get complete employee information
        logger.info(f"Searching for jobs with employer_brn: '{company_brn}'")
        
        jobs = db.query(Job).join(
            PrivateUser, Job.private_user_id == PrivateUser.private_user_id
        ).join(
            User, PrivateUser.user_id == User.user_id
        ).filter(
            Job.employer_brn == company_brn
        ).all()
        
        logger.info(f"Found {len(jobs)} jobs with complete user data for company BRN: {company_brn}")

        if not jobs:
            logger.info(f"No jobs found for company BRN: {company_brn}")
            return []

        # Convert to PendingEmployee format
        pending_employees = []
        for job in jobs:
            try:
                user = job.private_user.user if job.private_user else None
                private_user = job.private_user

                # Get salary info if available
                salary_info = None
                currency = None
                if job.salaries and len(job.salaries) > 0:
                    latest_salary = max(job.salaries, key=lambda s: s.created_at or datetime.min)
                    salary_info = str(latest_salary.salary)
                    currency = latest_salary.currency

                employee_data = {
                    "id": job.job_id,
                    "user_id": user.user_id if user else None,
                    "private_user_id": private_user.private_user_id if private_user else None,
                    "job_id": job.job_id,
                    "first_name": private_user.first_name if private_user else None,
                    "last_name": private_user.last_name if private_user else None,
                    "email": user.email if user else None,
                    "phone": private_user.phone if private_user else None,
                    "passport_number": private_user.pass_port_number if private_user else None,
                    "date_of_birth": str(private_user.date_of_birth) if private_user and private_user.date_of_birth else None,
                    "job_title": job.job_title,
                    "employer_name": job.employer_name,
                    "employer_brn": job.employer_brn,
                    "employer_email": job.employer_email,
                    "employer_phone": job.employer_phone,
                    "employer_address": job.employer_address,
                    "first_date_of_employment": str(job.first_date_of_employment) if job.first_date_of_employment else None,
                    "work_start_time": str(job.work_start_time) if job.work_start_time else None,
                    "work_end_time": str(job.work_end_time) if job.work_end_time else None,
                    "monthly_salary": salary_info,
                    "currency": currency,
                    "last_clock_in_location": None,  # Not available in current model
                    "last_clock_out_location": None,  # Not available in current model
                    "total_work_locations": None,  # Not available in current model
                    "created_at": str(job.created_at) if job.created_at else None,
                    "verification_status": job.verification_status or "pending"
                }
                pending_employees.append(employee_data)
            except Exception as job_error:
                logger.error(f"Error processing job {job.job_id}: {job_error}")
                continue
        
        logger.info(f"Successfully fetched {len(pending_employees)} employees for company BRN: {company_brn}")
        return pending_employees

    except SQLAlchemyError as e:
        logger.error(f"Database error getting jobs by BRN {company_brn}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Database error occurred")
    except Exception as ex:
        logger.error(f"Unexpected error getting jobs by BRN {company_brn}: {ex}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="An unexpected error occurred")

@router.post('/verify/{job_id}/approve', status_code=200)
async def approve_employee_verification(job_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(config.get_db)):
    """Approve employee verification for a job and link user to company. Only the
    employer (a member/admin of the company matching the job's BRN) may approve."""
    try:
        from core.model import Job, PrivateUser, Company
        from datetime import datetime
        
        job = db.query(Job).filter(Job.job_id == job_id).first()
        if not job:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
        
        # Get the private user
        private_user = db.query(PrivateUser).filter(
            PrivateUser.private_user_id == job.private_user_id
        ).first()
        if not private_user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")
        
        # Find company by BRN
        company = db.query(Company).filter(Company.brn == job.employer_brn).first()
        if not company:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")

        # Tenant-scope: the caller must belong to the company they're approving
        # the worker INTO (else any logged-in user could approve a claim against
        # any company's BRN and attach an employee to it).
        assert_company_access(current_user, company.company_id, db)

        # Update verification status
        job.verification_status = 'approved'
        job.verified_at = datetime.utcnow()
        job.verified_by = 'employer'  # You might want to get this from authentication
        job.company_id = company.company_id  # Link job to company
        job.updated_at = datetime.utcnow()
        
        # Per policy: do NOT set PrivateUser.company_id here. Only link the job to the company.
        # Mark the associated user as verified so dashboard counts them
        user = None
        try:
            if private_user and getattr(private_user, 'user', None):
                user = private_user.user
            elif private_user and private_user.user_id:
                from core.model import User as UserModel
                user = db.query(UserModel).filter(UserModel.user_id == private_user.user_id).first()

            if user and not getattr(user, 'user_verified', False):
                user.user_verified = True
                db.add(user)
        except Exception as e:
            logger.warning(f"Could not mark user as verified for job {job_id}: {e}")

        # Persist job and user changes and refresh
        db.add(job)
        if user:
            db.add(user)
        db.commit()
        db.refresh(job)
        db.refresh(private_user)
        if user:
            db.refresh(user)

        return {
            "message": "Employee verification approved successfully",
            "job_id": job.job_id,
            "company": {
                "company_id": company.company_id,
                "company_name": company.company_name,
                "brn": company.brn
            }
        }
        
    except HTTPException as e:
        raise e
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"Database error approving verification for job {job_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Database error occurred")
    except Exception as ex:
        db.rollback()
        logger.error(f"Unexpected error approving verification for job {job_id}: {ex}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="An unexpected error occurred")

@router.post('/verify/{job_id}/reject', status_code=200)
async def reject_employee_verification(
    job_id: int,
    rejection_data: dict = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(config.get_db)
):
    """Reject employee verification for a job. Only the employer (a member/admin of
    the company the worker is claiming) may reject."""
    try:
        from core.model import Job, PrivateUser, Company
        from datetime import datetime

        job = db.query(Job).filter(Job.job_id == job_id).first()
        if not job:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")

        # Tenant-scope: resolve the claimed company (already-linked company_id, or
        # by the job's employer_brn pre-approval) and require the caller to belong
        # to it. Fail-closed if no company is resolvable.
        _cid = job.company_id
        if _cid is None and job.employer_brn:
            _co = db.query(Company).filter(Company.brn == job.employer_brn).first()
            _cid = _co.company_id if _co else None
        assert_company_access(current_user, _cid, db)

        # Update verification status
        job.verification_status = 'rejected'
        job.verified_at = datetime.utcnow()
        job.verified_by = 'employer'  # You might want to get this from authentication
        job.rejection_reason = rejection_data.get('reason', 'No reason provided') if rejection_data else 'No reason provided'
        job.updated_at = datetime.utcnow()
        
        # Optional: Remove company link if this was their only/primary job
        # You might want to add business logic here based on your requirements
        
        db.commit()
        db.refresh(job)
        
        return {
            "message": "Employee verification rejected successfully", 
            "job_id": job_id,
            "reason": job.rejection_reason
        }
        
    except HTTPException as e:
        raise e
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"Database error rejecting verification for job {job_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Database error occurred")
    except Exception as ex:
        db.rollback()
        logger.error(f"Unexpected error rejecting verification for job {job_id}: {ex}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="An unexpected error occurred")


@router.patch('/{job_id}/department', status_code=200)
async def patch_job_department(job_id: int, payload: dict, current_user = Depends(get_current_user), db: Session = Depends(config.get_db)):
    """Set or clear the department for a job (company owner only)"""
    try:
        from core.model import Job, Department, Company, User

        job = db.query(Job).filter(Job.job_id == job_id).first()
        if not job:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Job not found')

        # Ensure job belongs to a company and current_user is owner
        if not job.company_id:
            raise HTTPException(status_code=400, detail='Job has no company')

        company = db.query(Company).filter(Company.company_id == job.company_id).first()
        if not company:
            raise HTTPException(status_code=404, detail='Company not found')

        # Authorization: only owner can change
        if not current_user or company.user_id != current_user.user_id:
            raise HTTPException(status_code=403, detail='Only company owner can set job department')

        dept_id = payload.get('department_id')
        if dept_id is None:
            job.department_id = None
            db.commit()
            return {'job_id': job_id, 'department_id': None}

        dept = db.query(Department).filter(Department.department_id == int(dept_id), Department.company_id == job.company_id).first()
        if not dept:
            raise HTTPException(status_code=400, detail='Invalid department for this company')

        job.department_id = dept.department_id
        db.commit()
        return {'job_id': job_id, 'department_id': dept.department_id}

    except HTTPException as e:
        raise e
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"Database error setting job department for job {job_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail='Database error occurred')
    except Exception as ex:
        db.rollback()
        logger.error(f"Unexpected error setting job department for job {job_id}: {ex}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail='An unexpected error occurred')


@router.patch('/{job_id}/details', status_code=200)
async def patch_job_details(job_id: int, payload: dict = _fastapi.Body(...), current_user: User = Depends(get_current_user), db: Session = Depends(config.get_db)):
    """Update lightweight job text fields (job_title, employer_name, employer_brn, etc.) without full schema validation. Scoped to the job's company."""
    # kiosk v1.6 — max_shift_hours added to the allowlist as the per-job
    # override for the missed-clockout cron's fallback chain (M27).
    ALLOWED_FIELDS = {'job_title', 'employer_name', 'employer_brn', 'employer_phone', 'employer_address', 'employer_email', 'company_id', 'max_shift_hours'}
    # Caller must belong to the job's current company.
    _assert_job_access(job_id, current_user, db)
    try:
        from core.model import Job as JobModel
        job = db.query(JobModel).filter(JobModel.job_id == job_id).first()
        if not job:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Job not found')

        updated_fields = {}
        for field, value in payload.items():
            if field in ALLOWED_FIELDS and hasattr(job, field):
                # Reassigning the job to another company requires access to the
                # TARGET company too — otherwise a member of company A could move
                # a job into company B.
                if field == 'company_id' and value is not None and value != job.company_id:
                    assert_company_access(current_user, value, db)
                setattr(job, field, value)
                updated_fields[field] = value

        if updated_fields:
            job.updated_at = datetime.now()
            db.commit()

        return {'job_id': job_id, **updated_fields}

    except HTTPException as e:
        raise e
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"Database error patching job details for job {job_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail='Database error occurred')
    except Exception as ex:
        db.rollback()
        logger.error(f"Unexpected error patching job details for job {job_id}: {ex}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail='An unexpected error occurred')


@router.get('/verified/{company_brn}', status_code=status.HTTP_200_OK)
async def get_verified_employees_by_brn(company_brn: str, db: Session = Depends(config.get_db)):
    """Get all verified employees for a company (by BRN)"""
    try:
        from core.model import Job, PrivateUser, User
        from schema.job_schema import PendingEmployee

        # Get only approved jobs with user data
        jobs = db.query(Job).join(
            PrivateUser, Job.private_user_id == PrivateUser.private_user_id
        ).join(
            User, PrivateUser.user_id == User.user_id
        ).filter(
            Job.employer_brn == company_brn,
            Job.verification_status == 'approved'
        ).all()

        if not jobs:
            logger.info(f"No verified jobs found for company BRN: {company_brn}")
            return []

        # Convert to VerifiedEmployee format (similar to PendingEmployee but for verified)
        verified_employees = []
        for job in jobs:
            try:
                user = job.private_user.user if job.private_user else None
                private_user = job.private_user

                # Get salary info if available
                salary_info = None
                currency = None
                if job.salaries and len(job.salaries) > 0:
                    latest_salary = max(job.salaries, key=lambda s: s.created_at or datetime.min)
                    salary_info = str(latest_salary.salary)
                    currency = latest_salary.currency

                employee_data = {
                    "id": job.job_id,
                    "user_id": user.user_id if user else None,
                    "private_user_id": private_user.private_user_id if private_user else None,
                    "job_id": job.job_id,
                    "name": f"{private_user.first_name} {private_user.last_name}" if private_user else None,
                    "email": user.email if user else None,
                    "phone": private_user.phone if private_user else None,
                    "position": job.job_title,
                    # Prefer department name if job is linked to a Department; fallback to employer_name
                    "department": job.department.name if job.department else (job.employer_name or None),
                    "status": "verified",
                    "start_date": str(job.first_date_of_employment) if job.first_date_of_employment else None,
                    "work_hours": f"{job.work_start_time} - {job.work_end_time}" if job.work_start_time and job.work_end_time else None,
                    "monthly_salary": salary_info,
                    "currency": currency,
                    "verification_date": str(job.updated_at) if job.updated_at else None,  # Using updated_at as verification date
                    "onboard_complete": user.onboard_complete if user else False
                }
                verified_employees.append(employee_data)
            except Exception as job_error:
                logger.error(f"Error processing verified job {job.job_id}: {job_error}")
                continue

        logger.info(f"Successfully fetched {len(verified_employees)} verified employees for company BRN: {company_brn}")
        return verified_employees

    except SQLAlchemyError as e:
        logger.error(f"Database error getting verified jobs by BRN {company_brn}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Database error occurred")
    except Exception as ex:
        logger.error(f"Unexpected error getting verified jobs by BRN {company_brn}: {ex}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="An unexpected error occurred")
