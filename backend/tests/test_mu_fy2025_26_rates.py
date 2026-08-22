"""MU FY2025/26 statutory rate version — end-to-end lawful computation.

Installs the FY2025/26 rates (scripts/seed_mu_payroll_rules_2025_26.install) on
top of the placeholder fixture and asserts the engine then computes per the law:
CSG two-band (1.5/3% on full base around Rs 50k), NSF capped at Rs 28,570, and
the 0/10/20% PAYE bands with the Rs 500,000 exemption threshold.
"""
from datetime import date
from decimal import Decimal

from services import payroll_rules as rules
from scripts.seed_mu_payroll_rules_2025_26 import install


def test_fy2025_26_rates_compute_lawfully(db, seed_mu_rules):
    assert install(db) is True
    db.commit()
    snap = rules.resolve(db, "MU", date(2026, 8, 1))  # after the 2026-07-01 effective date
    ee = [d for d in snap.statutory_deductions if d.employer_or_employee == "employee"]

    # CSG — tiered flat rate on the FULL base
    assert rules.compute_statutory({"CSG_EE": Decimal("30000")}, ee)["CSG_EE"] == Decimal("450.00")    # 1.5%
    assert rules.compute_statutory({"CSG_EE": Decimal("50000")}, ee)["CSG_EE"] == Decimal("750.00")    # 1.5% at threshold
    assert rules.compute_statutory({"CSG_EE": Decimal("120000")}, ee)["CSG_EE"] == Decimal("3600.00")  # 3% on whole

    # NSF — capped at the Rs 28,570/mo ceiling
    assert rules.compute_statutory({"NSF_EE": Decimal("120000")}, ee)["NSF_EE"] == Decimal("285.70")
    assert rules.compute_statutory({"NSF_EE": Decimal("20000")}, ee)["NSF_EE"] == Decimal("200.00")

    # PAYE — IET Rs 500,000, then 10%, then 20%
    brackets = snap.tax_bracket_set.brackets
    assert rules.compute_paye(Decimal("400000"), brackets) == Decimal("0.00")        # under IET
    assert rules.compute_paye(Decimal("700000"), brackets) == Decimal("20000.00")    # 200k @ 10%
    assert rules.compute_paye(Decimal("1500000"), brackets) == Decimal("150000.00")  # 500k@10 + 500k@20
    # Fair Share Contribution: +15% above Rs 12m → 35% marginal on the top slice.
    # 13m: 50k(10%) + 2.2m(20% on 1-12m) + 350k(35% on 12-13m) = 2,600,000
    assert rules.compute_paye(Decimal("13000000"), brackets) == Decimal("2600000.00")

    # idempotent
    assert install(db) is False
