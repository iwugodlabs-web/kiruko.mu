"""Seed Mauritius payroll rules with PLACEHOLDER values.

⚠️  Every rate, threshold, and entitlement in this file is a placeholder.
    Verify with a Mauritius HR/tax consultant against:
      - MRA PAYE bands for the relevant fiscal year
      - Current CSG / NSF rates and thresholds
      - Workers' Rights Act 2019 leave entitlements
      - End of Year Gratuity Act 2001 (with latest amendments)
    Then re-run this script — the supersede() service will close the
    placeholder rows and insert the verified ones, preserving the audit chain.

Run from backend/:
    .venv/bin/python -m scripts.seed_mu_payroll_rules
"""

from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session

from core.config import get_db
from core.model import (
    Country,
    CountryBonusRule,
    CountryLeaveDefault,
    StatutoryDeduction,
    TaxBracketSet,
)
from schema.payroll_rules_schema import (
    CountryBonusRuleCreate,
    CountryLeaveDefaultCreate,
    StatutoryDeductionCreate,
    TaxBracketLine,
    TaxBracketSetCreate,
)
from services import payroll_rules as rules_service


PLACEHOLDER_REF = "PLACEHOLDER — VERIFY WITH ACCOUNTANT"
EFFECTIVE_FROM = date(2026, 1, 1)


def ensure_country(db: Session) -> None:
    if not db.query(Country).filter(Country.code == "MU").one_or_none():
        db.add(
            Country(
                code="MU",
                name="Mauritius",
                currency="MUR",
                locale="en-MU",
                fiscal_year_start="07-01",
                date_format="DD/MM/YYYY",
                is_active=True,
            )
        )
        db.commit()


def seed_tax_brackets(db: Session) -> None:
    payload = TaxBracketSetCreate(
        country_code="MU",
        fiscal_year=2026,
        label="MU PAYE 2026 (placeholder)",
        effective_from=EFFECTIVE_FROM,
        source_reference=PLACEHOLDER_REF,
        change_reason="Initial seed",
        brackets=[
            TaxBracketLine(
                order_index=1,
                lower_bound=Decimal("0"),
                upper_bound=Decimal("390000"),
                rate=Decimal("0.00000"),
                description="Tax-free band — VERIFY",
            ),
            TaxBracketLine(
                order_index=2,
                lower_bound=Decimal("390000"),
                upper_bound=Decimal("430000"),
                rate=Decimal("0.10000"),
                description="VERIFY",
            ),
            TaxBracketLine(
                order_index=3,
                lower_bound=Decimal("430000"),
                upper_bound=Decimal("700000"),
                rate=Decimal("0.12500"),
                description="VERIFY",
            ),
            TaxBracketLine(
                order_index=4,
                lower_bound=Decimal("700000"),
                upper_bound=None,
                rate=Decimal("0.15000"),
                description="Top band — VERIFY",
            ),
        ],
    )
    rules_service.supersede(
        db,
        model=TaxBracketSet,
        rule_filter={"country_code": "MU", "fiscal_year": 2026},
        new_payload=payload,
        actor_user_id=None,  # system seed
    )


def seed_statutory(db: Session) -> None:
    deductions = [
        StatutoryDeductionCreate(
            country_code="MU",
            code="CSG_EE",
            label="CSG — Employee contribution",
            rate=Decimal("0.01500"),
            threshold_high=Decimal("50000"),
            taxable_base="gross",
            employer_or_employee="employee",
            effective_from=EFFECTIVE_FROM,
            source_reference=PLACEHOLDER_REF,
            change_reason="Initial seed",
        ),
        StatutoryDeductionCreate(
            country_code="MU",
            code="CSG_ER",
            label="CSG — Employer contribution",
            rate=Decimal("0.03000"),
            threshold_high=Decimal("50000"),
            taxable_base="gross",
            employer_or_employee="employer",
            effective_from=EFFECTIVE_FROM,
            source_reference=PLACEHOLDER_REF,
            change_reason="Initial seed",
        ),
        StatutoryDeductionCreate(
            country_code="MU",
            code="NSF_EE",
            label="NSF — Employee contribution",
            rate=Decimal("0.01000"),
            taxable_base="basic",
            employer_or_employee="employee",
            effective_from=EFFECTIVE_FROM,
            source_reference=PLACEHOLDER_REF,
            change_reason="Initial seed",
        ),
        StatutoryDeductionCreate(
            country_code="MU",
            code="NSF_ER",
            label="NSF — Employer contribution",
            rate=Decimal("0.02500"),
            taxable_base="basic",
            employer_or_employee="employer",
            effective_from=EFFECTIVE_FROM,
            source_reference=PLACEHOLDER_REF,
            change_reason="Initial seed",
        ),
    ]
    for d in deductions:
        rules_service.supersede(
            db,
            model=StatutoryDeduction,
            rule_filter={"country_code": "MU", "code": d.code},
            new_payload=d,
            actor_user_id=None,
        )


def seed_leave_defaults(db: Session) -> None:
    defaults = [
        CountryLeaveDefaultCreate(
            country_code="MU",
            leave_type_code="annual",
            label="Annual / local leave",
            days_per_year=22,
            accrual_method="annual",
            carry_forward_max=0,
            encashable=True,
            min_service_months=0,
            effective_from=EFFECTIVE_FROM,
            source_reference=PLACEHOLDER_REF + " (Workers' Rights Act 2019)",
            change_reason="Initial seed",
        ),
        CountryLeaveDefaultCreate(
            country_code="MU",
            leave_type_code="sick",
            label="Sick leave",
            days_per_year=15,
            accrual_method="annual",
            carry_forward_max=0,
            encashable=False,
            min_service_months=0,
            effective_from=EFFECTIVE_FROM,
            source_reference=PLACEHOLDER_REF + " (Workers' Rights Act 2019)",
            change_reason="Initial seed",
        ),
        CountryLeaveDefaultCreate(
            country_code="MU",
            leave_type_code="maternity",
            label="Maternity leave (14 weeks)",
            days_per_year=98,
            accrual_method="annual",
            carry_forward_max=0,
            encashable=False,
            min_service_months=12,
            effective_from=EFFECTIVE_FROM,
            source_reference=PLACEHOLDER_REF,
            change_reason="Initial seed",
        ),
        CountryLeaveDefaultCreate(
            country_code="MU",
            leave_type_code="paternity",
            label="Paternity leave",
            days_per_year=5,
            accrual_method="annual",
            carry_forward_max=0,
            encashable=False,
            min_service_months=12,
            effective_from=EFFECTIVE_FROM,
            source_reference=PLACEHOLDER_REF,
            change_reason="Initial seed",
        ),
    ]
    for d in defaults:
        rules_service.supersede(
            db,
            model=CountryLeaveDefault,
            rule_filter={"country_code": "MU", "leave_type_code": d.leave_type_code},
            new_payload=d,
            actor_user_id=None,
        )


def seed_bonus_rules(db: Session) -> None:
    payload = CountryBonusRuleCreate(
        country_code="MU",
        bonus_code="EOY_GRATUITY",
        label="End of Year Gratuity",
        formula="twelfth_of_annual",
        eligibility_min_service_months=12,
        payable_month=12,
        prorate_on_partial_year=True,
        taxable=True,
        effective_from=EFFECTIVE_FROM,
        source_reference=PLACEHOLDER_REF + " (End of Year Gratuity Act 2001)",
        change_reason="Initial seed",
    )
    rules_service.supersede(
        db,
        model=CountryBonusRule,
        rule_filter={"country_code": "MU", "bonus_code": "EOY_GRATUITY"},
        new_payload=payload,
        actor_user_id=None,
    )


def main() -> None:
    db: Session = next(get_db())
    try:
        ensure_country(db)
        seed_tax_brackets(db)
        seed_statutory(db)
        seed_leave_defaults(db)
        seed_bonus_rules(db)
        db.commit()
        print("✅ MU payroll rules seeded (PLACEHOLDER values — verify with accountant).")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
