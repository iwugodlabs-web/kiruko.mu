"""Tests for the two-lock profile model.

Two semantically distinct gates over the self-edit path:
    * is_locked        → always freezes COMPANY_FIELDS; a *manual* lock also
                         freezes IDENTITY_FIELDS, an *auto* lock does not
    * identity_verified → IDENTITY_FIELDS (first/last name, dob, passport, gender)

Headline guarantees under test:
    1. identity_verified=True blocks self-edits to identity fields.
    2. A manual lock (employer-sealed) blocks identity fields too.
    3. An auto-lock (admin company-edit, AUTO_LOCK_REASON) leaves identity
       editable so onboarding KYC entry stays open.
    4. Admins always bypass both gates.
    5. Non-gated fields (phone) stay editable in any state.

The endpoint exercised is `PATCH /api/v1/user/{user_id}` (handler
`update_user_profile` in api/v1/user.py). Tests stub auth via FastAPI's
dependency_overrides so we can assume the role of either the employee or
an admin.
"""

from __future__ import annotations

from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session


# ---------------------------------------------------------------------------
# Fixtures helpers
# ---------------------------------------------------------------------------


def _build_locked_user(
    db: Session,
    *,
    is_locked: bool = True,
    identity_verified: bool = True,
    lock_reason: str = "test fixture lock",
) -> dict:
    """Create a User + PrivateUser + Company, set lock state, return IDs.
    Caller is responsible for cleanup. Defaults to a fully-locked profile
    (both flags on) so legacy callers exercise both gates. ``lock_reason``
    defaults to a manual reason; pass AUTO_LOCK_REASON to exercise auto-lock."""
    from datetime import datetime as _dt, timezone as _tz

    from core.model import AuditLog, Company, PrivateUser, User

    # M5b RLS: reset app.company_id to '*' (bypass) so the fixture INSERTs
    # are not blocked by a leftover tenant scope from a prior test
    # (test_rls.py uses session-wide set_config that persists in the
    # connection pool until reset).
    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    db.commit()

    suffix = datetime.utcnow().strftime("%H%M%S%f")

    company_owner = User(
        user_type="company",
        email=f"lockco-owner-{suffix}@kontokaz.test",
        user_name=f"lockco-owner-{suffix}",
        password_hash="x",
    )
    db.add(company_owner)
    db.flush()

    co = Company(
        user_id=company_owner.user_id,
        company_name=f"LockCo {suffix}",
        email=f"lockco-{suffix}@kontokaz.test",
        brn=f"LOCK_{suffix}",
        country_code="MU",
    )
    db.add(co)
    db.flush()

    emp_user = User(
        user_type="private",
        email=f"locked-emp-{suffix}@kontokaz.test",
        user_name=f"locked-emp-{suffix}",
        password_hash="x",
    )
    db.add(emp_user)
    db.flush()

    priv = PrivateUser(
        user_id=emp_user.user_id,
        first_name="Original",
        last_name="Name",
        company_id=co.company_id,
        role="employee",
        pass_port_number=f"LOCK_PASS_{suffix}",
        is_locked=is_locked,
        locked_at=_dt.now(_tz.utc) if is_locked else None,
        locked_by_user_id=company_owner.user_id if is_locked else None,
        lock_reason=lock_reason if is_locked else None,
        identity_verified=identity_verified,
        identity_verified_at=_dt.now(_tz.utc) if identity_verified else None,
        identity_verified_by_user_id=company_owner.user_id if identity_verified else None,
    )
    db.add(priv)
    db.commit()

    return {
        "owner_user_id": company_owner.user_id,
        "owner_email": company_owner.email,
        "company_id": co.company_id,
        "emp_user_id": emp_user.user_id,
        "emp_email": emp_user.email,
        "priv_id": priv.private_user_id,
        "passport": priv.pass_port_number,
    }


def _cleanup(db: Session, ctx: dict) -> None:
    db.rollback()
    # audit_logs WORM trigger workaround — DELETE FROM users cascades a
    # SET NULL update to audit_logs.actor_user_id, so the whole user-
    # affecting block runs inside the unlock context.
    from tests.conftest import audit_logs_unlocked
    with audit_logs_unlocked(db):
        db.execute(
            sql_text("DELETE FROM audit_logs WHERE target_id = :p AND target_type='private_users'"),
            {"p": str(ctx["priv_id"])},
        )
        db.execute(sql_text("DELETE FROM private_users WHERE pass_port_number=:p"), {"p": ctx["passport"]})
        db.execute(sql_text("DELETE FROM companies WHERE company_id=:c"), {"c": ctx["company_id"]})
        db.execute(sql_text("DELETE FROM users WHERE email IN (:e1, :e2)"),
                   {"e1": ctx["owner_email"], "e2": ctx["emp_email"]})
        db.commit()


def _make_client(_engine, current_user_id: int):
    """Build a TestClient on the real FastAPI app with get_current_user
    overridden to return whichever user id we want to impersonate.

    `_override_user` takes the request-scoped db via Depends(get_db) so the
    returned User stays attached for the duration of the request — the
    endpoint accesses `user.company` etc. via lazy loads.
    """
    from fastapi import Depends as _Depends
    from sqlalchemy.orm import Session, sessionmaker

    from core import config as core_config
    from core.dependencies import get_current_user
    from core.model import User
    from main import app

    SessionFactory = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

    def _override_db():
        db = SessionFactory()
        try:
            yield db
        finally:
            db.close()

    def _override_user(db: Session = _Depends(core_config.get_db)) -> User:
        return db.query(User).filter(User.user_id == current_user_id).one()

    app.dependency_overrides[core_config.get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_user
    # raise_server_exceptions=False so a downstream serialization error
    # (the endpoint's response_model=showUser validation against a minimal
    # test fixture) surfaces as a 500 instead of a propagated Python
    # exception. Our tests only care about lock-guard behavior — anything
    # that isn't a 403 from the lock means the guard let the call through.
    return TestClient(app, raise_server_exceptions=False)


def _clear_overrides() -> None:
    from main import app
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestIdentityLockBlocksIdentityFields:
    def test_verified_employee_cannot_change_first_name(self, db: Session, _engine):
        """identity_verified=True freezes IDENTITY_FIELDS regardless of is_locked."""
        ctx = _build_locked_user(db, is_locked=False, identity_verified=True)
        try:
            client = _make_client(_engine, ctx["emp_user_id"])
            try:
                resp = client.patch(
                    f"/api/v1/user/{ctx['emp_user_id']}",
                    json={"first_name": "NewName"},
                )
                assert resp.status_code == 403, f"expected 403, got {resp.status_code}: {resp.text}"
                # New copy: "identity verified by admin" replaces legacy "locked".
                assert "identity" in resp.json()["detail"].lower()
            finally:
                _clear_overrides()

            # Audit log should record the blocked attempt.
            row = db.execute(
                sql_text(
                    "SELECT meta FROM audit_logs "
                    "WHERE action='profile.edit_blocked' "
                    "AND target_type='private_users' "
                    "AND target_id=:tid "
                    "ORDER BY created_at DESC LIMIT 1"
                ),
                {"tid": str(ctx["priv_id"])},
            ).fetchone()
            assert row is not None, "expected audit row for blocked edit"
            assert "first_name" in row[0]["blocked_fields"]
        finally:
            _cleanup(db, ctx)

    def test_manual_lock_blocks_identity_for_unverified_employee(
        self, db: Session, _engine
    ):
        """A manual lock (employer-sealed) freezes identity even without KYC verify."""
        ctx = _build_locked_user(
            db, is_locked=True, identity_verified=False, lock_reason="security"
        )
        try:
            client = _make_client(_engine, ctx["emp_user_id"])
            try:
                resp = client.patch(
                    f"/api/v1/user/{ctx['emp_user_id']}",
                    json={"first_name": "Blocked"},
                )
                assert resp.status_code == 403, (
                    f"manual lock must block identity edits. "
                    f"Got {resp.status_code}: {resp.text}"
                )
                assert "identity" in resp.json()["detail"].lower()
            finally:
                _clear_overrides()
        finally:
            _cleanup(db, ctx)

    def test_auto_lock_leaves_identity_editable_for_onboarding(
        self, db: Session, _engine
    ):
        """An auto-lock (admin company-edit) must NOT freeze identity, so an
        employee can still finish their KYC data mid-onboarding."""
        from core.profile_lock import AUTO_LOCK_REASON

        ctx = _build_locked_user(
            db, is_locked=True, identity_verified=False, lock_reason=AUTO_LOCK_REASON
        )
        try:
            client = _make_client(_engine, ctx["emp_user_id"])
            try:
                resp = client.patch(
                    f"/api/v1/user/{ctx['emp_user_id']}",
                    json={"first_name": "Allowed"},
                )
                # NOT 403 from the lock guard — identity stays editable on auto-lock.
                assert resp.status_code != 403, (
                    f"auto-lock must not block identity edits. "
                    f"Got {resp.status_code}: {resp.text}"
                )
            finally:
                _clear_overrides()
        finally:
            _cleanup(db, ctx)

    def test_manual_lock_upgrades_auto_lock_to_freeze_identity(
        self, db: Session, _engine
    ):
        """Clicking 'Lock' on an already auto-locked profile upgrades it to a
        manual lock, which then freezes identity for the employee. Guards the
        common sequence: admin sets salary (auto-lock) → admin clicks Lock."""
        from core.profile_lock import AUTO_LOCK_REASON

        ctx = _build_locked_user(
            db, is_locked=True, identity_verified=False, lock_reason=AUTO_LOCK_REASON
        )
        try:
            # Admin explicitly locks the (already auto-locked) profile.
            admin = _make_client(_engine, ctx["owner_user_id"])
            try:
                lock_resp = admin.post(
                    f"/api/v1/private-users/{ctx['priv_id']}/lock",
                    json={"reason": "security"},
                )
                assert lock_resp.status_code == 200, lock_resp.text
            finally:
                _clear_overrides()

            # The employee can now no longer edit identity fields.
            emp = _make_client(_engine, ctx["emp_user_id"])
            try:
                resp = emp.patch(
                    f"/api/v1/user/{ctx['emp_user_id']}",
                    json={"first_name": "Blocked"},
                )
                assert resp.status_code == 403, (
                    f"manual lock upgrade must freeze identity. "
                    f"Got {resp.status_code}: {resp.text}"
                )
            finally:
                _clear_overrides()
        finally:
            _cleanup(db, ctx)

    def test_onboard_path_honors_locks(self, db: Session, _engine):
        """The mobile Update Profile screen saves via POST /user/onboard, not
        PATCH /user. That path must enforce the same locks: a company-locked +
        identity-verified self-edit cannot change employment (start date) or
        identity (passport) through onboard."""
        from datetime import date as _date

        from core.model import Job, PrivateUser
        from tests.conftest import audit_logs_unlocked

        ctx = _build_locked_user(
            db, is_locked=True, identity_verified=True, lock_reason="security"
        )
        # Give the employee an existing job with a known start date.
        db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
        job = Job(
            private_user_id=ctx["priv_id"],
            company_id=ctx["company_id"],
            job_title="Original Title",
            employer_name="Original Employer",
            employer_brn="ORIGBRN",
            first_date_of_employment=_date(2020, 1, 1),
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        job_id = job.job_id
        try:
            client = _make_client(_engine, ctx["emp_user_id"])
            try:
                payload = {
                    "user_data": {
                        "private_user_id": ctx["priv_id"],
                        "gender": "Female",
                        "date_of_birth": "1990-01-01",
                        "pass_port_number": "HACKED_PASS",
                    },
                    "job_data": {
                        "private_user_id": ctx["priv_id"],
                        "company_id": ctx["company_id"],
                        "job_title": "Hacked Title",
                        "employer_name": "Hacked",
                        "employer_brn": "HACKEDBRN",
                        "employer_email": None,
                        "employer_phone": None,
                        "employer_address": None,
                        "first_date_of_employment": "2099-12-31",
                    },
                    "salary_data": {
                        "monthly_hours": "195",
                        "break_in_minutes_per_day": 30,
                        "days_of_work_per_month": 22,
                        "currency": "MUR",
                        "salary": "50000",
                    },
                }
                # Response may 500 on showUser serialization of the minimal
                # fixture — what matters is that the DB rows did NOT change.
                resp = client.post("/api/v1/user/onboard", json=payload)
                assert resp.status_code != 422, (
                    f"payload must be accepted (handler must run): {resp.text}"
                )

                db.expire_all()
                fresh_job = db.query(Job).filter(Job.job_id == job_id).one()
                assert str(fresh_job.first_date_of_employment).startswith("2020-01-01"), (
                    f"company lock must keep the start date; got "
                    f"{fresh_job.first_date_of_employment}"
                )
                assert fresh_job.job_title == "Original Title", "company lock must keep job fields"

                fresh_priv = (
                    db.query(PrivateUser)
                    .filter(PrivateUser.private_user_id == ctx["priv_id"])
                    .one()
                )
                assert fresh_priv.pass_port_number == ctx["passport"], (
                    "identity lock must keep the passport"
                )
            finally:
                _clear_overrides()
        finally:
            with audit_logs_unlocked(db):
                db.execute(sql_text("DELETE FROM salaries WHERE job_id=:j"), {"j": job_id})
                db.execute(sql_text("DELETE FROM jobs WHERE job_id=:j"), {"j": job_id})
                db.commit()
            _cleanup(db, ctx)

    def test_onboard_path_applies_changes_when_unlocked(self, db: Session, _engine):
        """Control for test_onboard_path_honors_locks: an UNLOCKED profile must
        still apply employment changes via onboard — proving the lock test's
        'unchanged' result comes from the lock, not a no-op endpoint."""
        from datetime import date as _date

        from core.model import Job
        from tests.conftest import audit_logs_unlocked

        ctx = _build_locked_user(db, is_locked=False, identity_verified=False)
        db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
        job = Job(
            private_user_id=ctx["priv_id"],
            company_id=ctx["company_id"],
            job_title="Original Title",
            employer_name="Original Employer",
            employer_brn="ORIGBRN2",
            first_date_of_employment=_date(2020, 1, 1),
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        job_id = job.job_id
        try:
            client = _make_client(_engine, ctx["emp_user_id"])
            try:
                payload = {
                    "user_data": {"private_user_id": ctx["priv_id"]},
                    "job_data": {
                        "private_user_id": ctx["priv_id"],
                        "company_id": ctx["company_id"],
                        "job_title": "Original Title",
                        "employer_name": "Original Employer",
                        "employer_brn": "ORIGBRN2",
                        "employer_email": None,
                        "employer_phone": None,
                        "employer_address": None,
                        "first_date_of_employment": "2099-12-31",
                    },
                    "salary_data": {
                        "monthly_hours": "195",
                        "break_in_minutes_per_day": 30,
                        "days_of_work_per_month": 22,
                        "currency": "MUR",
                        "salary": "50000",
                    },
                }
                resp = client.post("/api/v1/user/onboard", json=payload)
                assert resp.status_code != 422, resp.text

                db.expire_all()
                fresh_job = db.query(Job).filter(Job.job_id == job_id).one()
                assert str(fresh_job.first_date_of_employment).startswith("2099-12-31"), (
                    f"unlocked onboard must apply the start date change; got "
                    f"{fresh_job.first_date_of_employment}"
                )
            finally:
                _clear_overrides()
        finally:
            with audit_logs_unlocked(db):
                db.execute(sql_text("DELETE FROM salaries WHERE job_id=:j"), {"j": job_id})
                db.execute(sql_text("DELETE FROM jobs WHERE job_id=:j"), {"j": job_id})
                db.commit()
            _cleanup(db, ctx)

    def test_locked_employee_can_still_change_phone(self, db: Session, _engine):
        """phone is in neither IDENTITY_FIELDS nor COMPANY_FIELDS, so it
        stays editable regardless of lock state."""
        ctx = _build_locked_user(db)  # both gates on
        try:
            client = _make_client(_engine, ctx["emp_user_id"])
            try:
                resp = client.patch(
                    f"/api/v1/user/{ctx['emp_user_id']}",
                    json={"phone": "+230 5xxx xxxx"},
                )
                assert resp.status_code != 403, (
                    f"phone is non-locked; lock guard should not fire. "
                    f"Got {resp.status_code}: {resp.text}"
                )
            finally:
                _clear_overrides()
        finally:
            _cleanup(db, ctx)


class TestAdminBypass:
    def test_company_admin_can_change_locked_employee_first_name(self, db: Session, _engine):
        ctx = _build_locked_user(db)
        try:
            client = _make_client(_engine, ctx["owner_user_id"])
            try:
                resp = client.patch(
                    f"/api/v1/user/{ctx['emp_user_id']}",
                    json={"first_name": "AdminEdit"},
                )
                # Owner admin bypass: should NOT 403 from the lock guard.
                assert resp.status_code != 403, (
                    f"admin should bypass the lock. Got {resp.status_code}: {resp.text}"
                )
            finally:
                _clear_overrides()
        finally:
            _cleanup(db, ctx)


class TestUnlockedProfileUnaffected:
    def test_self_edit_works_when_neither_lock_applies(self, db: Session, _engine):
        ctx = _build_locked_user(db, is_locked=False, identity_verified=False)
        try:
            client = _make_client(_engine, ctx["emp_user_id"])
            try:
                resp = client.patch(
                    f"/api/v1/user/{ctx['emp_user_id']}",
                    json={"first_name": "OK"},
                )
                assert resp.status_code != 403, (
                    f"unlocked + unverified profile should accept self-edits. Got {resp.status_code}: {resp.text}"
                )
            finally:
                _clear_overrides()
        finally:
            _cleanup(db, ctx)
