"""Scale — a single payroll run resolves a large workforce correctly."""
import uuid
from decimal import Decimal

from sqlalchemy import text as sql_text

from core.model import Company, Payslip, PrivateUser, User
from schema.payroll_schema import PayrollRunCreate
from services import employee_import_service as imp, payroll_engine
from datetime import date

N = 100


def test_payroll_resolves_a_large_workforce(db, seed_mu_rules):
    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)")); db.commit()
    sfx = uuid.uuid4().hex[:8]
    owner = User(user_type="company", email=f"sc-{sfx}@x.com", user_name=f"sc-{sfx}", password_hash="x")
    db.add(owner); db.flush()
    co = Company(user_id=owner.user_id, company_name=f"Scale {sfx}", email=f"scco-{sfx}@x.com",
                 brn=f"SCALE_{sfx}", country_code="MU")
    db.add(co); db.commit()

    header = "first_name,last_name,email,job_title,start_date,base_salary,currency,department,work_days_per_week,pay_basis"
    rows = [f"E{i},T,e{i}-{sfx}@x.com,Clerk,2024-01-01,30000,MUR,Dept{i % 5},5,monthly" for i in range(N)]
    report = imp.commit(db, co.company_id, imp.parse((header + "\n" + "\n".join(rows) + "\n").encode(), "bulk.csv"), actor_user_id=None)
    db.commit()
    assert report["created"] == N

    run = payroll_engine.create_draft_run(db, PayrollRunCreate(
        company_id=co.company_id, period_start=date(2026, 5, 1), period_end=date(2026, 5, 31)), actor_user_id=None)
    db.flush()
    slips = db.query(Payslip).filter(Payslip.payroll_run_id == run.id).all()
    assert len(slips) == N                                   # every employee got a payslip
    assert all(Decimal(s.gross) == Decimal("30000.00") for s in slips)
    assert all(Decimal(s.net_pay) < Decimal(s.gross) for s in slips)  # statutory came off each
