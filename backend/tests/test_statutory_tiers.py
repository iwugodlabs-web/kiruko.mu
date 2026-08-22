"""CSG two-band (tiered flat rate) + NSF ceiling — unit tests for
payroll_rules.compute_statutory.

MU CSG: 1.5%/3% (employee) on TOTAL remuneration up to Rs 50,000, stepping to
3%/6% on the WHOLE total once it exceeds Rs 50,000 (not a marginal band). NSF is
a single capped rate. These verify the engine handles both shapes.
"""
from datetime import date
from decimal import Decimal

from schema.payroll_rules_schema import StatutoryDeductionRead
from services.payroll_rules import compute_statutory


def _ded(code, rate, *, taxable_base="gross", thi=None, who="employee"):
    return StatutoryDeductionRead(
        id=1, version=1, country_code="MU", code=code, label=code,
        rate=Decimal(rate), threshold_high=(Decimal(thi) if thi else None),
        taxable_base=taxable_base, employer_or_employee=who, effective_from=date(2026, 1, 1),
    )


# Two-tier CSG: lower tier capped by threshold_high=50000, top tier open-ended.
CSG_EE = [_ded("CSG_EE", "0.015", thi="50000"), _ded("CSG_EE", "0.03")]
CSG_ER = [_ded("CSG_ER", "0.03", thi="50000", who="employer"), _ded("CSG_ER", "0.06", who="employer")]


def test_csg_low_band_rate_on_full_base():
    out = compute_statutory({"CSG_EE": Decimal("30000")}, CSG_EE)
    assert out["CSG_EE"] == Decimal("450.00")          # 1.5% × 30000


def test_csg_at_threshold_uses_low_band():
    out = compute_statutory({"CSG_EE": Decimal("50000")}, CSG_EE)
    assert out["CSG_EE"] == Decimal("750.00")          # exactly 50k → 1.5%


def test_csg_high_band_applies_to_whole_base():
    out = compute_statutory({"CSG_EE": Decimal("120000")}, CSG_EE)
    assert out["CSG_EE"] == Decimal("3600.00")         # 3% × 120000 (NOT capped)
    out_er = compute_statutory({"CSG_ER": Decimal("120000")}, CSG_ER)
    assert out_er["CSG_ER"] == Decimal("7200.00")      # 6% × 120000


def test_nsf_single_row_still_caps_at_ceiling():
    nsf = [_ded("NSF_EE", "0.01", taxable_base="basic", thi="28570")]
    assert compute_statutory({"NSF_EE": Decimal("120000")}, nsf)["NSF_EE"] == Decimal("285.70")
    assert compute_statutory({"NSF_EE": Decimal("20000")}, nsf)["NSF_EE"] == Decimal("200.00")
