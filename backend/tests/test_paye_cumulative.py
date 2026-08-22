"""Fix 1 — PAYE must be cumulative over the fiscal year, not per-month-isolated.

The old formula annualized each month in isolation (x12, bracket lookup,
/12) with no reference to prior periods. The correct MRA PAYE-as-you-earn
approach: tax is computed on year-to-date taxable income at each pay run,
and only the delta over tax already withheld this fiscal year is deducted.

MU's fiscal year is July-June (Country.fiscal_year_start = '07-01'). These
tests explicitly install the FY2025/26 bracket set (effective 2026-07-01,
0-500k @ 0%, 500k-1m @ 10%, 1m-12m @ 20%, 12m+ @ 35%) rather than relying on
whichever set the test bootstrap happens to leave active — other test files
(test_mu_fy2025_26_rates.py) also call this same idempotent install(), and
since it's a one-way supersede against a shared session-scoped test DB,
suite-run order would otherwise silently change which bracket set is active
here. Installing it ourselves makes this test's numbers deterministic
regardless of what ran before it.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal as D

import pytest
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from scripts.seed_mu_payroll_rules_2025_26 import install
from services import payroll_rules
from services.payroll_rules import RuleSupersedeError


def _ensure_fy2025_26_installed(db: Session) -> None:
    """install()'s own idempotency check (StatutoryDeduction-based) doesn't
    reliably see a FY2025/26 install already committed by another test file
    in the same full-suite run (test_mu_fy2025_26_rates.py also installs it,
    session-visibility being what it is across separate test fixtures) — it
    can attempt to re-supersede TaxBracketSet and hit "must be strictly
    after prior effective_from". Either outcome (we installed it, or someone
    else already did) leaves the rates active, which is all this test needs."""
    try:
        install(db)
        db.commit()
    except RuleSupersedeError:
        db.rollback()


def _build_flat_salary_company(db: Session, monthly_taxable: D, hire_date: date) -> dict:
    """A company with a single, fully-taxable BASIC component — no allowances,
    no overtime complexity — so cumulative PAYE math is easy to hand-verify.

    `hire_date` matters: an employee with >=12 months' service gets an
    auto-injected, taxable EOY gratuity bonus component on their December
    payslip (see bonus_engine), which would silently inflate the taxable
    income these tests hand-derive PAYE against. Callers should hire the
    employee at (or after) the test window's own start so they stay under
    the 12-month EOY threshold for the whole window under test."""
    from core.model import (
        Company, EmployeeSalaryAssignment, Job, PrivateUser,
        SalaryComponent, SalaryStructure, SalaryStructureLine, User,
    )
    from services.salary_resolver import build_structure_snapshot

    suffix = datetime.utcnow().strftime("%H%M%S%f")

    owner = User(
        user_type="company", email=f"paye-owner-{suffix}@kontokaz.test",
        user_name=f"paye-owner-{suffix}", password_hash="x",
    )
    db.add(owner)
    db.flush()

    company = Company(
        user_id=owner.user_id, company_name=f"PAYE Cumulative Co {suffix}",
        email=f"paye-co-{suffix}@kontokaz.test", brn=f"PAYE_BRN_{suffix}",
        country_code="MU",
    )
    db.add(company)
    db.flush()

    emp_user = User(
        user_type="private", email=f"paye-emp-{suffix}@kontokaz.test",
        user_name=f"paye-emp-{suffix}", password_hash="x",
    )
    db.add(emp_user)
    db.flush()

    emp = PrivateUser(
        user_id=emp_user.user_id, first_name="Paye", last_name="Emp",
        company_id=company.company_id, role="employee",
        pass_port_number=f"PAYE_PASS_{suffix}",
    )
    db.add(emp)
    db.flush()

    job = Job(
        private_user_id=emp.private_user_id, company_id=company.company_id,
        job_title="Test", employer_name=f"PAYE Co {suffix}",
        employer_brn=f"PAYE_BRN_{suffix}", employer_email=f"paye-co-{suffix}@kontokaz.test",
        first_date_of_employment=hire_date,
    )
    db.add(job)
    db.flush()

    basic = SalaryComponent(
        company_id=company.company_id, code="BASIC", label="Basic",
        kind="earning", category="earning.basic", is_basic=True, is_taxable=True,
        statutory_base_codes=["PAYE", "CSG_EE", "CSG_ER", "NSF_EE", "NSF_ER"],
    )
    db.add(basic)
    db.flush()

    struct = SalaryStructure(company_id=company.company_id, name=f"PAYE Structure {suffix}")
    db.add(struct)
    db.flush()
    db.add(SalaryStructureLine(
        structure_id=struct.id, component_id=basic.id, amount=monthly_taxable, order_index=0,
    ))
    db.flush()

    snap = build_structure_snapshot(db, struct.id)
    assignment = EmployeeSalaryAssignment(
        private_user_id=emp.private_user_id, structure_id=struct.id,
        structure_snapshot=snap, currency="MUR",
        effective_from=hire_date, notes="paye cumulative test",
    )
    db.add(assignment)
    db.commit()

    return {
        "owner_email": owner.email, "emp_email": emp_user.email,
        "company_id": company.company_id, "private_user_id": emp.private_user_id,
        "job_id": job.job_id, "basic_id": basic.id,
        "structure_id": struct.id, "assignment_id": assignment.id,
        "passport": emp.pass_port_number,
    }


def _cleanup(db: Session, ctx: dict) -> None:
    db.rollback()
    db.execute(sql_text("DELETE FROM payslips WHERE private_user_id=:p"), {"p": ctx["private_user_id"]})
    db.execute(sql_text("DELETE FROM payroll_runs WHERE company_id=:c"), {"c": ctx["company_id"]})
    db.execute(sql_text("DELETE FROM employee_salary_assignments WHERE private_user_id=:p"), {"p": ctx["private_user_id"]})
    db.execute(sql_text("DELETE FROM jobs WHERE job_id=:j"), {"j": ctx["job_id"]})
    db.execute(sql_text("DELETE FROM private_users WHERE pass_port_number=:p"), {"p": ctx["passport"]})
    db.execute(sql_text("DELETE FROM salary_structure_lines WHERE structure_id=:s"), {"s": ctx["structure_id"]})
    db.execute(sql_text("DELETE FROM salary_structures WHERE id=:s"), {"s": ctx["structure_id"]})
    db.execute(sql_text("DELETE FROM salary_components WHERE id=:b"), {"b": ctx["basic_id"]})
    db.execute(sql_text("DELETE FROM companies WHERE company_id=:c"), {"c": ctx["company_id"]})
    db.execute(sql_text("DELETE FROM users WHERE email IN (:e1, :e2)"), {"e1": ctx["owner_email"], "e2": ctx["emp_email"]})
    db.commit()


def _run_month(db: Session, company_id: int, year: int, month: int):
    from schema.payroll_schema import PayrollRunCreate
    from services import payroll_engine
    import calendar

    last_day = calendar.monthrange(year, month)[1]
    draft = payroll_engine.create_draft_run(
        db,
        PayrollRunCreate(
            company_id=company_id,
            period_start=date(year, month, 1),
            period_end=date(year, month, last_day),
        ),
        actor_user_id=None,
    )
    db.commit()
    final = payroll_engine.finalize_run(db, draft.id, actor_user_id=None)
    db.commit()
    return final


class TestPayeTelescopesToAnnualTotal:
    def test_paye_telescopes_to_annual_total_within_fiscal_year(self, db: Session, seed_mu_rules):
        _ensure_fy2025_26_installed(db)
        ctx = _build_flat_salary_company(db, D("80000.00"), date(2026, 7, 1))
        try:
            months = [(2026, m) for m in range(7, 13)] + [(2027, m) for m in range(1, 7)]
            paye_by_month: list[D] = []
            for year, month in months:
                final = _run_month(db, ctx["company_id"], year, month)
                ps = next(p for p in final.payslips if p.private_user_id == ctx["private_user_id"])
                paye_by_month.append(D(ps.paye))

            # Hand-derived (FY2025/26 bands 0-500k@0%, 500k-1m@10%; cumulative
            # = 80000*m): zero through month 6 (480k), crosses 500k in month 7
            # (560k), then a flat 8000/mo delta as each month's full 80k slice
            # sits entirely inside the 10% band through month 12 (960k).
            expected = [D("0.00")] * 6 + [D("6000.00")] + [D("8000.00")] * 5
            assert paye_by_month == expected, f"got {paye_by_month}"

            snap = payroll_rules.resolve(db, "MU", date(2027, 6, 1))
            direct_annual = payroll_rules.compute_paye(D("960000.00"), list(snap.tax_bracket_set.brackets))
            assert sum(paye_by_month, D("0.00")) == direct_annual == D("46000.00"), (
                "sum of 12 monthly PAYE values must equal the annual total computed "
                "once directly — the core telescoping correctness invariant"
            )
        finally:
            _cleanup(db, ctx)

    def test_paye_resets_at_fiscal_year_boundary(self, db: Session, seed_mu_rules):
        _ensure_fy2025_26_installed(db)
        ctx = _build_flat_salary_company(db, D("80000.00"), date(2026, 7, 1))
        try:
            for year, month in [(2026, m) for m in range(7, 13)] + [(2027, m) for m in range(1, 7)]:
                _run_month(db, ctx["company_id"], year, month)

            # July 2027 starts a fresh fiscal year — YTD-before must reset to 0,
            # not continue accumulating from June 2027's cumulative total. A
            # lone 80k month sits entirely inside the 0-500k band, so PAYE is 0.
            final_july = _run_month(db, ctx["company_id"], 2027, 7)
            ps_july = next(p for p in final_july.payslips if p.private_user_id == ctx["private_user_id"])

            snap = payroll_rules.resolve(db, "MU", date(2027, 7, 1))
            standalone = payroll_rules.compute_paye(D("80000.00"), list(snap.tax_bracket_set.brackets))
            assert D(ps_july.paye) == standalone == D("0.00")
        finally:
            _cleanup(db, ctx)
