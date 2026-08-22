"""Backfill the new salary-structure model from legacy `salaries` rows.

For each existing `salaries` row:
  * Ensure the company has BASIC and ALLOWANCE SalaryComponents.
  * Create (or reuse) a per-employee SalaryStructure named "Salary <employee_id>"
    — the simplest 1:1 backfill that preserves existing amounts exactly.
  * Add structure lines for BASIC=salary, ALLOWANCE=allowance.
  * Create an active EmployeeSalaryAssignment with
    effective_from = first_date_of_employment (or 2026-01-01 fallback).

The legacy `salaries` table is left in place and unchanged. Future writes
will go to the new model; reads from existing endpoints can keep using the
legacy table during transition.

Idempotent — safe to re-run. Skips rows whose employee already has an
active assignment.

Run:
    .venv/bin/python -m scripts.backfill_salary_structures
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from core.config import get_db
from core.model import (
    EmployeeSalaryAssignment,
    Job,
    PrivateUser,
    Salary,
    SalaryComponent,
    SalaryStructure,
    SalaryStructureLine,
)


FALLBACK_EFFECTIVE_FROM = date(2026, 1, 1)


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
    statutory_base_codes: list[str] | None = None,
) -> SalaryComponent:
    existing = (
        db.query(SalaryComponent)
        .filter(SalaryComponent.company_id == company_id, SalaryComponent.code == code)
        .one_or_none()
    )
    if existing:
        return existing
    if statutory_base_codes is None:
        # Sensible MU defaults for components not given an explicit list.
        if is_basic:
            statutory_base_codes = ["PAYE", "CSG_EE", "CSG_ER", "NSF_EE", "NSF_ER"]
        elif is_taxable:
            statutory_base_codes = ["PAYE", "CSG_EE", "CSG_ER"]
        else:
            statutory_base_codes = []
    comp = SalaryComponent(
        company_id=company_id,
        code=code,
        label=label,
        kind=kind,
        category=category,
        is_basic=is_basic,
        is_taxable=is_taxable,
        statutory_base_codes=statutory_base_codes,
    )
    db.add(comp)
    db.flush()
    return comp


def _structure_name(private_user_id: int) -> str:
    return f"Salary {private_user_id}"


def _backfill_one(db: Session, salary_row: Salary) -> Optional[int]:
    """Backfill a single legacy salary row. Returns new assignment_id, or None
    if the employee already has an active assignment (i.e. nothing to do)."""
    job = db.query(Job).filter(Job.job_id == salary_row.job_id).one_or_none()
    if job is None:
        print(f"  skip salary_id={salary_row.salary_id}: job missing")
        return None
    private_user = (
        db.query(PrivateUser).filter(PrivateUser.private_user_id == job.private_user_id).one_or_none()
    )
    if private_user is None:
        print(f"  skip salary_id={salary_row.salary_id}: private_user missing")
        return None

    # Already has an active assignment? Nothing to do.
    has_active = (
        db.query(EmployeeSalaryAssignment)
        .filter(
            EmployeeSalaryAssignment.private_user_id == private_user.private_user_id,
            EmployeeSalaryAssignment.effective_to.is_(None),
        )
        .first()
    )
    if has_active is not None:
        print(f"  skip private_user_id={private_user.private_user_id}: already has active assignment id={has_active.id}")
        return None

    company_id = job.company_id
    if company_id is None:
        print(f"  skip salary_id={salary_row.salary_id}: job has no company")
        return None

    basic = _ensure_component(
        db, company_id, "BASIC", "Basic salary",
        kind="earning", category="earning.basic", is_basic=True, is_taxable=True,
    )
    allowance = _ensure_component(
        db, company_id, "ALLOWANCE", "Allowance",
        kind="earning", category="allowance.general", is_basic=False, is_taxable=True,
    )

    # Create or reuse per-employee structure
    name = _structure_name(private_user.private_user_id)
    structure = (
        db.query(SalaryStructure)
        .filter(SalaryStructure.company_id == company_id, SalaryStructure.name == name)
        .one_or_none()
    )
    if structure is None:
        structure = SalaryStructure(company_id=company_id, name=name, description="Auto-backfilled from legacy salaries row")
        db.add(structure)
        db.flush()

    # Add lines (skip if already present)
    salary_amount = salary_row.salary or Decimal("0.00")
    allowance_amount = salary_row.allowance or Decimal("0.00")

    for component, amount, order in [(basic, salary_amount, 0), (allowance, allowance_amount, 1)]:
        existing_line = (
            db.query(SalaryStructureLine)
            .filter(
                SalaryStructureLine.structure_id == structure.id,
                SalaryStructureLine.component_id == component.id,
            )
            .one_or_none()
        )
        if existing_line is None:
            db.add(
                SalaryStructureLine(
                    structure_id=structure.id,
                    component_id=component.id,
                    amount=amount,
                    order_index=order,
                )
            )

    # Effective_from: prefer job start, else fallback.
    eff_from = job.first_date_of_employment or FALLBACK_EFFECTIVE_FROM
    if hasattr(eff_from, "date"):
        eff_from = eff_from.date()  # in case it's a datetime

    assignment = EmployeeSalaryAssignment(
        private_user_id=private_user.private_user_id,
        structure_id=structure.id,
        currency=salary_row.currency or "MUR",
        effective_from=eff_from,
        notes="Backfilled from legacy salaries row",
        created_by_user_id=None,
    )
    db.add(assignment)
    db.flush()
    print(f"  ✓ private_user_id={private_user.private_user_id}: structure_id={structure.id} assignment_id={assignment.id} basic={salary_amount} allowance={allowance_amount}")
    return assignment.id


def main() -> None:
    db: Session = next(get_db())
    try:
        legacy_rows = db.query(Salary).order_by(Salary.salary_id).all()
        print(f"Found {len(legacy_rows)} legacy salary rows.")
        new_count = 0
        for row in legacy_rows:
            if _backfill_one(db, row) is not None:
                new_count += 1
        db.commit()
        print(f"\n✅ Backfill complete: {new_count} new assignment(s) created.")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
