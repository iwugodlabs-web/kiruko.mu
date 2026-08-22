"""End-of-year bonus engine.

For Mauritius, this implements the End of Year Gratuity Act 2001 formula
('twelfth_of_annual'): EOY bonus = total earnings YTD ÷ 12. Pro-ration for
partial-year employees is automatic — short YTD sum produces a small bonus.

Eligibility: from country_bonus_rules.eligibility_min_service_months. By
default seeded as 12 months, but a `supersede()` of the rule can change
that without code edits.

This module is country-agnostic — it reads `country_bonus_rules` and applies
whatever formula is configured.
"""

from __future__ import annotations

import logging
from datetime import date
from decimal import Decimal
from typing import List, Optional

from sqlalchemy.orm import Session

from core.model import (
    Company,
    CountryBonusRule,
    Job,
    PayrollRun,
    Payslip,
    PrivateUser,
    SalaryComponent,
)
from schema.payroll_rules_schema import CountryBonusRuleRead
from services import payroll_rules
from services.salary_resolver import ResolvedComponent


logger = logging.getLogger(__name__)


def get_or_create_bonus_component(
    db: Session, company_id: int, bonus_code: str, label: str, taxable: bool
) -> SalaryComponent:
    """Per-company SalaryComponent for the bonus. Created lazily on first use.
    Caller commits."""
    existing = (
        db.query(SalaryComponent)
        .filter(
            SalaryComponent.company_id == company_id,
            SalaryComponent.code == bonus_code,
        )
        .one_or_none()
    )
    if existing is not None:
        return existing
    new = SalaryComponent(
        company_id=company_id,
        code=bonus_code,
        label=label,
        kind="earning",
        category="earning.bonus",
        is_basic=False,
        is_taxable=taxable,
        is_recurring=False,
        is_one_off=True,
        prorate_on_partial_month=False,
        # M4: bonuses by MU practice are PAYE-only (no CSG, no NSF). If the
        # rule says non-taxable, the engine drops PAYE too — empty list.
        statutory_base_codes=["PAYE"] if taxable else [],
    )
    db.add(new)
    db.flush()
    return new


def _months_of_service(employee: PrivateUser, period_start: date, db: Session) -> int:
    """Months of continuous service. Approximated from the earliest active job's
    first_date_of_employment. Future Module 4 (FTE/contract types) will refine
    this; for now an approximation suffices."""
    earliest_job = (
        db.query(Job)
        .filter(Job.private_user_id == employee.private_user_id)
        .order_by(Job.first_date_of_employment.asc().nullslast())
        .first()
    )
    if earliest_job is None or earliest_job.first_date_of_employment is None:
        return 0
    start = earliest_job.first_date_of_employment
    if hasattr(start, "date"):
        start = start.date()
    months = (period_start.year - start.year) * 12 + (period_start.month - start.month)
    # A hire on the 1st has fully worked that calendar month, so it counts
    # toward service — otherwise a Jan 1 hire is wrongly 1 month short of
    # eligibility by December of the same year (11 vs the required 12).
    if start.day == 1:
        months += 1
    return max(months, 0)


def _ytd_earnings(
    db: Session, private_user_id: int, period_start: date
) -> Decimal:
    """Sum of finalized payslip.gross for the same calendar year, for periods
    BEFORE period_start. Excludes period_start itself because that payslip is
    being computed right now."""
    rows = (
        db.query(Payslip.gross)
        .join(PayrollRun, Payslip.payroll_run_id == PayrollRun.id)
        .filter(
            Payslip.private_user_id == private_user_id,
            PayrollRun.status == "finalized",
            PayrollRun.period_start < period_start,
            PayrollRun.period_start >= date(period_start.year, 1, 1),
        )
        .all()
    )
    return sum((Decimal(r[0]) for r in rows), Decimal("0.00"))


def _active_eoy_rule(
    db: Session, country_code: str, period_start: date
) -> Optional[CountryBonusRuleRead]:
    """The active EOY-style rule whose payable_month matches period_start.month."""
    rules = payroll_rules.get_bonus_rules(db, country_code, period_start)
    for r in rules:
        if r.payable_month == period_start.month:
            return CountryBonusRuleRead.model_validate(r)
    return None


def compute_eoy_for_employee(
    db: Session,
    employee: PrivateUser,
    period_start: date,
    *,
    current_period_gross: Decimal = Decimal("0"),
) -> Decimal:
    """The EOY bonus amount for an employee in this period.

    Returns Decimal("0.00") when:
      * No active EOY rule for the country + payable_month
      * Employee fails the min_service_months eligibility
      * Formula isn't implemented yet (anything other than 'twelfth_of_annual',
        'fixed', or 'percent_of_basic')

    `current_period_gross` is the gross from the in-flight period_start payslip
    (which isn't yet finalized). Pass it to include this month in the sum
    for 'twelfth_of_annual' — common practice in MU because payslip 12 itself
    is part of the annual earnings.
    """
    company = db.query(Company).filter(Company.company_id == employee.company_id).one_or_none()
    if company is None:
        return Decimal("0.00")

    rule = _active_eoy_rule(db, company.country_code, period_start)
    if rule is None:
        return Decimal("0.00")

    if _months_of_service(employee, period_start, db) < rule.eligibility_min_service_months:
        logger.info(
            f"bonus_engine: skip private_user_id={employee.private_user_id} — "
            f"service < {rule.eligibility_min_service_months} months for {rule.bonus_code}"
        )
        return Decimal("0.00")

    if rule.formula == "fixed":
        return Decimal(rule.fixed_amount or 0).quantize(Decimal("0.01"))

    if rule.formula == "percent_of_basic":
        # Caller should pass current_period_gross as basic for this branch.
        return (current_period_gross * Decimal(rule.rate or 0)).quantize(Decimal("0.01"))

    if rule.formula == "twelfth_of_annual":
        ytd = _ytd_earnings(db, employee.private_user_id, period_start)
        annual = ytd + current_period_gross
        return (annual / Decimal(12)).quantize(Decimal("0.01"))

    logger.warning(f"bonus_engine: formula {rule.formula!r} not implemented (rule {rule.bonus_code})")
    return Decimal("0.00")


def synthesize_bonus_component(
    db: Session,
    employee: PrivateUser,
    period_start: date,
    amount: Decimal,
) -> Optional[ResolvedComponent]:
    """Materialize a ResolvedComponent for a computed bonus amount, creating
    the underlying SalaryComponent on demand. Returns None if amount <= 0.
    Caller commits."""
    if amount <= 0:
        return None

    company = db.query(Company).filter(Company.company_id == employee.company_id).one()
    rule = _active_eoy_rule(db, company.country_code, period_start)
    if rule is None:
        return None

    component = get_or_create_bonus_component(
        db,
        company_id=employee.company_id,
        bonus_code=rule.bonus_code,
        label=rule.label,
        taxable=rule.taxable,
    )
    return ResolvedComponent(
        component_id=component.id,
        code=component.code,
        label=component.label,
        kind="earning",
        category=component.category,
        amount=amount.quantize(Decimal("0.01")),
        is_taxable=rule.taxable,
        is_basic=False,
        source="bonus",
        # M4: bonuses contribute to PAYE base only (set by
        # get_or_create_bonus_component above).
        statutory_base_codes=list(component.statutory_base_codes or []),
    )
