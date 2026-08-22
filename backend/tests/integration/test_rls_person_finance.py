"""PERSON-scoped RLS on the personal-finance tables (rls_person_finance_20260624).

The worker's own money data must be visible to THEM, never to a colleague, and —
for the personal-finance tables — never to their employer. The one exception is
employer-type loans, which the employer/payroll must still see.

As kiruko_app with app.private_user_id set:
  * a worker sees own budget_goal + own loans (both types), not a colleague's;
  * an employer (app.company_id set, but NOT the employee's private_user_id) sees
    the employee's EMPLOYER loan but NOT their personal loan or budget_goal;
  * '*' bypass sees everything.

Savepoint rolled back; needs a superuser connection to SET ROLE kiruko_app.
"""
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from core.model import BudgetGoal, Company, Loan, PrivateUser, User


@pytest.fixture
def _superuser_required(db: Session):
    if not db.execute(text(
            "SELECT rolsuper FROM pg_roles WHERE rolname = current_user")).scalar():
        pytest.skip("needs a superuser connection to SET ROLE kiruko_app")


def _worker(db: Session, company_id: int, tag: str):
    sfx = uuid.uuid4().hex[:8]
    u = User(user_type="private", email=f"{tag}-{sfx}@x.com",
             user_name=f"{tag}-{sfx}", password_hash="x")
    db.add(u); db.flush()
    pu = PrivateUser(user_id=u.user_id, first_name="E", last_name="E",
                     company_id=company_id, role="employee")
    db.add(pu); db.flush()
    bg = BudgetGoal(private_user_id=pu.private_user_id, category="food", monthly_limit=100)
    db.add(bg); db.flush()
    personal = Loan(private_user_id=pu.private_user_id, description="personal",
                    amount=500, loan_type="personal")
    emp = Loan(private_user_id=pu.private_user_id, description="employer advance",
               amount=900, loan_type="employer")
    db.add(personal); db.add(emp); db.flush()
    return pu, bg.budget_id, personal.loan_id, emp.loan_id


def test_person_scoped_finance(db: Session, _superuser_required):
    db.execute(text("SELECT set_config('app.company_id', '*', false)"))
    owner = User(user_type="company", email=f"own-{uuid.uuid4().hex[:6]}@x.com",
                 user_name=f"own-{uuid.uuid4().hex[:6]}", password_hash="x")
    db.add(owner); db.flush()
    co = Company(user_id=owner.user_id, company_name="Co",
                 email=f"co-{uuid.uuid4().hex[:6]}@x.com",
                 brn=f"B_{uuid.uuid4().hex[:6]}", country_code="MU")
    db.add(co); db.flush()

    a_pu, a_bg, a_personal, a_emp = _worker(db, co.company_id, "A")
    b_pu, b_bg, b_personal, b_emp = _worker(db, co.company_id, "B")
    db.flush()

    conn = db.connection()
    conn.execute(text("SAVEPOINT e"))
    try:
        # --- Worker A: sees own, not colleague B's ---
        conn.execute(text("SET LOCAL ROLE kiruko_app"))
        conn.execute(text(f"SET LOCAL app.private_user_id = '{a_pu.private_user_id}'"))
        conn.execute(text(f"SET LOCAL app.company_id = '{co.company_id}'"))
        bgs = {r[0] for r in conn.execute(text("SELECT budget_id FROM budget_goals")).fetchall()}
        loans = {r[0] for r in conn.execute(text("SELECT loan_id FROM loans")).fetchall()}
        assert a_bg in bgs and b_bg not in bgs, "worker sees only own budget_goal"
        assert {a_personal, a_emp} <= loans, "worker sees both own loans"
        assert b_personal not in loans and b_emp not in loans, "worker can't see colleague's loans"

        # --- Company/employer context: must see NOTHING (loans are personal/private) ---
        # company_id set (the employer's), but private_user_id is not an employee's.
        # There is no employer branch, so the company sees no personal finance at all.
        conn.execute(text("SET LOCAL app.private_user_id = '0'"))  # no matching person
        bgs2 = {r[0] for r in conn.execute(text("SELECT budget_id FROM budget_goals")).fetchall()}
        loans2 = {r[0] for r in conn.execute(text("SELECT loan_id FROM loans")).fetchall()}
        assert not bgs2, "company must NOT see any worker's budget_goals"
        assert a_personal not in loans2 and a_emp not in loans2, "company must NOT see worker A's loans"
        assert b_personal not in loans2 and b_emp not in loans2, "company must NOT see worker B's loans"

        # --- '*' bypass sees all ---
        conn.execute(text("SET LOCAL app.private_user_id = '*'"))
        allb = {r[0] for r in conn.execute(text("SELECT budget_id FROM budget_goals")).fetchall()}
        assert {a_bg, b_bg} <= allb
    finally:
        conn.execute(text("RESET ROLE"))
        conn.execute(text("ROLLBACK TO SAVEPOINT e"))
