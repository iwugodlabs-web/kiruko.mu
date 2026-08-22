"""revenue = salary + allowance must hold on every salary write path.

Regression cover for the "frozen / corrupted revenue" bug: a stale or wrong
client-sent `revenue` (e.g. the old web editor freezing it, or SalariesSection
sending revenue == allowance) must never stick — the backend always derives the
gross from salary + allowance.
"""

from __future__ import annotations

from core.model import Salary
from db_models.crud.job import _enforce_salary_money


# ---------------------------------------------------------------------------
# Unit — the invariant helper that create_salary / update_salary / onboard all
# call. No DB: deterministic and environment-independent.
# ---------------------------------------------------------------------------


class TestEnforceInvariantUnit:
    def test_derives_gross_and_ignores_existing_revenue(self):
        s = Salary(salary="18000", allowance="3000", revenue="999999")
        _enforce_salary_money(s)
        assert float(s.revenue) == 21000.0  # salary + allowance, not 999999
        assert float(s.allowance) == 3000.0

    def test_revenue_equal_to_allowance_is_corrected(self):
        # The old SalariesSection payload (revenue == allowance) must not stick.
        s = Salary(salary="18000", allowance="3000", revenue="3000")
        _enforce_salary_money(s)
        assert float(s.revenue) == 21000.0

    def test_negative_allowance_floored_to_zero(self):
        s = Salary(salary="18000", allowance="-500", revenue="0")
        _enforce_salary_money(s)
        assert float(s.allowance) == 0.0
        assert float(s.revenue) == 18000.0

    def test_realistic_ben_ten_values(self):
        # The exact case from the bug report: 18000 base + 3000 allowance.
        s = Salary(salary="18000", allowance="3000", revenue="38000")  # 38000 = stale
        _enforce_salary_money(s)
        assert float(s.revenue) == 21000.0
