"""Single-employee onboarding (POST /companies/{id}/employees).

The onboarding wizard now direct-creates a payroll-ready employee through the
SAME pipeline as bulk import, then sends the account-claim ("set my password")
link — not the old accept-only invite. These tests exercise the endpoint
function directly (like test_account_claim), so they cover the mapping,
validation, claim-token issuance and idempotency without HTTP/auth plumbing.
"""
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from core.model import Company, User, PrivateUser, Job, Salary
from core.security import verify_password
from api.v1 import account_claim as claim
from api.v1.account_claim import ClaimValidateRequest, ClaimCompleteRequest
from api.v1.employee_import import create_single_employee, SingleEmployeePayload


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


def _payload(sfx: str, **over) -> SingleEmployeePayload:
    base = dict(
        first_name="Aisha", last_name="R", email=f"solo-{sfx}@example.com",
        job_title="Cashier", start_date="2026-02-01", base_salary=22000, currency="MUR",
        department="Retail",
    )
    base.update(over)
    return SingleEmployeePayload(**base)


def test_creates_payroll_ready_employee_and_issues_claim(db: Session):
    owner, co = _company(db)
    sfx = uuid.uuid4().hex[:6]
    res = create_single_employee(co.company_id, _payload(sfx), db=db, current_user=owner)
    assert res["status"] == "created"

    # Full payroll spine exists: User → PrivateUser → Job → Salary.
    u = db.query(User).filter(User.email == f"solo-{sfx}@example.com").one()
    assert u.user_verified is False  # blocked from login until they claim
    emp = db.query(PrivateUser).filter(PrivateUser.user_id == u.user_id).one()
    job = db.query(Job).filter(Job.private_user_id == emp.private_user_id).one()
    assert job.job_title == "Cashier"
    sal = db.query(Salary).filter(Salary.job_id == job.job_id).one()
    assert str(sal.salary) == "22000.00"

    # The returned claim link actually works: set password → verified + enabled.
    token = res["claim_link"].split("token=")[1]
    peek = claim.validate_claim(ClaimValidateRequest(token=token), db=db)
    assert peek["email"] == u.email
    claim.complete_claim(ClaimCompleteRequest(token=token, new_password="GoodPass1"), db=db)
    db.refresh(u)
    assert u.user_verified is True
    assert verify_password("GoodPass1", u.password_hash)


def test_removing_employee_kills_claim_link(db: Session):
    # End-to-end for the gap this fix closes: onboard → remove → the emailed
    # "set your password" link must no longer work.
    import asyncio
    from api.v1.user import remove_company_user

    owner, co = _company(db)
    sfx = uuid.uuid4().hex[:6]
    res = create_single_employee(co.company_id, _payload(sfx), db=db, current_user=owner)
    token = res["claim_link"].split("token=")[1]
    u = db.query(User).filter(User.email == f"solo-{sfx}@example.com").one()

    # link works before removal
    assert claim.validate_claim(ClaimValidateRequest(token=token), db=db)["email"] == u.email

    asyncio.run(remove_company_user(co.company_id, u.user_id, db=db, company=co, current_user=owner))

    # link is dead after removal, and completing it is refused too
    with pytest.raises(HTTPException):
        claim.validate_claim(ClaimValidateRequest(token=token), db=db)
    with pytest.raises(HTTPException):
        claim.complete_claim(ClaimCompleteRequest(token=token, new_password="GoodPass1"), db=db)


def test_currency_is_derived_from_country_not_client(db: Session):
    # Server-authoritative: a client that sends currency='USD' is ignored; the
    # salary is stamped in the company's country currency (MU -> MUR).
    owner, co = _company(db)
    sfx = uuid.uuid4().hex[:6]
    create_single_employee(co.company_id, _payload(sfx, currency="USD"), db=db, current_user=owner)
    u = db.query(User).filter(User.email == f"solo-{sfx}@example.com").one()
    emp = db.query(PrivateUser).filter(PrivateUser.user_id == u.user_id).one()
    job = db.query(Job).filter(Job.private_user_id == emp.private_user_id).one()
    sal = db.query(Salary).filter(Salary.job_id == job.job_id).one()
    assert sal.currency == "MUR"  # NOT the client's 'USD'


def test_missing_salary_is_rejected_with_400(db: Session):
    owner, co = _company(db)
    sfx = uuid.uuid4().hex[:6]
    with pytest.raises(HTTPException) as ei:
        create_single_employee(co.company_id, _payload(sfx, base_salary=0), db=db, current_user=owner)
    assert ei.value.status_code == 400


def test_duplicate_email_is_rejected(db: Session):
    owner, co = _company(db)
    sfx = uuid.uuid4().hex[:6]
    create_single_employee(co.company_id, _payload(sfx), db=db, current_user=owner)
    with pytest.raises(HTTPException) as ei:
        create_single_employee(co.company_id, _payload(sfx), db=db, current_user=owner)
    assert ei.value.status_code in (400, 409)


def test_outsider_cannot_onboard(db: Session):
    owner, co = _company(db)
    sfx = uuid.uuid4().hex[:6]
    outsider = User(user_type="private", email=f"out-{sfx}@x.com", user_name=f"out-{sfx}", password_hash="x")
    db.add(outsider); db.commit()
    with pytest.raises(HTTPException) as ei:
        create_single_employee(co.company_id, _payload(sfx), db=db, current_user=outsider)
    assert ei.value.status_code == 403
