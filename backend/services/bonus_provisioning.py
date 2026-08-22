"""Monthly bonus liability provisioning (M23).

Walks every active employee in a company and writes (or upserts) one
`bonus_provisions` row recording the cumulative EOY bonus liability
through (year, month). The CFO dashboard sums these to surface "as of
end-of-month X, the company has accumulated Y in EOY liability".

Math per employee:

    For 'twelfth_of_annual' (Mauritius EOY):
        ytd_earnings = sum of finalized payslip.gross for the year up
                       through `month` (inclusive)
        accrued      = ytd_earnings / 12

    For 'fixed':
        accrued = (month / 12) × fixed_amount    (linear monthly accrual)

    For 'percent_of_basic':
        accrued = ytd_earnings × rate / 12       (interpret rate as
                                                   annualized — divide by
                                                   12 for the monthly slice)

When the active rule has `eligibility_min_service_months` set, employees
who fall short get a zero provision (still a row, so the dashboard shows
the count of ineligible employees explicitly).

Idempotent: re-running for the same period overwrites in place via the
unique constraint on (company_id, private_user_id, year, month).
"""

from __future__ import annotations

import logging
from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from core.model import (
    BonusProvision,
    Company,
    CountryBonusRule,
    PayrollRun,
    Payslip,
    PrivateUser,
)
from services import payroll_rules
from services.bonus_engine import _months_of_service


logger = logging.getLogger(__name__)


def _ytd_finalized_earnings(
    db: Session, private_user_id: int, year: int, through_month: int
) -> Decimal:
    """Sum of `payslip.gross` for finalized payslips whose run is in (year)
    and ends on or before the last day of `through_month`."""
    rows = (
        db.query(Payslip.gross)
        .join(PayrollRun, Payslip.payroll_run_id == PayrollRun.id)
        .filter(
            Payslip.private_user_id == private_user_id,
            PayrollRun.status == "finalized",
            PayrollRun.period_start >= date(year, 1, 1),
            PayrollRun.period_start < date(year, through_month + 1, 1) if through_month < 12
            else PayrollRun.period_start < date(year + 1, 1, 1),
        )
        .all()
    )
    return sum((Decimal(r[0]) for r in rows), Decimal("0.00"))


def _active_eoy_rule_for(
    db: Session, country_code: str, as_of: date
) -> Optional[CountryBonusRule]:
    """The single highest-priority EOY-style bonus rule active on `as_of`.

    Today the engine assumes one EOY-style rule per country (Mauritius:
    EOY_GRATUITY in payable_month=12). If multiple rules ever stack, this
    returns the one with the highest payable_month — the closest "year-end"
    rule, since that's what the liability dashboard is forecasting toward.
    """
    rules = payroll_rules.get_bonus_rules(db, country_code, as_of)
    if not rules:
        return None
    return max(rules, key=lambda r: r.payable_month)


def _compute_accrued(
    *,
    rule: CountryBonusRule,
    ytd_earnings: Decimal,
    month: int,
) -> Decimal:
    """Pure math: given a rule snapshot and YTD earnings through `month`,
    return the cumulative accrued liability."""
    if rule.formula == "twelfth_of_annual":
        return (ytd_earnings / Decimal(12)).quantize(Decimal("0.01"))

    if rule.formula == "fixed" and rule.fixed_amount is not None:
        return (Decimal(month) / Decimal(12) * Decimal(rule.fixed_amount)).quantize(Decimal("0.01"))

    if rule.formula == "percent_of_basic" and rule.rate is not None:
        return (ytd_earnings * Decimal(rule.rate) / Decimal(12)).quantize(Decimal("0.01"))

    logger.warning(
        "bonus_provisioning: formula %r not supported for liability accrual; treating as zero",
        rule.formula,
    )
    return Decimal("0.00")


def provision_for_month(
    db: Session, *, company_id: int, year: int, month: int
) -> dict:
    """Upsert one BonusProvision row per active employee for (year, month).

    Returns a counts dict suitable for the CFO dashboard or a cron log:
      {
        "company_id": int,
        "year": int,
        "month": int,
        "processed": int,         # rows written/updated
        "ineligible": int,        # employees below min_service_months
        "total_liability": str,   # sum of accrued_amount across all rows
      }

    Caller commits.
    """
    company = db.query(Company).filter(Company.company_id == company_id).one_or_none()
    if company is None:
        raise ValueError(f"Company {company_id} not found")
    if not 1 <= month <= 12:
        raise ValueError(f"month {month} out of range")

    # Use the last day of the month as the rule-resolution / service-tenure
    # reference — provisions are "as of end of month".
    if month == 12:
        as_of = date(year, 12, 31)
    else:
        as_of = date(year, month + 1, 1) - __import__("datetime").timedelta(days=1)

    rule = _active_eoy_rule_for(db, company.country_code, as_of)
    if rule is None:
        logger.info(
            "bonus_provisioning: no active EOY rule for %s on %s — nothing to provision",
            company.country_code, as_of,
        )
        return {
            "company_id": company_id, "year": year, "month": month,
            "processed": 0, "ineligible": 0, "total_liability": "0.00",
        }

    formula_snapshot = {
        "rule_id": rule.id,
        "bonus_code": rule.bonus_code,
        "formula": rule.formula,
        "eligibility_min_service_months": rule.eligibility_min_service_months,
        "fixed_amount": str(rule.fixed_amount) if rule.fixed_amount is not None else None,
        "rate": str(rule.rate) if rule.rate is not None else None,
        "version": rule.version,
        "effective_from": rule.effective_from.isoformat() if rule.effective_from else None,
    }

    employees = (
        db.query(PrivateUser)
        .filter(PrivateUser.company_id == company_id)
        .all()
    )

    processed = 0
    ineligible = 0
    total_liability = Decimal("0.00")

    for emp in employees:
        ytd = _ytd_finalized_earnings(db, emp.private_user_id, year, month)
        eligible = _months_of_service(emp, as_of, db) >= rule.eligibility_min_service_months

        if not eligible:
            accrued = Decimal("0.00")
            ineligible += 1
        else:
            accrued = _compute_accrued(rule=rule, ytd_earnings=ytd, month=month)

        existing = (
            db.query(BonusProvision)
            .filter(
                BonusProvision.company_id == company_id,
                BonusProvision.private_user_id == emp.private_user_id,
                BonusProvision.year == year,
                BonusProvision.month == month,
            )
            .one_or_none()
        )
        if existing:
            existing.accrued_amount = accrued
            existing.ytd_earnings = ytd
            existing.formula_snapshot = formula_snapshot
            existing.bonus_rule_id = rule.id
        else:
            db.add(BonusProvision(
                company_id=company_id,
                private_user_id=emp.private_user_id,
                year=year,
                month=month,
                accrued_amount=accrued,
                ytd_earnings=ytd,
                formula_snapshot=formula_snapshot,
                bonus_rule_id=rule.id,
            ))

        processed += 1
        total_liability += accrued

    db.flush()

    return {
        "company_id": company_id,
        "year": year,
        "month": month,
        "processed": processed,
        "ineligible": ineligible,
        "total_liability": str(total_liability.quantize(Decimal("0.01"))),
    }


def get_liability_summary(
    db: Session, *, company_id: int, year: int
) -> dict:
    """Aggregate the latest provision per employee for `year` and return
    a CFO-dashboard-shaped summary:
      {
        "company_id": int,
        "year": int,
        "as_of_month": int | None,    # latest month with any provision row
        "total_liability": "<decimal>",
        "headcount_provisioned": int,
        "by_employee": [
            {"private_user_id": int, "month": int, "accrued_amount": "..."}
            ...
        ],
      }
    """
    rows = (
        db.query(BonusProvision)
        .filter(
            BonusProvision.company_id == company_id,
            BonusProvision.year == year,
        )
        .all()
    )
    if not rows:
        return {
            "company_id": company_id, "year": year, "as_of_month": None,
            "total_liability": "0.00", "headcount_provisioned": 0, "by_employee": [],
        }

    # Latest month per employee (the cumulative accrued is on that row).
    by_emp: dict[int, BonusProvision] = {}
    for r in rows:
        prior = by_emp.get(r.private_user_id)
        if prior is None or r.month > prior.month:
            by_emp[r.private_user_id] = r

    as_of_month = max(r.month for r in by_emp.values())
    total = sum((Decimal(r.accrued_amount) for r in by_emp.values()), Decimal("0.00"))

    return {
        "company_id": company_id,
        "year": year,
        "as_of_month": as_of_month,
        "total_liability": str(total.quantize(Decimal("0.01"))),
        "headcount_provisioned": len(by_emp),
        "by_employee": sorted(
            [
                {
                    "private_user_id": r.private_user_id,
                    "month": r.month,
                    "accrued_amount": str(Decimal(r.accrued_amount).quantize(Decimal("0.01"))),
                    "ytd_earnings": str(Decimal(r.ytd_earnings).quantize(Decimal("0.01"))),
                }
                for r in by_emp.values()
            ],
            key=lambda d: -Decimal(d["accrued_amount"]),
        ),
    }
