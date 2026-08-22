"""Shadow-payroll (Phase 2) tests — tax-equalization math, FX snapshot, and an
end-to-end run producing host-country shadow figures on a payslip.
"""
from __future__ import annotations

import datetime as _dt
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from core.model import Company, EmployeeCountryAssignment, Payslip, PrivateUser, User
from schema.payroll_rules_schema import (
    CountryRulesSnapshot,
    StatutoryDeductionRead,
    TaxBracketLineRead,
    TaxBracketSetRead,
)
from services import employee_import_service as imp, fx_service, payroll_engine, payroll_rules


def _snapshot(with_rules: bool = True) -> CountryRulesSnapshot:
    """A host snapshot: FLAT_PERIODIC PAYE (0%→30% band above 100k) + one 10%
    employee statutory deduction on gross."""
    brackets = [
        TaxBracketLineRead(id=1, bracket_set_id=1, order_index=0, lower_bound=0,
                           upper_bound=Decimal("100000"), rate=Decimal("0.00"), description="a"),
        TaxBracketLineRead(id=2, bracket_set_id=1, order_index=1, lower_bound=Decimal("100000"),
                           upper_bound=None, rate=Decimal("0.30"), description="b"),
    ]
    ts = TaxBracketSetRead(id=1, country_code="TZ", fiscal_year="2026", label="TZ shadow",
                           effective_from=_dt.date(2026, 1, 1), effective_to=None,
                           superseded_by_id=None, version=1, source_reference="t",
                           change_reason="t", created_by_user_id=1, created_at=None,
                           tax_computation_mode="FLAT_PERIODIC", brackets=brackets)
    ded = StatutoryDeductionRead(country_code="TZ", code="NSSF_EE", label="NSSF employee",
                                 rate=Decimal("0.10"), threshold_low=None, threshold_high=None,
                                 taxable_base="gross", employer_or_employee="employee",
                                 reduces_base_code=None, id=1,
                                 effective_from=_dt.date(2026, 1, 1), version=1)
    return CountryRulesSnapshot(
        country_code="TZ", resolved_for_period_start=_dt.date(2026, 5, 1),
        resolved_at=_dt.datetime(2026, 5, 1, tzinfo=_dt.timezone.utc),
        tax_bracket_set=ts if with_rules else None,
        statutory_deductions=[ded] if with_rules else [],
        leave_defaults=[], bonus_rules=[], overtime=None,
    )


# ---------------------------------------------------------------------------
# Pure: compute_shadow (tax equalization)
# ---------------------------------------------------------------------------


def test_compute_shadow_equalization():
    """Host tax 30k TZS (300k @ 30% on the 100k+ band) *0.05 = 1500 MUR home;
    home PAYE for the period is 1000 → equalization due is 500 MUR."""
    snap = _snapshot()
    out = payroll_rules.compute_shadow(
        taxable_host=Decimal("200000"),
        bases_host={"gross": Decimal("200000")},
        snapshot=snap,
        fx_rate=Decimal("0.05"),
        home_paye=Decimal("1000.00"),
        host_currency="TZS",
    )
    # taxable above the 100k floor → band applies on 200000-100000 = 100000 @ 30%
    assert out["shadow_tax"] == Decimal("30000.00")
    assert out["shadow_ss"] == Decimal("20000.00")          # 10% of 200000
    assert out["shadow_equalization_due"] == Decimal("500.00")  # 1500 - 1000


def test_compute_shadow_zero_when_home_tax_exceeds_host():
    """When the home hypothetical tax already exceeds host tax, equalization
    due is floored at 0 (employee is never charged negative)."""
    out = payroll_rules.compute_shadow(
        taxable_host=Decimal("200000"),
        bases_host={"gross": Decimal("200000")},
        snapshot=_snapshot(),
        fx_rate=Decimal("0.05"),
        home_paye=Decimal("5000.00"),
        host_currency="TZS",
    )
    assert out["shadow_equalization_due"] == Decimal("0.00")


def test_compute_shadow_no_rules_is_zero():
    out = payroll_rules.compute_shadow(
        taxable_host=Decimal("200000"),
        bases_host={"gross": Decimal("200000")},
        snapshot=_snapshot(with_rules=False),
        fx_rate=Decimal("0.05"),
        home_paye=Decimal("1000.00"),
        host_currency="TZS",
    )
    assert out["shadow_tax"] == Decimal("0.00")
    assert out["shadow_ss"] == Decimal("0.00")


# ---------------------------------------------------------------------------
# FX snapshot (injectable fetch)
# ---------------------------------------------------------------------------


def _fake_bom(base, quote, as_of=None):
    return {"MUR": {"TZS": Decimal("0.05"), "MUR": Decimal("1"), "ZZK": None}}.get(base, {}).get(quote)


def test_build_run_fx_snapshot_e2e():
    snap = fx_service.build_run_fx_snapshot(
        base_currency="MUR",
        host_currencies={"TZ": "TZS", "KE": "KES", "MU": "MUR"},
        as_of=_dt.date(2026, 5, 1),
        fetch=lambda b, q, d: _fake_bom(b, q),
    )
    assert snap["source"] == "BOM"
    assert snap["base"] == "MUR"
    assert snap["rates"]["TZ"] == "0.05"
    assert snap["rates"]["MU"] == "1"        # same-currency => exact 1
    assert "KE" not in snap["rates"]          # no public rate => omitted
    assert "KE" in snap["unavailable"]
    assert fx_service.rate_for(snap, "TZ") == Decimal("0.05")
    assert fx_service.rate_for(snap, "KE") is None


def test_same_currency():
    assert fx_service.same_currency("mur", "MUR") is True
    assert fx_service.same_currency("MUR", "TZS") is False


# ---------------------------------------------------------------------------
# End-to-end: a MU payroll run + one TZ-shadowed payslip
# ---------------------------------------------------------------------------


def _seed_company(db):
    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)")); db.commit()
    sfx = uuid.uuid4().hex[:8]
    owner = User(user_type="company", email=f"sh-{sfx}@x.com", user_name=f"sh-{sfx}", password_hash="x")
    db.add(owner); db.flush()
    co = Company(user_id=owner.user_id, company_name=f"C{sfx}", email=f"co-{sfx}@x.com",
                 brn=f"SH_{sfx}", country_code="MU")
    db.add(co); db.flush()
    csv = ("first_name,last_name,email,job_title,start_date,base_salary,currency,work_days_per_week,pay_basis\n"
           f"W,{sfx},sw-{sfx}@x.com,Clerk,2024-01-01,36000,MUR,5,monthly\n").encode()
    imp.commit(db, co.company_id, imp.parse(csv, "s.csv"), actor_user_id=None)
    db.commit()
    wu = db.query(User).filter(User.email == f"sw-{sfx}@x.com").one()
    pu = db.query(PrivateUser).filter(PrivateUser.user_id == wu.user_id).one()
    return owner, co, pu


def _cleanup(db, co, owner_id):
    db.execute(sql_text("DELETE FROM employee_country_assignments WHERE created_by_user_id=:o"), {"o": owner_id})
    db.execute(sql_text("DELETE FROM payroll_runs WHERE company_id=:c"), {"c": co.company_id})
    db.execute(sql_text("DELETE FROM companies WHERE company_id=:c"), {"c": co.company_id})
    db.commit()


def test_shadow_end_to_end(db, _engine, seed_mu_rules, monkeypatch):
    from schema.payroll_schema import PayrollRunCreate

    # Central-bank fetch returns a stale-but-determined MUR/TZS rate for tests.
    monkeypatch.setattr(fx_service, "fetch_bom_rate", lambda base, quote, as_of=None: Decimal("0.05"))

    owner, co, pu = _seed_company(db)

    # Active mission to Tanzania starting before the run period.
    db.add(EmployeeCountryAssignment(
        private_user_id=pu.private_user_id, country_code="TZ", reason="mission",
        effective_from=_dt.date(2026, 4, 1), effective_to=None,
        created_by_user_id=owner.user_id))
    db.commit()

    run = payroll_engine.create_draft_run(db, PayrollRunCreate(
        company_id=co.company_id, period_start=_dt.date(2026, 5, 1),
        period_end=_dt.date(2026, 5, 31)), actor_user_id=owner.user_id)
    db.commit()

    # FX snapshot frozen on the run.
    assert run.fx_snapshot and run.fx_snapshot["rates"].get("TZ") == "0.05"
    assert run.fx_source == "BOM"

    ps = db.query(Payslip).filter(Payslip.payroll_run_id == run.id).one()
    assert ps.shadow_country_code == "TZ"
    assert ps.shadow_currency == "TZS"
    # home gross 36000 MUR -> host gross 36000 / 0.05 = 720000 TZS
    assert ps.shadow_gross == Decimal("720000.00")
    assert ps.shadow_taxable_income == Decimal("720000.00")
    # TZ shadow rules (placeholder) seeded in conftest:
    #   PAYE (monthly bands): 0-270k @0, 270-520k @9%, 520-760k @20%
    #   -> 250000*0.09 + 200000*0.20 = 62500
    assert ps.shadow_tax == Decimal("62500.00")
    #   NSSF_EE 10% on basic -> 720000*0.10
    assert ps.shadow_ss == Decimal("72000.00")
    # Tax equalization: host tax in home (62500*0.05=3125) minus home PAYE.
    # Home PAYE is 0 here (monthly gross 36000 < MU tax-free band) => 3125.
    assert ps.shadow_equalization_due == Decimal("3125.00")
    # Home figures are untouched by shadowing.
    assert ps.gross == Decimal("36000.00")
    assert ps.net_pay is not None and ps.net_pay > 0
    assert not any("shadow_missing_rules" in f for f in (run.compliance_flags or []))

    _cleanup(db, co, owner.user_id)