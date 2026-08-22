#!/usr/bin/env python3
"""One-off test fixture for the payslip-correction loop.

Seeds an April 2026 finalized payroll run for the demo employee, then attaches
a payroll dispute (UserRight) linked to that run + payslip — so the web
disputes modal shows the "Recompute & correct this payslip" button.

Flow it sets up (matches the manual test steps):
  1. April clock-ins seeded + a finalized April run with one payslip.
  2. A linked dispute (status=received) pointing at run_id + payslip_id.
  Then YOU: change the employee's salary, open the dispute, click correct.

Idempotent: reuses the demo company/employee (by BRN); if an April run already
exists it is reused (finalized if still draft); the dispute is reused by a
marker title rather than duplicated.

Run from repo root:
  python3 backend/scripts/seed_test_correction.py
  python3 backend/scripts/seed_test_correction.py --month 2026-04 --absence
"""
import argparse
import os
import sys
from datetime import date, datetime, time, timezone

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_dir)

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(backend_dir, ".env"), override=False)
except Exception:
    pass

from core.config import get_session_local
from core.model import PayrollRun, Payslip, UserRight
from schema.payroll_schema import PayrollRunCreate
from services import payroll_engine

# Reuse the demo-company/employee/clock-in plumbing so this stays in lock-step
# with the main demo seeder (same BRN, same worker, same work_days).
from scripts.seed_demo_payroll import (
    _ensure_company,
    _ensure_employee,
    _reseed_clockins,
    _month_bounds,
)

DISPUTE_MARKER = "[TEST] Payslip amount looks wrong"


def _get_or_create_april_run(db, company, emp, start: date, end: date) -> PayrollRun:
    run = (
        db.query(PayrollRun)
        .filter(
            PayrollRun.company_id == company.company_id,
            PayrollRun.period_start == start,
            PayrollRun.period_end == end,
            PayrollRun.status != "cancelled",
        )
        .first()
    )
    if run is None:
        run = payroll_engine.create_draft_run(
            db,
            PayrollRunCreate(
                company_id=company.company_id,
                period_start=start,
                period_end=end,
                private_user_ids=[emp.private_user_id],
                notes="Test fixture: correction-loop run",
            ),
            actor_user_id=None,
        )
        db.flush()

    if run.status == "draft":
        payroll_engine.finalize_run(db, run.id, actor_user_id=None)
        db.flush()
    return run


def _get_or_create_dispute(db, emp, run, payslip) -> UserRight:
    dispute = (
        db.query(UserRight)
        .filter(
            UserRight.private_user_id == emp.private_user_id,
            UserRight.title == DISPUTE_MARKER,
        )
        .first()
    )
    if dispute is None:
        dispute = UserRight(
            private_user_id=emp.private_user_id,
            title=DISPUTE_MARKER,
            category="payroll",
            issue_description=(
                "My April payslip net pay does not match what I expected. "
                "Please review and correct."
            ),
            contact_method="in_app",
            urgency_level="medium",
            expected_outcome="Corrected payslip with the right net pay.",
            status="received",
            channel="internal",
            accept_terms_and_conditions=True,
            acknowledge_information=True,
            agreed_to_be_contacted=True,
            payroll_run_id=run.id,
            payslip_id=payslip.id,
        )
        db.add(dispute)
        db.flush()
    else:
        # Re-point at the (possibly fresh) run/payslip and reset to an
        # actionable state so the correct button shows on a re-run.
        dispute.payroll_run_id = run.id
        dispute.payslip_id = payslip.id
        if dispute.status in ("resolved", "rejected", "closed"):
            dispute.status = "received"
        db.flush()
    return dispute


def run(month: str, absence: bool) -> None:
    SessionLocal = get_session_local()
    if SessionLocal is None:
        print("ERROR: no DB engine configured (check backend/.env DATABASE_URL).")
        sys.exit(1)
    db = SessionLocal()
    try:
        start, end = _month_bounds(month)
        company = _ensure_company(db)
        emp, job = _ensure_employee(db, company)
        n = _reseed_clockins(db, emp, job, start, end, absence=absence)

        run_ = _get_or_create_april_run(db, company, emp, start, end)

        payslip = (
            db.query(Payslip)
            .filter(
                Payslip.payroll_run_id == run_.id,
                Payslip.private_user_id == emp.private_user_id,
                Payslip.is_adjustment == False,  # noqa: E712 — the original, not an adjustment
            )
            .first()
        )
        if payslip is None:
            print("ERROR: finalize produced no payslip for the demo employee.")
            sys.exit(1)

        dispute = _get_or_create_dispute(db, emp, run_, payslip)
        db.commit()

        print("\nTest correction fixture ready:")
        print(f"  company_id        {company.company_id}  ({company.company_name})")
        print(f"  private_user_id   {emp.private_user_id}  (Demo Worker)")
        print(f"  period            {start} … {end}  ({n} approved clock-in day(s))")
        print(f"  payroll_run_id    {run_.id}  (status={run_.status})")
        print(f"  payslip_id        {payslip.id}  (net_pay={payslip.net_pay}, gross={payslip.gross})")
        print(f"  dispute right_id  {dispute.right_id}  (status={dispute.status}, linked → run+payslip)")
        print(f"  employer login    demo-employer@kirukodemo.com / DemoPass123!")
        print("\nNext (web dashboard):")
        print("  1. Change the worker's salary (or approve/unapprove an April clock-in).")
        print("  2. Open Disputes → this dispute (linked to a payslip).")
        print("  3. Click 'Recompute & correct this payslip' → toast shows the net delta.")
    finally:
        db.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Seed the payslip-correction test fixture (April run + linked dispute).")
    ap.add_argument("--month", default="2026-04", help="Target month YYYY-MM (default: 2026-04).")
    ap.add_argument("--absence", action="store_true", help="Skip the last working day to seed an absence deduction.")
    args = ap.parse_args()
    run(args.month, args.absence)
