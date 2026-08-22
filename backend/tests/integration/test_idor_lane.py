"""IDOR security lane — object-scoped endpoints must refuse the wrong employee.

Logs in as employee B and reaches for A's objects by id; each must be refused.
Guards this session's IDOR fixes against regression.

This file adds the PAYSLIP-read lane (previously untested). The other
object-scoped IDORs are already covered and indexed here so this is the single
security-lane map:
  - vault read / company-vault / delete → tests/test_vault_access.py
        (test_other_employee_blocked_idor, test_delete_idor_blocked,
         test_company_endpoint_excludes_private_and_gates_non_admin)
  - dispute payslip-link               → tests/test_dispute_flow_fixes.py
        (test_cannot_link_another_employees_payslip,
         test_link_to_nonexistent_payslip_rejected)
"""
import uuid
from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from core.model import Company, Payslip, PayrollRun, PrivateUser, User
from services import employee_import_service as imp
from api.v1.payroll import get_payslip, list_employee_payslips


def _two_employees_with_payslip(db: Session):
    """Company with employees A and B (real import path); A has a finalized
    payslip. Returns (company, A, A's user, B's user, A's payslip)."""
    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    db.commit()
    sfx = uuid.uuid4().hex[:8]
    owner = User(user_type="company", email=f"idor-own-{sfx}@x.com",
                 user_name=f"idor-own-{sfx}", password_hash="x")
    db.add(owner); db.flush()
    co = Company(user_id=owner.user_id, company_name=f"IDOR {sfx}",
                 email=f"idorco-{sfx}@x.com", brn=f"IDOR_{sfx}", country_code="MU")
    db.add(co); db.commit()

    csv = (
        "first_name,last_name,email,job_title,start_date,base_salary,currency\n"
        f"Aa,Tt,idor-a-{sfx}@x.com,Clerk,2024-01-01,25000,MUR\n"
        f"Bb,Tt,idor-b-{sfx}@x.com,Clerk,2024-01-01,25000,MUR\n"
    ).encode()
    imp.commit(db, co.company_id, imp.parse(csv, "s.csv"), actor_user_id=None)
    db.commit()

    a_user = db.query(User).filter(User.email == f"idor-a-{sfx}@x.com").one()
    a = db.query(PrivateUser).filter(PrivateUser.user_id == a_user.user_id).one()
    b_user = db.query(User).filter(User.email == f"idor-b-{sfx}@x.com").one()

    run = PayrollRun(company_id=co.company_id, period_start=date(2026, 4, 1),
                     period_end=date(2026, 4, 30), status="finalized", currency="MUR")
    db.add(run); db.flush()
    ps = Payslip(payroll_run_id=run.id, private_user_id=a.private_user_id,
                 gross="25000", net_pay="23000", paye="0", currency="MUR")
    db.add(ps); db.commit()
    return co, a, a_user, b_user, ps


# Each case: B (a non-admin colleague) reaching for A's payslip object by id.
_IDOR_CALLS = [
    ("get_payslip",
     lambda db, a, b_user, ps: get_payslip(ps.id, db=db, current_user=b_user)),
    ("list_employee_payslips",
     lambda db, a, b_user, ps: list_employee_payslips(a.private_user_id, db=db, current_user=b_user)),
]


@pytest.mark.parametrize("name,call", _IDOR_CALLS, ids=[c[0] for c in _IDOR_CALLS])
def test_payslip_idor_blocked(db: Session, name, call):
    _, a, a_user, b_user, ps = _two_employees_with_payslip(db)
    with pytest.raises(HTTPException) as ei:
        call(db, a, b_user, ps)
    assert ei.value.status_code in (403, 404), f"{name} did not refuse cross-employee access"


def test_payslip_owner_can_read(db: Session):
    """Positive control — the lane refuses B, but A still reads their own payslip
    (so the guard isn't just blocking everyone)."""
    _, a, a_user, b_user, ps = _two_employees_with_payslip(db)
    out = get_payslip(ps.id, db=db, current_user=a_user)
    assert out is not None
