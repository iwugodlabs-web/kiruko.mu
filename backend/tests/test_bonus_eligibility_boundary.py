"""Fix 2 — EOY eligibility gate must not exclude same-year Jan-1 hires.

`bonus_engine._months_of_service` used to compute service as a raw
(year, month) tuple subtraction, which under-counts by exactly one month
for anyone hired on the 1st of a month: hired 2026-01-01, evaluated at
December's period_start=2026-12-01, gave 11 months (excluded) even though
that employee will have received all 12 calendar months' payslips (Jan
through Dec) by the time the December run executes. Coverage here pins
the exact boundary and the two adjacent cases that must NOT change.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

import pytest
from sqlalchemy.orm import Session

from services import bonus_engine


def _make_employee(db: Session, company_id: int, suffix: str, hire_date: date):
    from core.model import Job, PrivateUser, User

    owner = User(
        user_type="private",
        email=f"eoy-boundary-{suffix}@kontokaz.test",
        user_name=f"eoy-boundary-{suffix}",
        password_hash="x",
    )
    db.add(owner)
    db.flush()
    emp = PrivateUser(
        user_id=owner.user_id,
        first_name="Boundary",
        last_name=suffix,
        company_id=company_id,
        pass_port_number=f"EOY_{suffix}",
        role="employee",
    )
    db.add(emp)
    db.flush()
    db.add(Job(
        private_user_id=emp.private_user_id,
        company_id=company_id,
        job_title="Tester",
        employer_name="X",
        employer_brn="X",
        employer_email=f"eoy-boundary-{suffix}-emp@kontokaz.test",
        first_date_of_employment=datetime.combine(hire_date, datetime.min.time(), tzinfo=timezone.utc),
    ))
    db.flush()
    return emp


class TestMonthsOfServiceBoundary:
    def test_jan_1_hire_eligible_for_december_eoy(self, db: Session, test_company_id: int):
        emp = _make_employee(db, test_company_id, "jan1", date(2026, 1, 1))
        assert bonus_engine._months_of_service(emp, date(2026, 12, 1), db) == 12

    def test_jan_2_hire_still_ineligible_for_december_eoy(self, db: Session, test_company_id: int):
        emp = _make_employee(db, test_company_id, "jan2", date(2026, 1, 2))
        assert bonus_engine._months_of_service(emp, date(2026, 12, 1), db) == 11

    def test_dec_31_prior_year_hire_unaffected(self, db: Session, test_company_id: int):
        emp = _make_employee(db, test_company_id, "dec31", date(2025, 12, 31))
        assert bonus_engine._months_of_service(emp, date(2026, 12, 1), db) == 12


class TestEoyGratuityEndToEnd:
    def test_jan_1_hire_receives_december_gratuity(
        self, db: Session, test_company_id: int, test_employee_id: int, seed_mu_rules, clean_payroll_state,
    ):
        """The pure helper is correct in isolation (above) — this proves the
        fix actually reaches the real draft/finalize path, not just the unit
        function. test_employee_id is pulled in only to force creation of the
        company's SalaryStructure (built as a side effect of that fixture) —
        the run's assertion is scoped to our own fresh employee below."""
        from core.model import EmployeeSalaryAssignment, SalaryStructure
        from schema.payroll_schema import PayrollRunCreate
        from services import payroll_engine

        emp = _make_employee(db, test_company_id, "e2e", date(2026, 1, 1))
        struct = (
            db.query(SalaryStructure)
            .filter(SalaryStructure.company_id == test_company_id)
            .first()
        )
        db.add(EmployeeSalaryAssignment(
            private_user_id=emp.private_user_id,
            structure_id=struct.id,
            currency="MUR",
            effective_from=date(2026, 1, 1),
            notes="EOY boundary e2e fixture",
        ))
        db.commit()

        draft = payroll_engine.create_draft_run(
            db,
            PayrollRunCreate(
                company_id=test_company_id,
                period_start=date(2026, 12, 1),
                period_end=date(2026, 12, 31),
            ),
            actor_user_id=None,
        )
        db.commit()
        final = payroll_engine.finalize_run(db, draft.id, actor_user_id=None)
        db.commit()

        ps = next(p for p in final.payslips if p.private_user_id == emp.private_user_id)
        assert ps.bonus > 0, "Jan-1 hire should be eligible for the December EOY gratuity"
