"""Admin API for the salary configuration redesign (Module 5).

Endpoints:

  Components catalog:
    GET    /companies/{cid}/salary-components
    POST   /companies/{cid}/salary-components
    PATCH  /companies/{cid}/salary-components/{id}

  Structures (templates):
    GET    /companies/{cid}/salary-structures
    POST   /companies/{cid}/salary-structures           (with lines)
    GET    /companies/{cid}/salary-structures/{id}
    POST   /companies/{cid}/salary-structures/{id}/lines

  Per-employee assignments:
    GET    /private-users/{pid}/salary-assignments
    GET    /private-users/{pid}/salary-assignments/active?as_of=YYYY-MM-DD
    POST   /private-users/{pid}/salary-assignments     (closes prior active)

  Preview:
    GET    /private-users/{pid}/salary/preview?as_of=YYYY-MM-DD

The new-assignment POST follows the same supersede pattern used in the
country payroll rules engine: closing the prior active row + inserting the
new one in a single transaction, with `effective_from` strictly after the
prior assignment's effective_from.
"""

from datetime import date
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, desc, or_
from sqlalchemy.orm import Session, joinedload

from core import config
from core.dependencies import get_current_user
from core.model import (
    Company,
    Department,
    EmployeeSalaryAssignment,
    EmployeeSalaryOverride,
    PrivateUser,
    SalaryComponent,
    SalaryStructure,
    SalaryStructureLine,
    SectorGrade,
    User,
)
from schema.salary_structure_schema import (
    EmployeeSalaryAssignmentCreate,
    EmployeeSalaryAssignmentRead,
    EmployeeSalaryOverrideRead,
    ResolvedSalary,
    SalaryComponentCreate,
    SalaryComponentRead,
    SalaryStructureCreate,
    SalaryStructureLineCreate,
    SalaryStructureLinePatch,
    SalaryStructureLineRead,
    SalaryStructurePatch,
    SalaryStructureRead,
    SalaryStructureUsage,
)
from services import salary_resolver


router = APIRouter(tags=["Salary Structures"])


# ---------------------------------------------------------------------------
# Authorization helpers
# ---------------------------------------------------------------------------


def _require_admin_for_company(actor: User, company_id: int, db: Session, permission: Optional[str] = None) -> None:
    """Company-admin gate. When COMPANY_RBAC_ENABLED is ON, enforces a company
    permission instead (default ``view_salary`` — the floor for any salary-
    structure surface; owner/admin bypass inside). Flag OFF ⇒ admin-only as today.
    Write routes that need more (manage_salary_structures / edit_salary) layer
    their own assert_company_permission on top."""
    perm = permission or "view_salary"
    from core.permission_guards import company_rbac_enabled, assert_company_permission
    if company_rbac_enabled():
        assert_company_permission(actor, company_id, perm, db)
        return
    from core.auth_guards import require_company_admin
    require_company_admin(actor, company_id, db)


def _resolve_target_employee(db: Session, private_user_id: int) -> PrivateUser:
    target = (
        db.query(PrivateUser)
        .filter(PrivateUser.private_user_id == private_user_id)
        .one_or_none()
    )
    if target is None:
        raise HTTPException(status_code=404, detail=f"PrivateUser {private_user_id} not found")
    return target


# ---------------------------------------------------------------------------
# Component metadata helpers
# ---------------------------------------------------------------------------


def _line_to_read(line: SalaryStructureLine) -> SalaryStructureLineRead:
    return SalaryStructureLineRead(
        id=line.id,
        structure_id=line.structure_id,
        component_id=line.component_id,
        amount=line.amount,
        formula_expression=line.formula_expression,
        order_index=line.order_index,
        component_code=line.component.code if line.component else None,
    )


def _structure_to_read(s: SalaryStructure) -> SalaryStructureRead:
    return SalaryStructureRead(
        id=s.id,
        company_id=s.company_id,
        name=s.name,
        description=s.description,
        is_default=s.is_default,
        created_at=s.created_at,
        lines=[_line_to_read(l) for l in s.lines],
    )


def _assignment_to_read(a: EmployeeSalaryAssignment) -> EmployeeSalaryAssignmentRead:
    return EmployeeSalaryAssignmentRead(
        id=a.id,
        private_user_id=a.private_user_id,
        structure_id=a.structure_id,
        currency=a.currency,
        effective_from=a.effective_from,
        effective_to=a.effective_to,
        notes=a.notes,
        created_by_user_id=a.created_by_user_id,
        created_at=a.created_at,
        overrides=[
            EmployeeSalaryOverrideRead(
                id=o.id,
                assignment_id=o.assignment_id,
                component_id=o.component_id,
                amount=o.amount,
                formula_expression=o.formula_expression,
                notes=o.notes,
            )
            for o in a.overrides
        ],
    )


# ---------------------------------------------------------------------------
# Salary components
# ---------------------------------------------------------------------------


@router.get(
    "/companies/{company_id}/salary-components",
    response_model=List[SalaryComponentRead],
)
def list_components(
    company_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin_for_company(current_user, company_id, db, permission="view_salary")
    return (
        db.query(SalaryComponent)
        .filter(SalaryComponent.company_id == company_id)
        .order_by(SalaryComponent.code)
        .all()
    )


@router.post(
    "/companies/{company_id}/salary-components",
    response_model=SalaryComponentRead,
    status_code=201,
)
def create_component(
    company_id: int,
    payload: SalaryComponentCreate,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin_for_company(current_user, company_id, db, permission="manage_salary_structures")
    if payload.kind not in ("earning", "deduction"):
        raise HTTPException(status_code=400, detail="kind must be 'earning' or 'deduction'")

    existing = (
        db.query(SalaryComponent)
        .filter(
            SalaryComponent.company_id == company_id,
            SalaryComponent.code == payload.code,
        )
        .one_or_none()
    )
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Component with code '{payload.code}' already exists",
        )

    if payload.is_basic:
        # Partial unique index also enforces this at the DB level; check up front
        # for a friendlier error.
        prior_basic = (
            db.query(SalaryComponent)
            .filter(SalaryComponent.company_id == company_id, SalaryComponent.is_basic.is_(True))
            .one_or_none()
        )
        if prior_basic is not None:
            raise HTTPException(
                status_code=409,
                detail=f"Company already has a basic component (code={prior_basic.code}). Mark it non-basic first.",
            )

    comp = SalaryComponent(company_id=company_id, **payload.model_dump())
    db.add(comp)
    db.commit()
    db.refresh(comp)
    return comp


class SalaryComponentPatch(BaseModel):
    label: Optional[str] = None
    category: Optional[str] = None
    is_taxable: Optional[bool] = None
    is_recurring: Optional[bool] = None
    is_one_off: Optional[bool] = None
    prorate_on_partial_month: Optional[bool] = None
    frequency: Optional[str] = None
    value_type: Optional[str] = None


@router.patch(
    "/companies/{company_id}/salary-components/{component_id}",
    response_model=SalaryComponentRead,
)
def patch_component(
    company_id: int,
    component_id: int,
    payload: SalaryComponentPatch,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin_for_company(current_user, company_id, db, permission="manage_salary_structures")
    comp = (
        db.query(SalaryComponent)
        .filter(SalaryComponent.id == component_id, SalaryComponent.company_id == company_id)
        .one_or_none()
    )
    if comp is None:
        raise HTTPException(status_code=404, detail=f"Component {component_id} not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(comp, key, value)
    db.commit()
    db.refresh(comp)
    return comp


# ---------------------------------------------------------------------------
# Salary structures
# ---------------------------------------------------------------------------


def _validate_structure_lines(
    db: Session,
    company_id: int,
    lines: List[SalaryStructureLineCreate],
    *,
    existing_structure_id: int | None = None,
) -> None:
    """Validate component ownership + formula safety + DAG resolvability.

    Catches at save time:
      * unknown component_ids
      * components from another company
      * formulas with disallowed constructs (`__`, attribute access, etc.)
      * formulas that reference unknown component codes
      * formulas that form cycles
    """
    if not lines:
        return

    comp_ids = [l.component_id for l in lines]
    # Reject the same component appearing twice in one structure up front —
    # otherwise both rows insert and collide on the DB constraint
    # uq_structure_line_unique (structure_id, component_id), surfacing as a 500.
    seen: set[int] = set()
    dupes = sorted({cid for cid in comp_ids if cid in seen or seen.add(cid)})
    if dupes:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Component(s) {dupes} appear more than once. A component can "
                "be in a structure only once — combine the lines into one. "
                "If these are statutory deductions (CSG, NSF, PAYE), remove "
                "them entirely: Kiruko calculates those automatically on every "
                "payslip, so they should not be added as structure lines."
            ),
        )
    found = (
        db.query(SalaryComponent)
        .filter(SalaryComponent.id.in_(comp_ids))
        .all()
    )
    if len(found) != len(set(comp_ids)):
        raise HTTPException(
            status_code=400,
            detail="One or more component_ids do not exist",
        )
    foreign = [c.id for c in found if c.company_id != company_id]
    if foreign:
        raise HTTPException(
            status_code=400,
            detail=f"Components {foreign} belong to a different company",
        )

    # Formula-side validation: parse + DAG check using formula_evaluator.
    # External vars formulas may reference (must mirror what salary_resolver
    # injects at evaluation time):
    EXTERNAL_VARS = {"period_days"}

    components_by_id = {c.id: c for c in found}
    items: List[tuple[str, "Decimal | None", "str | None"]] = []
    for line in lines:
        comp = components_by_id[line.component_id]
        if line.amount is not None:
            items.append((comp.code, line.amount, None))
        elif line.formula_expression:
            items.append((comp.code, None, line.formula_expression))
        # Lines with neither are valid (e.g. placeholder); skipped here.

    # When adding lines to an existing structure, include the existing lines
    # as already-known codes so the new line's formula can reference them.
    if existing_structure_id is not None:
        existing_lines = (
            db.query(SalaryStructureLine)
            .options(joinedload(SalaryStructureLine.component))
            .filter(SalaryStructureLine.structure_id == existing_structure_id)
            .all()
        )
        existing_codes_in_payload = {code for code, _, _ in items}
        for el in existing_lines:
            if el.component.code in existing_codes_in_payload:
                continue  # payload supersedes existing
            if el.amount is not None:
                items.append((el.component.code, el.amount, None))
            elif el.formula_expression:
                items.append((el.component.code, None, el.formula_expression))

    if not any(formula for _, _, formula in items):
        return  # No formulas — nothing further to validate.

    from services import formula_evaluator  # noqa: PLC0415  — local import to avoid pulling simpleeval at module load
    from decimal import Decimal as _Decimal

    # Use sentinel zero values for the external context just so refs resolve.
    fake_context = {var: _Decimal("0") for var in EXTERNAL_VARS}

    try:
        formula_evaluator.evaluate_dag(items, context=fake_context)
    except formula_evaluator.UnsafeFormulaError as e:
        raise HTTPException(status_code=400, detail=f"Unsafe formula: {e}")
    except formula_evaluator.CycleDetectedError as e:
        raise HTTPException(status_code=400, detail=f"Formula cycle: {e}")
    except formula_evaluator.UnknownReferenceError as e:
        raise HTTPException(status_code=400, detail=f"Unknown reference: {e}")
    except formula_evaluator.FormulaError as e:
        raise HTTPException(status_code=400, detail=f"Formula error: {e}")


def _validate_scoping_belongs_to_company(
    db: Session,
    company_id: int,
    payload: SalaryStructureCreate,
) -> None:
    """The dept/grade/role scoping FKs (M2) must point at entities owned by
    the same company. Prevents tenant leakage via FK assignment."""
    if payload.default_for_department_id is not None:
        dept = (
            db.query(Department)
            .filter(Department.department_id == payload.default_for_department_id)
            .one_or_none()
        )
        if dept is None:
            raise HTTPException(
                status_code=400,
                detail=f"Department {payload.default_for_department_id} does not exist",
            )
        if dept.company_id != company_id:
            raise HTTPException(
                status_code=400,
                detail=f"Department {payload.default_for_department_id} belongs to a different company",
            )

    if payload.default_for_sector_grade_id is not None:
        grade = (
            db.query(SectorGrade)
            .filter(SectorGrade.id == payload.default_for_sector_grade_id)
            .one_or_none()
        )
        if grade is None:
            raise HTTPException(
                status_code=400,
                detail=f"SectorGrade {payload.default_for_sector_grade_id} does not exist",
            )
        # SectorGrade is reference data (sector → grade), not company-owned.
        # No tenant check needed — anyone can reference any grade.


@router.get(
    "/companies/{company_id}/salary-structures",
    response_model=List[SalaryStructureRead],
)
def list_structures(
    company_id: int,
    include_archived: bool = Query(
        False,
        description="When true, returns soft-deleted structures alongside live ones.",
    ),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin_for_company(current_user, company_id, db, permission="view_salary")
    q = (
        db.query(SalaryStructure)
        .options(joinedload(SalaryStructure.lines).joinedload(SalaryStructureLine.component))
        .filter(SalaryStructure.company_id == company_id)
    )
    if not include_archived:
        q = q.filter(SalaryStructure.archived_at.is_(None))
    structures = q.order_by(SalaryStructure.name).all()
    return [_structure_to_read(s) for s in structures]


@router.get(
    "/companies/{company_id}/salary-structures/suggest",
    response_model=Optional[SalaryStructureRead],
)
def suggest_structure(
    company_id: int,
    private_user_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Auto-suggest the best-matching SalaryStructure for an employee (M2).

    Uses the 9-priority match table in services/salary_resolver.suggest_structure_for.
    Returns the best match or null. Caller (typically the onboarding UI) decides
    whether to create an assignment using the suggestion or override.
    """
    _require_admin_for_company(current_user, company_id, db, permission="view_salary")
    target = _resolve_target_employee(db, private_user_id)
    if target.company_id != company_id:
        raise HTTPException(
            status_code=400,
            detail=f"Employee {private_user_id} does not belong to company {company_id}",
        )
    from services import salary_resolver

    s = salary_resolver.suggest_structure_for(db, target)
    if s is None:
        return None
    # Re-fetch with lines + components eager-loaded so the response is complete.
    s = (
        db.query(SalaryStructure)
        .options(joinedload(SalaryStructure.lines).joinedload(SalaryStructureLine.component))
        .filter(SalaryStructure.id == s.id)
        .one()
    )
    return _structure_to_read(s)


@router.get(
    "/companies/{company_id}/salary-structures/{structure_id}",
    response_model=SalaryStructureRead,
)
def get_structure(
    company_id: int,
    structure_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin_for_company(current_user, company_id, db, permission="view_salary")
    s = (
        db.query(SalaryStructure)
        .options(joinedload(SalaryStructure.lines).joinedload(SalaryStructureLine.component))
        .filter(SalaryStructure.id == structure_id, SalaryStructure.company_id == company_id)
        .one_or_none()
    )
    if s is None:
        raise HTTPException(status_code=404, detail=f"Structure {structure_id} not found")
    return _structure_to_read(s)


@router.post(
    "/companies/{company_id}/salary-structures",
    response_model=SalaryStructureRead,
    status_code=201,
)
def create_structure(
    company_id: int,
    payload: SalaryStructureCreate,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin_for_company(current_user, company_id, db, permission="manage_salary_structures")
    _validate_structure_lines(db, company_id, payload.lines)
    _validate_scoping_belongs_to_company(db, company_id, payload)

    if payload.is_default:
        prior_default = (
            db.query(SalaryStructure)
            .filter(SalaryStructure.company_id == company_id, SalaryStructure.is_default.is_(True))
            .one_or_none()
        )
        if prior_default is not None:
            raise HTTPException(
                status_code=409,
                detail=f"Company already has a default structure (id={prior_default.id}). Unset it first.",
            )

    s = SalaryStructure(
        company_id=company_id,
        name=payload.name,
        description=payload.description,
        is_default=payload.is_default,
        default_for_department_id=payload.default_for_department_id,
        default_for_role=payload.default_for_role,
        default_for_sector_grade_id=payload.default_for_sector_grade_id,
    )
    db.add(s)
    db.flush()

    for line in payload.lines:
        db.add(
            SalaryStructureLine(
                structure_id=s.id,
                component_id=line.component_id,
                amount=line.amount,
                formula_expression=line.formula_expression,
                order_index=line.order_index,
            )
        )
    db.commit()
    db.refresh(s)
    return _structure_to_read(s)


@router.patch(
    "/companies/{company_id}/salary-structures/{structure_id}",
    response_model=SalaryStructureRead,
)
def patch_structure(
    company_id: int,
    structure_id: int,
    payload: SalaryStructurePatch,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a structure's metadata (name, default flag, scoping).

    Lines are edited via the dedicated line endpoints. Existing
    assignments resolve from their snapshot — only future assignments see
    the changes.
    """
    _require_admin_for_company(current_user, company_id, db, permission="manage_salary_structures")

    s = (
        db.query(SalaryStructure)
        .filter(SalaryStructure.id == structure_id, SalaryStructure.company_id == company_id)
        .one_or_none()
    )
    if s is None:
        raise HTTPException(status_code=404, detail=f"Structure {structure_id} not found")
    if s.archived_at is not None:
        raise HTTPException(
            status_code=409,
            detail="Cannot edit an archived structure. Restore it first.",
        )

    update = payload.model_dump(exclude_unset=True)

    # is_default → at most one default per company. Clear the prior default
    # if the caller is switching it on for this one.
    if update.get("is_default") is True and not s.is_default:
        prior = (
            db.query(SalaryStructure)
            .filter(
                SalaryStructure.company_id == company_id,
                SalaryStructure.is_default.is_(True),
                SalaryStructure.id != structure_id,
            )
            .one_or_none()
        )
        if prior is not None:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Company already has a default structure (id={prior.id}). "
                    "Unset it first."
                ),
            )

    # Validate that any new scoping refs belong to this company.
    if (
        "default_for_department_id" in update
        or "default_for_role" in update
        or "default_for_sector_grade_id" in update
    ):
        # Build a stand-in object that satisfies _validate_scoping_belongs_to_company.
        class _Probe:
            pass
        probe = _Probe()
        probe.default_for_department_id = update.get(
            "default_for_department_id", s.default_for_department_id
        )
        probe.default_for_role = update.get("default_for_role", s.default_for_role)
        probe.default_for_sector_grade_id = update.get(
            "default_for_sector_grade_id", s.default_for_sector_grade_id
        )
        _validate_scoping_belongs_to_company(db, company_id, probe)

    for key, value in update.items():
        setattr(s, key, value)

    db.commit()
    db.refresh(s)
    s = (
        db.query(SalaryStructure)
        .options(joinedload(SalaryStructure.lines).joinedload(SalaryStructureLine.component))
        .filter(SalaryStructure.id == s.id)
        .one()
    )
    return _structure_to_read(s)


@router.get(
    "/companies/{company_id}/salary-structures/{structure_id}/usage",
    response_model=SalaryStructureUsage,
)
def get_structure_usage(
    company_id: int,
    structure_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Count how many employees use this structure.

    The web UI calls this before destructive edits (line DELETE / amount
    PATCH / structure archive) so the admin can see the blast radius.
    Existing assignments resolve from a snapshot, so the count is a UX
    signal — it does NOT block edits.
    """
    _require_admin_for_company(current_user, company_id, db, permission="view_salary")

    s = (
        db.query(SalaryStructure)
        .filter(SalaryStructure.id == structure_id, SalaryStructure.company_id == company_id)
        .one_or_none()
    )
    if s is None:
        raise HTTPException(status_code=404, detail=f"Structure {structure_id} not found")

    base = (
        db.query(EmployeeSalaryAssignment)
        .filter(EmployeeSalaryAssignment.structure_id == structure_id)
    )
    total = base.count()
    active = base.filter(EmployeeSalaryAssignment.effective_to.is_(None)).count()

    sample = (
        db.query(PrivateUser.first_name, PrivateUser.last_name)
        .join(
            EmployeeSalaryAssignment,
            EmployeeSalaryAssignment.private_user_id == PrivateUser.private_user_id,
        )
        .filter(
            EmployeeSalaryAssignment.structure_id == structure_id,
            EmployeeSalaryAssignment.effective_to.is_(None),
        )
        .order_by(PrivateUser.last_name, PrivateUser.first_name)
        .limit(5)
        .all()
    )
    sample_names = [f"{fn} {ln}".strip() for fn, ln in sample]

    return SalaryStructureUsage(
        structure_id=structure_id,
        active_assignment_count=active,
        total_assignment_count=total,
        sample_employee_names=sample_names,
    )


@router.delete(
    "/companies/{company_id}/salary-structures/{structure_id}",
    status_code=204,
)
def archive_structure(
    company_id: int,
    structure_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Soft-delete a structure.

    Sets ``archived_at`` and clears all ``default_for_*`` + ``is_default``
    flags so auto-suggest doesn't resurrect it. Existing assignments keep
    resolving via their snapshot. Idempotent — already-archived structures
    return 204 without re-stamping.
    """
    from datetime import datetime, timezone

    _require_admin_for_company(current_user, company_id, db, permission="manage_salary_structures")

    s = (
        db.query(SalaryStructure)
        .filter(SalaryStructure.id == structure_id, SalaryStructure.company_id == company_id)
        .one_or_none()
    )
    if s is None:
        raise HTTPException(status_code=404, detail=f"Structure {structure_id} not found")
    if s.archived_at is not None:
        return None

    s.archived_at = datetime.now(timezone.utc)
    s.is_default = False
    s.default_for_department_id = None
    s.default_for_role = None
    s.default_for_sector_grade_id = None
    db.commit()
    return None


@router.post(
    "/companies/{company_id}/salary-structures/{structure_id}/restore",
    response_model=SalaryStructureRead,
)
def restore_structure(
    company_id: int,
    structure_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Reverse a soft-delete. The structure becomes visible in default
    listings again, but its prior default scoping flags are not
    auto-restored — the admin re-sets them if desired."""
    _require_admin_for_company(current_user, company_id, db, permission="manage_salary_structures")

    s = (
        db.query(SalaryStructure)
        .filter(SalaryStructure.id == structure_id, SalaryStructure.company_id == company_id)
        .one_or_none()
    )
    if s is None:
        raise HTTPException(status_code=404, detail=f"Structure {structure_id} not found")
    if s.archived_at is None:
        # Idempotent: already live.
        s = (
            db.query(SalaryStructure)
            .options(joinedload(SalaryStructure.lines).joinedload(SalaryStructureLine.component))
            .filter(SalaryStructure.id == s.id)
            .one()
        )
        return _structure_to_read(s)

    s.archived_at = None
    db.commit()
    db.refresh(s)
    s = (
        db.query(SalaryStructure)
        .options(joinedload(SalaryStructure.lines).joinedload(SalaryStructureLine.component))
        .filter(SalaryStructure.id == s.id)
        .one()
    )
    return _structure_to_read(s)


@router.post(
    "/companies/{company_id}/salary-structures/{structure_id}/lines",
    response_model=SalaryStructureLineRead,
    status_code=201,
)
def add_structure_line(
    company_id: int,
    structure_id: int,
    payload: SalaryStructureLineCreate,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin_for_company(current_user, company_id, db, permission="manage_salary_structures")
    s = (
        db.query(SalaryStructure)
        .filter(SalaryStructure.id == structure_id, SalaryStructure.company_id == company_id)
        .one_or_none()
    )
    if s is None:
        raise HTTPException(status_code=404, detail=f"Structure {structure_id} not found")
    _validate_structure_lines(db, company_id, [payload], existing_structure_id=structure_id)

    existing = (
        db.query(SalaryStructureLine)
        .filter(
            SalaryStructureLine.structure_id == structure_id,
            SalaryStructureLine.component_id == payload.component_id,
        )
        .one_or_none()
    )
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail="Line for this component already exists; delete it before re-adding",
        )

    line = SalaryStructureLine(
        structure_id=structure_id,
        component_id=payload.component_id,
        amount=payload.amount,
        formula_expression=payload.formula_expression,
        order_index=payload.order_index,
    )
    db.add(line)
    db.commit()
    db.refresh(line)
    line = (
        db.query(SalaryStructureLine)
        .options(joinedload(SalaryStructureLine.component))
        .filter(SalaryStructureLine.id == line.id)
        .one()
    )
    return _line_to_read(line)


@router.patch(
    "/companies/{company_id}/salary-structures/{structure_id}/lines/{line_id}",
    response_model=SalaryStructureLineRead,
)
def patch_structure_line(
    company_id: int,
    structure_id: int,
    line_id: int,
    payload: SalaryStructureLinePatch,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a single line's amount / formula / order. ``component_id``
    is immutable — to change components, DELETE this line and POST a new
    one. Existing assignments resolve from their structure_snapshot, so
    this edit only affects assignments created *after* the change.
    """
    _require_admin_for_company(current_user, company_id, db, permission="manage_salary_structures")

    line = (
        db.query(SalaryStructureLine)
        .join(SalaryStructure, SalaryStructure.id == SalaryStructureLine.structure_id)
        .filter(
            SalaryStructureLine.id == line_id,
            SalaryStructureLine.structure_id == structure_id,
            SalaryStructure.company_id == company_id,
        )
        .one_or_none()
    )
    if line is None:
        raise HTTPException(status_code=404, detail=f"Line {line_id} not found")

    update = payload.model_dump(exclude_unset=True)

    # If amount or formula changed, re-validate the whole structure so we
    # catch new cycles or unsafe formulas. Build a synthetic
    # SalaryStructureLineCreate for the proposed line and let
    # _validate_structure_lines reconcile against the rest of the structure.
    if "amount" in update or "formula_expression" in update:
        proposed_amount = update.get("amount", line.amount)
        proposed_formula = update.get("formula_expression", line.formula_expression)
        proposed_create = SalaryStructureLineCreate(
            component_id=line.component_id,
            amount=proposed_amount,
            formula_expression=proposed_formula,
            order_index=update.get("order_index", line.order_index),
        )
        _validate_structure_lines(
            db, company_id, [proposed_create], existing_structure_id=structure_id,
        )

    for key, value in update.items():
        setattr(line, key, value)

    db.commit()
    db.refresh(line)
    line = (
        db.query(SalaryStructureLine)
        .options(joinedload(SalaryStructureLine.component))
        .filter(SalaryStructureLine.id == line.id)
        .one()
    )
    return _line_to_read(line)


@router.delete(
    "/companies/{company_id}/salary-structures/{structure_id}/lines/{line_id}",
    status_code=204,
)
def delete_structure_line(
    company_id: int,
    structure_id: int,
    line_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove a line from a structure.

    No cascade — existing ``EmployeeSalaryAssignment`` rows resolve via
    their frozen ``structure_snapshot`` and are unaffected. Only future
    assignments will see the smaller structure shape.
    """
    _require_admin_for_company(current_user, company_id, db, permission="manage_salary_structures")

    line = (
        db.query(SalaryStructureLine)
        .join(SalaryStructure, SalaryStructure.id == SalaryStructureLine.structure_id)
        .filter(
            SalaryStructureLine.id == line_id,
            SalaryStructureLine.structure_id == structure_id,
            SalaryStructure.company_id == company_id,
        )
        .one_or_none()
    )
    if line is None:
        raise HTTPException(status_code=404, detail=f"Line {line_id} not found")

    db.delete(line)
    db.commit()
    return None


# ---------------------------------------------------------------------------
# Employee salary assignments
# ---------------------------------------------------------------------------


@router.get(
    "/private-users/{private_user_id}/salary-assignments",
    response_model=List[EmployeeSalaryAssignmentRead],
)
def list_assignments(
    private_user_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    target = _resolve_target_employee(db, private_user_id)
    if current_user.user_id != target.user_id:
        # Admin authorization piggybacks on the company.
        if target.company_id is None:
            raise HTTPException(status_code=403, detail="Forbidden")
        _require_admin_for_company(current_user, target.company_id, db, permission="view_salary")

    rows = (
        db.query(EmployeeSalaryAssignment)
        .options(joinedload(EmployeeSalaryAssignment.overrides))
        .filter(EmployeeSalaryAssignment.private_user_id == private_user_id)
        .order_by(desc(EmployeeSalaryAssignment.effective_from))
        .all()
    )
    return [_assignment_to_read(a) for a in rows]


@router.get(
    "/private-users/{private_user_id}/salary-assignments/active",
    response_model=Optional[EmployeeSalaryAssignmentRead],
)
def get_active_assignment(
    private_user_id: int,
    as_of: Optional[date] = Query(None, description="Defaults to today."),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    target = _resolve_target_employee(db, private_user_id)
    if current_user.user_id != target.user_id:
        if target.company_id is None:
            raise HTTPException(status_code=403, detail="Forbidden")
        _require_admin_for_company(current_user, target.company_id, db, permission="view_salary")

    when = as_of or date.today()
    a = salary_resolver.get_active_assignment(db, private_user_id, when)
    if a is None:
        return None
    a = (
        db.query(EmployeeSalaryAssignment)
        .options(joinedload(EmployeeSalaryAssignment.overrides))
        .filter(EmployeeSalaryAssignment.id == a.id)
        .one()
    )
    return _assignment_to_read(a)


@router.post(
    "/private-users/{private_user_id}/salary-assignments",
    response_model=EmployeeSalaryAssignmentRead,
    status_code=201,
)
def create_assignment(
    private_user_id: int,
    payload: EmployeeSalaryAssignmentCreate,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    target = _resolve_target_employee(db, private_user_id)
    if target.company_id is None:
        raise HTTPException(status_code=400, detail="Employee has no company")
    _require_admin_for_company(current_user, target.company_id, db, permission="edit_salary")

    if payload.private_user_id != private_user_id:
        raise HTTPException(status_code=400, detail="private_user_id in path must match payload")

    # An assignment that references neither a structure nor any overrides has
    # nothing to resolve at payroll time. Pydantic permits the empty shape for
    # backward compatibility with overrides-only assignments, so we enforce the
    # "non-empty" invariant here instead of at the schema layer.
    if payload.structure_id is None and not payload.overrides:
        raise HTTPException(
            status_code=422,
            detail=(
                "Assignment must reference a structure or include at least one override — "
                "an assignment with neither has nothing for the payroll engine to resolve."
            ),
        )

    if payload.structure_id is not None:
        s = (
            db.query(SalaryStructure)
            .filter(
                SalaryStructure.id == payload.structure_id,
                SalaryStructure.company_id == target.company_id,
            )
            .one_or_none()
        )
        if s is None:
            raise HTTPException(
                status_code=400,
                detail="structure_id does not exist or belongs to a different company",
            )
        if s.archived_at is not None:
            raise HTTPException(
                status_code=400,
                detail=f"Structure {s.id} is archived; restore it before assigning",
            )

    # Don't let a back-dated assignment silently rewrite a CLOSED period: refuse
    # if effective_from lands on/before the end of any FINALIZED payroll run for
    # the company. A finalized period is locked (already paid + filed); the
    # real-world fix for a salary change there is a retroactive adjustment in the
    # next open run, not editing history.
    from core.model import PayrollRun
    finalized = (
        db.query(PayrollRun)
        .filter(
            PayrollRun.company_id == target.company_id,
            PayrollRun.status == "finalized",
            PayrollRun.period_end >= payload.effective_from,
        )
        .order_by(PayrollRun.period_end.asc())
        .first()
    )
    if finalized is not None:
        raise HTTPException(
            status_code=409,
            detail=(
                f"That date is inside a finalized payroll period "
                f"({finalized.period_start} → {finalized.period_end}), which is locked. "
                "Back-dating a salary into a closed period isn't allowed — set it "
                "effective from the next open period, or post a retroactive adjustment."
            ),
        )

    # A back-dated assignment into an OPEN period is fine: INSERT it into the
    # timeline rather than refusing. Bound its effective_to at the nearest LATER
    # assignment's effective_from so the windows stay non-overlapping [from, to) —
    # the admin no longer has to cancel + recreate the current assignment just to
    # add a historical one (e.g. to run a back-dated month's payroll).
    future = (
        db.query(EmployeeSalaryAssignment)
        .filter(
            EmployeeSalaryAssignment.private_user_id == private_user_id,
            EmployeeSalaryAssignment.effective_from > payload.effective_from,
        )
        .order_by(EmployeeSalaryAssignment.effective_from.asc())
        .first()
    )
    new_effective_to = future.effective_from if future is not None else None

    # A5 — auto-close every overlapping prior assignment at new.effective_from.
    # Catches both the unclosed-current case (effective_to IS NULL) and any
    # closed window whose end extends past the new start.
    overlapping = (
        db.query(EmployeeSalaryAssignment)
        .filter(
            EmployeeSalaryAssignment.private_user_id == private_user_id,
            EmployeeSalaryAssignment.effective_from < payload.effective_from,
        )
        .filter(
            (EmployeeSalaryAssignment.effective_to.is_(None))
            | (EmployeeSalaryAssignment.effective_to > payload.effective_from)
        )
        .all()
    )
    for prior in overlapping:
        if payload.effective_from <= prior.effective_from:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"new effective_from {payload.effective_from} must be strictly "
                    f"after prior effective_from {prior.effective_from}"
                ),
            )
        prior.effective_to = payload.effective_from

    # M3: Freeze the structure into structure_snapshot at create time so future
    # edits to the live structure don't retroactively change this assignment.
    snapshot = None
    if payload.structure_id is not None:
        from services import salary_resolver as _resolver
        snapshot = _resolver.build_structure_snapshot(db, payload.structure_id)

    new = EmployeeSalaryAssignment(
        private_user_id=private_user_id,
        structure_id=payload.structure_id,
        structure_snapshot=snapshot,
        currency=payload.currency,
        effective_from=payload.effective_from,
        # Bounded by the next assignment when back-dating; open-ended otherwise.
        effective_to=new_effective_to,
        notes=payload.notes,
        created_by_user_id=current_user.user_id,
    )
    db.add(new)
    db.flush()

    for ov in payload.overrides:
        db.add(
            EmployeeSalaryOverride(
                assignment_id=new.id,
                component_id=ov.component_id,
                amount=ov.amount,
                formula_expression=ov.formula_expression,
                notes=ov.notes,
            )
        )

    # Salary assignment is a COMPANY_FIELDS edit on behalf of the employee.
    # Auto-lock the company segment so the employee can't self-edit
    # job/compensation while the new assignment is in flight.
    from core.profile_lock import auto_lock_on_admin_company_edit
    auto_lock_on_admin_company_edit(target, current_user, db)

    db.commit()
    db.refresh(new)
    new = (
        db.query(EmployeeSalaryAssignment)
        .options(joinedload(EmployeeSalaryAssignment.overrides))
        .filter(EmployeeSalaryAssignment.id == new.id)
        .one()
    )
    return _assignment_to_read(new)


# ---------------------------------------------------------------------------
# Preview — calls salary_resolver
# ---------------------------------------------------------------------------


@router.get(
    "/private-users/{private_user_id}/salary/preview",
    response_model=ResolvedSalary,
)
def preview_salary(
    private_user_id: int,
    as_of: Optional[date] = Query(None, description="Defaults to today."),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    target = _resolve_target_employee(db, private_user_id)
    if current_user.user_id != target.user_id:
        if target.company_id is None:
            raise HTTPException(status_code=403, detail="Forbidden")
        _require_admin_for_company(current_user, target.company_id, db, permission="view_salary")

    when = as_of or date.today()
    result = salary_resolver.resolve_components(db, private_user_id, when)

    # Daily-frequency components resolve to a bare per-day rate (the resolver
    # has no country/period context) — scale them here for the preview, using
    # the calendar month containing `when` as the period, same as
    # payroll_engine._apply_pay_basis does for an actual run. Best-effort:
    # skipped (left as the raw per-day rate) if the employee has no company
    # (no country_code to resolve working days against).
    daily_components = [c for c in result.components if c.frequency == "daily"]
    if daily_components and target.company_id is not None:
        company = db.query(Company).filter(Company.company_id == target.company_id).one_or_none()
        if company is not None and company.country_code:
            import calendar as _calendar
            from services import proration
            month_start = when.replace(day=1)
            month_end = when.replace(day=_calendar.monthrange(when.year, when.month)[1])
            days = proration.working_days_in_period(db, company.country_code, month_start, month_end)
            for c in daily_components:
                per_day = c.amount
                c.amount = (Decimal(days) * per_day).quantize(Decimal("0.01"))
                c.meta = {"frequency": "daily", "days": days, "rate": str(per_day)}

    return result
