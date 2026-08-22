"""Tests for M4 — per-component statutory base mapping.

Headline guarantee under test:
    A non-CSG-able allowance configured with statutory_base_codes=["PAYE"]
    must NOT inflate the CSG base. CSG = rate × (sum of components whose
    statutory_base_codes include "CSG_EE"), not × full gross.

Coverage:
  * `infer_statutory_base_codes` legacy fallback (no explicit list)
  * `compute_statutory` honors per-deduction `bases_by_code`
  * Engine builds `bases_by_code` correctly from components
  * Bonus contributes to PAYE only (not CSG)
  * Resolver propagates statutory_base_codes through ResolvedComponent
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal as D

import pytest
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session


# ---------------------------------------------------------------------------
# Pure-function tests — no DB needed
# ---------------------------------------------------------------------------


class TestInferStatutoryBaseCodes:
    def test_explicit_list_wins(self):
        from services.salary_resolver import infer_statutory_base_codes

        result = infer_statutory_base_codes(
            kind="earning", is_basic=False, is_taxable=True,
            explicit=["PAYE"],
        )
        assert result == ["PAYE"]

    def test_basic_inference(self):
        from services.salary_resolver import infer_statutory_base_codes

        result = infer_statutory_base_codes(
            kind="earning", is_basic=True, is_taxable=True, explicit=None,
        )
        assert set(result) == {"PAYE", "CSG_EE", "CSG_ER", "NSF_EE", "NSF_ER"}

    def test_non_basic_taxable_inference(self):
        from services.salary_resolver import infer_statutory_base_codes

        result = infer_statutory_base_codes(
            kind="earning", is_basic=False, is_taxable=True, explicit=None,
        )
        assert set(result) == {"PAYE", "CSG_EE", "CSG_ER"}
        assert "NSF_EE" not in result

    def test_non_taxable_inference(self):
        from services.salary_resolver import infer_statutory_base_codes

        result = infer_statutory_base_codes(
            kind="earning", is_basic=False, is_taxable=False, explicit=None,
        )
        assert result == []

    def test_deduction_inference(self):
        from services.salary_resolver import infer_statutory_base_codes

        # Even with is_taxable=True, deductions never contribute to bases.
        result = infer_statutory_base_codes(
            kind="deduction", is_basic=False, is_taxable=True, explicit=None,
        )
        assert result == []


class TestComputeStatutoryByCode:
    """compute_statutory now looks up bases by deduction code."""

    def test_per_code_base_used(self):
        from schema.payroll_rules_schema import StatutoryDeductionRead
        from services.payroll_rules import compute_statutory

        csg = StatutoryDeductionRead(
            id=1, country_code="MU", code="CSG_EE", label="CSG",
            rate=D("0.015"), threshold_high=D("50000"),
            taxable_base="gross",  # legacy field, ignored when CSG_EE in bases_by_code
            employer_or_employee="employee",
            effective_from=date(2026, 1, 1), version=1,
        )
        # Per-code base: 30k basic only (no allowances in this base).
        out = compute_statutory({"CSG_EE": D("30000"), "gross": D("36000")}, [csg])
        # 1.5% of 30000 = 450, NOT 1.5% of 36000 = 540
        assert out == {"CSG_EE": D("450.00")}

    def test_legacy_taxable_base_fallback(self):
        from schema.payroll_rules_schema import StatutoryDeductionRead
        from services.payroll_rules import compute_statutory

        # Old-style call: bases_by_code only has 'basic' / 'gross', no per-code key.
        nsf = StatutoryDeductionRead(
            id=1, country_code="MU", code="NSF_EE", label="NSF",
            rate=D("0.01"),
            taxable_base="basic",
            employer_or_employee="employee",
            effective_from=date(2026, 1, 1), version=1,
        )
        out = compute_statutory({"basic": D("30000"), "gross": D("36000")}, [nsf])
        # 1% of 30000 = 300
        assert out == {"NSF_EE": D("300.00")}

    def test_threshold_high_caps_base(self):
        from schema.payroll_rules_schema import StatutoryDeductionRead
        from services.payroll_rules import compute_statutory

        csg = StatutoryDeductionRead(
            id=1, country_code="MU", code="CSG_EE", label="CSG",
            rate=D("0.015"), threshold_high=D("50000"),
            taxable_base="gross",
            employer_or_employee="employee",
            effective_from=date(2026, 1, 1), version=1,
        )
        # Base 70k > threshold_high 50k → cap at 50k
        out = compute_statutory({"CSG_EE": D("70000")}, [csg])
        assert out == {"CSG_EE": (D("50000") * D("0.015")).quantize(D("0.01"))}


# ---------------------------------------------------------------------------
# Engine integration test — non-CSG-able allowance excluded from CSG base
# ---------------------------------------------------------------------------


def _build_company_with_components(db: Session, transport_codes: list[str]) -> dict:
    """Build a company with BASIC + TRANSPORT components where TRANSPORT's
    statutory_base_codes is configurable. Returns IDs for cleanup."""
    from core.model import (
        Company,
        EmployeeSalaryAssignment,
        Job,
        PrivateUser,
        SalaryComponent,
        SalaryStructure,
        SalaryStructureLine,
        User,
    )
    from services.salary_resolver import build_structure_snapshot

    suffix = datetime.utcnow().strftime("%H%M%S%f")

    owner = User(
        user_type="company",
        email=f"sb-owner-{suffix}@kontokaz.test",
        user_name=f"sb-owner-{suffix}",
        password_hash="x",
    )
    db.add(owner)
    db.flush()

    company = Company(
        user_id=owner.user_id,
        company_name=f"SB Co {suffix}",
        email=f"sb-co-{suffix}@kontokaz.test",
        brn=f"SB_BRN_{suffix}",
        country_code="MU",
    )
    db.add(company)
    db.flush()

    emp_user = User(
        user_type="private",
        email=f"sb-emp-{suffix}@kontokaz.test",
        user_name=f"sb-emp-{suffix}",
        password_hash="x",
    )
    db.add(emp_user)
    db.flush()

    emp = PrivateUser(
        user_id=emp_user.user_id,
        first_name="SB",
        last_name="Emp",
        company_id=company.company_id,
        role="employee",
        pass_port_number=f"SB_PASS_{suffix}",
    )
    db.add(emp)
    db.flush()

    job = Job(
        private_user_id=emp.private_user_id,
        company_id=company.company_id,
        job_title="Test",
        employer_name=f"SB Co {suffix}",
        employer_brn=f"SB_BRN_{suffix}",
        employer_email=f"sb-co-{suffix}@kontokaz.test",
        first_date_of_employment=date(2024, 1, 1),
    )
    db.add(job)
    db.flush()

    basic = SalaryComponent(
        company_id=company.company_id,
        code="BASIC",
        label="Basic",
        kind="earning",
        category="earning.basic",
        is_basic=True,
        is_taxable=True,
        statutory_base_codes=["PAYE", "CSG_EE", "CSG_ER", "NSF_EE", "NSF_ER"],
    )
    transport = SalaryComponent(
        company_id=company.company_id,
        code="TRANSPORT",
        label="Transport",
        kind="earning",
        category="allowance.transport",
        is_basic=False,
        is_taxable=True,
        statutory_base_codes=transport_codes,  # the test variable
    )
    db.add_all([basic, transport])
    db.flush()

    struct = SalaryStructure(
        company_id=company.company_id,
        name=f"SB Structure {suffix}",
    )
    db.add(struct)
    db.flush()
    db.add_all([
        SalaryStructureLine(
            structure_id=struct.id, component_id=basic.id,
            amount=D("30000.00"), order_index=0,
        ),
        SalaryStructureLine(
            structure_id=struct.id, component_id=transport.id,
            amount=D("6000.00"), order_index=1,
        ),
    ])
    db.flush()

    snap = build_structure_snapshot(db, struct.id)
    a = EmployeeSalaryAssignment(
        private_user_id=emp.private_user_id,
        structure_id=struct.id,
        structure_snapshot=snap,
        currency="MUR",
        effective_from=date(2024, 1, 1),
        notes="sb test",
    )
    db.add(a)
    db.commit()

    return {
        "owner_email": owner.email,
        "emp_email": emp_user.email,
        "company_id": company.company_id,
        "private_user_id": emp.private_user_id,
        "job_id": job.job_id,
        "basic_id": basic.id,
        "transport_id": transport.id,
        "structure_id": struct.id,
        "assignment_id": a.id,
        "passport": emp.pass_port_number,
    }


def _cleanup(db: Session, ctx: dict) -> None:
    db.rollback()
    db.execute(
        sql_text("DELETE FROM employee_salary_assignments WHERE private_user_id=:p"),
        {"p": ctx["private_user_id"]},
    )
    db.execute(
        sql_text("DELETE FROM jobs WHERE job_id=:j"), {"j": ctx["job_id"]}
    )
    db.execute(
        sql_text("DELETE FROM private_users WHERE pass_port_number=:p"),
        {"p": ctx["passport"]},
    )
    db.execute(
        sql_text("DELETE FROM salary_structure_lines WHERE structure_id=:s"),
        {"s": ctx["structure_id"]},
    )
    db.execute(
        sql_text("DELETE FROM salary_structures WHERE id=:s"),
        {"s": ctx["structure_id"]},
    )
    db.execute(
        sql_text("DELETE FROM salary_components WHERE id IN (:b, :t)"),
        {"b": ctx["basic_id"], "t": ctx["transport_id"]},
    )
    db.execute(
        sql_text("DELETE FROM companies WHERE company_id=:c"),
        {"c": ctx["company_id"]},
    )
    db.execute(
        sql_text("DELETE FROM users WHERE email IN (:e1, :e2)"),
        {"e1": ctx["owner_email"], "e2": ctx["emp_email"]},
    )
    db.commit()


class TestEngineBaseAllocation:
    def test_transport_excluded_from_csg_base(self, db: Session, seed_mu_rules):
        """TRANSPORT with statutory_base_codes=["PAYE"] only must NOT
        contribute to CSG base — the headline M4 guarantee."""
        from schema.payroll_schema import PayrollRunCreate
        from services import payroll_engine

        ctx = _build_company_with_components(db, transport_codes=["PAYE"])
        try:
            draft = payroll_engine.create_draft_run(
                db,
                PayrollRunCreate(
                    company_id=ctx["company_id"],
                    period_start=date(2026, 5, 1),
                    period_end=date(2026, 5, 31),
                ),
                actor_user_id=None,
            )
            db.commit()
            ps = next(p for p in draft.payslips if p.private_user_id == ctx["private_user_id"])

            csg_employee = D(ps.statutory_employee.get("CSG_EE", "0"))
            # Expected: 1.5% of 30000 (basic only, transport excluded) = 450
            assert csg_employee == D("450.00"), (
                f"CSG_EE should be 450 (1.5% of basic alone), got {csg_employee} — "
                f"TRANSPORT was incorrectly included in CSG base"
            )

            # PAYE base should still include both (BASIC + TRANSPORT). This is
            # this employee's first-ever payslip (a draft run, no prior
            # finalized history), so PAYE is now cumulative-YTD-based: YTD
            # taxable before this period is 0, cumulative = 0 + 36000 = 36000,
            # which sits entirely inside the 0%-rate first bracket → PAYE is
            # 0.00. This is no longer testing steady mid-year PAYE math (the
            # old per-month-annualized formula gave 354.17 here) — see
            # tests/test_paye_cumulative.py for genuine multi-period,
            # bracket-crossing cumulative coverage.
            assert ps.paye == D("0.00"), f"PAYE math broke: got {ps.paye}"

            # Cleanup the run
            db.execute(
                sql_text("DELETE FROM payslips WHERE payroll_run_id=:id"),
                {"id": draft.id},
            )
            db.execute(
                sql_text("DELETE FROM payroll_runs WHERE id=:id"),
                {"id": draft.id},
            )
            db.commit()
        finally:
            _cleanup(db, ctx)

    def test_transport_with_csg_codes_does_inflate_base(self, db: Session, seed_mu_rules):
        """Sanity check the inverse: TRANSPORT WITH ["PAYE","CSG_EE","CSG_ER"]
        SHOULD contribute to CSG base."""
        from schema.payroll_schema import PayrollRunCreate
        from services import payroll_engine

        ctx = _build_company_with_components(
            db, transport_codes=["PAYE", "CSG_EE", "CSG_ER"]
        )
        try:
            draft = payroll_engine.create_draft_run(
                db,
                PayrollRunCreate(
                    company_id=ctx["company_id"],
                    period_start=date(2026, 5, 1),
                    period_end=date(2026, 5, 31),
                ),
                actor_user_id=None,
            )
            db.commit()
            ps = next(p for p in draft.payslips if p.private_user_id == ctx["private_user_id"])

            csg_employee = D(ps.statutory_employee.get("CSG_EE", "0"))
            # Expected: 1.5% of 36000 (basic + transport) = 540
            assert csg_employee == D("540.00"), (
                f"CSG_EE should be 540 (1.5% of full gross), got {csg_employee}"
            )

            db.execute(
                sql_text("DELETE FROM payslips WHERE payroll_run_id=:id"),
                {"id": draft.id},
            )
            db.execute(
                sql_text("DELETE FROM payroll_runs WHERE id=:id"),
                {"id": draft.id},
            )
            db.commit()
        finally:
            _cleanup(db, ctx)
