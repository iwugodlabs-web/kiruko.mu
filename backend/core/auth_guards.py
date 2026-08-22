"""Shared authorization helpers for company-scoped routes.

The new payroll / salary / leave / bonus-liability / one-off / profile-lock
routers each grew their own narrow `_require_admin_for_company` helper
that only accepted platform admins and the company OWNER (companies.user_id
== users.user_id). That excludes company admins added via the multi-role
CompanyUserRole table — the very people the company actually delegates
payroll to.

This module consolidates the check into one place so the gate behaves
consistently and so a future tweak (e.g. adding a 'payroll_clerk' role
that can run payroll but not change rules) lands in one file.

`require_company_admin(actor, company_id, db)`:
  * platform admin (PlatformRole)         → allowed
  * company owner (companies.user_id)     → allowed
  * CompanyUserRole role IN admin_roles() → allowed (admin/owner/manager)
  * else                                  → HTTPException(403)

  404 wins over 403 if the company doesn't exist, since "company not
  found" is more actionable than "you don't have access".
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from core.model import Company, User
from core.roles import is_company_admin_for


def require_company_admin(actor: User, company_id: int, db: Session) -> None:
    """Raise HTTPException unless the actor can administer `company_id`.

    Allowed actors:
      - platform admins (any PlatformRole assignment)
      - company owners (companies.user_id matches the actor)
      - PrivateUser holders of an admin / owner / manager role for the
        company in CompanyUserRole

    The check delegates to `core.roles.is_company_admin_for` for the
    company-side check, plus an explicit platform-admin short-circuit
    so the helper stays usable from non-company-scoped contexts too.
    """
    from db_models.crud.role import get_roles_for_user

    if get_roles_for_user(actor.user_id, db):
        return  # platform admin

    if is_company_admin_for(actor, company_id, db):
        return  # owner OR multi-role company admin/manager

    # If the company doesn't exist, prefer a 404 — "you can't access X"
    # when X doesn't exist is misleading.
    company = db.query(Company).filter(Company.company_id == company_id).one_or_none()
    if company is None:
        raise HTTPException(status_code=404, detail=f"Company {company_id} not found")

    raise HTTPException(
        status_code=403,
        detail="Only platform admin, company owner, or company admin can access this resource.",
    )


def require_platform_admin(actor: User, db: Session) -> None:
    """Raise 403 unless the actor is a Kiruko platform admin (holds any
    PlatformRole). Stricter than ``require_company_admin`` — company owners and
    company admins do NOT pass.

    Used to lock kiosk DEVICE lifecycle (register / list / rotate / deactivate)
    to the platform team: companies don't provision their own kiosk hardware.
    Per-employee kiosk PINs remain company-admin operations.
    """
    from db_models.crud.role import get_roles_for_user

    if get_roles_for_user(actor.user_id, db):
        return  # platform admin
    raise HTTPException(
        status_code=403,
        detail="Only Kiruko platform admins can manage kiosk devices.",
    )
