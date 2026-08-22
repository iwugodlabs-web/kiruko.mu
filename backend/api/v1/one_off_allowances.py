"""One-off allowance API (Module 8)."""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from core import config
from core.dependencies import get_current_user
from core.idempotency import require_idempotency_key
from core.model import (
    Company,
    EmployeeOneOffAllowance,
    PrivateUser,
    SalaryComponent,
    User,
)
from schema.one_off_schema import (
    AdditionalRemunerationCreate,
    AdHocDeductionCreate,
    OneOffAllowanceCreate,
    OneOffAllowanceRead,
)
from services import one_off_allowances_service


router = APIRouter(tags=["One-off Allowances"])


def _require_admin_for_target(actor: User, target: PrivateUser, db: Session, permission: str = "manage_allowances") -> None:
    """Authorize managing one-off allowances for `target`'s company.

    Permission-aware: when company RBAC is ON, this checks the fine-grained
    `permission` (default `manage_allowances`) via assert_company_permission —
    which owners/company admins bypass, and which a delegated role like HR
    Manager holds. When OFF, it falls back to the owner/admin-only gate (today's
    behavior). Previously it ALWAYS used the admin-only gate, so an HR role-holder
    was rejected even though the HR Manager role grants `manage_allowances` —
    which 500/403'd the employee detail page on load. Mirrors job.py /
    salary_structures.py.
    """
    if target.company_id is None:
        raise HTTPException(status_code=403, detail="Target has no company")
    from core.permission_guards import company_rbac_enabled, assert_company_permission
    if company_rbac_enabled():
        assert_company_permission(actor, target.company_id, permission, db)
        return
    from core.auth_guards import require_company_admin
    require_company_admin(actor, target.company_id, db)


def _to_read(o: EmployeeOneOffAllowance) -> OneOffAllowanceRead:
    return OneOffAllowanceRead(
        id=o.id,
        private_user_id=o.private_user_id,
        component_id=o.component_id,
        component_code=o.component.code if o.component else None,
        component_label=o.component.label if o.component else None,
        amount=o.amount,
        payable_in_year=o.payable_in_year,
        payable_in_month=o.payable_in_month,
        applied_to_payslip_id=o.applied_to_payslip_id,
        notes=o.notes,
        created_by_user_id=o.created_by_user_id,
        created_at=o.created_at,
    )


@router.post(
    "/one-off-allowances",
    response_model=OneOffAllowanceRead,
    status_code=201,
)
def create_one_off(
    payload: OneOffAllowanceCreate,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    _idempotency_key: str = Depends(require_idempotency_key),
):
    target = (
        db.query(PrivateUser)
        .filter(PrivateUser.private_user_id == payload.private_user_id)
        .one_or_none()
    )
    if target is None:
        raise HTTPException(status_code=404, detail=f"PrivateUser {payload.private_user_id} not found")
    _require_admin_for_target(current_user, target, db)
    from core.permission_guards import assert_company_permission
    assert_company_permission(
        current_user, target.company_id, "manage_allowances", db,
        endpoint="/one-off-allowances", method="POST",
    )

    # Component must belong to the same company as the employee.
    component = (
        db.query(SalaryComponent)
        .filter(SalaryComponent.id == payload.component_id)
        .one_or_none()
    )
    if component is None:
        raise HTTPException(status_code=404, detail=f"SalaryComponent {payload.component_id} not found")
    if component.company_id != target.company_id:
        raise HTTPException(
            status_code=400,
            detail="Component does not belong to the employee's company.",
        )

    o = EmployeeOneOffAllowance(
        private_user_id=payload.private_user_id,
        component_id=payload.component_id,
        amount=payload.amount,
        payable_in_year=payload.payable_in_year,
        payable_in_month=payload.payable_in_month,
        notes=payload.notes,
        created_by_user_id=current_user.user_id,
    )
    db.add(o)
    db.commit()
    db.refresh(o)
    # joinedload via re-query so component_code/label populate
    o = (
        db.query(EmployeeOneOffAllowance)
        .options(joinedload(EmployeeOneOffAllowance.component))
        .filter(EmployeeOneOffAllowance.id == o.id)
        .one()
    )
    return _to_read(o)


@router.post(
    "/private-users/{private_user_id}/additional-remuneration",
    response_model=OneOffAllowanceRead,
    status_code=201,
)
def grant_additional_remuneration(
    private_user_id: int,
    payload: AdditionalRemunerationCreate,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    _idempotency_key: str = Depends(require_idempotency_key),
):
    """#18 — grant additional remuneration for additional duty.

    Unlike the generic one-off, the caller doesn't pick a component: the server
    ensures the company's canonical "Additional duty" earning component exists
    (taxable, non-basic) and books the one-off against it. This keeps additional
    duty as one consistent, reportable component instead of free-text lines.
    It does NOT touch the employee's profile or salary structure, and it does
    not clock anything — it's a deliberate employer grant for a given month that
    flows into that month's payroll run (and the worker's estimate) as an
    earning line.
    """
    target = (
        db.query(PrivateUser)
        .filter(PrivateUser.private_user_id == private_user_id)
        .one_or_none()
    )
    if target is None:
        raise HTTPException(status_code=404, detail=f"PrivateUser {private_user_id} not found")
    _require_admin_for_target(current_user, target, db)
    from core.permission_guards import assert_company_permission
    assert_company_permission(
        current_user, target.company_id, "manage_allowances", db,
        endpoint="/private-users/{private_user_id}/additional-remuneration", method="POST",
    )

    component = one_off_allowances_service.ensure_additional_duty_component(
        db, target.company_id
    )
    o = EmployeeOneOffAllowance(
        private_user_id=private_user_id,
        component_id=component.id,
        amount=payload.amount,
        payable_in_year=payload.payable_in_year,
        payable_in_month=payload.payable_in_month,
        notes=payload.notes,
        created_by_user_id=current_user.user_id,
    )
    db.add(o)
    db.commit()
    db.refresh(o)
    o = (
        db.query(EmployeeOneOffAllowance)
        .options(joinedload(EmployeeOneOffAllowance.component))
        .filter(EmployeeOneOffAllowance.id == o.id)
        .one()
    )
    return _to_read(o)


@router.post(
    "/private-users/{private_user_id}/ad-hoc-deduction",
    response_model=OneOffAllowanceRead,
    status_code=201,
)
def grant_ad_hoc_deduction(
    private_user_id: int,
    payload: AdHocDeductionCreate,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    _idempotency_key: str = Depends(require_idempotency_key),
):
    """Dock a specific employee's pay for a one-time reason, mirroring
    grant_additional_remuneration. Unlike the generic one-off, the caller
    doesn't pick a component: the server ensures the company's canonical
    "Ad-hoc deduction" component exists and books the one-off against it, with
    the required notes explaining why. It does NOT touch the employee's
    profile or salary structure — it's a single-month deduction line that
    flows into that month's payroll run (and the worker's estimate).
    """
    target = (
        db.query(PrivateUser)
        .filter(PrivateUser.private_user_id == private_user_id)
        .one_or_none()
    )
    if target is None:
        raise HTTPException(status_code=404, detail=f"PrivateUser {private_user_id} not found")
    _require_admin_for_target(current_user, target, db)
    from core.permission_guards import assert_company_permission
    assert_company_permission(
        current_user, target.company_id, "manage_allowances", db,
        endpoint="/private-users/{private_user_id}/ad-hoc-deduction", method="POST",
    )

    component = one_off_allowances_service.ensure_ad_hoc_deduction_component(
        db, target.company_id
    )
    o = EmployeeOneOffAllowance(
        private_user_id=private_user_id,
        component_id=component.id,
        amount=payload.amount,
        payable_in_year=payload.payable_in_year,
        payable_in_month=payload.payable_in_month,
        notes=payload.notes,
        created_by_user_id=current_user.user_id,
    )
    db.add(o)
    db.commit()
    db.refresh(o)
    o = (
        db.query(EmployeeOneOffAllowance)
        .options(joinedload(EmployeeOneOffAllowance.component))
        .filter(EmployeeOneOffAllowance.id == o.id)
        .one()
    )
    return _to_read(o)


@router.get(
    "/private-users/{private_user_id}/one-off-allowances",
    response_model=List[OneOffAllowanceRead],
)
def list_one_offs(
    private_user_id: int,
    pending_only: bool = Query(False, description="If true, only un-applied rows."),
    year: Optional[int] = None,
    month: Optional[int] = None,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    target = (
        db.query(PrivateUser)
        .filter(PrivateUser.private_user_id == private_user_id)
        .one_or_none()
    )
    if target is None:
        raise HTTPException(status_code=404, detail=f"PrivateUser {private_user_id} not found")
    # Employees can read their own list; admins can read anyone in their company
    if current_user.user_id != target.user_id:
        _require_admin_for_target(current_user, target, db)

    q = (
        db.query(EmployeeOneOffAllowance)
        .options(joinedload(EmployeeOneOffAllowance.component))
        .filter(EmployeeOneOffAllowance.private_user_id == private_user_id)
    )
    if pending_only:
        q = q.filter(EmployeeOneOffAllowance.applied_to_payslip_id.is_(None))
    if year is not None:
        q = q.filter(EmployeeOneOffAllowance.payable_in_year == year)
    if month is not None:
        q = q.filter(EmployeeOneOffAllowance.payable_in_month == month)

    return [_to_read(o) for o in q.order_by(EmployeeOneOffAllowance.id).all()]


@router.delete("/one-off-allowances/{one_off_id}", status_code=204)
def delete_one_off(
    one_off_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    o = (
        db.query(EmployeeOneOffAllowance)
        .filter(EmployeeOneOffAllowance.id == one_off_id)
        .one_or_none()
    )
    if o is None:
        raise HTTPException(status_code=404, detail=f"One-off {one_off_id} not found")
    if o.applied_to_payslip_id is not None:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot delete a one-off already applied to payslip {o.applied_to_payslip_id}. "
                "Cancel the payroll run first."
            ),
        )
    target = db.query(PrivateUser).filter(PrivateUser.private_user_id == o.private_user_id).one()
    _require_admin_for_target(current_user, target, db)
    from core.permission_guards import assert_company_permission
    assert_company_permission(
        current_user, target.company_id, "manage_allowances", db,
        endpoint=f"/one-off-allowances/{one_off_id}", method="DELETE",
    )
    db.delete(o)
    db.commit()
