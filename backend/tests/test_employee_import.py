"""Bulk employee import — parse / validate / commit."""
import uuid
from datetime import date

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from core.model import Company, User, PrivateUser
from services import employee_import_service as imp


def _company(db: Session) -> int:
    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    db.commit()
    sfx = uuid.uuid4().hex[:8]
    owner = User(user_type="company", email=f"imp-own-{sfx}@example.com", user_name=f"imp-own-{sfx}", password_hash="x")
    db.add(owner); db.flush()
    co = Company(user_id=owner.user_id, company_name=f"IMP {sfx}", email=f"impco-{sfx}@example.com", brn=f"IMP_{sfx}", country_code="MU")
    db.add(co); db.flush()
    return co.company_id


def _csv(sfx: str) -> bytes:
    return (
        "first_name,last_name,email,job_title,start_date,base_salary,currency,department,role,pay_basis\n"
        f"Aisha,R,imp-{sfx}-a@example.com,Cashier,2026-02-01,22000,MUR,Retail,employee,monthly\n"
        f"Bob,L,imp-{sfx}-b@example.com,Stocker,2026-02-01,9000,MUR,Retail,employee,monthly\n"      # below min → warn
        "Bad,Row,not-an-email,,baddate,-5,ZZZ,,,\n"                                                   # 5 field errors
        f"Dup,A,imp-{sfx}-a@example.com,Cashier,2026-02-01,22000,MUR,Retail,employee,monthly\n"      # dup of row 2
    ).encode()


def test_parse_reads_csv_headers_and_rows(db: Session):
    rows = imp.parse(_csv("p"), "staff.csv")
    assert len(rows) == 4
    assert rows[0]["first_name"] == "Aisha"
    assert rows[0]["base_salary"] == "22000"


def test_xlsx_parses_normalizes_headers_and_validates(db: Session):
    import io
    from openpyxl import Workbook

    cid = _company(db)
    sfx = uuid.uuid4().hex[:6]
    wb = Workbook()
    ws = wb.active
    # Mixed-case / spaced headers exercise _norm_header; numeric salary exercises coercion.
    ws.append(["First Name", "Last Name", "Email", "Job Title", "Start Date", "Base Salary", "Currency"])
    ws.append(["Xavier", "Sheet", f"xls-{sfx}@example.com", "Analyst", "2026-03-01", 28000, "MUR"])
    ws.append([None, None, None, None, None, None, None])  # blank row → skipped
    buf = io.BytesIO()
    wb.save(buf)

    rows = imp.parse(buf.getvalue(), "staff.xlsx")
    assert len(rows) == 1                                  # blank row dropped
    assert rows[0]["first_name"] == "Xavier"              # "First Name" → first_name
    assert rows[0]["base_salary"] == "28000"              # numeric cell → string
    assert rows[0]["email"] == f"xls-{sfx}@example.com"

    res = imp.validate(db, cid, rows)
    assert len(res["ok"]) == 1
    assert res["errors"] == []
    assert res["missing_columns"] == []


def test_validate_flags_errors_dupes_and_warnings(db: Session):
    cid = _company(db)
    sfx = uuid.uuid4().hex[:6]
    res = imp.validate(db, cid, imp.parse(_csv(sfx), "s.csv"))
    assert res["total"] == 4
    assert len(res["ok"]) == 2                       # the 2 good rows
    # bad row contributes several field errors; dup row contributes one.
    # NB: currency is server-authoritative (company country) — the CSV currency
    # column is ignored, so a bad currency value no longer flags a row error.
    fields = {(e["field"]) for e in res["errors"]}
    assert {"email", "job_title", "start_date", "base_salary"} <= fields
    assert any("duplicate" in e["reason"] for e in res["errors"])
    assert any("minimum" in w["reason"] for w in res["warnings"])  # Bob at 9000
    assert res["missing_columns"] == []


def test_validate_reports_missing_required_columns(db: Session):
    cid = _company(db)
    rows = imp.parse(b"first_name,email\nJane,jane@example.com\n", "x.csv")
    res = imp.validate(db, cid, rows)
    assert "base_salary" in res["missing_columns"]
    assert "job_title" in res["missing_columns"]


def test_commit_creates_payroll_ready_employees_and_is_idempotent(db: Session):
    cid = _company(db)
    sfx = uuid.uuid4().hex[:6]
    csv = _csv(sfx)

    summary = imp.commit(db, cid, imp.parse(csv, "s.csv"), actor_user_id=None)
    db.commit()
    assert summary["created"] == 2
    assert summary["skipped"] == 2  # bad row + dup row

    # the created monthly employee resolves to a BASIC component → payroll-ready
    from services import salary_resolver
    u = db.query(User).filter(User.email == f"imp-{sfx}-a@example.com").one()
    emp = db.query(PrivateUser).filter(PrivateUser.user_id == u.user_id).one()
    resolved = salary_resolver.resolve_components(db, emp.private_user_id, date(2026, 2, 1))
    basics = [c for c in resolved.components if getattr(c, "is_basic", False)]
    assert basics and str(basics[0].amount) == "22000.00"

    # re-importing the SAME file creates nothing new (idempotent)
    summary2 = imp.commit(db, cid, imp.parse(csv, "s.csv"), actor_user_id=None)
    db.commit()
    assert summary2["created"] == 0


def test_commit_materialises_work_schedule_from_work_days_per_week(db: Session):
    # Regression: import computed work_days_per_week then dropped it (work_days={}),
    # so a 6-day worker silently fell back to a Mon–Fri week (wrong proration /
    # absence). The schedule + monthly-days must be materialised from the column.
    from core.model import Job, Salary

    cid = _company(db)
    sfx = uuid.uuid4().hex[:6]
    csv = (
        "first_name,last_name,email,job_title,start_date,base_salary,currency,work_days_per_week,work_start_time,work_end_time\n"
        f"Six,Day,sched-{sfx}@example.com,Cashier,2026-02-01,22000,MUR,6,08:00,16:00\n"
    ).encode()
    imp.commit(db, cid, imp.parse(csv, "s.csv"), actor_user_id=None)
    db.commit()

    u = db.query(User).filter(User.email == f"sched-{sfx}@example.com").one()
    emp = db.query(PrivateUser).filter(PrivateUser.user_id == u.user_id).one()
    job = db.query(Job).filter(Job.private_user_id == emp.private_user_id).one()
    sal = db.query(Salary).filter(Salary.job_id == job.job_id).one()

    assert set(job.work_days.keys()) == {"Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"}
    assert "Sunday" not in job.work_days
    assert all(str(v).strip().lower() not in ("off", "0", "") for v in job.work_days.values())  # all real workdays
    assert int(sal.days_of_work_per_month) == 26  # 6 × 52 / 12, not the old hard-coded 22
    # start/end times feed clock reminders + tight auto-close (NULL → off).
    assert job.work_start_time.strftime("%H:%M") == "08:00"
    assert job.work_end_time.strftime("%H:%M") == "16:00"
    assert job.work_days["Monday"] == "08:00-16:00"  # range shape when both times given


def test_validate_warns_on_unparseable_work_time(db: Session):
    cid = _company(db)
    sfx = uuid.uuid4().hex[:6]
    csv = (
        "first_name,last_name,email,job_title,start_date,base_salary,currency,work_start_time\n"
        f"Bad,Time,wt-{sfx}@example.com,Clerk,2026-02-01,22000,MUR,8am\n"
    ).encode()
    res = imp.validate(db, cid, imp.parse(csv, "s.csv"))
    assert not res["errors"]  # bad time doesn't block the row
    assert any("work_start_time" in w["reason"] for w in res["warnings"])


def test_imported_employee_serializes_for_login(db: Session):
    # Regression: the login response (showUser) requires jobs[].employer_name /
    # employer_brn as non-null strings — an imported employee must serialize, or
    # login 500s. (Caught by end-to-end testing.)
    from schema.user_schema import showUser

    cid = _company(db)
    sfx = uuid.uuid4().hex[:6]
    csv = (
        "first_name,last_name,email,job_title,start_date,base_salary,currency\n"
        f"Ser,Ialize,login-{sfx}@example.com,Clerk,2026-03-01,21000,MUR\n"
    ).encode()
    imp.commit(db, cid, imp.parse(csv, "s.csv"), actor_user_id=None)
    db.commit()

    u = db.query(User).filter(User.email == f"login-{sfx}@example.com").one()
    showUser.model_validate(u, from_attributes=True)  # must NOT raise
    assert u.private_user.jobs[0].employer_name  # set from the company


def test_commit_assigns_department_on_private_user(db: Session):
    # The departments page counts members by PrivateUser.department_id, so import
    # must set it (Job.department_id alone showed imported staff as unassigned).
    from core.model import Department

    cid = _company(db)
    sfx = uuid.uuid4().hex[:6]
    csv = (
        "first_name,last_name,email,job_title,start_date,base_salary,currency,department\n"
        f"Dee,Pertment,dept-{sfx}@example.com,Clerk,2026-03-01,20000,MUR,Retail\n"
    ).encode()
    imp.commit(db, cid, imp.parse(csv, "s.csv"), actor_user_id=None)
    db.commit()

    u = db.query(User).filter(User.email == f"dept-{sfx}@example.com").one()
    emp = db.query(PrivateUser).filter(PrivateUser.user_id == u.user_id).one()
    assert emp.department_id is not None
    assert db.query(Department).filter(Department.department_id == emp.department_id).one().name == "Retail"


def test_template_csv_has_required_headers():
    t = imp.template_csv()
    header = t.splitlines()[0]
    for col in imp.REQUIRED_COLUMNS:
        assert col in header
    assert len(t.splitlines()) >= 2  # header + example row
