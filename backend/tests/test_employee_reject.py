"""Atomic employee reject — a single PATCH /user/{id} {rejected} clears
verification AND detaches the company, so the web needs no second /verify call."""
import asyncio
import uuid

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

import pytest
from fastapi import HTTPException

from core.model import User, PrivateUser, Company, CompanyRole, Job
from core.company_user_role import CompanyUserRole
from api.v1.user import update_user_profile
from db_models.crud.user import get_users_by_company


def _run(coro):
    return asyncio.run(coro)


def _operator(db, company_id, perms, slug="hr"):
    """A delegated role-holder in the company with `perms`."""
    sfx = uuid.uuid4().hex[:8]
    u = User(user_type="private", email=f"op-{sfx}@x.com", user_name=f"op-{sfx}", password_hash="x")
    db.add(u); db.flush()
    pu = PrivateUser(user_id=u.user_id, first_name="Op", last_name="R", company_id=company_id, role="employee")
    db.add(pu); db.flush()
    db.add(CompanyRole(company_id=company_id, name=slug.upper(), description="t", is_system=False, permissions=perms))
    db.add(CompanyUserRole(company_id=company_id, private_user_id=pu.private_user_id, role=slug))
    db.commit()
    return db.query(User).filter(User.user_id == u.user_id).one()


def _setup(db: Session):
    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    db.commit()
    sfx = uuid.uuid4().hex[:8]
    owner = User(user_type="company", email=f"ro-{sfx}@x.com", user_name=f"ro-{sfx}", password_hash="x")
    db.add(owner); db.flush()
    co = Company(user_id=owner.user_id, company_name=f"R {sfx}", email=f"rc-{sfx}@x.com", brn=f"R_{sfx}", country_code="MU")
    db.add(co); db.flush()
    emp = User(
        user_type="private", email=f"re-{sfx}@x.com", user_name=f"re-{sfx}",
        password_hash="x", user_verified=True, user_enabled=True,
    )
    db.add(emp); db.flush()
    pu = PrivateUser(user_id=emp.user_id, first_name="Rej", last_name="Ect",
                     company_id=co.company_id, role="employee")
    db.add(pu); db.flush()
    # An imported employee also has a Job linking them to the company — this is
    # why detaching only PrivateUser.company_id wasn't enough (Job.company_id
    # still matched the employee-list query).
    db.add(Job(private_user_id=pu.private_user_id, company_id=co.company_id, work_days=[]))
    db.commit()
    owner = db.query(User).filter(User.user_id == owner.user_id).one()
    emp = db.query(User).filter(User.user_id == emp.user_id).one()
    return owner, co, emp


def test_reject_is_atomic(db: Session):
    owner, co, emp = _setup(db)
    assert emp.user_verified is True
    assert emp.private_user.company_id == co.company_id

    # One call: reject.
    _run(update_user_profile(
        user_id=emp.user_id,
        payload={"company_onboarding_status": "rejected"},
        current_user=owner, db=db,
    ))

    db.refresh(emp)
    db.refresh(emp.private_user)
    # Verification cleared AND company detached — in a single transaction.
    assert emp.user_verified is False
    assert emp.private_user.company_id is None
    # …and they no longer appear in the company's employee list, even though
    # their Job still points at the company (this is the bug behind "rejected
    # still appears in the list").
    listed_ids = {u.user_id for u in get_users_by_company(co.company_id, db)}
    assert emp.user_id not in listed_ids


def test_reject_by_onboarder_role(db: Session):
    # An HR Manager with onboard_employee can reject (same perm as approve).
    owner, co, emp = _setup(db)
    hr = _operator(db, co.company_id, ["onboard_employee"])
    _run(update_user_profile(
        user_id=emp.user_id,
        payload={"company_onboarding_status": "rejected"},
        current_user=hr, db=db,
    ))
    db.refresh(emp); db.refresh(emp.private_user)
    assert emp.user_verified is False
    assert emp.private_user.company_id is None


def test_reject_denied_without_onboard_permission(db: Session):
    # A role lacking onboard_employee (e.g. view-only) cannot reject — fail-closed.
    owner, co, emp = _setup(db)
    viewer = _operator(db, co.company_id, ["view_employee"], slug="viewer")
    with pytest.raises(HTTPException) as ei:
        _run(update_user_profile(
            user_id=emp.user_id,
            payload={"company_onboarding_status": "rejected"},
            current_user=viewer, db=db,
        ))
    assert ei.value.status_code == 403
