"""Account claim — token set-password + verify for imported employees."""
import uuid

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

import pytest
from fastapi import HTTPException

from core.model import User, PrivateUser, Company
from core.security import verify_password
from api.v1 import account_claim as claim
from api.v1.account_claim import ClaimValidateRequest, ClaimCompleteRequest, ClaimResendRequest


def _company_with_unverified_employee(db: Session):
    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    db.commit()
    sfx = uuid.uuid4().hex[:8]
    owner = User(user_type="company", email=f"own-{sfx}@x.com", user_name=f"own-{sfx}", password_hash="x")
    db.add(owner); db.flush()
    co = Company(user_id=owner.user_id, company_name=f"C {sfx}", email=f"co-{sfx}@x.com", brn=f"B_{sfx}", country_code="MU")
    db.add(co); db.flush()
    emp = User(
        user_type="private", email=f"emp-{sfx}@x.com", user_name=f"emp-{sfx}",
        password_hash="x", user_verified=False, user_enabled=True,
    )
    db.add(emp); db.flush()
    db.add(PrivateUser(user_id=emp.user_id, first_name="New", last_name="Hire",
                       company_id=co.company_id, role="employee"))
    db.commit()
    return owner, co, emp


def _unverified_user(db: Session) -> User:
    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    db.commit()
    sfx = uuid.uuid4().hex[:8]
    u = User(
        user_type="private", email=f"claim-{sfx}@example.com", user_name=f"claim-{sfx}",
        password_hash="x", user_verified=False, user_enabled=True,
    )
    db.add(u); db.flush()
    db.add(PrivateUser(user_id=u.user_id, first_name="Cla", last_name="Im", role="employee"))
    db.commit()
    return u


def test_claim_sets_password_and_verifies(db: Session):
    u = _unverified_user(db)
    token = claim.generate_claim_token(db, u)
    db.commit()
    assert u.user_verified is False

    peek = claim.validate_claim(ClaimValidateRequest(token=token), db=db)
    assert peek["valid"] and peek["email"] == u.email and peek["first_name"] == "Cla"

    claim.complete_claim(ClaimCompleteRequest(token=token, new_password="GoodPass1"), db=db)
    db.refresh(u)
    assert u.user_verified is True
    assert verify_password("GoodPass1", u.password_hash)


def test_claim_token_is_single_use(db: Session):
    u = _unverified_user(db)
    token = claim.generate_claim_token(db, u)
    db.commit()
    claim.complete_claim(ClaimCompleteRequest(token=token, new_password="GoodPass1"), db=db)
    import pytest
    from fastapi import HTTPException
    with pytest.raises(HTTPException):
        claim.validate_claim(ClaimValidateRequest(token=token), db=db)


def test_bad_token_rejected(db: Session):
    _unverified_user(db)
    import pytest
    from fastapi import HTTPException
    with pytest.raises(HTTPException):
        claim.validate_claim(ClaimValidateRequest(token="not-a-real-token"), db=db)


def test_resend_reissues_working_token(db: Session):
    owner, co, emp = _company_with_unverified_employee(db)
    res = claim.resend_claim(ClaimResendRequest(user_id=emp.user_id), current_user=owner, db=db)
    assert res["status"] == "success"
    assert res["token"] and "/claim?token=" in res["claim_link"]
    # the freshly issued token actually works
    peek = claim.validate_claim(ClaimValidateRequest(token=res["token"]), db=db)
    assert peek["email"] == emp.email


def test_resend_invalidates_prior_token(db: Session):
    owner, co, emp = _company_with_unverified_employee(db)
    old = claim.generate_claim_token(db, emp); db.commit()
    claim.resend_claim(ClaimResendRequest(user_id=emp.user_id), current_user=owner, db=db)
    # the old link no longer validates
    with pytest.raises(HTTPException):
        claim.validate_claim(ClaimValidateRequest(token=old), db=db)


def test_resend_works_for_verified_employee(db: Session):
    # Admin-approved (verified) but passwordless employees still need a link —
    # resend must work for them (acts as a password reset for genuine claimers).
    owner, co, emp = _company_with_unverified_employee(db)
    emp.user_verified = True; db.commit()
    res = claim.resend_claim(ClaimResendRequest(user_id=emp.user_id), current_user=owner, db=db)
    assert res["status"] == "success" and res["token"]


def test_invalidate_claim_tokens_kills_outstanding_link(db: Session):
    # Removing an employee must burn their claim link so a "set your password"
    # email (valid up to 14 days) can't activate the account after removal.
    u = _unverified_user(db)
    token = claim.generate_claim_token(db, u); db.commit()
    n = claim.invalidate_claim_tokens(db, u.email); db.commit()
    assert n == 1
    with pytest.raises(HTTPException):
        claim.validate_claim(ClaimValidateRequest(token=token), db=db)


def test_complete_refuses_disabled_account(db: Session):
    # Defense-in-depth: even if a stale token survived, a disabled (removed)
    # account can't be (re)activated via claim.
    u = _unverified_user(db)
    token = claim.generate_claim_token(db, u); db.commit()
    u.user_enabled = False; db.commit()
    with pytest.raises(HTTPException) as ei:
        claim.complete_claim(ClaimCompleteRequest(token=token, new_password="GoodPass1"), db=db)
    assert ei.value.status_code == 400
    db.refresh(u)
    assert u.user_verified is False  # not activated


def test_resend_rejected_for_outsider(db: Session):
    owner, co, emp = _company_with_unverified_employee(db)
    sfx = uuid.uuid4().hex[:8]
    outsider = User(user_type="private", email=f"out-{sfx}@x.com", user_name=f"out-{sfx}", password_hash="x")
    db.add(outsider); db.commit()
    with pytest.raises(HTTPException) as ei:
        claim.resend_claim(ClaimResendRequest(user_id=emp.user_id), current_user=outsider, db=db)
    assert ei.value.status_code == 403
