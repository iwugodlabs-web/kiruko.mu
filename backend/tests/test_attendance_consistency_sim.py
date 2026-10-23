"""Simulation: reproduce the dashboard-vs-attendance 'clocked in' mismatch and
prove the fix + the auto-close sweep behave correctly.

Scenario (on the isolated kontokaz_test DB — never prod/dev):
  * 2 employees with FRESH open sessions (2h ago)   → live
  * 2 employees with STALE open sessions (17h ago)  → forgotten clock-out
    (company default max-shift = NULL → 12h system cap)

Asserts:
  1. BEFORE sweep: dashboard counts 2 clocked-in, 2 anomalies (not 4/0).
  2. The attendance endpoint's status logic classifies 2 active / 2 incomplete.
  3. The auto-close sweep closes the 2 stale sessions (auto_closed=True), leaves
     the 2 fresh ones open.
  4. AFTER sweep: dashboard counts 2 clocked-in, 0 anomalies.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from core.model import Company, Job, PrivateUser, User, TimeLog
from services.time_log_service import TimeLogService
from db_models.crud.dashboard import get_dashboard_stats_from_db


def _make_company(db: Session) -> tuple[User, Company]:
    owner = User(
        user_type="company",
        email=f"sim-co-{uuid.uuid4().hex[:8]}@kontokaz.test",
        user_name=f"sim-co-{uuid.uuid4().hex[:6]}",
        password_hash="x",
    )
    db.add(owner)
    db.flush()
    company = Company(
        user_id=owner.user_id,
        company_name="Sim Attendance Co.",
        email=f"sim-co-contact-{uuid.uuid4().hex[:8]}@kontokaz.test",
        brn=f"SIM_BRN_{uuid.uuid4().hex[:8]}",
        country_code="MU",
        default_max_shift_hours=None,  # → system default 12h
    )
    db.add(company)
    db.commit()
    db.refresh(company)
    return owner, company


def _make_employee(db: Session, company_id: int) -> tuple[User, PrivateUser, Job]:
    owner = User(
        user_type="private",
        email=f"sim-emp-{uuid.uuid4().hex[:8]}@kontokaz.test",
        password_hash="x",
    )
    db.add(owner)
    db.flush()
    pu = PrivateUser(
        user_id=owner.user_id,
        first_name="Sim",
        last_name="Worker",
        company_id=company_id,
        role="employee",
        pass_port_number=f"SIM-{uuid.uuid4().hex[:8]}",
    )
    db.add(pu)
    db.flush()
    job = Job(
        private_user_id=pu.private_user_id,
        company_id=company_id,
        job_title="Sim job",
        employer_name="Sim Co",
        employer_brn="SIM_BRN",
        employer_email=f"sim-jobemp-{uuid.uuid4().hex[:8]}@kontokaz.test",
        first_date_of_employment=datetime(2024, 1, 1).date(),
    )
    db.add(job)
    db.commit()
    db.refresh(pu)
    db.refresh(job)
    return owner, pu, job


def _open_log(db: Session, pu: PrivateUser, job: Job, hours_ago: float) -> TimeLog:
    start = datetime.now(timezone.utc) - timedelta(hours=hours_ago)
    log = TimeLog(
        job_id=job.job_id,
        private_user_id=pu.private_user_id,
        day_of_week=start.strftime("%A"),
        start_time=start,
        end_time=None,
        location={"latitude": -20.16, "longitude": 57.50},
        created_source="mobile",
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


def _attendance_status(log: TimeLog, job: Job, pu: PrivateUser, company_default) -> str:
    """Mirror of the status derivation in api/v1/job.py get_company_time_logs_dashboard."""
    now = datetime.now(timezone.utc)
    st = log.start_time if log.start_time.tzinfo else log.start_time.replace(tzinfo=timezone.utc)
    elapsed = (now - st).total_seconds() / 3600
    cap = TimeLogService.resolve_max_shift_hours(job, pu, company_default)
    return "incomplete" if elapsed > cap else "active"


def test_attendance_dashboard_consistency_and_sweep(db: Session):
    co_owner, company = _make_company(db)
    created_emps: list[tuple[User, PrivateUser, Job]] = []
    try:
        fresh, stale = [], []
        for _ in range(2):
            o, pu, job = _make_employee(db, company.company_id)
            created_emps.append((o, pu, job))
            fresh.append((pu, job, _open_log(db, pu, job, hours_ago=2)))
        for _ in range(2):
            o, pu, job = _make_employee(db, company.company_id)
            created_emps.append((o, pu, job))
            stale.append((pu, job, _open_log(db, pu, job, hours_ago=17)))

        # (2) attendance endpoint status classification
        for pu, job, log in fresh:
            assert _attendance_status(log, job, pu, None) == "active"
        for pu, job, log in stale:
            assert _attendance_status(log, job, pu, None) == "incomplete"

        # (1) dashboard BEFORE sweep → 2 live, 2 forgotten (not 4 / 0)
        ov = get_dashboard_stats_from_db(db, company.company_id)["overview"]
        print(f"\nBEFORE sweep: clockedIn={ov['clockedInEmployees']} anomalies={ov['clockInAnomalies']}")
        assert ov["clockedInEmployees"] == 2, ov
        assert ov["clockInAnomalies"] == 2, ov

        # (3) sweep — scoped per-user (never the global sweep)
        closed = 0
        for pu, job, log in stale:
            closed += TimeLogService.cleanup_active_time_logs(db, pu.private_user_id)
        for pu, job, log in fresh:
            assert TimeLogService.cleanup_active_time_logs(db, pu.private_user_id) == 0
        assert closed == 2
        for pu, job, log in stale:
            db.refresh(log)
            assert log.end_time is not None
            assert log.auto_closed is True

        # (4) dashboard AFTER sweep → 2 live, 0 forgotten
        ov2 = get_dashboard_stats_from_db(db, company.company_id)["overview"]
        print(f"AFTER sweep:  clockedIn={ov2['clockedInEmployees']} anomalies={ov2['clockInAnomalies']}")
        assert ov2["clockedInEmployees"] == 2, ov2
        assert ov2["clockInAnomalies"] == 0, ov2
    finally:
        for _o, pu, job in created_emps:
            db.query(TimeLog).filter(TimeLog.private_user_id == pu.private_user_id).delete()
            db.delete(job)
            db.delete(pu)
        db.flush()
        for o, _pu, _job in created_emps:
            db.delete(o)
        db.delete(company)
        db.delete(co_owner)
        db.commit()
