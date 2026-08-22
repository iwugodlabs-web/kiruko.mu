"""Tests for the fine-grained company-side permission guard
(`core.permission_guards.require_company_permission`).

These tests exercise the resolution order directly via the dependency
function, bypassing the FastAPI request cycle. We construct a Request mock
just sufficient for the guard's needs.
"""

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace

import pytest
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from core.permission_guards import require_company_permission


def _request(path: str = "/company/1/payroll/runs", method: str = "POST", company_id: int | None = 1):
    """Minimal request stand-in. The guard only reads
    path_params, query_params, url.path, method."""
    return SimpleNamespace(
        path_params={"company_id": company_id} if company_id else {},
        query_params={},
        url=SimpleNamespace(path=path),
        method=method,
    )


def _seed_company_role(db: Session, company_id: int, name: str, permissions: list[str], is_system: bool = False):
    from core.model import CompanyRole
    role = CompanyRole(
        company_id=company_id,
        name=name,
        description=f"Test role: {name}",
        is_system=is_system,
        permissions=permissions,
    )
    db.add(role)
    db.commit()
    return role


def _assign_company_role(db: Session, private_user_id: int, company_id: int, role_name: str):
    from core.company_user_role import CompanyUserRole
    db.add(CompanyUserRole(
        company_id=company_id, private_user_id=private_user_id, role=role_name,
    ))
    db.commit()


def _reset_company_roles(db: Session, company_id: int):
    """Wipe per-test churn on company_roles + company_user_roles for this company."""
    from core.model import CompanyRole
    from core.company_user_role import CompanyUserRole
    db.query(CompanyUserRole).filter(CompanyUserRole.company_id == company_id).delete()
    db.query(CompanyRole).filter(CompanyRole.company_id == company_id).delete()
    db.commit()


@pytest.fixture()
def reset_company_state(db: Session, test_company_id: int):
    """Reset company role state before AND after each test."""
    _reset_company_roles(db, test_company_id)
    yield
    _reset_company_roles(db, test_company_id)


@pytest.fixture()
def fresh_user(db: Session, test_company_id: int):
    """Create a fresh PrivateUser inside the test company for permission testing."""
    from core.model import PrivateUser, User
    suffix = datetime.utcnow().strftime("%H%M%S%f")
    u = User(
        user_type="private",
        email=f"perm-test-{suffix}@kontokaz.test",
        user_name=f"perm-test-{suffix}",
        password_hash="x",
    )
    db.add(u)
    db.flush()
    p = PrivateUser(
        user_id=u.user_id,
        first_name="Perm",
        last_name="Test",
        company_id=test_company_id,
        pass_port_number=f"PERM_{suffix}",
        role="employee",
    )
    db.add(p)
    db.commit()

    # Eager-load the .private_user relationship
    u = db.query(User).filter(User.user_id == u.user_id).one()
    yield u
    # No cleanup of users/private_users: audit_logs is append-only and
    # forbids both UPDATE and DELETE, so the FK SET NULL fails the
    # trigger. The test DB is throwaway; leaking rows is fine.


def _call_guard(guard_dep, request, user, db) -> bool:
    """Invoke the FastAPI dependency directly. Returns True on allow,
    raises HTTPException on deny."""
    return guard_dep(request=request, current_user=user, db=db) is not None


class TestCompanyPermissionGuard:
    def test_custom_role_with_permission_allowed(
        self, db, test_company_id, fresh_user, reset_company_state,
    ):
        _seed_company_role(db, test_company_id, "PayrollClerk", ["manage_payroll"])
        _assign_company_role(db, fresh_user.private_user.private_user_id, test_company_id, "PayrollClerk")

        guard = require_company_permission("manage_payroll")
        assert _call_guard(guard, _request(company_id=test_company_id), fresh_user, db) is True

    def test_custom_role_without_permission_denied(
        self, db, test_company_id, fresh_user, reset_company_state,
    ):
        from fastapi import HTTPException
        _seed_company_role(db, test_company_id, "ViewerOnly", ["view_employee"])
        _assign_company_role(db, fresh_user.private_user.private_user_id, test_company_id, "ViewerOnly")

        guard = require_company_permission("edit_salary")
        with pytest.raises(HTTPException) as exc:
            _call_guard(guard, _request(company_id=test_company_id), fresh_user, db)
        assert exc.value.status_code == 403
        assert "edit_salary" in str(exc.value.detail)

    def test_has_company_permission_reflects_granted_perms(
        self, db, test_company_id, fresh_user, reset_company_state,
    ):
        # Drives the migrated employee endpoints (verify/approve→onboard_employee,
        # edit/enable→edit_employee). A delegated role functions iff granted.
        from core.permission_guards import has_company_permission
        _seed_company_role(db, test_company_id, "HRMgr", ["onboard_employee", "edit_employee"])
        _assign_company_role(db, fresh_user.private_user.private_user_id, test_company_id, "HRMgr")
        assert has_company_permission(fresh_user, test_company_id, "onboard_employee", db) is True
        assert has_company_permission(fresh_user, test_company_id, "edit_employee", db) is True
        assert has_company_permission(fresh_user, test_company_id, "manage_payroll", db) is False

    def test_has_company_permission_false_without_grant(
        self, db, test_company_id, fresh_user, reset_company_state,
    ):
        from core.permission_guards import has_company_permission
        _seed_company_role(db, test_company_id, "ViewerB", ["view_employee"])
        _assign_company_role(db, fresh_user.private_user.private_user_id, test_company_id, "ViewerB")
        assert has_company_permission(fresh_user, test_company_id, "onboard_employee", db) is False
        assert has_company_permission(fresh_user, test_company_id, "edit_employee", db) is False

    def test_is_company_admin_for_recognizes_seeded_company_admin(
        self, db, test_company_id, fresh_user, reset_company_state,
    ):
        # The seeded "Company Admin" role must count as admin on permission-less
        # admin endpoints (stats/profile/compliance) — the legacy enum missed it.
        from core.roles import is_company_admin_for
        _seed_company_role(db, test_company_id, "Company Admin", ["view_employee"], is_system=True)
        _assign_company_role(db, fresh_user.private_user.private_user_id, test_company_id, "Company Admin")
        assert is_company_admin_for(fresh_user, test_company_id, db) is True

    def test_is_company_admin_for_rejects_delegated_role(
        self, db, test_company_id, fresh_user, reset_company_state,
    ):
        from core.roles import is_company_admin_for
        _seed_company_role(db, test_company_id, "HR Manager", ["onboard_employee"])
        _assign_company_role(db, fresh_user.private_user.private_user_id, test_company_id, "HR Manager")
        assert is_company_admin_for(fresh_user, test_company_id, db) is False

    def test_seeded_owner_role_bypasses_jsonb(
        self, db, test_company_id, fresh_user, reset_company_state,
    ):
        # Owner role exists with NO 'edit_salary' permission, but the named
        # bypass means it should still allow.
        _seed_company_role(db, test_company_id, "Owner", [], is_system=True)
        _assign_company_role(db, fresh_user.private_user.private_user_id, test_company_id, "Owner")

        guard = require_company_permission("edit_salary")
        assert _call_guard(guard, _request(company_id=test_company_id), fresh_user, db) is True

    def test_company_admin_role_bypasses_jsonb(
        self, db, test_company_id, fresh_user, reset_company_state,
    ):
        _seed_company_role(db, test_company_id, "Company Admin", [], is_system=True)
        _assign_company_role(db, fresh_user.private_user.private_user_id, test_company_id, "Company Admin")

        guard = require_company_permission("manage_payroll")
        assert _call_guard(guard, _request(company_id=test_company_id), fresh_user, db) is True

    def test_multi_role_union_allowed(
        self, db, test_company_id, fresh_user, reset_company_state,
    ):
        _seed_company_role(db, test_company_id, "ViewerOnly", ["view_employee"])
        _seed_company_role(db, test_company_id, "SeniorClerk", ["edit_salary"])
        _assign_company_role(db, fresh_user.private_user.private_user_id, test_company_id, "ViewerOnly")
        _assign_company_role(db, fresh_user.private_user.private_user_id, test_company_id, "SeniorClerk")

        guard = require_company_permission("edit_salary")
        assert _call_guard(guard, _request(company_id=test_company_id), fresh_user, db) is True

    def test_no_role_denied(
        self, db, test_company_id, fresh_user, reset_company_state,
    ):
        from fastapi import HTTPException
        guard = require_company_permission("edit_salary")
        with pytest.raises(HTTPException) as exc:
            _call_guard(guard, _request(company_id=test_company_id), fresh_user, db)
        assert exc.value.status_code == 403

    def test_missing_company_id_400(
        self, db, fresh_user, reset_company_state,
    ):
        from fastapi import HTTPException
        guard = require_company_permission("manage_payroll")
        with pytest.raises(HTTPException) as exc:
            _call_guard(guard, _request(company_id=None), fresh_user, db)
        assert exc.value.status_code == 400

    def test_nonexistent_company_404(
        self, db, fresh_user, reset_company_state,
    ):
        from fastapi import HTTPException
        guard = require_company_permission("manage_payroll")
        with pytest.raises(HTTPException) as exc:
            _call_guard(guard, _request(company_id=999999), fresh_user, db)
        # Either 404 (preferred) or 403 — but it must NOT 200 a bogus company.
        assert exc.value.status_code in (403, 404)

    def test_denial_writes_audit_row(
        self, db, test_company_id, fresh_user, reset_company_state,
    ):
        from fastapi import HTTPException
        from core.model import AuditLog
        _seed_company_role(db, test_company_id, "ViewerOnly", ["view_employee"])
        _assign_company_role(db, fresh_user.private_user.private_user_id, test_company_id, "ViewerOnly")

        before = db.query(AuditLog).filter(
            AuditLog.action == "permission.denied",
            AuditLog.actor_user_id == fresh_user.user_id,
        ).count()

        guard = require_company_permission("edit_salary")
        with pytest.raises(HTTPException):
            _call_guard(guard, _request(company_id=test_company_id), fresh_user, db)

        after = db.query(AuditLog).filter(
            AuditLog.action == "permission.denied",
            AuditLog.actor_user_id == fresh_user.user_id,
        ).count()
        assert after == before + 1

    def test_cross_tier_legacy_platform_admin_bypasses(
        self, db, test_company_id, fresh_user, reset_company_state,
    ):
        """Phase 1 default: any platform_admin role assignment bypasses."""
        # Give fresh_user a platform_admin role assignment.
        from core.platform_role import PlatformRole, UserPlatformRole
        role = db.query(PlatformRole).filter(PlatformRole.name == "platform_admin").one_or_none()
        if role is None:
            role = PlatformRole(name="platform_admin", description="root", system=True)
            db.add(role)
            db.flush()
        db.add(UserPlatformRole(user_id=fresh_user.user_id, role_id=role.role_id))
        db.commit()
        try:
            guard = require_company_permission("manage_payroll")
            assert _call_guard(guard, _request(company_id=test_company_id), fresh_user, db) is True
        finally:
            db.execute(sql_text(
                "DELETE FROM user_platform_roles WHERE user_id = :u"
            ), {"u": fresh_user.user_id})
            db.commit()


class TestCompanyRbacGatedFlag:
    """P4 proof tests for the flag-aware gate (COMPANY-RBAC-PLAN.md):
    name-match fix, deny-by-default, flag-off no-op, and grant-opens."""

    def test_name_match_slug_vs_display_resolves(
        self, db, test_company_id, fresh_user, reset_company_state, monkeypatch,
    ):
        # CompanyUserRole stores the slug ("hr_manager"); the catalogue uses the
        # display name ("HR Manager"). Before the P1 fix this resolved to ∅.
        monkeypatch.setenv("COMPANY_RBAC_ENABLED", "true")
        _seed_company_role(db, test_company_id, "HR Manager", ["view_attendance"])
        _assign_company_role(db, fresh_user.private_user.private_user_id, test_company_id, "hr_manager")
        from core.permission_guards import company_access_for_user
        perms, _roles = company_access_for_user(fresh_user, db)
        assert "view_attendance" in perms

    def test_gated_flag_off_is_a_no_op(
        self, db, test_company_id, fresh_user, reset_company_state, monkeypatch,
    ):
        # Flag OFF → any company member passes WITHOUT any permission (today's behavior).
        monkeypatch.delenv("COMPANY_RBAC_ENABLED", raising=False)
        from core.permission_guards import require_company_permission_gated
        guard = require_company_permission_gated("view_attendance")
        assert _call_guard(guard, _request(company_id=test_company_id), fresh_user, db) is True

    def test_gated_flag_on_empty_role_denied(
        self, db, test_company_id, fresh_user, reset_company_state, monkeypatch,
    ):
        # Flag ON + a management role with NO permission → 403 (deny-by-default).
        from fastapi import HTTPException
        monkeypatch.setenv("COMPANY_RBAC_ENABLED", "true")
        _seed_company_role(db, test_company_id, "HR Manager", [])
        _assign_company_role(db, fresh_user.private_user.private_user_id, test_company_id, "hr_manager")
        from core.permission_guards import require_company_permission_gated
        guard = require_company_permission_gated("view_attendance")
        with pytest.raises(HTTPException) as exc:
            _call_guard(guard, _request(company_id=test_company_id), fresh_user, db)
        assert exc.value.status_code == 403

    def test_gated_flag_on_granted_allowed(
        self, db, test_company_id, fresh_user, reset_company_state, monkeypatch,
    ):
        # Flag ON + the permission granted → allowed (grant opens exactly its route).
        monkeypatch.setenv("COMPANY_RBAC_ENABLED", "true")
        _seed_company_role(db, test_company_id, "HR Manager", ["view_attendance"])
        _assign_company_role(db, fresh_user.private_user.private_user_id, test_company_id, "hr_manager")
        from core.permission_guards import require_company_permission_gated
        guard = require_company_permission_gated("view_attendance")
        assert _call_guard(guard, _request(company_id=test_company_id), fresh_user, db) is True

    def test_gated_flag_on_other_permission_denied(
        self, db, test_company_id, fresh_user, reset_company_state, monkeypatch,
    ):
        # Granting view_attendance must NOT open a different route (no mis-mapping).
        from fastapi import HTTPException
        monkeypatch.setenv("COMPANY_RBAC_ENABLED", "true")
        _seed_company_role(db, test_company_id, "HR Manager", ["view_attendance"])
        _assign_company_role(db, fresh_user.private_user.private_user_id, test_company_id, "hr_manager")
        from core.permission_guards import require_company_permission_gated
        guard = require_company_permission_gated("view_salary")
        with pytest.raises(HTTPException) as exc:
            _call_guard(guard, _request(company_id=test_company_id), fresh_user, db)
        assert exc.value.status_code == 403


def test_no_raw_admin_only_gates_in_api():
    """Rock-solid guardrail against regression: a company endpoint must gate on a
    PERMISSION (assert_company_permission / has_company_permission), never a raw
    `if not is_company_admin_for(...)` primary gate. The ONLY allowed raw gates
    are the flag-OFF fallback inside the three flag-aware helpers, which use
    assert_company_permission when COMPANY_RBAC_ENABLED is on. If this test fails,
    migrate the new endpoint to a permission instead of admin-only."""
    import os
    import re

    FLAG_AWARE_HELPERS = {"announcements.py", "company_roles.py", "department.py"}
    base = os.path.join(os.path.dirname(__file__), "..", "api", "v1")
    offenders = []
    for fn in sorted(os.listdir(base)):
        if not fn.endswith(".py") or fn in FLAG_AWARE_HELPERS:
            continue
        text = open(os.path.join(base, fn)).read()
        if re.search(r"if not is_company_admin_for\(", text):
            offenders.append(fn)
    assert not offenders, (
        f"Raw admin-only gate (`if not is_company_admin_for(...)`) found in {offenders}. "
        "Gate the endpoint on a company permission via assert_company_permission "
        "instead, so any role granted that permission can perform the action."
    )
