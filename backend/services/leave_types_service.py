"""Service layer for the leave_types catalog (Module 1).

Two responsibilities:

  1. seed_defaults_for_company(db, company_id) — pull every active row from
     country_leave_defaults for the company's country, create or update a
     matching leave_types row per (company_id, code). Idempotent.

  2. get_or_create_for_code(db, company_id, code) — convenience for the
     existing leave-application code path: if a string `leave_type='annual'`
     hits the new model, we lazily create the leave_types row from the
     country default rather than failing.
"""

from __future__ import annotations

from datetime import date
from typing import Optional

from sqlalchemy.orm import Session

from core.model import Company, CountryLeaveDefault, LeaveType
from schema.leave_types_schema import SeedFromCountryReport
from services import payroll_rules


def seed_defaults_for_company(
    db: Session, company_id: int, *, period_start: Optional[date] = None
) -> SeedFromCountryReport:
    """Create or refresh leave_types rows for `company_id` from the active
    country_leave_defaults. Idempotent.

    Behavior:
      * For each active CountryLeaveDefault on the company's country:
          - If no LeaveType with that code exists → create.
          - If one exists with country_default_id linking back to a prior
            version of this rule → update its mutable fields and re-link.
          - If one exists *without* a country_default_id (a custom company
            type that happens to share the code) → skip.
      * Returns a report of which codes were created/updated/skipped.

    Caller must commit.
    """
    company = db.query(Company).filter(Company.company_id == company_id).one_or_none()
    if company is None:
        raise ValueError(f"Company {company_id} not found")

    if period_start is None:
        period_start = date.today()

    defaults = payroll_rules.get_leave_defaults(db, company.country_code, period_start)

    report = SeedFromCountryReport(
        company_id=company_id, country_code=company.country_code
    )

    for d in defaults:
        existing = (
            db.query(LeaveType)
            .filter(LeaveType.company_id == company_id, LeaveType.code == d.leave_type_code)
            .one_or_none()
        )

        if existing is None:
            db.add(
                LeaveType(
                    company_id=company_id,
                    code=d.leave_type_code,
                    label=d.label,
                    is_paid=True,
                    is_statutory=True,
                    accrual_method=d.accrual_method,
                    days_per_year=d.days_per_year,
                    carry_forward_max=d.carry_forward_max,
                    encashable=d.encashable,
                    min_service_months=d.min_service_months,
                    country_default_id=d.id,
                )
            )
            report.created.append(d.leave_type_code)
            continue

        # Existing without link — leave alone (custom type).
        if existing.country_default_id is None:
            report.skipped.append(d.leave_type_code)
            continue

        # Existing linked — refresh from the country default.
        existing.label = d.label
        existing.accrual_method = d.accrual_method
        existing.days_per_year = d.days_per_year
        existing.carry_forward_max = d.carry_forward_max
        existing.encashable = d.encashable
        existing.min_service_months = d.min_service_months
        existing.country_default_id = d.id
        existing.is_statutory = True
        report.updated.append(d.leave_type_code)

    db.flush()
    return report


def get_or_create_for_code(
    db: Session, company_id: int, code: str
) -> Optional[LeaveType]:
    """Returns the LeaveType for (company_id, code), creating it from the
    country default if necessary. Returns None if no matching country default
    exists either — caller decides whether to error.

    Caller must commit if anything was created.
    """
    existing = (
        db.query(LeaveType)
        .filter(LeaveType.company_id == company_id, LeaveType.code == code)
        .one_or_none()
    )
    if existing is not None:
        return existing

    company = db.query(Company).filter(Company.company_id == company_id).one()
    defaults = payroll_rules.get_leave_defaults(db, company.country_code, date.today())
    matching = next((d for d in defaults if d.leave_type_code == code), None)
    if matching is None:
        return None

    new = LeaveType(
        company_id=company_id,
        code=matching.leave_type_code,
        label=matching.label,
        is_paid=True,
        is_statutory=True,
        accrual_method=matching.accrual_method,
        days_per_year=matching.days_per_year,
        carry_forward_max=matching.carry_forward_max,
        encashable=matching.encashable,
        min_service_months=matching.min_service_months,
        country_default_id=matching.id,
    )
    db.add(new)
    db.flush()
    return new
