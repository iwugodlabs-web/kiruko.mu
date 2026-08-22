"""Tests for self-service account deletion — DELETE /user/me (api.v1.user.delete_my_account).

The endpoint soft-deletes + anonymizes the authenticated user, deletes personal
notifications/sessions, and BLOCKS a company owner who still has team members.
Employment/payroll records are retained (de-identified).

The endpoint is a plain `async def` whose dependencies are passed as params, so we
call it directly with a constructed user + the `db` session fixture (RLS-bypassed),
mirroring the suite's DB-level testing style.
"""
import asyncio
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import text as sql_text

from api.v1.user import delete_my_account
from core.model import Company, Notification, NotificationRecipient, PrivateUser, User, UserType


def _run(coro):
    """Run an async endpoint from a sync test WITHOUT destroying the thread's
    event loop. _run() closes + unsets the loop, which then pollutes
    later async tests (e.g. kiosk TestClient tests fail with 'no current event
    loop'). A fresh, left-open loop keeps the thread usable for subsequent tests."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


def _suffix() -> str:
    return uuid.uuid4().hex[:10]


def _mk_user(db, *, user_type, suffix) -> User:
    u = User(
        user_type=user_type,
        email=f"deltest-{suffix}@kontokaz.test",
        user_name=f"deltest-{suffix}",
        password_hash="hash",
        phone="+23050000000",
    )
    db.add(u)
    db.flush()
    return u


def _mk_company(db, owner, suffix) -> Company:
    c = Company(
        user_id=owner.user_id,
        company_name=f"DelTest Co {suffix}",
        email=f"delco-{suffix}@kontokaz.test",
        brn=f"BRN-{suffix}",
        country_code="MU",
    )
    db.add(c)
    db.flush()
    return c


def _mk_private(db, user, company_id, suffix) -> PrivateUser:
    p = PrivateUser(
        user_id=user.user_id,
        first_name="Jane",
        last_name="Doe",
        phone="+23050000001",
        company_id=company_id,
        pass_port_number=f"PP-{suffix}",
    )
    db.add(p)
    db.flush()
    return p


def _purge_users_and_company(db, user_ids, company_id):
    """Hard-remove the rows a test created. audit_logs is append-only, so its
    reject-mutation trigger is disabled around the cascade SET NULL."""
    db.rollback()
    db.execute(sql_text("ALTER TABLE audit_logs DISABLE TRIGGER USER"))
    db.query(User).filter(User.user_id.in_(user_ids)).delete(synchronize_session=False)
    if company_id is not None:
        db.query(Company).filter(Company.company_id == company_id).delete(synchronize_session=False)
    db.execute(sql_text("ALTER TABLE audit_logs ENABLE TRIGGER USER"))
    db.commit()


def test_delete_account_anonymizes_employee_and_scrubs_personal_data(db):
    suffix = _suffix()
    owner = _mk_user(db, user_type=UserType.company, suffix=f"own-{suffix}")
    company = _mk_company(db, owner, suffix)
    emp = _mk_user(db, user_type=UserType.private, suffix=f"emp-{suffix}")
    _mk_private(db, emp, company.company_id, suffix)
    _n = Notification(title="Hi", message="Body", type="test")
    db.add(_n)
    db.flush()
    db.add(NotificationRecipient(notification_id=_n.notification_id, user_id=emp.user_id))
    db.commit()
    emp_id = emp.user_id

    try:
        result = _run(delete_my_account(current_user=emp, db=db))
        assert "deleted" in str(result.get("message", "")).lower()

        db.expire_all()
        u = db.query(User).filter(User.user_id == emp_id).first()
        assert u is not None
        assert u.user_enabled is False               # login disabled
        assert u.email.startswith("deleted+")        # email released + scrubbed
        assert u.phone is None
        assert u.user_name is None
        assert u.expo_push_token is None

        p = db.query(PrivateUser).filter(PrivateUser.user_id == emp_id).first()
        assert p is not None                         # employment record retained...
        assert p.first_name == "Deleted"             # ...but de-identified
        assert p.last_name == "User"
        assert p.phone is None
        assert p.pass_port_number is None

        # Personal notification deliveries are gone.
        assert db.query(NotificationRecipient).filter(NotificationRecipient.user_id == emp_id).count() == 0

        # Idempotent: a second call must not raise.
        _run(delete_my_account(current_user=u, db=db))
    finally:
        _purge_users_and_company(db, [emp_id, owner.user_id], company.company_id)


def test_delete_account_blocked_for_owner_with_members(db):
    suffix = _suffix()
    owner = _mk_user(db, user_type=UserType.company, suffix=f"own2-{suffix}")
    company = _mk_company(db, owner, suffix)
    emp = _mk_user(db, user_type=UserType.private, suffix=f"emp2-{suffix}")
    _mk_private(db, emp, company.company_id, suffix)  # a member in the owner's company
    db.commit()

    try:
        with pytest.raises(HTTPException) as exc:
            _run(delete_my_account(current_user=owner, db=db))
        assert exc.value.status_code == 409
    finally:
        _purge_users_and_company(db, [emp.user_id, owner.user_id], company.company_id)


def test_delete_account_user_not_found(db):
    ghost = User(
        user_id=2_000_000_111,
        user_type=UserType.private,
        email="ghost@kontokaz.test",
        user_name="ghost-not-persisted",
        password_hash="x",
    )  # never added to the session
    with pytest.raises(HTTPException) as exc:
        _run(delete_my_account(current_user=ghost, db=db))
    assert exc.value.status_code == 404
