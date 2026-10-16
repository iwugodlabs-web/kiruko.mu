"""Bootstrap a payroll-ready salary assignment from a legacy `salaries` row.

Onboarding tracks (self-signup -> onboard, claim-link, job approval, user
approval) historically wrote only the legacy `salaries` row. The payroll
engine, however, resolves pay from `employee_salary_assignments`
(`salary_resolver.resolve_components` returns empty components without one),
so monthly employees with a profile salary but no assignment silently dropped
out of runs (`payroll_engine` skip at "no resolved components").

This module is the single convergence point: given a private_user, create a
per-employee structure ("Salary {id}", same convention as the import path and
`scripts/backfill_salary_structures.py`) + BASIC/ALLOWANCE lines mirroring the
legacy amounts + an open-ended assignment. Idempotent — returns the existing
assignment when one already covers the employee.

Contract: writes are flushed, never committed. Callers own the transaction
(endpoints commit; the backfill script commits once at the end).
"""

from __future__ import annotations

import logging
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Optional

from sqlalchemy.orm import Session

from core.model import (
    EmployeeSalaryAssignment,
    Job,
    PrivateUser,
    Salary,
    SalaryComponent,
    SalaryStructure,
    SalaryStructureLine,
)

logger = logging.getLogger(__name__)


def _to_decimal(value) -> Decimal:
    try:
        if value is None or (isinstance(value, str) and not value.strip()):
            return Decimal("0.00")
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0.00")


def _ensure_component(
    db: Session,
    company_id: int,
    code: str,
    label: str,
    *,
    kind: str = "earning",
    category: str = "earning.other",
    is_basic: bool = False,
    is_taxable: bool = True,
) -> SalaryComponent:
    existing = (
        db.query(SalaryComponent)
        .filter(SalaryComponent.company_id == company_id, SalaryComponent.code == code)
        .one_or_none()
    )
    if existing is not None:
        return existing
    # A company may already have a basic component under a DIFFERENT code
    # (uq_salary_component_one_basic allows only one is_basic per company), so
    # reuse it rather than inserting a duplicate BASIC that would violate the
    # constraint. The structure line references it by id — the code is metadata.
    if is_basic:
        existing_basic = (
            db.query(SalaryComponent)
            .filter(SalaryComponent.company_id == company_id, SalaryComponent.is_basic.is_(True))
            .first()
        )
        if existing_basic is not None:
            return existing_basic
    comp = SalaryComponent(
        company_id=company_id,
        code=code,
        label=label,
        kind=kind,
        category=category,
        is_basic=is_basic,
        is_taxable=is_taxable,
        statutory_base_codes=(
            ["PAYE", "CSG_EE", "CSG_ER", "NSF_EE", "NSF_ER"]
            if is_basic
            else (["PAYE", "CSG_EE", "CSG_ER"] if is_taxable else [])
        ),
    )
    db.add(comp)
    db.flush()
    return comp


def ensure_assignment_from_legacy(
    db: Session,
    private_user_id: int,
    *,
    created_by_user_id: Optional[int] = None,
    effective_from: Optional[date] = None,
    notes: str = "Auto-created from legacy salary on onboarding approval",
) -> Optional[EmployeeSalaryAssignment]:
    """Create a payroll-ready assignment from the employee's legacy salary.

    Returns the new (or pre-existing covering) assignment, or None when there
    is nothing to do: no company link, onboarding-draft job, no legacy salary
    row, or an assignment already in force. Never commits.
    """
    employee = (
        db.query(PrivateUser)
        .filter(PrivateUser.private_user_id == private_user_id)
        .one_or_none()
    )
    if employee is None:
        return None

    # Latest job first — created_at is NULL on some legacy rows, so NULLS LAST.
    job = (
        db.query(Job)
        .filter(Job.private_user_id == private_user_id)
        .order_by(Job.created_at.desc().nullslast())
        .first()
    )
    if job is None or getattr(job, "is_onboarding_draft", False):
        return None

    company_id = employee.company_id or job.company_id
    if company_id is None:
        return None

    target_from = effective_from
    if target_from is None:
        first = getattr(job, "first_date_of_employment", None)
        target_from = first.date() if hasattr(first, "date") else first
    if target_from is None:
        target_from = date.today()

    # Idempotency: an open-ended assignment, or one already covering the
    # target date, means payroll already resolves this employee.
    existing = (
        db.query(EmployeeSalaryAssignment)
        .filter(EmployeeSalaryAssignment.private_user_id == private_user_id)
        .order_by(EmployeeSalaryAssignment.effective_from.desc())
        .all()
    )
    for row in existing:
        if row.effective_to is None:
            return row
        if row.effective_from <= target_from < (row.effective_to or target_from):
            return row

    salary_row = (
        db.query(Salary)
        .filter(Salary.job_id == job.job_id)
        .order_by(Salary.created_at.desc().nullslast())
        .first()
    )
    if salary_row is None:
        return None

    basic = _ensure_component(
        db, company_id, "BASIC", "Basic salary",
        kind="earning", category="earning.basic", is_basic=True, is_taxable=True,
    )
    allowance = _ensure_component(
        db, company_id, "ALLOWANCE", "Allowance",
        kind="earning", category="allowance.general", is_basic=False, is_taxable=True,
    )

    name = f"Salary {private_user_id}"
    structure = (
        db.query(SalaryStructure)
        .filter(SalaryStructure.company_id == company_id, SalaryStructure.name == name)
        .one_or_none()
    )
    if structure is None:
        structure = SalaryStructure(
            company_id=company_id, name=name,
            description="Auto-created from legacy salary on onboarding approval",
        )
        db.add(structure)
        db.flush()

    for component, amount, order in (
        (basic, _to_decimal(salary_row.salary), 0),
        (allowance, _to_decimal(getattr(salary_row, "allowance", None)), 1),
    ):
        line = (
            db.query(SalaryStructureLine)
            .filter(
                SalaryStructureLine.structure_id == structure.id,
                SalaryStructureLine.component_id == component.id,
            )
            .one_or_none()
        )
        if line is None:
            db.add(
                SalaryStructureLine(
                    structure_id=structure.id,
                    component_id=component.id,
                    amount=amount,
                    order_index=order,
                )
            )
    db.flush()

    snapshot = None
    try:
        from services import salary_resolver as _resolver

        snapshot = _resolver.build_structure_snapshot(db, structure.id)
    except Exception as exc:  # legacy live-structure path still resolves
        logger.warning(
            "bootstrap: snapshot build failed for structure %s: %s", structure.id, exc
        )

    assignment = EmployeeSalaryAssignment(
        private_user_id=private_user_id,
        structure_id=structure.id,
        structure_snapshot=snapshot,
        currency=getattr(salary_row, "currency", None) or "MUR",
        effective_from=target_from,
        notes=notes,
        created_by_user_id=created_by_user_id,
    )
    db.add(assignment)
    db.flush()
    logger.info(
        "bootstrap: assignment id=? for private_user_id=%s company_id=%s effective_from=%s",
        private_user_id, company_id, target_from,
    )
    return assignment
