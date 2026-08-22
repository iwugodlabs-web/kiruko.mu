import os
from schema.user_schema import UpdatePrivateUser
from dotenv import load_dotenv
from fastapi import HTTPException
from sqlalchemy import create_engine, Column, Integer, String, Date
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, joinedload
from core.model import Job as JobORM, Salary as SalaryORM,Company,TimeLog as TimeLogORM, User, PrivateUser, Schedule as ScheduleORM, BreakLog as BreakLogORM, ScheduleAssigneeStatus

# Try to import JobHistory, but make it optional in case the table doesn't exist yet
try:
    from core.model import JobHistory as JobHistoryORM
    JOB_HISTORY_AVAILABLE = True
except ImportError:
    JobHistoryORM = None
    JOB_HISTORY_AVAILABLE = False
# from schema.user_schema import *
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError
import logging
import sys
from email_validator import EmailNotValidError, validate_email
from datetime import timezone, timedelta
from fastapi.concurrency import run_in_threadpool
from fastapi import status
from schema.job_schema import *
from datetime import datetime


def _parse_decimal(value: Optional[str]) -> float:
    try:
        return float(str(value or '0').replace(',', '').strip())
    except (ValueError, TypeError):
        return 0.0


def _enforce_salary_money(salary_obj) -> None:
    """The single invariant for salary money columns: revenue = salary + allowance.

    `allowance` is the authoritative, editable figure; `revenue` is a derived
    (legacy) mirror that is ALWAYS recomputed here and never trusted from the
    client — that's what caused the "frozen revenue" drift. Allowance is floored
    at 0. Every write path (create_salary, update_salary, onboard) calls this so
    the salary↔revenue relationship is defined in exactly one place.
    """
    salary_val = _parse_decimal(getattr(salary_obj, 'salary', 0))
    allowance_val = max(0.0, _parse_decimal(getattr(salary_obj, 'allowance', 0)))
    salary_obj.allowance = str(round(allowance_val, 2))
    salary_obj.revenue = str(round(salary_val + allowance_val, 2))


def resolve_salary_currency(db: Session, job_obj) -> Optional[str]:
    """The operating currency for a job's salary, derived from the employee's
    effective country (company country → own country_code → phone), matching
    `Company.currency` / `Country.currency`.

    Currency is server-authoritative: the client used to hardcode 'MUR', which
    stamped every salary MUR regardless of country. Callers stamp the return of
    this over any client-supplied value. Returns None only if it can't be
    resolved, in which case the caller leaves the existing/DB-default value.
    """
    from core.model import Country as CountryORM
    if job_obj is None or getattr(job_obj, 'private_user_id', None) is None:
        return None
    pu = db.query(PrivateUser).filter(
        PrivateUser.private_user_id == job_obj.private_user_id).first()
    if not pu:
        return None
    code = pu.effective_country_code  # 'MU' / 'TZ'
    if not code:
        return None
    country = db.query(CountryORM).filter(CountryORM.code == code).first()
    return country.currency if country and country.currency else None



async def create_job(job: CreateJob, db: Session):
    try:
        reason_for_deduction = job.reason_for_deduction or {}

        # print(f"[create_job] Input Pydantic job: {job}")
        # print(f"[create_job] Input dict: {job.dict()}")
        job_obj = JobORM(
            private_user_id=job.private_user_id,
            company_id=getattr(job, "company_id", None),
            job_title=job.job_title,
            employer_name=job.employer_name,
            employer_brn=job.employer_brn,
            employer_email=job.employer_email,
            employer_phone=job.employer_phone,
            employer_address=job.employer_address,
            first_date_of_employment=job.first_date_of_employment,
            work_start_time=job.work_start_time,
            work_end_time=job.work_end_time,
            work_days=job.work_days,
            has_contract=job.has_contract,
            has_permission_to_work=job.has_permission_to_work,
            work_permit_type=job.work_permit_type,
            working_on_tourist_visa=job.working_on_tourist_visa,
            is_salary_deducted=job.is_salary_deducted,
            reason_for_deduction=reason_for_deduction,
            is_accommodation_covered_by_employer=job.is_accommodation_covered_by_employer,
            is_accommodation_a_dormitory=job.is_accommodation_a_dormitory,
            is_accommodation_decent=job.is_accommodation_decent,
            is_passport_retained=job.is_passport_retained,
            is_job_execution_same_as_description=job.is_job_execution_same_as_description,
            doubts_about_compensation=job.doubts_about_compensation,
            department_id=getattr(job, "department_id", None),
            created_at=datetime.now(timezone.utc),
        )
        db.add(job_obj)
        db.flush()
        db.refresh(job_obj)

        # print(f"[create_job] Created ORM job_obj fields: {job_obj.__dict__}")
        return job_obj  # Ensure the created job object is returned
    except SQLAlchemyError as e:
        print(f"[create_job] SQLAlchemyError: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    except Exception as ex:
        print(f"[create_job] Unexpected Exception: {ex}", file=sys.stderr)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(ex))
    except Exception:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)

async def create_salary(job: Salary, db: Session):

    print(f"[create_salary] Input Pydantic job: {job}")

    job_exists = db.query(JobORM).filter(JobORM.job_id == job.job_id).first()
    if not job_exists:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Job with id {job.job_id} does not exist.",
        )
    try:
        salary_val = _parse_decimal(job.salary)
        raw_allowance = getattr(job, 'allowance', None)
        if raw_allowance is not None:
            allowance_val = max(0.0, _parse_decimal(raw_allowance))
        else:
            # Legacy callers that only send `revenue` (the gross): recover the
            # allowance once as revenue - salary.
            allowance_val = max(0.0, _parse_decimal(getattr(job, 'revenue', '0')) - salary_val)

        salary_obj = SalaryORM(
            job_id=job.job_id,
            # Denormalized RLS tenant column — set from the job so we never
            # depend on the DB BEFORE-INSERT trigger (missing on prod's
            # create_all-bootstrapped schema → NULL → not-null violation).
            company_id=job_exists.company_id,
            monthly_hours=job.monthly_hours,
            break_in_minutes_per_day=job.break_in_minutes_per_day,
            days_of_work_per_month=job.days_of_work_per_month,
            salary=job.salary,
            allowance=str(round(allowance_val, 2)),
            # Invariant: revenue = salary + allowance (never a client value).
            revenue=str(round(salary_val + allowance_val, 2)),
            # Set pay_basis EXPLICITLY rather than leaning on the column's
            # server_default('monthly'). On prod (schema create_all-bootstrapped,
            # so the employment_type_paybasis migration no-ops) salaries.pay_basis
            # can be NOT NULL WITHOUT the default — then omitting it here inserts
            # NULL and the whole "Complete Profile" save dies with an
            # IntegrityError. Writing it always keeps the insert self-sufficient.
            pay_basis=(getattr(job, 'pay_basis', None) or 'monthly'),
            created_at=datetime.now(timezone.utc),
        )
        # Currency is server-authoritative (derived from the employee's country),
        # not the client's hardcoded 'MUR'. Falls back to the model default only
        # if the country can't be resolved.
        resolved_currency = resolve_salary_currency(db, job_exists)
        if resolved_currency:
            salary_obj.currency = resolved_currency
        db.add(salary_obj)
        db.flush()
        db.refresh(salary_obj)
    except SQLAlchemyError as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    except:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
    return salary_obj


async def update_salary(salary_id: int, salary_data: dict, db: Session):
    salary_obj = db.query(SalaryORM).filter(SalaryORM.salary_id == salary_id).first()
    if not salary_obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Salary record with id {salary_id} does not exist.",
        )
    try:
        prev_salary = _parse_decimal(salary_obj.salary)
        prev_revenue = _parse_decimal(getattr(salary_obj, 'revenue', '0'))
        had_allowance = salary_obj.allowance is not None and str(salary_obj.allowance).strip() != ''

        # Apply incoming fields, but NEVER trust a client-sent `revenue`: it is
        # derived (revenue = salary + allowance) and a stale/legacy value here
        # is exactly what froze the gross. Drop it and recompute below.
        for field, value in salary_data.items():
            if field == 'revenue':
                continue
            if value is not None and hasattr(salary_obj, field):
                setattr(salary_obj, field, value)

        # Legacy rows: if no allowance was ever stored and the client didn't
        # send one, recover it once from the old revenue so it isn't wiped.
        if 'allowance' not in salary_data and not had_allowance:
            salary_obj.allowance = str(max(0.0, prev_revenue - prev_salary))

        _enforce_salary_money(salary_obj)
        salary_obj.updated_at = datetime.now(timezone.utc)
        db.flush()
        db.refresh(salary_obj)
    except SQLAlchemyError as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    return salary_obj

async def create_time_log(clockin: CreateTimeLog, db: Session, client_ip: Optional[str] = None):
    try:
        print(f"Received payload: {clockin}")

        # Ensure datetime parsing from string or directly as datetime
        start_time = clockin.start_time
        end_time = clockin.end_time

        # Calculate hours_worked
        if start_time and end_time:
            # This path is less likely for creation, but included for completeness
            if start_time.tzinfo is None: start_time = start_time.replace(tzinfo=timezone.utc)
            if end_time.tzinfo is None: end_time = end_time.replace(tzinfo=timezone.utc)

            total_seconds = (end_time - start_time).total_seconds()
            worked_seconds = max(total_seconds, 0)
            hours_worked = round(worked_seconds / 3600, 2)
        else:
            hours_worked = None

        from services.time_log_service import TimeLogService

        # Close any stale session first (max-shift / scheduled-end / day-boundary)
        # so a forgotten previous-day or past-shift session never blocks a fresh
        # clock-in — the same rule the kiosk uses.
        TimeLogService.resolve_stale_for_user(db, clockin.private_user_id)

        active_logs = db.query(TimeLogORM).filter(
            TimeLogORM.private_user_id == clockin.private_user_id,
            TimeLogORM.end_time.is_(None)
        ).all()

        if active_logs:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You already have an active clock-in session. Please clock out before starting a new session."
            )

        if start_time and end_time:
            from services.time_log_service import TimeLogService
            conflict = TimeLogService.find_overlapping_time_log(
                db, clockin.private_user_id, start_time, end_time,
            )
            if conflict:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        f"This clock-in overlaps an existing session "
                        f"(timelog {conflict.timelog_id})."
                    ),
                )

        # Handle flexible location format
        location_data = clockin.location
        if hasattr(location_data, 'dict'):
            # Pydantic model
            location_json = location_data.dict()
        elif isinstance(location_data, dict):
            # Already a dict
            location_json = location_data
        else:
            # Convert to dict if it's another type
            location_json = dict(location_data)
        
        # Respect the employee's schedule on the mobile path too — FLAG (not
        # block) a clock-in outside the configured shift window, the same rule
        # the kiosk applies. Best-effort: a flag-check failure never blocks the
        # clock-in itself.
        out_of_schedule = False
        is_late = False
        try:
            from services.kiosk_service import KioskService
            from core.tenant_context import bypass_tenant_guard
            # PK lookups on jobs/private_users/companies carry no company_id
            # filter; this is a flag-only read for the user we're already
            # clocking in, so bypass the tenant guard (same as the system sweep).
            with bypass_tenant_guard("clock-in out_of_schedule flag check (single user)"):
                job_row = db.query(JobORM).filter(JobORM.job_id == clockin.job_id).first()
                pu = db.query(PrivateUser).filter(PrivateUser.private_user_id == clockin.private_user_id).first()
                comp = pu.company if pu else None
                company_tz = getattr(comp, "timezone", None)
            out_of_schedule = KioskService.is_out_of_schedule(
                job=job_row, company_timezone=company_tz, clock_in_at=start_time,
            )
            # Late START (after start + grace, still in shift) — distinct from
            # off-hours. Computed server-side; the client never sets is_late.
            is_late = KioskService.is_late_start(
                job=job_row, company_timezone=company_tz, clock_in_at=start_time,
            )
        except Exception:
            logging.exception("mobile clock-in out_of_schedule check failed (non-blocking)")
            is_late = False
        # Only keep a late reason when the clock-in is actually late.
        late_reason = (clockin.late_reason or None) if is_late else None

        # Geofencing v3 — location-based enforcement. Best-effort decision
        # path: a geofence config/DB fault must NOT silently record a punch
        # that should have been blocked, so we enforce inside the same
        # tenant-bypass read (PK-scoped to this user's company) and let a
        # failure surface rather than swallowing it.
        out_of_geofence = False
        geofence_audit = None
        try:
            from services.geofence_service import (
                PunchContext,
                employee_home_fence_id,
                enforce_punch,
                get_company_geofences,
            )
            loc = location_json
            gctx = getattr(clockin, "geo_check", None)
            ctx = PunchContext(
                latitude=loc.get("latitude") if isinstance(loc, dict) else None,
                longitude=loc.get("longitude") if isinstance(loc, dict) else None,
                accuracy_m=gctx.accuracy_m if gctx else None,
                fix_timestamp=gctx.fix_timestamp if gctx else None,
                mock_detected=bool(gctx and gctx.mock_detected),
                qr_token=gctx.qr_token if gctx else None,
                wifi_bssid=gctx.wifi_bssid if gctx else None,
                device_id=gctx.device_id if gctx else None,
                os=gctx.os if gctx else None,
                app_version=gctx.app_version if gctx else None,
                ip_address=client_ip,
                source="kiosk" if clockin.created_source == "kiosk" else "mobile",
                home_geofence_id=employee_home_fence_id(db, clockin.private_user_id),
            )
            if comp is not None:
                fences = get_company_geofences(comp.company_id, db)
                outcome = enforce_punch(comp, fences, ctx)
                out_of_geofence = outcome.flagged
                geofence_audit = outcome.audit
                if outcome.flagged:
                    from db_models.crud.audit import create_audit_log
                    create_audit_log(
                        db,
                        user_id=None,
                        action="geofence_flag",
                        resource_type="TimeLog",
                        resource_id=None,  # timelog_id not created yet
                        details={"punch": outcome.audit, "reason": outcome.reason},
                    )
        except HTTPException:
            raise
        except Exception:
            logging.exception("geofence check failed on mobile clock-in (non-blocking)")
            out_of_geofence = False
            geofence_audit = None

        time_log_orm = TimeLogORM(
            job_id=clockin.job_id,
            private_user_id=clockin.private_user_id,
            day_of_week=clockin.day_of_week,
            start_time=start_time,
            end_time=end_time,
            location=location_json,
            hours_worked=hours_worked,
            out_of_schedule=out_of_schedule,
            is_late=is_late,
            late_reason=late_reason,
            out_of_geofence=out_of_geofence,
            geofence_check_json=geofence_audit,
            # M26 — provenance: 'mobile' default keeps every existing caller
            # behaviorally identical; KioskService passes 'kiosk' explicitly.
            created_source=clockin.created_source or 'mobile',
            created_at=datetime.now(timezone.utc),
        )

        db.add(time_log_orm)
        db.commit()
        db.refresh(time_log_orm)

        logging.info(f"Validated payload: {clockin}")
        return time_log_orm

    except SQLAlchemyError as e:
        db.rollback()
        logging.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    except HTTPException:
        db.rollback()
        raise
    except Exception as ex:
        db.rollback()
        logging.error("Unexpected Error:", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(ex))

async def get_all_time_logs(db: Session):
    """Get all time logs with break logs"""
    try:
        time_logs = db.query(TimeLogORM).all()
        
        # Add break logs to each time log
        for time_log in time_logs:
            break_logs = db.query(BreakLogORM).filter(BreakLogORM.timelog_id == time_log.timelog_id).all()
            time_log.breaks = break_logs
            
        return time_logs
    except SQLAlchemyError as e:
        logging.error(f"SQLAlchemyError while fetching all time logs: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    except Exception as ex:
        logging.error(f"Unexpected Error while fetching all time logs: {ex}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(ex))

async def get_time_logs_by_company(company_id: int, db: Session):
    """Get all time logs for a specific company with break logs and employee details"""
    try:
        # Join with PrivateUser, User, and Job to get details
        # Fetch PrivateUser to get first_name/last_name
        results = db.query(TimeLogORM, PrivateUser, JobORM)\
            .join(PrivateUser, TimeLogORM.private_user_id == PrivateUser.private_user_id)\
            .join(JobORM, TimeLogORM.job_id == JobORM.job_id)\
            .filter(JobORM.company_id == company_id)\
            .order_by(TimeLogORM.start_time.desc())\
            .all()
        
        final_logs = []
        for time_log, private_user, job in results:
            # Add break logs to each time log
            break_logs = db.query(BreakLogORM).filter(BreakLogORM.timelog_id == time_log.timelog_id).all()
            time_log.breaks = break_logs
            
            # Add employee details
            time_log.employee_name = f"{private_user.first_name or ''} {private_user.last_name or ''}".strip()
            time_log.job_title = job.job_title
            
            final_logs.append(time_log)
            
        return final_logs
    except SQLAlchemyError as e:
        logging.error(f"SQLAlchemyError while fetching time logs by company: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    except Exception as ex:
        logging.error(f"Unexpected Error while fetching time logs by company: {ex}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(ex))

async def get_time_logs_by_job(job_id: int, db: Session):
    """Get time logs for a specific job with break logs"""
    try:
        time_logs = db.query(TimeLogORM).filter(TimeLogORM.job_id == job_id).all()
        
        # Add break logs to each time log
        for time_log in time_logs:
            break_logs = db.query(BreakLogORM).filter(BreakLogORM.timelog_id == time_log.timelog_id).all()
            time_log.breaks = break_logs
            
        return time_logs
    except SQLAlchemyError as e:
        logging.error(f"SQLAlchemyError while fetching job time logs: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    except Exception as ex:
        logging.error(f"Unexpected Error while fetching job time logs: {ex}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(ex))

async def get_time_logs_by_user(private_user_id: int, db: Session, date_from: Optional[str] = None, date_to: Optional[str] = None):
    """Get time logs for a specific user with break logs and optional date filtering"""
    try:
        query = db.query(TimeLogORM).filter(TimeLogORM.private_user_id == private_user_id)
        
        if date_from:
            try:
                # Assuming date_from is 'YYYY-MM-DD'; treat as UTC start-of-day to match TIMESTAMPTZ column
                start_date = datetime.fromisoformat(date_from).replace(
                    hour=0, minute=0, second=0, microsecond=0, tzinfo=timezone.utc
                )
                query = query.filter(TimeLogORM.start_time >= start_date)
            except (ValueError, TypeError):
                logging.warning(f"Invalid date_from format: {date_from}")

        if date_to:
            try:
                # Assuming date_to is 'YYYY-MM-DD'; treat as UTC end-of-day to match TIMESTAMPTZ column
                end_date = datetime.fromisoformat(date_to).replace(
                    hour=23, minute=59, second=59, microsecond=999999, tzinfo=timezone.utc
                )
                query = query.filter(TimeLogORM.start_time <= end_date)
            except (ValueError, TypeError):
                logging.warning(f"Invalid date_to format: {date_to}")

        time_logs = query.order_by(TimeLogORM.start_time.desc()).all()
        
        # Add break logs to each time log
        for time_log in time_logs:
            break_logs = db.query(BreakLogORM).filter(BreakLogORM.timelog_id == time_log.timelog_id).all()
            time_log.breaks = break_logs
        
        logging.info(
            "🔧 Backend: get_time_logs_by_user query result",
            extra={
                "private_user_id": private_user_id,
                "date_from": date_from,
                "date_to": date_to,
                "returned": len(time_logs),
                "sample_ids": [log.timelog_id for log in time_logs[:8]],
            },
        )
        return time_logs
    except SQLAlchemyError as e:
        logging.error(f"SQLAlchemyError while fetching user time logs: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    except Exception as ex:
        logging.error(f"Unexpected Error while fetching user time logs: {ex}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(ex))

async def update_time_log(time_log_id: int, time_log_data: dict, db: Session, client_ip: Optional[str] = None) -> Optional[TimeLogORM]:
    """Update a time log record."""
    try:
        time_log = db.query(TimeLogORM).filter(TimeLogORM.timelog_id == time_log_id).first()
        if not time_log:
            return None

        # Parse string dates from payload into datetime objects
        datetime_fields = ['start_time', 'end_time'] #, 'break_start_time', 'break_end_time']
        for field in datetime_fields:
            if field in time_log_data and isinstance(time_log_data[field], str):
                try:
                    # The frontend sends ISO 8601 format (e.g., with 'Z' at the end)
                    time_log_data[field] = datetime.fromisoformat(time_log_data[field].replace('Z', '+00:00'))
                except (ValueError, TypeError):
                    # Handle cases where the date string might be invalid or None
                    time_log_data[field] = None

        # Handle location updates specially for clock-out
        if 'location' in time_log_data:
            # Get current location data
            current_location = time_log.location or {}
            if isinstance(current_location, str):
                import json
                current_location = json.loads(current_location)
            
            # For clock-out, store location under clock_out
            new_location_data = time_log_data['location']
            if hasattr(new_location_data, 'dict'):
                new_location_dict = new_location_data.dict()
            elif isinstance(new_location_data, dict):
                new_location_dict = new_location_data
            else:
                new_location_dict = dict(new_location_data)
            
            # Merge with existing location data
            updated_location = dict(current_location)
            updated_location['clock_out'] = new_location_dict
            time_log.location = updated_location
            # Remove location from time_log_data to avoid double processing
            del time_log_data['location']

            # Geofencing v3 — enforce the fence on clock-out too, using the
            # clock_out coordinates the client just sent. Same rules as
            # clock-in: block rejects, flag marks out_of_geofence. A geofence
            # config/DB fault surfaces rather than being silently swallowed —
            # clock-out is the second half of the compliance story.
            geo_check = time_log_data.pop('geo_check', None) or {}
            try:
                from services.geofence_service import (
                    PunchContext,
                    employee_home_fence_id,
                    enforce_punch,
                    get_company_geofences,
                )
                company = time_log.job.company if time_log.job else None
                if company is not None and new_location_dict.get('latitude') is not None:
                    fences = get_company_geofences(company.company_id, db)
                    ctx = PunchContext(
                        latitude=new_location_dict.get('latitude'),
                        longitude=new_location_dict.get('longitude'),
                        accuracy_m=geo_check.get('accuracy_m'),
                        fix_timestamp=geo_check.get('fix_timestamp'),
                        mock_detected=bool(geo_check.get('mock_detected')),
                        qr_token=geo_check.get('qr_token'),
                        wifi_bssid=geo_check.get('wifi_bssid'),
                        device_id=geo_check.get('device_id'),
                        os=geo_check.get('os'),
                        app_version=geo_check.get('app_version'),
                        ip_address=client_ip,
                        source="mobile",
                        home_geofence_id=employee_home_fence_id(db, time_log.private_user_id),
                    )
                    outcome = enforce_punch(company, fences, ctx)
                    if outcome.flagged:
                        time_log.out_of_geofence = True
                    existing_check = time_log.geofence_check_json or {}
                    existing_check['clock_out'] = outcome.audit
                    time_log.geofence_check_json = existing_check
                    if outcome.flagged:
                        from db_models.crud.audit import create_audit_log
                        create_audit_log(
                            db,
                            user_id=None,
                            action="geofence_flag",
                            resource_type="TimeLog",
                            resource_id=time_log.timelog_id,
                            details={"punch": outcome.audit, "reason": outcome.reason},
                        )
            except HTTPException:
                raise
            except Exception:
                logging.exception("geofence check failed on mobile clock-out (non-blocking)")

        for field, value in time_log_data.items():
            if hasattr(time_log, field):
                setattr(time_log, field, value)

        # Recalculate total hours_worked if clocking out
        if time_log.start_time and time_log.end_time:
            start_time = time_log.start_time
            end_time = time_log.end_time

            # Ensure both datetimes are timezone-aware before subtraction
            if start_time.tzinfo is None: start_time = start_time.replace(tzinfo=timezone.utc)
            if end_time.tzinfo is None: end_time = end_time.replace(tzinfo=timezone.utc)

            from services.time_log_service import TimeLogService
            conflict = TimeLogService.find_overlapping_time_log(
                db, time_log.private_user_id, start_time, end_time,
                exclude_timelog_id=time_log.timelog_id,
            )
            if conflict:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        f"This update overlaps an existing session "
                        f"(timelog {conflict.timelog_id})."
                    ),
                )

            # Calculate total break time from the associated break_logs table.
            # A break started but never explicitly ended (e.g. the employee
            # clocked back in without first pressing "end break") must still
            # count as break time through the clock-out, or it's silently
            # excluded entirely here — inflating hours_worked, which real
            # payroll sums for hourly staff (proration.sum_hours_worked_in_period).
            # Mobile's own local hours calculation already treats an open
            # break this way (falls back to the session's end_time); match
            # that so the stored value doesn't disagree with what the
            # employee/employer sees on mobile.
            breaks = db.query(BreakLogORM.start_time, BreakLogORM.end_time).filter(
                BreakLogORM.timelog_id == time_log_id,
            ).all()
            total_break_seconds = 0.0
            for b_start, b_end in breaks:
                if b_start is None:
                    continue
                effective_end = b_end if b_end is not None else end_time
                if b_start.tzinfo is None:
                    b_start = b_start.replace(tzinfo=timezone.utc)
                if effective_end.tzinfo is None:
                    effective_end = effective_end.replace(tzinfo=timezone.utc)
                total_break_seconds += max((effective_end - b_start).total_seconds(), 0)

            total_seconds = (end_time - start_time).total_seconds()
            worked_seconds = max(total_seconds - float(total_break_seconds), 0)
            time_log.hours_worked = round(worked_seconds / 3600, 2)

        time_log.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(time_log)
        return time_log
    except SQLAlchemyError as e:
        db.rollback()
        logging.error(f"SQLAlchemyError while updating time log: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    except HTTPException:
        db.rollback()
        raise
    except Exception as ex:
        db.rollback()
        logging.error(f"Unexpected Error while updating time log: {ex}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(ex))

async def create_break_log(timelog_id: int, db: Session) -> Optional[BreakLogORM]:
    """Start a new break for a given time log."""
    try:
        # Ensure the parent time log exists and is active
        time_log = db.query(TimeLogORM).filter(TimeLogORM.timelog_id == timelog_id, TimeLogORM.end_time.is_(None)).first()
        if not time_log:
            raise HTTPException(status_code=404, detail="Active time log not found.")

        new_break = BreakLogORM(
            timelog_id=timelog_id,
            start_time=datetime.now(timezone.utc)
        )
        db.add(new_break)
        db.commit()
        db.refresh(new_break)
        return new_break
    except SQLAlchemyError as e:
        db.rollback()
        logging.error(f"SQLAlchemyError while starting break: {e}")
        raise HTTPException(status_code=500, detail=str(e))

async def update_break_log(timelog_id: int, db: Session) -> Optional[BreakLogORM]:
    """End the current active break for a given time log."""
    try:
        # Find the currently active break for the time log
        active_break = db.query(BreakLogORM).filter(
            BreakLogORM.timelog_id == timelog_id,
            BreakLogORM.end_time.is_(None)
        ).first()

        if not active_break:
            raise HTTPException(status_code=404, detail="No active break found to end.")

        active_break.end_time = datetime.now(timezone.utc)
        db.commit()
        db.refresh(active_break)
        return active_break
    except SQLAlchemyError as e:
        db.rollback()
        logging.error(f"SQLAlchemyError while ending break: {e}")
        raise HTTPException(status_code=500, detail=str(e))

async def mark_time_log_overtime(timelog_id: int, db: Session) -> Optional[TimeLogORM]:
    """Mark a time log as overtime and return it."""
    try:
        timelog = db.query(TimeLogORM).filter(TimeLogORM.timelog_id == timelog_id).first()
        if not timelog:
            return None
        
        timelog.is_overtime = True
        timelog.marked_as_overtime_at = datetime.now(timezone.utc)
        
        db.commit()
        db.refresh(timelog)
        return timelog
    except Exception as e:
        db.rollback()
        logging.error(f"Error marking overtime for timelog {timelog_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

async def get_job_by_id(private_user_id: int, db: Session):
    try:
        logging.info(f"Fetching job for private_user_id: {private_user_id}")
        user_job = db.query(JobORM).filter(JobORM.private_user_id == private_user_id).first()
        if user_job:
            logging.info(f"Job found: {user_job}")
            return user_job  # Return the full job object
        else:
            logging.warning(f"No job found for private_user_id: {private_user_id}")
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logging.error(f"SQLAlchemyError while fetching job: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    except Exception as ex:
        logging.error(f"Unexpected Error while fetching job: {ex}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(ex))

async def get_all_jobs(db: Session):
    """Get all job profiles"""
    try:
        jobs = db.query(JobORM).all()
        return jobs
    except SQLAlchemyError as e:
        logging.error(f"SQLAlchemyError while fetching all jobs: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    except Exception as ex:
        logging.error(f"Unexpected Error while fetching all jobs: {ex}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(ex))

async def get_jobs_by_company(company_id: int, db: Session):
    """Get all jobs for a specific company"""
    try:
        # Check both Job.company_id and PrivateUser.company_id for maximum compatibility
        from sqlalchemy import or_
        jobs = db.query(JobORM).outerjoin(JobORM.private_user).filter(
            or_(
                JobORM.company_id == company_id,
                PrivateUser.company_id == company_id
            )
        ).all()
        return jobs
    except SQLAlchemyError as e:
        logging.error(f"SQLAlchemyError while fetching jobs by company: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    except Exception as ex:
        logging.error(f"Unexpected Error while fetching jobs by company: {ex}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(ex))

# Add a simple update function without history for backward compatibility
async def update_job_simple(job_id: int, job_data: dict, db: Session):
    """Update job profile information without history tracking (fallback)"""
    try:
        job = db.query(JobORM).filter(JobORM.job_id == job_id).first()
        if not job:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
        
        # Update fields
        for field, value in job_data.items():
            if hasattr(job, field):
                setattr(job, field, value)
        
        job.updated_at = datetime.now()
        db.commit()
        db.refresh(job)
        return job
    except SQLAlchemyError as e:
        db.rollback()
        logging.error(f"SQLAlchemyError while updating job: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    except Exception as ex:
        db.rollback()
        logging.error(f"Unexpected Error while updating job: {ex}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(ex))

async def update_job(job_id: int, job_data: dict, db: Session, change_reason: str = None, changed_by: str = None):
    """Update job profile information and save history"""
    try:
        job = db.query(JobORM).filter(JobORM.job_id == job_id).first()
        if not job:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
        
        # Try to create history record before updating (optional, won't fail if table doesn't exist)
        try:
            await create_job_history(job, change_reason, changed_by, db)
        except Exception as history_error:
            logging.warning(f"Could not create job history (table might not exist): {history_error}")
            # Continue with update even if history fails
        
        # Update fields
        for field, value in job_data.items():
            if hasattr(job, field):
                setattr(job, field, value)
        
        job.updated_at = datetime.now()
        db.commit()
        db.refresh(job)
        return job
    except SQLAlchemyError as e:
        db.rollback()
        logging.error(f"SQLAlchemyError while updating job: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    except Exception as ex:
        db.rollback()
        logging.error(f"Unexpected Error while updating job: {ex}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(ex))

async def create_job_history(job: JobORM, change_reason: str = None, changed_by: str = None, db: Session = None):
    """Create a history record of the current job state before updating"""
    if not JOB_HISTORY_AVAILABLE or JobHistoryORM is None:
        logging.warning("JobHistory model not available, skipping history creation")
        return None
        
    try:
        history_record = JobHistoryORM(
            job_id=job.job_id,
            private_user_id=job.private_user_id,
            company_id=job.company_id,
            job_title=job.job_title,
            employer_name=job.employer_name,
            employer_brn=job.employer_brn,
            employer_email=job.employer_email,
            employer_phone=job.employer_phone,
            employer_address=job.employer_address,
            first_date_of_employment=job.first_date_of_employment,
            work_start_time=job.work_start_time,
            work_end_time=job.work_end_time,
            work_days=job.work_days,
            has_contract=job.has_contract,
            has_permission_to_work=job.has_permission_to_work,
            work_permit_type=job.work_permit_type,
            working_on_tourist_visa=job.working_on_tourist_visa,
            is_salary_deducted=job.is_salary_deducted,
            reason_for_deduction=job.reason_for_deduction,
            is_accommodation_covered_by_employer=job.is_accommodation_covered_by_employer,
            is_accommodation_a_dormitory=job.is_accommodation_a_dormitory,
            is_accommodation_decent=job.is_accommodation_decent,
            is_passport_retained=job.is_passport_retained,
            is_job_execution_same_as_description=job.is_job_execution_same_as_description,
            doubts_about_compensation=job.doubts_about_compensation,
            change_reason=change_reason or "Job updated",
            changed_by=changed_by or "System",
            change_timestamp=datetime.now(),
            original_created_at=job.created_at,
            original_updated_at=job.updated_at
        )
        
        db.add(history_record)
        db.flush()  # Don't commit here, let the calling function handle the transaction
        logging.info(f"Job history record created for job_id: {job.job_id}")
        return history_record
        
    except Exception as ex:
        logging.error(f"Error creating job history: {ex}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to create job history: {str(ex)}")

async def get_job_history(job_id: int, db: Session):
    """Get all history records for a specific job"""
    if not JOB_HISTORY_AVAILABLE or JobHistoryORM is None:
        logging.warning("JobHistory model not available")
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED, 
            detail="Job history feature not available. Please run database migrations."
        )
        
    try:
        history_records = db.query(JobHistoryORM).filter(
            JobHistoryORM.job_id == job_id
        ).order_by(JobHistoryORM.change_timestamp.desc()).all()
        return history_records
    except SQLAlchemyError as e:
        logging.error(f"SQLAlchemyError while fetching job history: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    except Exception as ex:
        logging.error(f"Unexpected Error while fetching job history: {ex}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(ex))

async def delete_job(job_id: int, db: Session):
    """Delete job profile"""
    try:
        job = db.query(JobORM).filter(JobORM.job_id == job_id).first()
        if not job:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
        
        db.delete(job)
        db.commit()
        return {"message": "Job deleted successfully"}
    except SQLAlchemyError as e:
        db.rollback()
        logging.error(f"SQLAlchemyError while deleting job: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    except Exception as ex:
        db.rollback()
        logging.error(f"Unexpected Error while deleting job: {ex}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(ex))


# --- Schedule CRUD Functions ---

async def create_schedule(schedule_data: CreateSchedule, db: Session) -> ScheduleORM:
    """Create a new schedule and assign employees"""
    try:
        # Create the schedule instance
        new_schedule = ScheduleORM(
            title=schedule_data.title,
            company_id=schedule_data.company_id,
            location=schedule_data.location,
            hours=schedule_data.hours,
            notes=schedule_data.notes,
            start_time=schedule_data.start_time,
            end_time=schedule_data.end_time,
            status=schedule_data.status or 'pending',
            additional_remuneration_amount=schedule_data.additional_remuneration_amount,
        )

        # Find and assign employees
        if schedule_data.assigned_employee_ids:
            employees = db.query(PrivateUser).filter(
                PrivateUser.private_user_id.in_(schedule_data.assigned_employee_ids)
            ).all()
            if len(employees) != len(schedule_data.assigned_employee_ids):
                found_ids = {emp.private_user_id for emp in employees}
                missing_ids = [eid for eid in schedule_data.assigned_employee_ids if eid not in found_ids]
                raise HTTPException(status_code=404, detail=f"One or more employees not found: {missing_ids}")
            new_schedule.assigned_employees.extend(employees)

        db.add(new_schedule)
        db.flush()  # flush to get schedule_id before creating status rows

        # Create per-employee status rows (start everyone at 'pending')
        for employee in new_schedule.assigned_employees:
            status_row = ScheduleAssigneeStatus(
                schedule_id=new_schedule.schedule_id,
                private_user_id=employee.private_user_id,
                status='pending'
            )
            db.add(status_row)

        db.commit()
        db.refresh(new_schedule)
        return new_schedule
    except Exception as e:
        db.rollback()
        logging.error(f"Error creating schedule: {e}")
        raise HTTPException(status_code=500, detail="Could not create schedule.")

async def get_schedule(schedule_id: int, db: Session) -> Optional[ScheduleORM]:
    """Get a single schedule by its ID, with assigned employees"""
    return db.query(ScheduleORM).options(joinedload(ScheduleORM.assigned_employees), joinedload(ScheduleORM.assignee_statuses)).filter(ScheduleORM.schedule_id == schedule_id).first()

async def get_schedules_by_company(company_id: int, db: Session) -> List[ScheduleORM]:
    """Get all schedules for a given company"""
    return db.query(ScheduleORM).options(joinedload(ScheduleORM.assigned_employees), joinedload(ScheduleORM.assignee_statuses)).filter(ScheduleORM.company_id == company_id).order_by(ScheduleORM.start_time.desc()).all()

async def update_schedule(schedule_id: int, schedule_data: UpdateSchedule, db: Session) -> Optional[ScheduleORM]:
    """Update an existing schedule"""
    try:
        schedule = db.query(ScheduleORM).options(joinedload(ScheduleORM.assigned_employees)).filter(ScheduleORM.schedule_id == schedule_id).first()
        if not schedule:
            return None

        update_data = schedule_data.dict(exclude_unset=True)

        if "assigned_employee_ids" in update_data:
            employee_ids = update_data.pop("assigned_employee_ids")
            if employee_ids is not None:
                employees = db.query(PrivateUser).filter(PrivateUser.private_user_id.in_(employee_ids)).all()
                if len(employees) != len(set(employee_ids)):
                    found_ids = {emp.private_user_id for emp in employees}
                    missing_ids = [eid for eid in employee_ids if eid not in found_ids]
                    raise HTTPException(status_code=404, detail=f"One or more employees not found: {missing_ids}")
                schedule.assigned_employees = employees

                # Sync ScheduleAssigneeStatus rows: add new, remove stale
                existing_statuses = db.query(ScheduleAssigneeStatus).filter(
                    ScheduleAssigneeStatus.schedule_id == schedule_id
                ).all()
                existing_ids = {s.private_user_id for s in existing_statuses}
                new_ids = {emp.private_user_id for emp in employees}

                # Remove rows for employees no longer assigned
                for status_row in existing_statuses:
                    if status_row.private_user_id not in new_ids:
                        db.delete(status_row)

                # Add rows for newly assigned employees
                for emp in employees:
                    if emp.private_user_id not in existing_ids:
                        db.add(ScheduleAssigneeStatus(
                            schedule_id=schedule_id,
                            private_user_id=emp.private_user_id,
                            status='pending'
                        ))
            else:
                schedule.assigned_employees = []
                # Remove all status rows
                db.query(ScheduleAssigneeStatus).filter(
                    ScheduleAssigneeStatus.schedule_id == schedule_id
                ).delete()

        for field, value in update_data.items():
            if hasattr(schedule, field):
                setattr(schedule, field, value)
        
        schedule.updated_at = datetime.now()
        db.commit()
        db.refresh(schedule)
        return schedule
    except Exception as e:
        db.rollback()
        logging.error(f"Error updating schedule: {e}")
        raise HTTPException(status_code=500, detail="Could not update schedule.")

async def delete_schedule(schedule_id: int, db: Session) -> bool:
    """Delete a schedule by its ID"""
    schedule = db.query(ScheduleORM).filter(ScheduleORM.schedule_id == schedule_id).first()
    if not schedule:
        return False
    db.delete(schedule)
    db.commit()
    return True

async def update_my_schedule_status(schedule_id: int, private_user_id: int, new_status: str, db: Session, note: Optional[str] = None) -> Optional[ScheduleORM]:
    """Update a single employee's personal status on a task.

    Rules:
    - Any assigned employee can flip their own status: pending → started → completed
    - When ALL assignees have status='completed', the global Schedule.status auto-sets to 'completed'
    - When the first assignee marks 'started' and the global status is still 'pending',
      the global status advances to 'started'
    - Managers can still override the global status independently via PUT /schedule/{id}
    """
    try:
        # Verify the employee is actually assigned to this schedule
        schedule = db.query(ScheduleORM).options(
            joinedload(ScheduleORM.assigned_employees)
        ).filter(ScheduleORM.schedule_id == schedule_id).first()

        if not schedule:
            return None

        assigned_ids = {emp.private_user_id for emp in schedule.assigned_employees}
        if private_user_id not in assigned_ids:
            raise HTTPException(status_code=403, detail="You are not assigned to this task.")

        # Upsert the per-employee status row
        status_row = db.query(ScheduleAssigneeStatus).filter(
            ScheduleAssigneeStatus.schedule_id == schedule_id,
            ScheduleAssigneeStatus.private_user_id == private_user_id
        ).first()

        if status_row:
            # Completed is terminal for the assignee — never let an employee
            # downgrade/undo their own completion (prevents gaming the
            # verify-and-pay gate). Managers override via PUT /schedule/{id}.
            if status_row.status == 'completed' and new_status != 'completed':
                raise HTTPException(
                    status_code=409,
                    detail="You already marked this task as completed. Please contact your employer to reopen it.",
                )
            status_row.status = new_status
            if note is not None:
                status_row.note = note
            status_row.updated_at = datetime.now()
        else:
            status_row = ScheduleAssigneeStatus(
                schedule_id=schedule_id,
                private_user_id=private_user_id,
                status=new_status,
                note=note,
            )
            db.add(status_row)

        db.flush()

        # --- Auto-advance global task status ---
        all_status_rows = db.query(ScheduleAssigneeStatus).filter(
            ScheduleAssigneeStatus.schedule_id == schedule_id
        ).all()

        completed_ids = {s.private_user_id for s in all_status_rows if s.status == 'completed'}
        started_ids = {s.private_user_id for s in all_status_rows if s.status in ('started', 'completed')}

        if assigned_ids and assigned_ids <= completed_ids:
            # Every assignee is done → auto-complete the task
            schedule.status = 'completed'
        elif started_ids and schedule.status == 'pending':
            # At least one person started → advance global to 'started'
            schedule.status = 'started'

        schedule.updated_at = datetime.now()
        db.commit()
        db.refresh(schedule)
        return schedule
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logging.error(f"Error updating assignee status for schedule {schedule_id}: {e}")
        raise HTTPException(status_code=500, detail="Could not update task status.")


async def verify_schedule_completion(schedule_id: int, actor_user_id: Optional[int], db: Session) -> Optional[dict]:
    """Employer verifies a task's completion and books its additional
    remuneration as a one-off allowance for each COMPLETED assignee not yet paid.

    Verify-before-pay (PO-confirmed): self-marked completion does NOT pay; the
    employer's verification here is the gate, mirroring clock-in / overtime
    confirmation. Each completed assignee earns the FULL amount. Idempotent —
    an assignee already linked to a one-off is skipped, so re-verifying (e.g.
    after a late assignee finishes) never double-pays. Returns a summary dict,
    or None if the schedule doesn't exist. Caller has already authorized.
    """
    from decimal import Decimal
    from core.model import EmployeeOneOffAllowance
    from services import one_off_allowances_service

    schedule = (
        db.query(ScheduleORM)
        .options(joinedload(ScheduleORM.assignee_statuses))
        .filter(ScheduleORM.schedule_id == schedule_id)
        .first()
    )
    if not schedule:
        return None

    amount = schedule.additional_remuneration_amount
    if amount is None or Decimal(amount) <= 0:
        raise HTTPException(status_code=400, detail="This task has no additional remuneration to pay.")

    component = one_off_allowances_service.ensure_additional_duty_component(db, schedule.company_id)
    year, month = schedule.start_time.year, schedule.start_time.month

    paid = skipped = 0
    try:
        for st in schedule.assignee_statuses:
            if st.status != 'completed' or st.remuneration_one_off_id is not None:
                skipped += 1
                continue
            allowance = EmployeeOneOffAllowance(
                private_user_id=st.private_user_id,
                component_id=component.id,
                amount=amount,
                payable_in_year=year,
                payable_in_month=month,
                notes=f"Additional duty — task: {schedule.title}",
                created_by_user_id=actor_user_id,
            )
            db.add(allowance)
            db.flush()
            st.remuneration_one_off_id = allowance.id
            paid += 1
        db.commit()
    except Exception as e:
        db.rollback()
        logging.error(f"Error verifying schedule {schedule_id} completion: {e}")
        raise HTTPException(status_code=500, detail="Could not book task remuneration.")

    return {
        "schedule_id": schedule_id,
        "paid_count": paid,
        "skipped_count": skipped,
        "amount_each": amount,
        "total_booked": (Decimal(amount) * paid).quantize(Decimal("0.01")),
    }
