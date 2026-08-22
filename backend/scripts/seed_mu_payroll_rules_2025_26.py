#!/usr/bin/env python3
"""MU FY2025/26 statutory rate version — supersedes the placeholder rules.

⚠️  PENDING ACCOUNTANT / LAWYER SIGN-OFF (the repo's M0 step). Values below are
transcribed from public sources (MRA + PwC Worldwide Tax Summaries, Finance Act
2025) and MUST be reconciled against 3 real MRA-computed payslips before any
production payroll is finalised on them.

What it installs (effective 2026-07-01, the next fiscal-year boundary after the
2026-01-01 placeholder — supersede requires a strictly-later effective_from):

  PAYE (annual chargeable income)        0–500,000: 0% · 500k–1m: 10% · >1m: 20%
  CSG  employee  1.5% (<=Rs 50,000/mo)  -> 3% on the WHOLE amount above 50,000
  CSG  employer  3.0% (<=Rs 50,000/mo)  -> 6% on the WHOLE amount above 50,000
  NSF  employee  1.0%   ceiling Rs 28,570/mo
  NSF  employer  2.5%   ceiling Rs 28,570/mo
  Training Levy  1.5% (employer)

The CSG two-band is stored as TWO active statutory_deductions rows per code; the
engine's compute_statutory treats multiple rows per code as a tiered flat rate.

Usage:  cd backend && python3 scripts/seed_mu_payroll_rules_2025_26.py
"""
import os
import sys
from datetime import date
from decimal import Decimal

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_dir)
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(backend_dir, ".env"), override=False)
except Exception:
    pass

from core.config import get_session_local
from core.model import StatutoryDeduction, TaxBracketSet
from schema.payroll_rules_schema import (
    StatutoryDeductionCreate, TaxBracketLine, TaxBracketSetCreate,
)
from services import payroll_rules as rules

EFF = date(2026, 7, 1)
SRC = "MRA + PwC WWTS (Finance Act 2025) — PENDING ACCOUNTANT SIGN-OFF"
REASON = "FY2025/26 statutory rates"


def _csg_high_tier(db, code, label, rate, who):
    """Insert the >Rs50,000 CSG tier as a second active row (append-only INSERT,
    allowed by the rule trigger). compute_statutory picks it for bases above the
    low tier's threshold_high and applies it to the full base."""
    db.add(StatutoryDeduction(
        country_code="MU", code=code, label=label, rate=rate,
        threshold_low=Decimal("50000"), threshold_high=None,
        taxable_base="gross", employer_or_employee=who,
        effective_from=EFF, effective_to=None, version=2,
        source_reference=SRC, change_reason=REASON + " (high tier)",
    ))
    db.flush()


def install(db) -> bool:
    """Install the FY2025/26 rates on `db` (caller commits). Returns False if
    already installed (idempotent skip)."""
    already = (
        db.query(StatutoryDeduction)
        .filter(StatutoryDeduction.country_code == "MU", StatutoryDeduction.code == "CSG_EE")
        .filter(StatutoryDeduction.effective_to.is_(None), StatutoryDeduction.threshold_high.is_(None))
        .first()
    )
    if already:
        return False
    _install_rules(db)
    return True


def _install_rules(db):
    if True:
        # 1. PAYE — 3-band progressive, IET Rs 500,000
        rules.supersede(
            db, model=TaxBracketSet, rule_filter={"country_code": "MU", "fiscal_year": 2026},
            new_payload=TaxBracketSetCreate(
                country_code="MU", fiscal_year=2026, label="MU PAYE FY2025/26",
                effective_from=EFF, source_reference=SRC, change_reason=REASON,
                brackets=[
                    TaxBracketLine(order_index=1, lower_bound=Decimal("0"), upper_bound=Decimal("500000"), rate=Decimal("0.00"), description="Tax-free (IET Rs 500k)"),
                    TaxBracketLine(order_index=2, lower_bound=Decimal("500000"), upper_bound=Decimal("1000000"), rate=Decimal("0.10"), description="10%"),
                    TaxBracketLine(order_index=3, lower_bound=Decimal("1000000"), upper_bound=Decimal("12000000"), rate=Decimal("0.20"), description="20%"),
                    # Fair Share Contribution (Finance Act 2025): +15% on income
                    # above Rs 12m/yr, folded onto the 20% band -> 35% marginal.
                    TaxBracketLine(order_index=4, lower_bound=Decimal("12000000"), upper_bound=None, rate=Decimal("0.35"), description="20% PAYE + 15% Fair Share (>Rs 12m)"),
                ],
            ),
            actor_user_id=None,
        )

        # 2. CSG — low tier via supersede (closes placeholder), high tier inserted
        rules.supersede(db, model=StatutoryDeduction, rule_filter={"country_code": "MU", "code": "CSG_EE"},
                        new_payload=StatutoryDeductionCreate(country_code="MU", code="CSG_EE", label="CSG employee (<=50k)", rate=Decimal("0.015"), threshold_high=Decimal("50000"), taxable_base="gross", employer_or_employee="employee", effective_from=EFF, source_reference=SRC, change_reason=REASON), actor_user_id=None)
        _csg_high_tier(db, "CSG_EE", "CSG employee (>50k)", Decimal("0.03"), "employee")
        rules.supersede(db, model=StatutoryDeduction, rule_filter={"country_code": "MU", "code": "CSG_ER"},
                        new_payload=StatutoryDeductionCreate(country_code="MU", code="CSG_ER", label="CSG employer (<=50k)", rate=Decimal("0.03"), threshold_high=Decimal("50000"), taxable_base="gross", employer_or_employee="employer", effective_from=EFF, source_reference=SRC, change_reason=REASON), actor_user_id=None)
        _csg_high_tier(db, "CSG_ER", "CSG employer (>50k)", Decimal("0.06"), "employer")

        # 3. NSF — add the Rs 28,570/mo contribution ceiling
        rules.supersede(db, model=StatutoryDeduction, rule_filter={"country_code": "MU", "code": "NSF_EE"},
                        new_payload=StatutoryDeductionCreate(country_code="MU", code="NSF_EE", label="NSF employee", rate=Decimal("0.01"), threshold_high=Decimal("28570"), taxable_base="basic", employer_or_employee="employee", effective_from=EFF, source_reference=SRC, change_reason=REASON), actor_user_id=None)
        rules.supersede(db, model=StatutoryDeduction, rule_filter={"country_code": "MU", "code": "NSF_ER"},
                        new_payload=StatutoryDeductionCreate(country_code="MU", code="NSF_ER", label="NSF employer", rate=Decimal("0.025"), threshold_high=Decimal("28570"), taxable_base="basic", employer_or_employee="employer", effective_from=EFF, source_reference=SRC, change_reason=REASON), actor_user_id=None)

        # 4. Training Levy — 1.5% employer (new code; no prior → version 1)
        rules.supersede(db, model=StatutoryDeduction, rule_filter={"country_code": "MU", "code": "TRAINING_ER"},
                        new_payload=StatutoryDeductionCreate(country_code="MU", code="TRAINING_ER", label="HRDC Training Levy", rate=Decimal("0.015"), taxable_base="gross", employer_or_employee="employer", effective_from=EFF, source_reference=SRC, change_reason=REASON), actor_user_id=None)

        return


def main():
    db = get_session_local()()
    try:
        if not install(db):
            print("FY2025/26 rates already installed — skipping.")
            return
        db.commit()
        print(f"Installed MU FY2025/26 rates (effective {EFF}). PENDING ACCOUNTANT SIGN-OFF.")
        snap = rules.resolve(db, "MU", date(2026, 8, 1))
        out = rules.compute_statutory(
            {"CSG_EE": Decimal("120000"), "NSF_EE": Decimal("120000")},
            [d for d in snap.statutory_deductions if d.employer_or_employee == "employee"],
        )
        print(f"  check: 120,000 earner CSG_EE={out.get('CSG_EE')} (expect 3600.00), NSF_EE={out.get('NSF_EE')} (expect 285.70)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
