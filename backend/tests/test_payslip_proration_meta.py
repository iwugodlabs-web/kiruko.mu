"""Unit tests for the base-pay proration meta surfaced on the payslip.

`_replace_or_add_basic` carries a `meta` breakdown (hours × rate, days × rate,
or the monthly proration factor) onto the basic earning so the employee gets a
"how this was computed" drill-down. These are pure, DB-free checks of that
plumbing; the amount arithmetic itself is covered by the engine tests.
"""
from datetime import date
from decimal import Decimal

from schema.salary_structure_schema import ResolvedComponent, ResolvedSalary
from services.payroll_engine import _replace_or_add_basic


def _resolved(components):
    return ResolvedSalary(
        private_user_id=1,
        period_start=date(2026, 6, 1),
        assignment_id=None,
        structure_id=None,
        currency="MUR",
        components=components,
    )


def _basic(amount="20000.00"):
    return ResolvedComponent(
        component_id=1,
        code="BASIC",
        label="Basic",
        kind="earning",
        category="earning.basic",
        amount=Decimal(amount),
        is_taxable=True,
        is_basic=True,
        source="structure",
    )


def test_meta_attaches_to_existing_basic():
    r = _resolved([_basic()])
    _replace_or_add_basic(
        r, Decimal("9186.67"), "Hourly wages", "hourly",
        meta={"pay_basis": "hourly", "hours": "89.6", "rate": "102.53"},
    )
    basic = next(c for c in r.components if c.is_basic)
    assert basic.amount == Decimal("9186.67")
    assert basic.source == "hourly"
    assert basic.meta == {"pay_basis": "hourly", "hours": "89.6", "rate": "102.53"}


def test_meta_attaches_to_synthesized_basic():
    r = _resolved([])  # structure defined no basic — one is synthesized
    _replace_or_add_basic(
        r, Decimal("5000.00"), "Daily wages", "daily",
        meta={"pay_basis": "daily", "days": 10, "rate": "500"},
    )
    basic = next(c for c in r.components if c.is_basic)
    assert basic.amount == Decimal("5000.00")
    assert basic.meta["pay_basis"] == "daily"
    assert basic.meta["days"] == 10


def test_no_meta_leaves_meta_none():
    r = _resolved([_basic()])
    _replace_or_add_basic(r, Decimal("20000.00"), "Basic", "structure")
    basic = next(c for c in r.components if c.is_basic)
    assert basic.meta is None
