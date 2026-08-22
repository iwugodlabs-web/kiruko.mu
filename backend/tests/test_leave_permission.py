"""Phase 0 — dedicated Leave permission (view_leave / approve_leave).

Covers the catalogue entry + seed, and the `approve_leave` gate the leave
approval endpoint enforces via `assert_company_permission` (Owner / Company
Admin bypass; a delegated role needs the permission explicitly).
"""
from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy.orm import Session


def test_catalogue_and_seed_include_leave():
    from api.v1.company_roles import PERMISSION_GROUPS, SYSTEM_ROLES

    assert PERMISSION_GROUPS.get("Leave") == ["view_leave", "approve_leave"]

    owner = next(r for r in SYSTEM_ROLES if r["name"] == "Owner")
    admin = next(r for r in SYSTEM_ROLES if r["name"] == "Company Admin")
    for perm in ("view_leave", "approve_leave"):
        assert perm in owner["permissions"], f"Owner missing {perm}"
        assert perm in admin["permissions"], f"Company Admin missing {perm}"

    # Bare-by-default management roles must NOT auto-receive it.
    hr = next(r for r in SYSTEM_ROLES if r["name"] == "HR Manager")
    assert hr["permissions"] == []


# --- helpers (mirror test_company_permission_guard) ---------------------------
def _seed_company_role(db: Session, company_id: int, name: str, permissions: list[str], is_system: bool = False):
    from core.model import CompanyRole
    role = CompanyRole(
        company_id=company_id, name=name, description=f"Test: {name}",
        is_system=is_system, permissions=permissions,
    )
    db.add(role)
    db.commit()
    return role


def _assign_company_role(db: Session, private_user_id: int, company_id: int, role_name: str):
    from core.company_user_role import CompanyUserRole
    db.add(CompanyUserRole(company_id=company_id, private_user_id=private_user_id, role=role_name))
    db.commit()


def _reset(db: Session, company_id: int):
    from core.model import CompanyRole
    from core.company_user_role import CompanyUserRole
    db.query(CompanyUserRole).filter(CompanyUserRole.company_id == company_id).delete()
    db.query(CompanyRole).filter(CompanyRole.company_id == company_id).delete()
    db.commit()


@pytest.fixture()
def reset_company_state(db: Session, test_company_id: int):
    _reset(db, test_company_id)
    yield
    _reset(db, test_company_id)


@pytest.fixture()
def fresh_user(db: Session, test_company_id: int):
    from core.model import PrivateUser, User
    suffix = datetime.utcnow().strftime("%H%M%S%f")
    u = User(
        user_type="private", email=f"leave-{suffix}@kontokaz.test",
        user_name=f"leave-{suffix}", password_hash="x",
    )
    db.add(u)
    db.flush()
    p = PrivateUser(
        user_id=u.user_id, first_name="Leave", last_name="Test",
        company_id=test_company_id, pass_port_number=f"LV_{suffix}", role="employee",
    )
    db.add(p)
    db.commit()
    yield db.query(User).filter(User.user_id == u.user_id).one()


def test_role_with_approve_leave_allowed(db, test_company_id, fresh_user, reset_company_state):
    from core.permission_guards import assert_company_permission
    _seed_company_role(db, test_company_id, "Leave Approver", ["approve_leave"])
    _assign_company_role(db, fresh_user.private_user.private_user_id, test_company_id, "Leave Approver")
    # Returns None (no raise) when allowed.
    assert assert_company_permission(fresh_user, test_company_id, "approve_leave", db) is None


def test_role_without_approve_leave_denied(db, test_company_id, fresh_user, reset_company_state):
    from fastapi import HTTPException
    from core.permission_guards import assert_company_permission
    _seed_company_role(db, test_company_id, "Viewer", ["view_employee"])
    _assign_company_role(db, fresh_user.private_user.private_user_id, test_company_id, "Viewer")
    with pytest.raises(HTTPException) as exc:
        assert_company_permission(fresh_user, test_company_id, "approve_leave", db)
    assert exc.value.status_code == 403


def test_seeded_company_admin_bypasses_without_explicit_perm(db, test_company_id, fresh_user, reset_company_state):
    from core.permission_guards import assert_company_permission
    # Company Admin with EMPTY perms still bypasses via the named-role rule —
    # so owner/admin can approve leave even before the backfill migration runs.
    _seed_company_role(db, test_company_id, "Company Admin", [], is_system=True)
    _assign_company_role(db, fresh_user.private_user.private_user_id, test_company_id, "Company Admin")
    assert assert_company_permission(fresh_user, test_company_id, "approve_leave", db) is None
