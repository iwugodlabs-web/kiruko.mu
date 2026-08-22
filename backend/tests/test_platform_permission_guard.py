"""Tests for the platform-side permission guard
(`core.permission_guards.require_platform_permission`) and the cross-tier
bypass behavior of `require_company_permission` under the
PLATFORM_PERM_ENFORCEMENT flag.
"""

from __future__ import annotations

import os
from datetime import datetime
from types import SimpleNamespace

import pytest
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from core.permission_guards import (
    _cross_tier_bypass_allowed,
    _platform_permissions_for_user,
    assert_company_permission,
    require_platform_permission,
)


def _request(path: str = "/admin/roles", method: str = "GET"):
    return SimpleNamespace(
        path_params={},
        query_params={},
        url=SimpleNamespace(path=path),
        method=method,
        headers={},
    )


@pytest.fixture()
def fresh_platform_user(db: Session):
    """A fresh User row, no platform role attached."""
    from core.model import User
    suffix = datetime.utcnow().strftime("%H%M%S%f")
    # user_type='company' covers Kiruko staff with platform-role
    # assignments (matches the convention in existing fixtures).
    u = User(
        user_type="company",
        email=f"plat-{suffix}@kontokaz.test",
        user_name=f"plat-{suffix}",
        password_hash="x",
    )
    db.add(u)
    db.commit()
    u = db.query(User).filter(User.user_id == u.user_id).one()
    yield u
    # No cleanup — audit_logs append-only blocks user delete.


def _attach_role(db: Session, user_id: int, role_name: str, permissions: list[str]):
    """Create or update the named platform role with given permissions,
    then attach it to the user."""
    from core.platform_role import PlatformRole, UserPlatformRole
    role = db.query(PlatformRole).filter(PlatformRole.name == role_name).one_or_none()
    if role is None:
        role = PlatformRole(name=role_name, description="test", system=False, permissions=permissions)
        db.add(role)
        db.flush()
    else:
        role.permissions = permissions
    db.add(UserPlatformRole(user_id=user_id, role_id=role.role_id))
    db.commit()
    return role


def _detach_all_roles(db: Session, user_id: int):
    db.execute(sql_text("DELETE FROM user_platform_roles WHERE user_id = :u"), {"u": user_id})
    db.commit()


@pytest.fixture(autouse=True)
def _reset_flag():
    """Snapshot + restore PLATFORM_PERM_ENFORCEMENT so tests don't bleed."""
    prior = os.environ.get("PLATFORM_PERM_ENFORCEMENT")
    yield
    if prior is None:
        os.environ.pop("PLATFORM_PERM_ENFORCEMENT", None)
    else:
        os.environ["PLATFORM_PERM_ENFORCEMENT"] = prior


class TestPlatformPermissionUnion:
    def test_user_with_multiple_roles_unions_permissions(
        self, db, fresh_platform_user,
    ):
        _attach_role(db, fresh_platform_user.user_id, "support_test_a", ["view_companies"])
        _attach_role(db, fresh_platform_user.user_id, "support_test_b", ["view_audit_log"])
        try:
            perms = _platform_permissions_for_user(fresh_platform_user, db)
            assert "view_companies" in perms
            assert "view_audit_log" in perms
        finally:
            _detach_all_roles(db, fresh_platform_user.user_id)


class TestRequirePlatformPermission:
    def test_legacy_platform_admin_bypasses(self, db, fresh_platform_user):
        # User has the literal 'platform_admin' role with NO permissions.
        # Named bypass should still allow.
        _attach_role(db, fresh_platform_user.user_id, "platform_admin", [])
        try:
            guard = require_platform_permission("view_audit_log")
            result = guard(request=_request(), current_user=fresh_platform_user, db=db)
            assert result is fresh_platform_user
        finally:
            _detach_all_roles(db, fresh_platform_user.user_id)

    def test_role_with_permission_allowed(self, db, fresh_platform_user):
        _attach_role(db, fresh_platform_user.user_id, "test_support_role", ["view_audit_log"])
        try:
            guard = require_platform_permission("view_audit_log")
            result = guard(request=_request(), current_user=fresh_platform_user, db=db)
            assert result is fresh_platform_user
        finally:
            _detach_all_roles(db, fresh_platform_user.user_id)

    def test_role_without_permission_denied(self, db, fresh_platform_user):
        from fastapi import HTTPException
        _attach_role(db, fresh_platform_user.user_id, "test_support_role", ["view_companies"])
        try:
            guard = require_platform_permission("manage_payroll_rules")
            with pytest.raises(HTTPException) as exc:
                guard(request=_request(), current_user=fresh_platform_user, db=db)
            assert exc.value.status_code == 403
        finally:
            _detach_all_roles(db, fresh_platform_user.user_id)

    def test_no_role_denied(self, db, fresh_platform_user):
        from fastapi import HTTPException
        guard = require_platform_permission("manage_companies")
        with pytest.raises(HTTPException) as exc:
            guard(request=_request(), current_user=fresh_platform_user, db=db)
        assert exc.value.status_code == 403


class TestCrossTierBypass:
    def test_flag_off_any_platform_admin_bypasses(self, db, fresh_platform_user):
        """Phase 1 default: any platform_admin role assignment grants
        cross-tier write authority on company endpoints."""
        os.environ["PLATFORM_PERM_ENFORCEMENT"] = "false"
        _attach_role(db, fresh_platform_user.user_id, "platform_admin", [])
        try:
            assert _cross_tier_bypass_allowed(fresh_platform_user, db) is True
        finally:
            _detach_all_roles(db, fresh_platform_user.user_id)

    def test_flag_on_requires_act_on_behalf_permission(
        self, db, fresh_platform_user, test_company_id,
    ):
        """Phase 2 cutover: even platform_admin must hold the specific
        'act_on_behalf_of_company' permission to pass cross-tier writes."""
        from fastapi import HTTPException
        os.environ["PLATFORM_PERM_ENFORCEMENT"] = "true"

        # Attach a role that does NOT have act_on_behalf_of_company.
        _attach_role(db, fresh_platform_user.user_id, "support_no_write", ["read_any_company_data"])
        try:
            assert _cross_tier_bypass_allowed(fresh_platform_user, db) is False
            # And the company guard should refuse.
            with pytest.raises(HTTPException) as exc:
                assert_company_permission(
                    fresh_platform_user, test_company_id, "manage_payroll", db,
                    endpoint="/payroll/runs", method="POST",
                )
            assert exc.value.status_code == 403
        finally:
            _detach_all_roles(db, fresh_platform_user.user_id)

    def test_flag_on_with_act_on_behalf_allowed(
        self, db, fresh_platform_user, test_company_id,
    ):
        """Phase 2 cutover: a user with act_on_behalf_of_company DOES bypass
        company-side guards."""
        os.environ["PLATFORM_PERM_ENFORCEMENT"] = "true"
        _attach_role(
            db, fresh_platform_user.user_id, "ops_with_write",
            ["act_on_behalf_of_company"],
        )
        try:
            assert _cross_tier_bypass_allowed(fresh_platform_user, db) is True
            # Should NOT raise — cross-tier bypass kicks in.
            assert_company_permission(
                fresh_platform_user, test_company_id, "manage_payroll", db,
                endpoint="/payroll/runs", method="POST",
            )
        finally:
            _detach_all_roles(db, fresh_platform_user.user_id)


class TestPlatformPermissionsCatalogue:
    def test_catalogue_includes_load_bearing_perms(self):
        from core.platform_permissions import all_permissions
        perms = all_permissions()
        assert "act_on_behalf_of_company" in perms
        assert "read_any_company_data" in perms
        assert "manage_companies" in perms

    def test_seed_defaults_are_well_formed(self):
        from core.platform_permissions import SYSTEM_ROLE_DEFAULTS, all_permissions
        catalogue = all_permissions()
        for spec in SYSTEM_ROLE_DEFAULTS:
            unknown = set(spec["permissions"]) - catalogue
            assert not unknown, f"Role {spec['name']!r} references unknown permissions {unknown}"

    def test_platform_admin_seed_has_all_permissions(self):
        from core.platform_permissions import SYSTEM_ROLE_DEFAULTS, all_permissions
        admin = next(r for r in SYSTEM_ROLE_DEFAULTS if r["name"] == "platform_admin")
        assert set(admin["permissions"]) == all_permissions()

    def test_engineer_seed_lacks_cross_tier_write(self):
        """Engineering role should not silently get write authority over
        customer companies — that's an opt-in for ops/founder."""
        from core.platform_permissions import SYSTEM_ROLE_DEFAULTS
        eng = next(r for r in SYSTEM_ROLE_DEFAULTS if r["name"] == "engineer")
        assert "act_on_behalf_of_company" not in eng["permissions"]
        assert "delete_company" not in eng["permissions"]
