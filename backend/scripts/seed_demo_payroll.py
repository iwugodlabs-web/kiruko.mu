#!/usr/bin/env python3
"""#19 — Seed a demo company + salaried employee + a month of clock-ins so the
clock-driven payroll story (basic stays constant; absences dock it; the profile
estimate equals the finalized run) can be shown end-to-end in the UI.

Usage:
  python3 backend/scripts/seed_demo_payroll.py                 # current month, full attendance
  python3 backend/scripts/seed_demo_payroll.py --month 2026-05 # a specific month
  python3 backend/scripts/seed_demo_payroll.py --absence       # skip the last working day (shows the deduction)

Idempotent: re-running reuses the demo company/employee (by BRN) and re-seeds
the target month's clock-ins. Commits real rows — this is for a live demo DB,
not the test DB.

Prerequisites: MU payroll rules + overtime rule must already be seeded
(scripts/seed_mu_payroll_rules.py, scripts/seed_overtime_rules_mu.py, or
scripts/seed_all.py). The script checks and warns if they're missing.
"""
import argparse
import calendar
import os
import sys
from datetime import date, datetime, time, timezone
from decimal import Decimal

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_dir)

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(backend_dir, ".env"), override=False)
except Exception:
    pass

from core.config import get_session_local
from core.security import generate_passwd_hash
from core.model import (
    Company,
    CountryOvertimeRule,
    EmployeeSalaryAssignment,
    Job,
    PrivateUser,
    Salary,
    SalaryComponent,
    SalaryStructure,
    SalaryStructureLine,
    TimeLog,
    User,
)
from services import proration


# NOTE: use a real, non-reserved TLD. The login response serializes through a
# pydantic EmailStr; RFC 6761 reserved TLDs (.test/.invalid/.localhost) are
# REJECTED there and cause a 500 on login, even though the row inserts fine.
BRN = "DEMO_PAYROLL_BRN"
COMPANY_NAME = "Kiruko Demo Co."
OWNER_EMAIL = "demo-employer@kirukodemo.com"
EMP_EMAIL = "demo-worker@kirukodemo.com"
COMPANY_EMAIL = "demo-co@kirukodemo.com"
EMP_PASSPORT = "DEMO_WORKER_PASS"
DEMO_PASSWORD = os.getenv("DEMO_PASSWORD", "DemoPass123!")
BASIC = Decimal(os.getenv("DEMO_BASIC", "30000.00"))
# Job.work_days is a DICT keyed by day name in the real model (the response
# schema rejects a bare list). proration reads the keys, so the values are free.
WORK_DAYS = {
    "Monday": "08:00-16:00", "Tuesday": "08:00-16:00", "Wednesday": "08:00-16:00",
    "Thursday": "08:00-16:00", "Friday": "08:00-16:00",
}
# Naive midnight — first_date_of_employment serializes as an exact `date`; a
# tz-aware value reads back with a non-zero time and fails schema validation.
FIRST_EMPLOYMENT = datetime(2024, 1, 1)


def _month_bounds(month: str) -> tuple[date, date]:
    y, m = (int(x) for x in month.split("-"))
    last = calendar.monthrange(y, m)[1]
    return date(y, m, 1), date(y, m, last)


def _get_or_create_user(db, *, email, user_type) -> User:
    u = db.query(User).filter(User.email == email).one_or_none()
    if u is None:
        u = User(
            user_type=user_type, email=email, user_name=email,
            password_hash=generate_passwd_hash(DEMO_PASSWORD),
            onboard_complete=True, user_verified=True, user_enabled=True,
            # The employer's employee list filters on company_onboarding_status
            # == 'approved'; a 'pending' worker is invisible on the dashboard.
            company_onboarding_status="approved",
        )
        db.add(u)
        db.flush()
    elif u.company_onboarding_status != "approved":
        u.company_onboarding_status = "approved"
        db.flush()
    return u


def _repair_email(db, *, old_email: str, new_email: str, password: str) -> None:
    """Migrate a previously-seeded reserved-TLD (.test) login to a valid domain
    so the login response serializes. Idempotent."""
    u = db.query(User).filter(User.email == old_email).one_or_none()
    if u is not None:
        u.email = new_email
        u.user_name = new_email
        u.password_hash = generate_passwd_hash(password)
        db.flush()


def _ensure_company(db) -> Company:
    # Repair rows from earlier seeds (reserved-TLD .test, or the old Kontokaz
    # demo domain) before reuse-by-BRN, so existing demo logins are rebranded
    # in place rather than duplicated.
    _repair_email(db, old_email="demo-employer@kontokaz.test", new_email=OWNER_EMAIL, password=DEMO_PASSWORD)
    _repair_email(db, old_email="demo-worker@kontokaz.test", new_email=EMP_EMAIL, password=DEMO_PASSWORD)
    _repair_email(db, old_email="demo-employer@kontokazdemo.com", new_email=OWNER_EMAIL, password=DEMO_PASSWORD)
    _repair_email(db, old_email="demo-worker@kontokazdemo.com", new_email=EMP_EMAIL, password=DEMO_PASSWORD)

    c = db.query(Company).filter(Company.brn == BRN).one_or_none()
    if c is None:
        owner = _get_or_create_user(db, email=OWNER_EMAIL, user_type="company")
        c = Company(
            user_id=owner.user_id, company_name=COMPANY_NAME,
            email=COMPANY_EMAIL, brn=BRN, country_code="MU",
            require_approved_clockins_for_payroll=True,
        )
        db.add(c)
        db.flush()
    else:
        # Clock-driven payroll is the whole point of the demo; also rebrand a
        # stale company name / email from the .test or Kontokaz seeds.
        c.require_approved_clockins_for_payroll = True
        c.company_name = COMPANY_NAME
        if (c.email or "").endswith(".test") or "kontokaz" in (c.email or "").lower():
            c.email = COMPANY_EMAIL

    # Real company signup gives the owner a PrivateUser; the web's AuthContext
    # gates the dashboard on is_company_admin, which the login only sets when the
    # owner has a PrivateUser. Without this, login succeeds but the dashboard
    # treats the owner as a non-admin.
    owner_user_id = c.user_id
    owner_user = db.query(User).filter(User.user_id == owner_user_id).one_or_none()
    if owner_user is not None and owner_user.company_onboarding_status != "approved":
        owner_user.company_onboarding_status = "approved"
    if db.query(PrivateUser).filter(PrivateUser.user_id == owner_user_id).first() is None:
        db.add(PrivateUser(
            user_id=owner_user_id, first_name="Demo", last_name="Employer",
            company_id=c.company_id, pass_port_number="DEMO_OWNER_PASS",
            role="owner",
        ))
        db.flush()
    return c


def _ensure_employee(db, company: Company) -> tuple[PrivateUser, Job]:
    emp = (
        db.query(PrivateUser)
        .filter(PrivateUser.pass_port_number == EMP_PASSPORT)
        .one_or_none()
    )
    if emp is None:
        emp_user = _get_or_create_user(db, email=EMP_EMAIL, user_type="private")
        emp = PrivateUser(
            user_id=emp_user.user_id, first_name="Demo", last_name="Worker",
            company_id=company.company_id, pass_port_number=EMP_PASSPORT,
            role="employee",
        )
        db.add(emp)
        db.flush()

    # Reused worker: ensure the User is approved (the dashboard's employee list
    # filters company_onboarding_status == 'approved'). _get_or_create_user is
    # skipped on the reuse path above, so approve here explicitly.
    emp_user = db.query(User).filter(User.user_id == emp.user_id).one_or_none()
    if emp_user is not None and emp_user.company_onboarding_status != "approved":
        emp_user.company_onboarding_status = "approved"
        db.flush()

    job = (
        db.query(Job)
        .filter(Job.private_user_id == emp.private_user_id)
        .order_by(Job.created_at.desc())
        .first()
    )
    if job is None:
        job = Job(
            private_user_id=emp.private_user_id, company_id=company.company_id,
            job_title="Salaried staff", employer_name=company.company_name,
            employer_brn=BRN, employer_email=OWNER_EMAIL,
            first_date_of_employment=FIRST_EMPLOYMENT,
            work_days=WORK_DAYS, weekly_rest_day_dow=7,
            verification_status="approved",  # so they show in the verified list
        )
        db.add(job)
        db.flush()
    else:
        # Repair reused rows so the dashboard's strict showUser serializer
        # (private_user → jobs → salaries) doesn't 500 on partial/stale data.
        job.employer_name = company.company_name
        job.employer_email = OWNER_EMAIL
        job.first_date_of_employment = FIRST_EMPLOYMENT
        job.work_days = WORK_DAYS
        job.verification_status = "approved"
        if job.weekly_rest_day_dow is None:
            job.weekly_rest_day_dow = 7
        db.flush()

    from db_models.crud.job import _enforce_salary_money
    salary = db.query(Salary).filter(Salary.job_id == job.job_id).first()
    if salary is None:
        salary = Salary(
            job_id=job.job_id, pay_basis="monthly", salary=BASIC,
            monthly_hours="195", break_in_minutes_per_day=30, days_of_work_per_month=22,
        )
        # Keep revenue = salary + allowance so seeded rows match app-created data.
        _enforce_salary_money(salary)
        db.add(salary)
    else:
        salary.pay_basis = "monthly"
        salary.salary = BASIC
        if salary.monthly_hours is None:
            salary.monthly_hours = "195"
        if salary.break_in_minutes_per_day is None:
            salary.break_in_minutes_per_day = 30
        if salary.days_of_work_per_month is None:
            salary.days_of_work_per_month = 22
        _enforce_salary_money(salary)
        db.flush()

    # New-model salary: BASIC component → structure → line → assignment.
    if (
        db.query(EmployeeSalaryAssignment)
        .filter(EmployeeSalaryAssignment.private_user_id == emp.private_user_id)
        .first()
        is None
    ):
        basic = SalaryComponent(
            company_id=company.company_id, code="BASIC", label="Basic salary",
            kind="earning", category="earning.basic", is_basic=True, is_taxable=True,
        )
        db.add(basic)
        db.flush()
        structure = SalaryStructure(
            company_id=company.company_id, name="Demo Structure", description="Demo",
        )
        db.add(structure)
        db.flush()
        db.add(SalaryStructureLine(
            structure_id=structure.id, component_id=basic.id,
            amount=BASIC, order_index=0,
        ))
        db.add(EmployeeSalaryAssignment(
            private_user_id=emp.private_user_id, structure_id=structure.id,
            currency="MUR", effective_from=date(2024, 1, 1), notes="Demo",
        ))
        db.flush()

    return emp, job


def _reseed_clockins(db, emp: PrivateUser, job: Job, start: date, end: date, *, absence: bool) -> int:
    # Wipe the demo employee's existing clock-ins in this month, then reseed.
    db.query(TimeLog).filter(
        TimeLog.private_user_id == emp.private_user_id,
        TimeLog.start_time >= datetime.combine(start, time.min, tzinfo=timezone.utc),
        TimeLog.start_time <= datetime.combine(end, time.max, tzinfo=timezone.utc),
    ).delete(synchronize_session=False)

    work = sorted(proration.working_dates_in_period(db, "MU", start, end, WORK_DAYS))
    if absence and work:
        skipped = work[-1]
        work = work[:-1]
        print(f"  · absence demo: skipping {skipped} (1 unexplained absence)")

    for d in work:
        db.add(TimeLog(
            private_user_id=emp.private_user_id, job_id=job.job_id,
            day_of_week=d.strftime("%A"),  # response schema requires a non-null string
            start_time=datetime.combine(d, time(8, 0), tzinfo=timezone.utc),
            end_time=datetime.combine(d, time(16, 0), tzinfo=timezone.utc),
            hours_worked=Decimal("8.00"), location={"source": "demo_seed"},
            admin_approved=True, created_source="kiosk",
        ))
    return len(work)


def run(month: str, absence: bool) -> None:
    SessionLocal = get_session_local()
    if SessionLocal is None:
        print("ERROR: no DB engine configured (check backend/.env DATABASE_URL).")
        sys.exit(1)
    db = SessionLocal()
    try:
        start, end = _month_bounds(month)

        if db.query(CountryOvertimeRule).filter(CountryOvertimeRule.country_code == "MU").first() is None:
            print(
                "WARNING: no MU overtime rule seeded — payroll runs will fail.\n"
                "         Run scripts/seed_overtime_rules_mu.py (or seed_all.py) first."
            )

        company = _ensure_company(db)
        emp, job = _ensure_employee(db, company)
        n = _reseed_clockins(db, emp, job, start, end, absence=absence)
        db.commit()

        print("\nDemo payroll data ready:")
        print(f"  company_id        {company.company_id}  ({company.company_name}, BRN {BRN})")
        print(f"  private_user_id   {emp.private_user_id}  (Demo Worker, monthly basic {BASIC})")
        print(f"  period            {start} … {end}")
        print(f"  approved clock-ins {n} working day(s) seeded")
        print(f"  employer login    {OWNER_EMAIL} / {DEMO_PASSWORD}")
        print("\nNext: create a payroll run for this company/period, or open the")
        print("worker's profile to see the estimated payslip — the two will match.")
    finally:
        db.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Seed demo clock-driven payroll data.")
    ap.add_argument("--month", default=None, help="Target month YYYY-MM (default: current month).")
    ap.add_argument("--absence", action="store_true", help="Skip the last working day to show the absence deduction.")
    args = ap.parse_args()
    target = args.month or datetime.now(timezone.utc).strftime("%Y-%m")
    run(target, args.absence)
