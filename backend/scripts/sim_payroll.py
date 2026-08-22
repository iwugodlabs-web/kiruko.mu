#!/usr/bin/env python3
"""One-off payroll simulation: run the REAL engine for the demo employee and
dump every line, then cross-check the totals. Not committed long-term — a
debugging aid to find where payslip numbers don't add up."""
import os
import sys
from datetime import date
from decimal import Decimal

backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend)
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(backend, ".env"), override=False)
except Exception:
    pass

from core.config import get_session_local
from core.model import Company, Job, Payslip, PayrollRun, PrivateUser, Salary
from schema.payroll_schema import PayrollRunCreate
from services import payroll_engine

db = get_session_local()()


def money(x):
    return Decimal(str(x or 0))


def main():
    co = db.query(Company).filter(Company.brn == "DEMO_PAYROLL_BRN").one_or_none()
    if co is None:
        print("No demo company — run scripts/seed_demo_payroll.py first.")
        return
    emp = (
        db.query(PrivateUser)
        .filter(PrivateUser.company_id == co.company_id, PrivateUser.role == "employee")
        .first()
    )
    job = db.query(Job).filter(Job.private_user_id == emp.private_user_id).first()
    sal = db.query(Salary).filter(Salary.job_id == job.job_id).first()
    print(f"company={co.company_id} {co.company_name}")
    print(f"employee priv_id={emp.private_user_id} basic={sal.salary} basis={sal.pay_basis} "
          f"monthly_hours={sal.monthly_hours} days/mo={sal.days_of_work_per_month}")

    ps, pe = date(2026, 6, 1), date(2026, 6, 30)
    for r in db.query(PayrollRun).filter(
        PayrollRun.company_id == co.company_id, PayrollRun.period_start == ps,
        PayrollRun.status != "cancelled",
    ).all():
        payroll_engine.cancel_run(db, r.id)
    db.flush()

    run = payroll_engine.create_draft_run(
        db, PayrollRunCreate(company_id=co.company_id, period_start=ps, period_end=pe, notes="sim"),
        actor_user_id=co.user_id,
    )
    db.commit()
    print(f"\nrun={run.id} status={run.status} flags={run.compliance_flags}")

    for p in db.query(Payslip).filter(Payslip.payroll_run_id == run.id).all():
        print(f"\n=== payslip {p.id} (priv {p.private_user_id}) ===")
        earn = Decimal("0"); ded = Decimal("0")
        print("  components:")
        for c in (p.components or []):
            amt = money(c.get("amount"))
            if c.get("kind") == "earning":
                earn += amt
            else:
                ded += amt
            print(f"    {c.get('kind'):9} {c.get('code'):16} {amt:>12} meta={c.get('meta')}")
        stat_ee = sum((money(v) for v in (p.statutory_employee or {}).values()), Decimal("0"))
        print(f"  statutory_employee={p.statutory_employee}  (sum={stat_ee})")
        print(f"  statutory_employer={p.statutory_employer}")
        print(f"  paye={p.paye} loan={p.loan_repayments} leave_impact={p.leave_impact}")
        print(f"  gross={p.gross} taxable={p.taxable_income} deductions_total={p.deductions_total} net={p.net_pay}")

        # cross-checks
        print("  --- cross-checks ---")
        print(f"   sum(earning components) = {earn}  vs gross = {p.gross}   {'OK' if earn == money(p.gross) else 'MISMATCH'}")
        expected_ded = ded + stat_ee + money(p.paye) + money(p.loan_repayments) + money(p.leave_impact)
        print(f"   sum(component deds)+stat_ee+paye+loan+leave = {expected_ded}  vs deductions_total = {p.deductions_total}   {'OK' if expected_ded == money(p.deductions_total) else 'MISMATCH'}")
        net_chk = money(p.gross) - money(p.deductions_total)
        print(f"   gross - deductions_total = {net_chk}  vs net = {p.net_pay}   {'OK' if net_chk == money(p.net_pay) else 'MISMATCH'}")


if __name__ == "__main__":
    try:
        main()
    finally:
        db.close()
