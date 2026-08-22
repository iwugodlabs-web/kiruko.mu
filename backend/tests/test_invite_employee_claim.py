"""Employee invites route through the account-claim flow, not the web invite.

Employees live in the mobile app, so `POST /company/{id}/invite` with role
"employee" must direct-create a claimable shell account (blank profile) and mint
a /claim token — NOT a web CompanyInvite record. Other roles keep the web invite
→ accept flow. These call the endpoint function directly (like
test_single_employee_onboard) to cover the branch without HTTP/auth plumbing.
"""
import uuid
import asyncio

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from core.model import Company, User, PrivateUser, CompanyInvite, VerificationToken
from api.v1 import account_claim as claim
from api.v1.account_claim import ClaimValidateRequest, ClaimCompleteRequest, CLAIM_TOKEN_TYPE
from api.v1.company import invite_company_user, InviteCompanyUser


def _company(db: Session):
    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    db.commit()
    sfx = uuid.uuid4().hex[:8]
    owner = User(user_type="company", email=f"own-{sfx}@x.com", user_name=f"own-{sfx}", password_hash="x")
    db.add(owner); db.flush()
    co = Company(user_id=owner.user_id, company_name=f"C {sfx}", email=f"co-{sfx}@x.com", brn=f"B_{sfx}", country_code="MU")
    db.add(co); db.flush()
    db.commit()
    return owner, co


def _invite(db, co, owner, email, role):
    return asyncio.run(invite_company_user(
        co.company_id, InviteCompanyUser(email=email, role=role),
        BackgroundTasks(), db=db, current_user=owner,
    ))


def test_employee_invite_creates_claimable_shell_not_web_invite(db: Session):
    owner, co = _company(db)
    email = f"emp-{uuid.uuid4().hex[:6]}@example.com"

    res = _invite(db, co, owner, email, "employee")
    assert res.get("claim") is True
    assert res["role"] == "employee"

    # A shell account exists, linked to the company as an employee, blank
    # profile, and NOT verified (login blocked until they claim + set a pwd).
    u = db.query(User).filter(User.email == email).one()
    assert u.user_verified is False
    assert u.onboard_complete is False  # must complete profile on mobile
    emp = db.query(PrivateUser).filter(PrivateUser.user_id == u.user_id).one()
    assert emp.company_id == co.company_id
    assert emp.role == "employee"
    assert emp.first_name == "" and emp.last_name == ""

    # It went through the CLAIM path, not the web invite path.
    assert db.query(CompanyInvite).filter(CompanyInvite.email == email).count() == 0
    tok = db.query(VerificationToken).filter(
        VerificationToken.email == email,
        VerificationToken.token_type == CLAIM_TOKEN_TYPE,
        VerificationToken.used == False,  # noqa: E712
    ).one()
    assert tok is not None


def test_non_employee_invite_still_uses_web_invite(db: Session):
    owner, co = _company(db)
    email = f"mgr-{uuid.uuid4().hex[:6]}@example.com"

    res = _invite(db, co, owner, email, "manager")
    assert res.get("invite_id") is not None
    assert res.get("claim") is None

    # Web invite record created; no shell User; no claim token.
    assert db.query(CompanyInvite).filter(CompanyInvite.email == email).count() == 1
    assert db.query(User).filter(User.email == email).count() == 0
    assert db.query(VerificationToken).filter(
        VerificationToken.email == email,
        VerificationToken.token_type == CLAIM_TOKEN_TYPE,
    ).count() == 0


def test_duplicate_employee_invite_is_409(db: Session):
    owner, co = _company(db)
    email = f"dup-{uuid.uuid4().hex[:6]}@example.com"
    _invite(db, co, owner, email, "employee")
    with pytest.raises(HTTPException) as ei:
        _invite(db, co, owner, email, "employee")
    assert ei.value.status_code == 409
