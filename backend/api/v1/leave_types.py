"""Leave types catalog API (Module 1)."""

from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from core import config
from core.dependencies import get_current_user
from core.model import Company, LeaveType, User
from schema.leave_types_schema import (
    LeaveTypeCreate,
    LeaveTypeRead,
    LeaveTypeUpdate,
    SeedFromCountryReport,
)
from services import leave_types_service


router = APIRouter(tags=["Leave Types"])


def _require_admin_for_company(actor: User, company_id: int, db: Session, permission=None) -> None:
    """Company-admin gate. When COMPANY_RBAC_ENABLED is on, enforces a company
    permission (default ``view_schedule`` — leave config is schedule-adjacent;
    owner/admin bypass inside). Flag off ⇒ admin-only as today."""
    perm = permission or "view_schedule"
    from core.permission_guards import company_rbac_enabled, assert_company_permission
    if company_rbac_enabled():
        assert_company_permission(actor, company_id, perm, db)
        return
    from core.auth_guards import require_company_admin
    require_company_admin(actor, company_id, db)


@router.get(
    "/companies/{company_id}/leave-types",
    response_model=List[LeaveTypeRead],
)
def list_leave_types(
    company_id: int,
    include_inactive: bool = Query(False),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    # Listing is broadly readable: any authenticated user from the same company.
    # Admin-only would block self-service screens that need to render leave-type pickers.
    company = db.query(Company).filter(Company.company_id == company_id).one_or_none()
    if company is None:
        raise HTTPException(status_code=404, detail=f"Company {company_id} not found")

    q = db.query(LeaveType).filter(LeaveType.company_id == company_id)
    if not include_inactive:
        q = q.filter(LeaveType.is_active.is_(True))
    return q.order_by(LeaveType.code).all()


@router.post(
    "/companies/{company_id}/leave-types",
    response_model=LeaveTypeRead,
    status_code=201,
)
def create_leave_type(
    company_id: int,
    payload: LeaveTypeCreate,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin_for_company(current_user, company_id, db)

    existing = (
        db.query(LeaveType)
        .filter(LeaveType.company_id == company_id, LeaveType.code == payload.code)
        .one_or_none()
    )
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Leave type with code '{payload.code}' already exists",
        )

    lt = LeaveType(company_id=company_id, **payload.model_dump())
    db.add(lt)
    db.commit()
    db.refresh(lt)
    return lt


@router.patch(
    "/companies/{company_id}/leave-types/{leave_type_id}",
    response_model=LeaveTypeRead,
)
def update_leave_type(
    company_id: int,
    leave_type_id: int,
    payload: LeaveTypeUpdate,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin_for_company(current_user, company_id, db)
    lt = (
        db.query(LeaveType)
        .filter(LeaveType.id == leave_type_id, LeaveType.company_id == company_id)
        .one_or_none()
    )
    if lt is None:
        raise HTTPException(status_code=404, detail=f"Leave type {leave_type_id} not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(lt, key, value)
    db.commit()
    db.refresh(lt)
    return lt


@router.post(
    "/companies/{company_id}/leave-types/seed-from-country",
    response_model=SeedFromCountryReport,
)
def seed_from_country(
    company_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Pull country statutory leave defaults into this company's catalog.

    Idempotent — re-running refreshes country-linked rows and skips
    custom company-defined types that happen to share a code.
    """
    _require_admin_for_company(current_user, company_id, db)
    report = leave_types_service.seed_defaults_for_company(db, company_id)
    db.commit()
    return report
