"""SalaryComponent.frequency ('monthly'|'daily') + value_type
('amount'|'percent_of_basic'), and the prorate_on_partial_month wiring fix.

Coverage:
  * Daily-frequency component scales by working days in the period, even in
    the common full-time/full-month case (multiplier==1 early-return doesn't
    skip it).
  * Daily-frequency component for a mid-month joiner is bounded to their
    employed window directly — NOT also scaled by the FTE/proration
    multiplier (which would double-count the partial month).
  * pay_basis='daily' keeps frequency='daily' structure components (scaled
    by the same working-day count as BASIC) instead of stripping them.
  * value_type='percent_of_basic' resolves against the structure's BASIC.
  * prorate_on_partial_month=False keeps a component's full amount for a
    mid-month joiner — this flag existed before but the engine never read it.

Uses the session-scoped `test_employee`/`seed_mu_rules` fixtures shared with
test_part_time.py (BASIC=30000, ALLOWANCE=6000, May 2026 has 20 working days
per the seeded MU public holidays) — every test restores the ALLOWANCE
component's fields in `finally` so it doesn't leak into other tests.
"""

from __future__ import annotations

from datetime import date, datetime, time
from decimal import Decimal

import pytest

from services.payroll_engine import _apply_pay_basis
from services.salary_resolver import resolve_components


def _get_allowance_component(db, test_company_id: int):
    from core.model import SalaryComponent

    return (
        db.query(SalaryComponent)
        .filter(SalaryComponent.company_id == test_company_id, SalaryComponent.code == "ALLOWANCE")
        .one()
    )


def _set_job_dates(db, employee_id, *, start_date=None, end_date=None):
    from core.model import Job

    job = (
        db.query(Job)
        .filter(Job.private_user_id == employee_id)
        .order_by(Job.created_at.desc())
        .first()
    )
    if start_date is not None:
        job.first_date_of_employment = datetime.combine(start_date, time.min)
    job.end_date = end_date
    db.flush()


def _set_pay_basis(db, employee_id, *, pay_basis="monthly", daily_rate=None):
    from core.model import Job, Salary

    salary = (
        db.query(Salary)
        .join(Job, Salary.job_id == Job.job_id)
        .filter(Job.private_user_id == employee_id)
        .order_by(Salary.created_at.desc())
        .first()
    )
    salary.pay_basis = pay_basis
    salary.daily_rate = daily_rate
    db.flush()


class TestDailyFrequency:
    def test_daily_allowance_scales_by_working_days_full_month(
        self, db, seed_mu_rules, test_employee, test_company_id,
    ):
        comp = _get_allowance_component(db, test_company_id)
        comp.frequency = "daily"
        db.flush()
        try:
            resolved = resolve_components(db, test_employee.private_user_id, date(2026, 5, 1))
            _apply_pay_basis(db, test_employee, date(2026, 5, 1), date(2026, 5, 31), "MU", resolved)
            allowance = next(c for c in resolved.components if not c.is_basic)
            # 6000/day (the structure's stored amount) × 20 working days in
            # May 2026 (21 weekdays − Labour Day). Scales even though this is
            # the full-time/full-month case (multiplier would otherwise be 1
            # and skip everything below it).
            assert allowance.amount == Decimal("120000.00")
            assert allowance.meta == {"frequency": "daily", "days": 20, "rate": "6000.00"}
        finally:
            comp.frequency = "monthly"
            db.commit()

    def test_daily_allowance_mid_month_joiner_not_double_prorated(
        self, db, seed_mu_rules, test_employee, test_company_id,
    ):
        comp = _get_allowance_component(db, test_company_id)
        comp.frequency = "daily"
        db.flush()
        _set_job_dates(db, test_employee.private_user_id, start_date=date(2026, 5, 18))
        try:
            resolved = resolve_components(db, test_employee.private_user_id, date(2026, 5, 1))
            _apply_pay_basis(db, test_employee, date(2026, 5, 1), date(2026, 5, 31), "MU", resolved)
            basic = next(c.amount for c in resolved.components if c.is_basic)
            allowance = next(c for c in resolved.components if not c.is_basic)
            # BASIC still prorates via the FTE/joiner factor (10/20 working days).
            assert basic == Decimal("15000.00")
            # ALLOWANCE is bounded directly to the employed window (18-31 May
            # = 10 working days) × 6000/day = 60000 — NOT also multiplied by
            # the 0.5 proration factor (which would give 30000 if double-counted).
            assert allowance.amount == Decimal("60000.00")
        finally:
            comp.frequency = "monthly"
            _set_job_dates(db, test_employee.private_user_id, start_date=date(2024, 1, 1), end_date=None)
            db.commit()

    def test_pay_basis_daily_keeps_daily_frequency_component(
        self, db, seed_mu_rules, test_employee, test_company_id,
    ):
        comp = _get_allowance_component(db, test_company_id)
        comp.frequency = "daily"
        db.flush()
        _set_pay_basis(db, test_employee.private_user_id, pay_basis="daily", daily_rate=Decimal("1000.00"))
        try:
            resolved = resolve_components(db, test_employee.private_user_id, date(2026, 5, 1))
            _apply_pay_basis(db, test_employee, date(2026, 5, 1), date(2026, 5, 31), "MU", resolved)
            basic = next(c.amount for c in resolved.components if c.is_basic)
            assert basic == Decimal("20000.00")  # 1000/day × 20 working days
            non_basic = [c for c in resolved.components if c.kind == "earning" and not c.is_basic]
            assert len(non_basic) == 1, "frequency='daily' structure component should survive pay_basis='daily', not be stripped"
            assert non_basic[0].amount == Decimal("120000.00")  # 6000/day × 20 working days
        finally:
            comp.frequency = "monthly"
            _set_pay_basis(db, test_employee.private_user_id, pay_basis="monthly")
            db.commit()

    def test_pay_basis_daily_still_drops_monthly_frequency_component(
        self, db, seed_mu_rules, test_employee,
    ):
        """Unchanged prior behavior: a monthly-frequency structure earning
        (the fixture default) is dropped under pay_basis='daily' — a monthly
        allowance means nothing for a genuinely daily-rate worker."""
        _set_pay_basis(db, test_employee.private_user_id, pay_basis="daily", daily_rate=Decimal("1000.00"))
        try:
            resolved = resolve_components(db, test_employee.private_user_id, date(2026, 5, 1))
            _apply_pay_basis(db, test_employee, date(2026, 5, 1), date(2026, 5, 31), "MU", resolved)
            non_basic = [c for c in resolved.components if c.kind == "earning" and not c.is_basic]
            assert non_basic == []
        finally:
            _set_pay_basis(db, test_employee.private_user_id, pay_basis="monthly")
            db.commit()


class TestPercentOfBasic:
    def test_percent_of_basic_resolves_against_basic(
        self, db, seed_mu_rules, test_employee, test_company_id,
    ):
        comp = _get_allowance_component(db, test_company_id)
        comp.value_type = "percent_of_basic"
        db.flush()
        from core.model import SalaryStructureLine

        line = (
            db.query(SalaryStructureLine)
            .filter(SalaryStructureLine.component_id == comp.id)
            .one()
        )
        original_amount = line.amount
        line.amount = Decimal("10.00")  # 10% of BASIC
        db.commit()
        try:
            resolved = resolve_components(db, test_employee.private_user_id, date(2026, 5, 1))
            basic = next(c.amount for c in resolved.components if c.is_basic)
            allowance = next(c.amount for c in resolved.components if not c.is_basic)
            assert basic == Decimal("30000.00")
            assert allowance == Decimal("3000.00")  # 10% of 30000

            # The raw percentage-points figure (10) must survive in `meta` —
            # the UI edits/redisplays THIS, not the resolved 3000 total.
            # Without this, re-saving an unchanged edit would silently
            # overwrite the override's "10% of basic" with a flat "3000".
            allowance_component = next(c for c in resolved.components if not c.is_basic)
            assert allowance_component.meta == {"value_type": "percent_of_basic", "percent": "10.00"}
        finally:
            comp.value_type = "amount"
            line.amount = original_amount
            db.commit()

    def test_percent_of_basic_flags_for_manual_review_on_daily_pay_basis(
        self, db, seed_mu_rules, test_employee, test_company_id,
    ):
        """A percent_of_basic component was resolved against the structure's
        BASIC, but pay_basis='daily' replaces BASIC with days×rate below —
        those can diverge. Rather than silently use the stale percentage,
        the engine flags it for manual review (same pattern as
        hourly_zero_pay / salaried_absence_skipped elsewhere in this file)."""
        comp = _get_allowance_component(db, test_company_id)
        comp.value_type = "percent_of_basic"
        db.flush()
        _set_pay_basis(db, test_employee.private_user_id, pay_basis="daily", daily_rate=Decimal("1000.00"))
        try:
            resolved = resolve_components(db, test_employee.private_user_id, date(2026, 5, 1))
            flags: list[str] = []
            _apply_pay_basis(db, test_employee, date(2026, 5, 1), date(2026, 5, 31), "MU", resolved, flags_out=flags)
            assert "percent_of_basic_with_daily_pay_basis:ALLOWANCE" in flags
        finally:
            comp.value_type = "amount"
            _set_pay_basis(db, test_employee.private_user_id, pay_basis="monthly")
            db.commit()


class TestProrateOnPartialMonthWiring:
    def test_prorate_false_keeps_full_amount_for_mid_month_joiner(
        self, db, seed_mu_rules, test_employee, test_company_id,
    ):
        comp = _get_allowance_component(db, test_company_id)
        comp.prorate_on_partial_month = False
        db.flush()
        _set_job_dates(db, test_employee.private_user_id, start_date=date(2026, 5, 18))
        try:
            resolved = resolve_components(db, test_employee.private_user_id, date(2026, 5, 1))
            _apply_pay_basis(db, test_employee, date(2026, 5, 1), date(2026, 5, 31), "MU", resolved)
            basic = next(c.amount for c in resolved.components if c.is_basic)
            allowance = next(c.amount for c in resolved.components if not c.is_basic)
            assert basic == Decimal("15000.00"), "BASIC (prorate=True) still prorates for the mid-month joiner"
            assert allowance == Decimal("6000.00"), "prorate_on_partial_month=False keeps the full amount"
        finally:
            comp.prorate_on_partial_month = True
            _set_job_dates(db, test_employee.private_user_id, start_date=date(2024, 1, 1), end_date=None)
            db.commit()

    def test_prorate_true_still_prorates_as_before(
        self, db, seed_mu_rules, test_employee,
    ):
        """Default (prorate_on_partial_month=True, the fixture's default)
        still prorates for a mid-month joiner — confirms the wiring fix
        didn't change the common case."""
        _set_job_dates(db, test_employee.private_user_id, start_date=date(2026, 5, 18))
        try:
            resolved = resolve_components(db, test_employee.private_user_id, date(2026, 5, 1))
            _apply_pay_basis(db, test_employee, date(2026, 5, 1), date(2026, 5, 31), "MU", resolved)
            allowance = next(c.amount for c in resolved.components if not c.is_basic)
            assert allowance == Decimal("3000.00")  # 6000 × 10/20
        finally:
            _set_job_dates(db, test_employee.private_user_id, start_date=date(2024, 1, 1), end_date=None)
            db.commit()
