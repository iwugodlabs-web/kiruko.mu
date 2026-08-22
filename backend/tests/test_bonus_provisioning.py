"""M23 — Bonus provisions + monthly accrual.

Verifies the monthly cron upserts one BonusProvision row per active
employee, that re-running is idempotent, that ineligible employees get
a zero row (still counted), and that get_liability_summary aggregates
correctly across employees.
"""

from datetime import date, datetime, timezone, timedelta
from decimal import Decimal

import pytest

from services import bonus_provisioning


@pytest.fixture()
def finalized_payslip_for_january(db, seed_mu_rules, test_employee, test_company, clean_payroll_state):
    """Create a finalized payroll run for January 2026 so YTD earnings
    have something to sum."""
    from schema.payroll_schema import PayrollRunCreate
    from services import payroll_engine

    payload = PayrollRunCreate(
        company_id=test_company.company_id,
        period_start=date(2026, 1, 1),
        period_end=date(2026, 1, 31),
        notes="M23 fixture",
    )
    run = payroll_engine.create_draft_run(db, payload, actor_user_id=None)
    db.flush()
    payroll_engine.finalize_run(db, run.id, actor_user_id=None)
    db.flush()
    return run


class TestProvisionForMonth:
    def test_writes_one_row_per_employee(
        self, db, seed_mu_rules, test_company, finalized_payslip_for_january,
    ):
        from core.model import BonusProvision, PrivateUser

        result = bonus_provisioning.provision_for_month(
            db, company_id=test_company.company_id, year=2026, month=1
        )
        db.flush()

        emp_count = (
            db.query(PrivateUser).filter(PrivateUser.company_id == test_company.company_id).count()
        )
        provision_count = (
            db.query(BonusProvision)
            .filter(
                BonusProvision.company_id == test_company.company_id,
                BonusProvision.year == 2026,
                BonusProvision.month == 1,
            )
            .count()
        )
        assert provision_count == emp_count
        assert result["processed"] == emp_count
        assert result["year"] == 2026 and result["month"] == 1

    def test_twelfth_of_annual_math(
        self, db, seed_mu_rules, test_company, test_employee, finalized_payslip_for_january,
    ):
        from core.model import BonusProvision

        bonus_provisioning.provision_for_month(
            db, company_id=test_company.company_id, year=2026, month=1
        )
        db.flush()

        prov = (
            db.query(BonusProvision)
            .filter(
                BonusProvision.private_user_id == test_employee.private_user_id,
                BonusProvision.year == 2026,
                BonusProvision.month == 1,
            )
            .one()
        )
        # Test fixture pays gross 36000 (basic 30k + allowance 6k), so YTD
        # through Jan = 36000, accrued = 36000/12 = 3000.
        assert Decimal(prov.ytd_earnings) == Decimal("36000.00")
        assert Decimal(prov.accrued_amount) == Decimal("3000.00")
        # Snapshot captured the rule.
        assert prov.formula_snapshot["formula"] == "twelfth_of_annual"
        assert prov.formula_snapshot["bonus_code"] == "EOY_GRATUITY"

    def test_idempotent_rerun_overwrites(
        self, db, seed_mu_rules, test_company, finalized_payslip_for_january,
    ):
        from core.model import BonusProvision

        bonus_provisioning.provision_for_month(
            db, company_id=test_company.company_id, year=2026, month=1
        )
        db.flush()
        count_after_first = db.query(BonusProvision).filter(
            BonusProvision.company_id == test_company.company_id,
            BonusProvision.year == 2026, BonusProvision.month == 1,
        ).count()

        bonus_provisioning.provision_for_month(
            db, company_id=test_company.company_id, year=2026, month=1
        )
        db.flush()
        count_after_second = db.query(BonusProvision).filter(
            BonusProvision.company_id == test_company.company_id,
            BonusProvision.year == 2026, BonusProvision.month == 1,
        ).count()

        assert count_after_first == count_after_second  # No duplicates.


class TestLiabilitySummary:
    def test_empty_company_returns_zero(self, db, seed_mu_rules, test_company):
        result = bonus_provisioning.get_liability_summary(
            db, company_id=test_company.company_id, year=2027,  # year with no provisions
        )
        assert result["total_liability"] == "0.00"
        assert result["headcount_provisioned"] == 0
        assert result["as_of_month"] is None
        assert result["by_employee"] == []

    def test_summary_after_provisioning(
        self, db, seed_mu_rules, test_company, finalized_payslip_for_january,
    ):
        bonus_provisioning.provision_for_month(
            db, company_id=test_company.company_id, year=2026, month=1
        )
        db.flush()

        summary = bonus_provisioning.get_liability_summary(
            db, company_id=test_company.company_id, year=2026,
        )
        assert summary["as_of_month"] == 1
        assert summary["headcount_provisioned"] >= 1
        # Total liability is at least 3000 (test_employee's accrued).
        assert Decimal(summary["total_liability"]) >= Decimal("3000.00")
        # The breakdown lists at least the test employee.
        emp_ids = {row["private_user_id"] for row in summary["by_employee"]}
        from core.model import PrivateUser
        # Some employee in the breakdown
        assert len(emp_ids) >= 1


class TestEligibilityFilter:
    def test_under_min_service_gets_zero(
        self, db, seed_mu_rules, test_company, finalized_payslip_for_january,
    ):
        """An employee whose start_date is too recent gets a zero row, still
        counted but flagged as ineligible."""
        from core.model import (
            BonusProvision, EmployeeSalaryAssignment, Job, PrivateUser, SalaryStructure, User,
        )

        # Create a fresh-hire employee whose tenure is well below 12 months.
        owner = User(
            user_type="private",
            email="newhire-m23@kontokaz.test",
            user_name="newhire-m23",
            password_hash="x",
        )
        db.add(owner); db.flush()
        emp = PrivateUser(
            user_id=owner.user_id,
            first_name="Fresh", last_name="Hire",
            company_id=test_company.company_id,
            pass_port_number="M23_NEWHIRE",
            role="employee",
        )
        db.add(emp); db.flush()
        # Hired 2 weeks before period end → fails ≥12mo eligibility.
        job = Job(
            private_user_id=emp.private_user_id,
            company_id=test_company.company_id,
            job_title="Junior",
            employer_name="X", employer_brn="X",
            employer_email="newhire-m23-emp@kontokaz.test",
            first_date_of_employment=datetime(2026, 1, 14, tzinfo=timezone.utc),
        )
        db.add(job); db.flush()
        # Reuse the existing structure for the company.
        struct = (
            db.query(SalaryStructure)
            .filter(SalaryStructure.company_id == test_company.company_id)
            .first()
        )
        db.add(EmployeeSalaryAssignment(
            private_user_id=emp.private_user_id,
            structure_id=struct.id,
            currency="MUR",
            effective_from=date(2026, 1, 14),
            notes="M23 ineligible fixture",
        ))
        db.flush()

        result = bonus_provisioning.provision_for_month(
            db, company_id=test_company.company_id, year=2026, month=1
        )
        db.flush()

        prov = (
            db.query(BonusProvision)
            .filter(BonusProvision.private_user_id == emp.private_user_id,
                    BonusProvision.year == 2026, BonusProvision.month == 1)
            .one()
        )
        assert Decimal(prov.accrued_amount) == Decimal("0.00")
        assert result["ineligible"] >= 1

        # Cleanup — delete in dependency order. The model has a pre-existing
        # contradiction (jobs.private_user_id is NOT NULL but FK is SET NULL
        # on delete), so the PrivateUser must go after its dependents.
        from core.model import EmployeeSalaryAssignment as _ESA, Job as _Job
        db.query(BonusProvision).filter(
            BonusProvision.private_user_id == emp.private_user_id
        ).delete(synchronize_session=False)
        db.query(_ESA).filter(_ESA.private_user_id == emp.private_user_id).delete(synchronize_session=False)
        db.query(_Job).filter(_Job.private_user_id == emp.private_user_id).delete(synchronize_session=False)
        db.delete(emp)
        db.delete(owner)
        db.flush()
