#!/usr/bin/env python3
"""Seed a realistic DEMO company for testing — 10 employees across departments
with a full year of clock-ins, overtime, breaks, one absence, and a few leave
records. For staging / QA only.

GUARDED: refuses to run unless SEED_DEMO=yes, so it can never fire on a normal
deploy. Idempotent: if the demo company already exists it skips.

EVERYTHING is configurable via env (defaults reproduce the existing demo):

  SEED_DEMO              required = "yes" (the safety guard; nothing runs otherwise)
  DEMO_OWNER_EMAIL       company owner / login           (iwugodjoshua@gmail.com)
  DEMO_EMPLOYEE_EMAILS   any number of emails, comma-sep  (iwugodjoshua+test1..10@gmail.com)
                         (roster auto-sizes to match the count)
  DEMO_COMPANY_NAME      company name                     (Kiruko Demo Co)
  DEMO_COMPANY_BRN       business reg. no.                (DEMO0001)
  DEMO_COMPANY_EMAIL     company contact email            (company@kiruko-demo.mu)
  DEMO_PASSWORD          login password for everyone      (password)
  DEMO_COUNTRY           ISO-2 country code               (MU)
  DEMO_CURRENCY          pay currency                     (MUR)
  DEMO_TIMEZONE          IANA tz for clock-ins            (Indian/Mauritius)
  DEMO_CLOCK_DRIVEN      attendance drives pay  true/false (true)
  DEMO_YEAR              attendance year                  (current year)
  DEMO_MONTHS            months of attendance, 1-12       (12)
  DEMO_THROUGH_TODAY     stop clock-ins at today  true/false (true)
                         true  → current year seeds Jan 1 → today
                         false → seed full DEMO_MONTHS (for EOY testing)
  DEMO_NO_ATTENDANCE     accounts only, no clock-ins/leave true/false (false)
                         true → test users start empty (onboarding from scratch)

  Example:
    SEED_DEMO=yes DEMO_OWNER_EMAIL=owner@x.com \\
      DEMO_EMPLOYEE_EMAILS="a@x.com,b@x.com,...(10)" \\
      python3 scripts/seed_demo_data.py

NO payroll runs are created — log in as the owner and run them. Does NOT
install statutory rates (run seed_all / seed_mu_payroll_rules first).
"""
import os
import sys
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

_backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _backend)
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(_backend, ".env"), override=False)
except Exception:
    pass

from sqlalchemy import text
from core.config import get_session_local
from core.security import generate_passwd_hash
from core.model import (
    User, Company, PrivateUser, Job, Salary, TimeLog, BreakLog, Leave,
    SalaryComponent, SalaryStructure, SalaryStructureLine, EmployeeSalaryAssignment,
    UserPlatformRole,
)
from services import employee_import_service as imp

# ── config (every knob is env-driven; defaults reproduce the existing demo) ───
def _flag(name, default):
    return os.getenv(name, default).strip().lower() in ("1", "true", "yes", "on")

OWNER_EMAIL = os.getenv("DEMO_OWNER_EMAIL", "iwugodjoshua@gmail.com").strip()
_emails_env = os.getenv("DEMO_EMPLOYEE_EMAILS", "").strip()
EMPLOYEE_EMAILS = (
    [e.strip() for e in _emails_env.split(",") if e.strip()]
    if _emails_env else [f"iwugodjoshua+test{i}@gmail.com" for i in range(1, 11)]
)
COMPANY_NAME = os.getenv("DEMO_COMPANY_NAME", "Kiruko Demo Co")
COMPANY_BRN = os.getenv("DEMO_COMPANY_BRN", "DEMO0001")
COMPANY_EMAIL = os.getenv("DEMO_COMPANY_EMAIL", "company@kiruko-demo.mu")
PASSWORD = os.getenv("DEMO_PASSWORD", "password")
COUNTRY = os.getenv("DEMO_COUNTRY", "MU").strip().upper()
CURRENCY = os.getenv("DEMO_CURRENCY", "MUR").strip().upper()
TIMEZONE = os.getenv("DEMO_TIMEZONE", "Indian/Mauritius").strip()
CLOCK_DRIVEN = _flag("DEMO_CLOCK_DRIVEN", "true")
YEAR = int(os.getenv("DEMO_YEAR", str(datetime.now().year)))
MONTHS = max(1, min(12, int(os.getenv("DEMO_MONTHS", "12"))))
# DEMO_THROUGH_TODAY=true (default): stop clock-ins at today, so the current
# year seeds "Jan 1 → today". Set false to seed the full DEMO_MONTHS (e.g. all
# 12 months for end-of-year bonus testing, even with future dates).
THROUGH_TODAY = _flag("DEMO_THROUGH_TODAY", "true")
# DEMO_NO_ATTENDANCE=true → create the company + accounts only (no clock-ins or
# leave), so test users start empty and exercise onboarding/payroll from scratch.
NO_ATTENDANCE = _flag("DEMO_NO_ATTENDANCE", "false")
TODAY = date.today()

MU = ZoneInfo(TIMEZONE)   # clock-in timezone (kept the short name `MU`)


def utc(d: date, hh: int, mm: int = 0) -> datetime:
    return datetime(d.year, d.month, d.day, hh, mm, tzinfo=MU).astimezone(timezone.utc)


# basis: monthly base salary OR hourly rate; wdays 5→22-day / 6→26-day profile;
# ot = long shifts/month (engine auto-splits the excess); absent = unclocked days.
BASE_ROSTER = [
    dict(fn="Aanya",  ln="Devi",    dept="Operations",  title="Operations Manager", base=85000, wdays=5, basis="monthly", ot=0, absent=[], allow=2500, role="department_manager"),
    dict(fn="Bilal",  ln="Khan",    dept="Finance",     title="Accountant",         base=55000, wdays=5, basis="monthly", ot=0, absent=[], allow=0, role="company_admin"),
    dict(fn="Chen",   ln="Wei",     dept="Engineering", title="Senior Engineer",    base=120000, wdays=5, basis="monthly", ot=0, absent=[], allow=0),
    dict(fn="Divya",  ln="Rao",     dept="Sales",       title="Sales Executive",    base=38000, wdays=6, basis="monthly", ot=2, absent=[], allow=3000),
    dict(fn="Emed",   ln="Joseph",  dept="Admin",       title="Admin Assistant",    base=28000, wdays=5, basis="monthly", ot=0, absent=[(3,10),(3,11)], allow=0),
    dict(fn="Farah",  ln="Bibi",    dept="HR",          title="HR Officer",         base=46000, wdays=5, basis="monthly", ot=1, absent=[], allow=0, role="hr_manager"),
    dict(fn="Gopal",  ln="Naidu",   dept="Warehouse",   title="Storekeeper",        base=150,   wdays=6, basis="hourly",  ot=3, absent=[], allow=0),
    dict(fn="Hassan", ln="Ali",     dept="Warehouse",   title="Loader",             base=135,   wdays=6, basis="hourly",  ot=2, absent=[], allow=0),
    dict(fn="Ingrid", ln="Louis",   dept="Operations",  title="Supervisor",         base=42000, wdays=6, basis="monthly", ot=2, absent=[], allow=0, role="supervisor"),
    dict(fn="Jay",    ln="Ramduth", dept="Engineering", title="Tech Lead",          base=200000, wdays=5, basis="monthly", ot=0, absent=[], allow=0),
]


def _effective_roster(n):
    """Exactly `n` roster entries so ANY number of emails can be seeded: trim
    the base set when fewer, or extend it with generic staff (cycling depts)
    when more."""
    n = max(n, 1)
    if n <= len(BASE_ROSTER):
        return BASE_ROSTER[:n]
    depts = ["Operations", "Finance", "Engineering", "Sales", "Admin", "HR", "Warehouse"]
    out = list(BASE_ROSTER)
    for i in range(len(BASE_ROSTER), n):
        b = BASE_ROSTER[i % len(BASE_ROSTER)]
        out.append(dict(b, fn=f"Staff{i + 1}", ln="Demo", dept=depts[i % len(depts)],
                        title="Staff", ot=0, absent=[], allow=0, role=None))
    return out


ROSTER = _effective_roster(len(EMPLOYEE_EMAILS))
# A few approved leave records (employee-index, type, [days in month 6]).
LEAVE = [(0, "annual", [15, 16, 17]), (1, "unpaid", [22, 23]), (4, "sick", [9])]


def working_days(year, month, wdays):
    d, out = date(year, month, 1), []
    while d.month == month:
        if d.weekday() < wdays:           # 0=Mon … 5=Sat
            out.append(d)
        d += timedelta(days=1)
    return out


def make_owner_company(db):
    owner = db.query(User).filter(User.email == OWNER_EMAIL).one_or_none()
    if owner is None:
        owner = User(email=OWNER_EMAIL, user_name=OWNER_EMAIL, user_type="company",
                     password_hash=generate_passwd_hash(PASSWORD),
                     user_enabled=True, user_verified=True, onboard_complete=True,
                     company_onboarding_status="approved")
        db.add(owner); db.flush()
    else:
        owner.user_type = "company"; owner.onboard_complete = True
        owner.company_onboarding_status = "approved"
        # A company login must never carry a platform role (the wipe may have
        # seeded this email as super-admin to set its password).
        db.query(UserPlatformRole).filter(UserPlatformRole.user_id == owner.user_id).delete()
    db.flush()
    # Reuse an existing company owned by this user instead of blindly inserting a
    # new one. Company.user_id is NOT unique (the constraint was intentionally
    # dropped), so a plain insert would leave an owner who already has a company
    # with TWO — and the ORM's `user.company` (uselist=False) then resolves to an
    # arbitrary one, so the web dashboard can show the wrong (often empty) company
    # ("a company inside a company"). Update-in-place keeps it to a single company
    # and stays idempotent across re-seeds.
    co = db.query(Company).filter(Company.user_id == owner.user_id).first()
    if co is None:
        co = Company(user_id=owner.user_id)
        db.add(co)
    co.company_name = COMPANY_NAME
    co.email = COMPANY_EMAIL
    co.brn = COMPANY_BRN
    co.country_code = COUNTRY
    co.timezone = TIMEZONE
    co.require_approved_clockins_for_payroll = CLOCK_DRIVEN
    db.flush()
    return co


def import_employees(db, co):
    header = "first_name,last_name,email,job_title,start_date,base_salary,currency,department,work_days_per_week,pay_basis"
    lines = [header]
    for r, em in zip(ROSTER, EMPLOYEE_EMAILS):
        base = r["base"] if r["basis"] == "monthly" else 30000   # hourly rate set below
        # hired the prior year → tenured (so the Dec EOY bonus, ≥12mo service, fires)
        lines.append(f'{r["fn"]},{r["ln"]},{em},{r["title"]},{YEAR-1}-01-01,{base},{CURRENCY},{r["dept"]},{r["wdays"]},monthly')
    report = imp.commit(db, co.company_id, imp.parse(("\n".join(lines) + "\n").encode(), "demo.csv"), actor_user_id=None)
    db.flush()
    # The importer skips any email that already exists as a User (its idempotency
    # guard in employee_import_service). Detect those explicitly and abort with a
    # CLEAR, actionable message instead of the old cryptic
    # `SystemExit("import created 9/10: None")` + full rollback, which gave no
    # hint that a listed person had simply signed up before (often as an employer,
    # user_type='company'). Such a skipped account is NOT enrolled in this company,
    # so on login it resolves to its own/empty company — the "why does my employee
    # see an empty owner dashboard" symptom.
    if report["created"] != len(ROSTER):
        preexisting = []
        for em in EMPLOYEE_EMAILS[:len(ROSTER)]:
            u = db.query(User).filter(User.email == em).first()
            if u is None:
                continue
            pu = (db.query(PrivateUser)
                    .filter(PrivateUser.user_id == u.user_id,
                            PrivateUser.company_id == co.company_id)
                    .first())
            if pu is None:
                preexisting.append(em)
        detail = ", ".join(preexisting) or str(report.get("failed"))
        raise SystemExit(
            f"Seed aborted: {report['created']}/{len(ROSTER)} employees imported. "
            f"These DEMO_EMPLOYEE_EMAILS already have a Kiruko account and were "
            f"skipped (NOT enrolled in '{COMPANY_NAME}'): {detail}. "
            "Remove them from DEMO_EMPLOYEE_EMAILS, use fresh addresses, or wipe "
            "the DB and reseed."
        )
    emp = {}
    for em in EMPLOYEE_EMAILS[:len(ROSTER)]:
        u = db.query(User).filter(User.email == em).one()
        u.user_verified = True; u.user_enabled = True
        u.password_hash = generate_passwd_hash(PASSWORD)   # so you can log in as them
        # Scope the membership lookup to THIS company — a user_id-only .one() would
        # raise MultipleResults for anyone who also belongs to another company.
        emp[em] = (db.query(PrivateUser)
                     .filter(PrivateUser.user_id == u.user_id,
                             PrivateUser.company_id == co.company_id)
                     .one())
    db.flush()
    return emp


def assign_roles(db, co):
    """Seed the company's system-role catalogue (Owner, Company Admin, HR Manager,
    Department Manager, Supervisor) and grant a few employees a management role, so
    they can sign in to the WEB dashboard (a private user needs a company role for
    web access) and RBAC can be exercised end-to-end. Mirrors what the app does on
    first visit to Settings → Permissions, so a freshly-seeded company is testable
    without manual clicking. Employees with no `role` stay mobile-only."""
    from api.v1.company_roles import _ensure_system_roles
    from db_models.crud.user import set_roles_for_private_user

    _ensure_system_roles(co.company_id, db)   # creates the CompanyRole catalogue

    granted = []
    for r, em in zip(ROSTER, EMPLOYEE_EMAILS):
        slug = r.get("role")
        if not slug:
            continue
        u = db.query(User).filter(User.email == em).one()
        pu = (db.query(PrivateUser)
                .filter(PrivateUser.user_id == u.user_id,
                        PrivateUser.company_id == co.company_id)
                .one())
        # created_by = the company owner (Company.user_id)
        set_roles_for_private_user(co.company_id, pu.private_user_id, [slug], co.user_id, db)
        granted.append((em, slug))
    return granted


def post_process(db, co, emp):
    allow_comp = SalaryComponent(
        company_id=co.company_id, code="TRANSPORT", label="Transport allowance",
        kind="earning", category="allowance.transport", is_basic=False,
        is_taxable=True, statutory_base_codes=["PAYE", "CSG_EE", "CSG_ER"])
    db.add(allow_comp); db.flush()
    for r, em in zip(ROSTER, EMPLOYEE_EMAILS):
        pu = emp[em]
        job = db.query(Job).filter(Job.private_user_id == pu.private_user_id).order_by(Job.job_id.desc()).first()
        sal = db.query(Salary).filter(Salary.job_id == job.job_id).first()
        sal.break_in_minutes_per_day = 60
        if r["basis"] == "hourly":
            sal.pay_basis = "hourly"; sal.hourly_rate = Decimal(str(r["base"]))
            sal.monthly_hours = str(r["wdays"] * 4 * 8); sal.salary = "0"
        if r["allow"]:
            structure = (db.query(SalaryStructure)
                         .join(SalaryStructureLine, SalaryStructureLine.structure_id == SalaryStructure.id)
                         .join(EmployeeSalaryAssignment, EmployeeSalaryAssignment.structure_id == SalaryStructure.id)
                         .filter(EmployeeSalaryAssignment.private_user_id == pu.private_user_id).first())
            if structure:
                db.add(SalaryStructureLine(structure_id=structure.id, component_id=allow_comp.id,
                                           amount=Decimal(str(r["allow"])), order_index=1))
    db.flush()


def seed_attendance(db, emp):
    n = 0
    for r, em in zip(ROSTER, EMPLOYEE_EMAILS):
        pu = emp[em]
        job = db.query(Job).filter(Job.private_user_id == pu.private_user_id).order_by(Job.job_id.desc()).first()
        absent = set(r["absent"])
        for month in range(1, MONTHS + 1):
            wd = working_days(YEAR, month, r["wdays"])
            ot_picks = set(wd[i] for i in range(2, len(wd), max(1, len(wd)//max(r["ot"], 1)))) if r["ot"] else set()
            otc = 0
            for d in wd:
                if THROUGH_TODAY and d > TODAY:
                    continue                       # no future-dated attendance
                if (month, d.day) in absent:
                    continue
                long_day = d in ot_picks and otc < r["ot"]
                end_h = 20 if long_day else 17    # plain shift; engine auto-splits OT past 8h/45h
                if long_day:
                    otc += 1
                tl = TimeLog(private_user_id=pu.private_user_id, job_id=job.job_id,
                             start_time=utc(d, 8), end_time=utc(d, end_h),
                             location={"latitude": -20.1609, "longitude": 57.5012, "source": "demo_seed"},
                             hours_worked=Decimal(str((end_h - 8) - 1)), day_of_week=d.strftime("%A"),
                             admin_approved=True, admin_approved_at=utc(d, end_h), admin_rejected=False,
                             is_overtime=False, overtime_confirmed_by_employer=False)
                db.add(tl); db.flush(); n += 1
                db.add(BreakLog(timelog_id=tl.timelog_id, start_time=utc(d, 12), end_time=utc(d, 13)))
        db.flush()
    return n


def seed_leave(db, emp, owner_id):
    # Leave lives in June; only seed it if June is within the attendance range.
    if MONTHS < 6:
        return 0
    added = 0
    for idx, ltype, days in LEAVE:
        if idx >= len(EMPLOYEE_EMAILS):
            continue   # fewer test users than the sample leave indices
        days_set = {date(YEAR, 6, dd) for dd in days}
        if THROUGH_TODAY:
            days_set = {d for d in days_set if d <= TODAY}   # no future leave
        if not days_set:
            continue
        em = EMPLOYEE_EMAILS[idx]
        pu = emp[em]
        # remove clashing clock-ins on the leave days (can't be present + on leave)
        for tl in db.query(TimeLog).filter(TimeLog.private_user_id == pu.private_user_id).all():
            if tl.start_time and tl.start_time.astimezone(MU).date() in days_set:
                db.delete(tl)
        db.add(Leave(private_user_id=pu.private_user_id, leave_type=ltype, leave_type_id=None,
                     start_date=min(days_set), end_date=max(days_set), status="approved",
                     approved_at=utc(date(YEAR, 6, 1), 8), approved_by=owner_id, notes="demo seed"))
        added += 1
    db.flush()
    return added


def main():
    if os.getenv("SEED_DEMO") != "yes":
        print("Refusing to seed demo data. Re-run with SEED_DEMO=yes (staging/QA only).")
        sys.exit(1)
    if not EMPLOYEE_EMAILS:
        print("No employee emails — set DEMO_EMPLOYEE_EMAILS (comma-separated).")
        sys.exit(1)

    from core.tenant_context import bypass_tenant_guard

    db = get_session_local()()
    db.execute(text("SELECT set_config('app.company_id', '*', false)")); db.commit()
    # This maintenance script touches every tenant. The PG GUC above satisfies
    # Postgres RLS, but the Python-level tenant guard is a SEPARATE mechanism and
    # needs its own escape hatch — otherwise the private_users lookup in
    # import_employees ("query touches multi-tenant tables without a company_id
    # filter") is rejected. bypass_tenant_guard is exactly that hatch.
    with bypass_tenant_guard("demo data seeding (maintenance script, all tenants)"):
        try:
            if db.query(Company).filter(Company.company_name == COMPANY_NAME).first():
                print(f"Demo company '{COMPANY_NAME}' already exists — skipping (idempotent).")
                return
            co = make_owner_company(db)
            emp = import_employees(db, co)
            post_process(db, co, emp)
            granted = assign_roles(db, co)
            if NO_ATTENDANCE:
                n = lv = 0
            else:
                n = seed_attendance(db, emp)
                owner_id = db.query(Company).filter(Company.company_id == co.company_id).one().user_id
                lv = seed_leave(db, emp, owner_id)
            db.commit()
            print(f"✅ Seeded '{COMPANY_NAME}' (company_id={co.company_id}): "
                  f"{len(ROSTER)} employees, {n} clock-ins, {lv} leave records"
                  f"{' (accounts only)' if NO_ATTENDANCE else f', {MONTHS} month(s)'}.")
            print(f"   Owner login: {OWNER_EMAIL} / {PASSWORD}")
            print(f"   Employees:   {EMPLOYEE_EMAILS[0]} … (+{len(ROSTER)-1} more) / {PASSWORD}")
            if granted:
                print("   Web-enabled role logins (private users with a company role):")
                for em, slug in granted:
                    print(f"     - {em} → {slug} / {PASSWORD}")
            print("   NO payroll runs created — log in as the owner and run them.")
        finally:
            db.close()


if __name__ == "__main__":
    main()
