"""Seed Tanzania (TZ) payroll rules with PLACEHOLDER values for shadow payroll.

⚠️  Every rate, threshold, and entitlement in this file is a placeholder.
    Verify with a Tanzania HR/tax consultant against:
      - TRA PAYE monthly bands for the relevant fiscal year
      - Current NSSF / SDL / WCF rates and ceilings
    Then re-run this script — the supersede() service will close the
    placeholder rows and insert the verified ones, preserving the audit chain.

This seeds only what shadow payroll needs (PAYE bands + employee/employer
statutory), enabling a MU→TZ mission to produce non-zero host-country shadow
figures for reporting. It does NOT seed leave/bonus/overtime — running a real
payroll run with a TZ *employer* is a separate, gated onboarding (see
doc/TANZANIA-ONBOARDING-PLAN.md).

Run from backend/:
    .venv/bin/python -m scripts.seed_tz_shadow_rules
"""

from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session

from core.config import get_db
from core.model import StatutoryDeduction, TaxBracketSet
from schema.payroll_rules_schema import (
    StatutoryDeductionCreate,
    TaxBracketLine,
    TaxBracketSetCreate,
)
from services import payroll_rules as rules_service


PLACEHOLDER_REF = "PLACEHOLDER — VERIFY WITH ACCOUNTANT"
EFFECTIVE_FROM = date(2026, 1, 1)


def seed_tax_brackets(db: Session) -> None:
    # TRA publishes MONTHLY PAYE bands (FLAT_PERIODIC — no annual cumulative
    # reconciliation for simple employment income). Bands below are placeholders
    # that must be verified against the current TRA table.
    payload = TaxBracketSetCreate(
        country_code="TZ",
        fiscal_year=2026,
        label="TZ PAYE 2026 monthly (placeholder)",
        effective_from=EFFECTIVE_FROM,
        source_reference=PLACEHOLDER_REF,
        change_reason="Initial shadow-payroll seed",
        tax_computation_mode="FLAT_PERIODIC",
        brackets=[
            TaxBracketLine(
                order_index=1,
                lower_bound=Decimal("0"),
                upper_bound=Decimal("270000"),
                rate=Decimal("0.00000"),
                description="Tax-free band — VERIFY",
            ),
            TaxBracketLine(
                order_index=2,
                lower_bound=Decimal("270000"),
                upper_bound=Decimal("520000"),
                rate=Decimal("0.09000"),
                description="VERIFY",
            ),
            TaxBracketLine(
                order_index=3,
                lower_bound=Decimal("520000"),
                upper_bound=Decimal("760000"),
                rate=Decimal("0.20000"),
                description="VERIFY",
            ),
            TaxBracketLine(
                order_index=4,
                lower_bound=Decimal("760000"),
                upper_bound=Decimal("1000000"),
                rate=Decimal("0.25000"),
                description="VERIFY",
            ),
            TaxBracketLine(
                order_index=5,
                lower_bound=Decimal("1000000"),
                upper_bound=None,
                rate=Decimal("0.30000"),
                description="Top band — VERIFY",
            ),
        ],
    )
    rules_service.supersede(
        db,
        model=TaxBracketSet,
        rule_filter={"country_code": "TZ", "fiscal_year": 2026},
        new_payload=payload,
        actor_user_id=None,  # system seed
    )


def seed_statutory(db: Session) -> None:
    deductions = [
        StatutoryDeductionCreate(
            country_code="TZ",
            code="NSSF_EE",
            label="NSSF — Employee contribution",
            rate=Decimal("0.10000"),
            taxable_base="basic",
            employer_or_employee="employee",
            effective_from=EFFECTIVE_FROM,
            source_reference=PLACEHOLDER_REF,
            change_reason="Initial shadow-payroll seed",
        ),
        StatutoryDeductionCreate(
            country_code="TZ",
            code="NSSF_ER",
            label="NSSF — Employer contribution",
            rate=Decimal("0.10000"),
            taxable_base="basic",
            employer_or_employee="employer",
            effective_from=EFFECTIVE_FROM,
            source_reference=PLACEHOLDER_REF,
            change_reason="Initial shadow-payroll seed",
        ),
    ]
    for d in deductions:
        rules_service.supersede(
            db,
            model=StatutoryDeduction,
            rule_filter={"country_code": "TZ", "code": d.code},
            new_payload=d,
            actor_user_id=None,
        )


def main() -> None:
    db: Session = next(get_db())
    try:
        seed_tax_brackets(db)
        seed_statutory(db)
        db.commit()
        print("✅ TZ shadow-payroll rules seeded (PLACEHOLDER values — verify with accountant).")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()