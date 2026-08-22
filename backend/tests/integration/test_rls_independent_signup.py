"""Regression: an independent (no-employer) signup must not be blocked by RLS.

Bug (prod, 2026-07-20): a Tanzania company signed up, then an employee tried to
self-register with a Mauritius number. The independent-signup branch inserts
`private_users` with `company_id = NULL`, but the TZ company's tenant had bled
onto the pooled connection, so `app.company_id` was a concrete id at insert time.
The `tenant_isolation_private_users` policy failed the NULL row and Postgres raised:

    new row violates row-level security policy for table "private_users"

FIX (root cause): core.tenant_context force-resets `app.company_id` to '' for any
request that binds no tenant (the NO_TENANT sentinel), so a stale value can't be
inherited from a pooled connection. At '' the policy is permissive and the
independent INSERT (+ its RETURNING) succeeds.

We deliberately did NOT relax the RLS policy to allow `company_id IS NULL`: because
INSERT...RETURNING re-checks the row against the SELECT policy, allowing NULL there
would also make every independent user's PII readable by any employer-scoped
session. test_scoped_tenant_cannot_read_independent_users locks that in.
"""
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from core.model import User


@pytest.fixture
def _superuser_required(db: Session):
    if not db.execute(text(
            "SELECT rolsuper FROM pg_roles WHERE rolname = current_user")).scalar():
        pytest.skip("needs a superuser connection to SET ROLE kiruko_app")


def test_independent_insert_succeeds_at_empty_tenant(db: Session, _superuser_required):
    """The state Fix 2 produces for an anonymous signup (app.company_id='') lets an
    independent private_user (company_id=NULL) be inserted WITH RETURNING."""
    sfx = uuid.uuid4().hex[:8]
    u = User(user_type="private", email=f"indep-{sfx}@x.com",
             user_name=f"indep-{sfx}", password_hash="x")
    db.add(u)
    db.flush()

    conn = db.connection()
    conn.execute(text("SAVEPOINT s"))
    try:
        conn.execute(text("SET LOCAL ROLE kiruko_app"))
        conn.execute(text("SET LOCAL app.company_id = ''"))  # NO_TENANT → '' (Fix 2)
        pid = conn.execute(
            text(
                "INSERT INTO private_users (user_id, first_name, last_name, phone, company_id) "
                "VALUES (:uid, 'Mary', 'Pgt', '+23057060508', NULL) "
                "RETURNING private_user_id"
            ),
            {"uid": u.user_id},
        ).scalar()
        assert pid is not None, "independent signup must succeed at empty tenant"
    finally:
        conn.execute(text("ROLLBACK TO SAVEPOINT s"))


def test_independent_insert_blocked_under_leaked_tenant(db: Session, _superuser_required):
    """Documents WHY Fix 2 matters: under a leaked concrete tenant the policy still
    (correctly) rejects a NULL-company row. Fix 2 prevents this state from arising."""
    from psycopg2.errors import InsufficientPrivilege
    from sqlalchemy.exc import ProgrammingError

    sfx = uuid.uuid4().hex[:8]
    u = User(user_type="private", email=f"leak-{sfx}@x.com",
             user_name=f"leak-{sfx}", password_hash="x")
    db.add(u)
    db.flush()

    conn = db.connection()
    conn.execute(text("SAVEPOINT s"))
    try:
        conn.execute(text("SET LOCAL ROLE kiruko_app"))
        conn.execute(text("SET LOCAL app.company_id = '999999'"))
        with pytest.raises(ProgrammingError) as exc:
            conn.execute(
                text(
                    "INSERT INTO private_users (user_id, first_name, last_name, phone, company_id) "
                    "VALUES (:uid, 'Mary', 'Pgt', '+230', NULL)"
                ),
                {"uid": u.user_id},
            )
        assert isinstance(exc.value.orig, InsufficientPrivilege)
    finally:
        conn.execute(text("ROLLBACK TO SAVEPOINT s"))


def test_scoped_tenant_cannot_read_independent_users(db: Session, _superuser_required):
    """Isolation guard: an employer-scoped session must NOT be able to read
    independent (company_id IS NULL) users. If someone re-adds `OR company_id IS
    NULL` to the policy's USING clause, this fails."""
    sfx = uuid.uuid4().hex[:8]
    u = User(user_type="private", email=f"seen-{sfx}@x.com",
             user_name=f"seen-{sfx}", password_hash="x")
    db.add(u)
    db.flush()
    # Create an independent user (as superuser, RLS bypassed) to look for later.
    indep_id = db.execute(
        text(
            "INSERT INTO private_users (user_id, first_name, last_name, phone, company_id) "
            "VALUES (:uid, 'Ind', 'User', '+230', NULL) RETURNING private_user_id"
        ),
        {"uid": u.user_id},
    ).scalar()
    db.flush()

    conn = db.connection()
    conn.execute(text("SAVEPOINT s"))
    try:
        conn.execute(text("SET LOCAL ROLE kiruko_app"))
        conn.execute(text("SET LOCAL app.company_id = '1'"))
        visible = conn.execute(
            text("SELECT count(*) FROM private_users WHERE private_user_id = :pid"),
            {"pid": indep_id},
        ).scalar()
        assert visible == 0, "employer-scoped session must not see independent users"
    finally:
        conn.execute(text("ROLLBACK TO SAVEPOINT s"))


def test_no_tenant_request_resets_guc():
    """Fix 2: a request that binds no tenant force-resets the GUC to '' (NO_TENANT),
    rather than leaving a stale value in place (None = leave alone)."""
    from core.tenant_context import (
        push_request_tenant, pop_request_tenant,
        _resolve_pg_setting_value, _resolve_pg_private_user_value, _current_tenant,
    )

    # Simulate a stale tenant leaked into this context from a prior request.
    leaked = _current_tenant.set(999)
    try:
        handles = push_request_tenant(company_id=None, private_user_id=None, bypass=False)
        try:
            assert _resolve_pg_setting_value() == "", \
                "no-tenant request must force app.company_id='', not inherit '999'"
            assert _resolve_pg_private_user_value() == "", \
                "no-tenant request must force app.private_user_id=''"
        finally:
            pop_request_tenant(handles)
    finally:
        try:
            _current_tenant.reset(leaked)
        except ValueError:
            _current_tenant.set(None)


def test_bound_tenant_still_emits_company_id():
    """A request WITH a tenant still resolves to that company id (no regression)."""
    from core.tenant_context import (
        push_request_tenant, pop_request_tenant, _resolve_pg_setting_value,
    )
    handles = push_request_tenant(company_id=7, private_user_id=None, bypass=False)
    try:
        assert _resolve_pg_setting_value() == "7"
    finally:
        pop_request_tenant(handles)


def test_raw_session_leaves_guc_alone():
    """A raw context (no push_request_tenant call, e.g. a test/maintenance Session)
    still resolves to None so the bridge leaves a session-wide GUC untouched."""
    from core.tenant_context import _resolve_pg_setting_value, _current_tenant
    # default state: nothing bound
    assert _current_tenant.get() is None
    assert _resolve_pg_setting_value() is None
