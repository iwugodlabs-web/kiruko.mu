"""Phase 2 — permission-based notification fan-out (_members_with_permission).

The three non-sensitive actionable types fan out to the owner + everyone whose
role grants the gating permission; members without it get nothing.
"""
from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy.orm import Session


def _seed_company_role(db, company_id, name, permissions, is_system=False):
    from core.model import CompanyRole
    r = CompanyRole(
        company_id=company_id, name=name, description=f"T:{name}",
        is_system=is_system, permissions=permissions,
    )
    db.add(r)
    db.commit()
    return r


def _assign(db, private_user_id, company_id, role_name):
    from core.company_user_role import CompanyUserRole
    db.add(CompanyUserRole(company_id=company_id, private_user_id=private_user_id, role=role_name))
    db.commit()


def _reset(db, company_id):
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


def _mk_member(db, company_id, suffix):
    from core.model import User, PrivateUser
    u = User(
        user_type="private", email=f"fan-{suffix}@kontokaz.test",
        user_name=f"fan-{suffix}", password_hash="x",
    )
    db.add(u)
    db.flush()
    p = PrivateUser(
        user_id=u.user_id, first_name="Fan", last_name="Test",
        company_id=company_id, pass_port_number=f"FAN_{suffix}", role="employee",
    )
    db.add(p)
    db.commit()
    return u, p


def test_members_with_permission_owner_plus_grantees(db, test_company_id, reset_company_state):
    from services.notification_service import NotificationService
    from core.model import Company
    owner_id = db.query(Company).filter(Company.company_id == test_company_id).first().user_id
    s = datetime.utcnow().strftime("%H%M%S%f")
    yes_u, yes_p = _mk_member(db, test_company_id, f"y{s}")
    no_u, no_p = _mk_member(db, test_company_id, f"n{s}")
    _seed_company_role(db, test_company_id, "OT Manager", ["view_overtime"])
    _seed_company_role(db, test_company_id, "Plain", ["view_employee"])
    _assign(db, yes_p.private_user_id, test_company_id, "OT Manager")
    _assign(db, no_p.private_user_id, test_company_id, "Plain")

    ids = set(NotificationService._members_with_permission(db, test_company_id, "view_overtime"))
    assert owner_id in ids            # owner always included
    assert yes_u.user_id in ids       # grantee included
    assert no_u.user_id not in ids    # member without the permission excluded


def test_members_with_permission_owner_only_when_no_grantees(db, test_company_id, reset_company_state):
    from services.notification_service import NotificationService
    from core.model import Company
    owner_id = db.query(Company).filter(Company.company_id == test_company_id).first().user_id
    # No roles grant view_compliance → only the owner.
    assert NotificationService._members_with_permission(db, test_company_id, "view_compliance") == [owner_id]
