"""Dispute-flow fixes: (1) link-ownership IDOR, (2) correction resolves dispute."""
import asyncio
import uuid
from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from core.model import Company, User, PrivateUser, PayrollRun, Payslip, UserRight
from api.v1.user import create_user_right
from api.v1.payroll import create_payslip_adjustment
from services import employee_import_service as imp


def _run(coro):
    return asyncio.run(coro)


def _company_two(db: Session):
    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    db.commit()
    sfx = uuid.uuid4().hex[:8]
    owner = User(user_type="company", email=f"d-own-{sfx}@x.com", user_name=f"d-own-{sfx}", password_hash="x")
    db.add(owner); db.flush()
    co = Company(user_id=owner.user_id, company_name=f"D {sfx}", email=f"dco-{sfx}@x.com", brn=f"D_{sfx}", country_code="MU")
    db.add(co); db.flush()

    def emp(tag):
        u = User(user_type="private", email=f"d-{tag}-{sfx}@x.com", user_name=f"d-{tag}-{sfx}", password_hash="x")
        db.add(u); db.flush()
        p = PrivateUser(user_id=u.user_id, first_name=tag, last_name="T", company_id=co.company_id, role="employee")
        db.add(p); db.flush()
        return u, p

    a_user, a = emp("A")
    b_user, b = emp("B")
    db.commit()
    return sfx, owner, co, a_user, a, b_user, b


def _raise(db, reporter_pid, payslip_id=None):
    return _run(create_user_right(
        private_user_id=reporter_pid, title="Q", category="payroll",
        issue_description="x", contact_method="in_app", previous_occurence=False,
        urgency_level="medium", resolution_method="x",
        accept_terms_and_conditions=True, acknowledge_information=True, agreed_to_be_contacted=True,
        complaint_status="received", expected_outcome="fix",
        payslip_id=payslip_id, db=db,
    ))


# ── Fix #2: IDOR ─────────────────────────────────────────────────────────────
def test_cannot_link_another_employees_payslip(db: Session):
    _, owner, co, a_user, a, b_user, b = _company_two(db)
    run = PayrollRun(company_id=co.company_id, period_start=date(2026, 4, 1), period_end=date(2026, 4, 30), status="finalized", currency="MUR")
    db.add(run); db.flush()
    ps = Payslip(payroll_run_id=run.id, private_user_id=a.private_user_id, gross="1000", net_pay="900", paye="0", currency="MUR")
    db.add(ps); db.commit()

    # B tries to attach A's payslip → 403
    with pytest.raises(HTTPException) as ei:
        _raise(db, b.private_user_id, payslip_id=ps.id)
    assert ei.value.status_code == 403


def test_link_to_nonexistent_payslip_rejected(db: Session):
    _, owner, co, a_user, a, b_user, b = _company_two(db)
    with pytest.raises(HTTPException) as ei:
        _raise(db, a.private_user_id, payslip_id=999999999)
    assert ei.value.status_code == 403


# ── Fix #1: correction resolves the linked dispute ───────────────────────────
def test_correction_advances_linked_dispute(db: Session, seed_mu_rules):
    sfx, owner, co, *_ = _company_two(db)
    # A payroll-ready employee (structure resolves to 25000) via the import service.
    csv = (
        "first_name,last_name,email,job_title,start_date,base_salary,currency\n"
        f"Corr,Test,corr-{sfx}@x.com,Clerk,2026-04-01,25000,MUR\n"
    ).encode()
    imp.commit(db, co.company_id, imp.parse(csv, "s.csv"), actor_user_id=None)
    db.commit()
    eu = db.query(User).filter(User.email == f"corr-{sfx}@x.com").one()
    e = db.query(PrivateUser).filter(PrivateUser.user_id == eu.user_id).one()

    run = PayrollRun(company_id=co.company_id, period_start=date(2026, 4, 1), period_end=date(2026, 4, 30), status="finalized", currency="MUR")
    db.add(run); db.flush()
    # Stale payslip (net 0) so the recompute produces a non-zero delta.
    ps = Payslip(payroll_run_id=run.id, private_user_id=e.private_user_id, gross="0", net_pay="0", paye="0", currency="MUR")
    db.add(ps); db.flush()
    ur = UserRight(
        private_user_id=e.private_user_id, title="Wrong pay", category="payroll",
        issue_description="net looks wrong", contact_method="in_app", urgency_level="medium",
        expected_outcome="fix", status="investigating", channel="internal",
        accept_terms_and_conditions=True, acknowledge_information=True, agreed_to_be_contacted=True,
        payslip_id=ps.id, payroll_run_id=run.id,
    )
    db.add(ur); db.commit()

    resp = create_payslip_adjustment(run.id, ps.id, body={}, db=db, current_user=owner)
    assert resp["status"] == "adjusted"
    assert resp["linked_disputes_updated"] == 1

    db.refresh(ur)
    assert ur.status == "action_taken"               # investigating → action_taken
    assert "correction applied" in (ur.internal_notes or "").lower()
