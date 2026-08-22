"""M0 — reconcile the engine against REAL Mauritius payslips.

This is the mechanism that closes M0 ("3 real MU payslips reconciled + lawyer
opinion letter"). It installs the FY2025/26 rate version and asserts the engine
reproduces each statutory figure from a real, authoritative payslip to the cent.

➡️  TO CLOSE M0: paste 3 real MRA-computed payslips into REAL_PAYSLIPS below
   (from the MRA PAYE/CSG/NSF calculator or a signed-off payroll bureau), attach
   the lawyer opinion letter alongside, then flip the skip. The numbers and the
   sign-off are the human input; this harness is the verification.

Until then it SKIPS (so CI stays green) — the engine math is already proven by
test_mu_fy2025_26_rates; this is the legal reconciliation layer on top.
"""
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

import pytest

from services import payroll_rules as rules
from scripts.seed_mu_payroll_rules_2025_26 import install


@dataclass
class MRAPayslip:
    label: str
    gross_monthly: Decimal      # monthly remuneration (CSG base)
    basic_monthly: Decimal      # basic (NSF base)
    csg_ee: Decimal             # expected employee CSG, per the real payslip
    nsf_ee: Decimal             # expected employee NSF
    paye_monthly: Decimal       # expected monthly PAYE
    # PAYE is cumulative-YTD (see services/payroll_engine.py), so a single
    # isolated month can't be verified without knowing what came before it in
    # the same MU fiscal year (July–June). Default to 0/0 for a payslip that's
    # the FIRST of its fiscal year for that employee — the simplest case to
    # reconcile against one real payslip. If a pasted payslip is NOT the
    # employee's first of the fiscal year, fill these in from their actual
    # prior YTD taxable income / PAYE withheld.
    ytd_taxable_before: Decimal = Decimal("0")
    ytd_paye_before: Decimal = Decimal("0")


# ── PASTE REAL, SIGNED-OFF PAYSLIPS HERE ─────────────────────────────────────
REAL_PAYSLIPS: list[MRAPayslip] = [
    # MRAPayslip("low earner",  Decimal("30000"),  Decimal("30000"),  Decimal("..."), Decimal("..."), Decimal("...")),
    # MRAPayslip("mid earner",  Decimal("80000"),  Decimal("80000"),  Decimal("..."), Decimal("..."), Decimal("...")),
    # MRAPayslip("high earner", Decimal("150000"), Decimal("150000"), Decimal("..."), Decimal("..."), Decimal("...")),
]


@pytest.mark.skipif(not REAL_PAYSLIPS, reason="M0 pending: paste 3 real MRA payslips + attach lawyer opinion")
@pytest.mark.parametrize("p", REAL_PAYSLIPS, ids=lambda p: p.label)
def test_engine_matches_real_mra_payslip(db, seed_mu_rules, p: MRAPayslip):
    install(db)
    db.commit()
    snap = rules.resolve(db, "MU", date(2026, 8, 1))
    ee = [d for d in snap.statutory_deductions if d.employer_or_employee == "employee"]

    assert rules.compute_statutory({"CSG_EE": p.gross_monthly}, ee)["CSG_EE"] == p.csg_ee, "CSG mismatch vs MRA"
    assert rules.compute_statutory({"NSF_EE": p.basic_monthly}, ee)["NSF_EE"] == p.nsf_ee, "NSF mismatch vs MRA"

    # PAYE is cumulative: tax due on (YTD taxable before this period + this
    # period's taxable), minus PAYE already withheld YTD this fiscal year.
    cumulative_tax_due = rules.compute_paye(
        p.ytd_taxable_before + p.gross_monthly, snap.tax_bracket_set.brackets
    )
    paye_this_period = max(Decimal("0.00"), cumulative_tax_due - p.ytd_paye_before)
    assert paye_this_period == p.paye_monthly, "PAYE mismatch vs MRA"
