"""M4 — overtime engine wired into payroll compute (integration).

Builds a purpose-made hourly employee with time logs spanning a 50-hour
week (incl. one over-threshold day) and a rest-day shift, creates a draft
run, and asserts the payslip carries bucketed OT components with the right
multipliers + is_basic flags.
"""

from __future__ import annotations

from datetime import date, datetime, time, timezone
from decimal import Decimal

import pytest

from core.model import (
    Company,
    EmployeeSalaryAssignment,
    Job,
    PayrollRun,
    Payslip,
    PrivateUser,
    Salary,
    SalaryComponent,
    SalaryStructure,
    SalaryStructureLine,
    TimeLog,
    User,
)
from schema.payroll_schema import PayrollRunCreate
from services import payroll_engine


def _utc(y, m, d, hh):
    return datetime(y, m, d, hh, 0, tzinfo=timezone.utc)


@pytest.fixture()
def hourly_employee(db, test_company_id):
    """An hourly-paid employee (MUR 200/hr) with an active assignment.
    Distinct from the shared monthly fixture so we don't disturb it.
    Idempotent: reuse if a prior test (or run) already created it."""
    existing = (
        db.query(PrivateUser)
        .filter(PrivateUser.pass_port_number == "OT_HOURLY_FIXTURE")
        .one_or_none()
    )
    if existing is not None:
        return existing.private_user_id

    owner = User(
        user_type="private",
        email="ot-hourly@kontokaz.test",
        user_name="ot-hourly",
        password_hash="x",
    )
    db.add(owner)
    db.flush()
    priv = PrivateUser(
        user_id=owner.user_id,
        first_name="Otto",
        last_name="Verteim",
        company_id=test_company_id,
        pass_port_number="OT_HOURLY_FIXTURE",
        role="employee",
    )
    db.add(priv)
    db.flush()
    job = Job(
        private_user_id=priv.private_user_id,
        company_id=test_company_id,
        job_title="Hourly worker",
        employer_name="Kiruko Test Co.",
        employer_brn="OT_BRN",
        employer_email="ot-employer@kontokaz.test",
        first_date_of_employment=date(2024, 1, 1),
        work_days=["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        weekly_rest_day_dow=7,
        overtime_eligibility="HOURLY",
    )
    db.add(job)
    db.flush()
    db.add(Salary(
        job_id=job.job_id,
        monthly_hours="195",
        salary=Decimal("0"),
        hourly_rate=Decimal("200.00"),
        pay_basis="hourly",
    ))
    # Reuse the company's single basic component (uq_salary_component_one_basic
    # allows only one per company). Create it only if absent.
    basic = (
        db.query(SalaryComponent)
        .filter(SalaryComponent.company_id == test_company_id)
        .filter(SalaryComponent.is_basic.is_(True))
        .first()
    )
    if basic is None:
        basic = SalaryComponent(
            company_id=test_company_id, code="BASIC_OT", label="Basic",
            kind="earning", category="earning.basic", is_basic=True, is_taxable=True,
        )
        db.add(basic)
        db.flush()
    structure = SalaryStructure(company_id=test_company_id, name="Hourly Struct", description="x")
    db.add(structure)
    db.flush()
    db.add(SalaryStructureLine(
        structure_id=structure.id, component_id=basic.id,
        amount=Decimal("0"), order_index=0,
    ))
    db.add(EmployeeSalaryAssignment(
        private_user_id=priv.private_user_id, structure_id=structure.id,
        currency="MUR", effective_from=date(2024, 1, 1), notes="hourly fixture",
    ))
    db.commit()
    return priv.private_user_id


def _clear_logs(db, priv_id):
    db.query(TimeLog).filter(TimeLog.private_user_id == priv_id).delete()
    db.commit()


def _clear_runs(db, company_id):
    """Wipe payroll runs + payslips for a company. clean_payroll_state's
    teardown is broken in this DB (unconditional DELETE FROM audit_logs hits
    the append-only trigger and rolls back), so tests that reuse a period
    must self-clean at the start."""
    from sqlalchemy import text as _text
    db.execute(_text(
        "DELETE FROM payslips WHERE payroll_run_id IN "
        "(SELECT id FROM payroll_runs WHERE company_id = :cid)"
    ), {"cid": company_id})
    db.execute(_text("DELETE FROM payroll_runs WHERE company_id = :cid"), {"cid": company_id})
    db.commit()


def _add_log(db, priv_id, job_id, start, end, is_ot=False, ot_confirmed=False):
    db.add(TimeLog(
        job_id=job_id,
        private_user_id=priv_id,
        start_time=start,
        end_time=end,
        location={"lat": 0, "lng": 0},
        is_overtime=is_ot,
        overtime_confirmed_by_employer=ot_confirmed,
        admin_approved=True,
    ))


class TestOvertimeWiredIntoDraftRun:
    def test_50hr_week_plus_rest_day_buckets_appear(
        self, db, hourly_employee, test_company_id, clean_payroll_state,
    ):
        priv_id = hourly_employee
        job = db.query(Job).filter(Job.private_user_id == priv_id).first()
        _clear_runs(db, test_company_id)
        _clear_logs(db, priv_id)

        # Week of Mon 4 May – Sun 10 May 2026.
        # 10h × 5 weekdays = 50h → 45 REG + 5 OT_WEEKDAY_T1.
        for day_off in range(5):
            d = date(2026, 5, 4 + day_off)
            _add_log(db, priv_id, job.job_id,
                     datetime.combine(d, time(8, 0), tzinfo=timezone.utc),
                     datetime.combine(d, time(18, 0), tzinfo=timezone.utc))
        # Sunday rest-day shift: 6h → OT_REST_DAY at 2×.
        _add_log(db, priv_id, job.job_id,
                 _utc(2026, 5, 10, 9), _utc(2026, 5, 10, 15))
        db.commit()

        run = payroll_engine.create_draft_run(
            db,
            PayrollRunCreate(
                company_id=test_company_id,
                period_start=date(2026, 5, 4),
                period_end=date(2026, 5, 10),
                private_user_ids=[priv_id],
            ),
            actor_user_id=None,
        )
        db.commit()

        assert run.compute_version == 2
        ps = db.query(Payslip).filter(
            Payslip.payroll_run_id == run.id,
            Payslip.private_user_id == priv_id,
        ).one()

        codes = {c["code"]: c for c in ps.components if c["kind"] == "earning"}
        # REG: 45h × 200 × 1.0 = 9000
        assert "REG" in codes
        assert Decimal(codes["REG"]["amount"]) == Decimal("9000.00")
        assert codes["REG"]["is_basic"] is True
        # OT weekday tier 1: 5h × 200 × 1.5 = 1500
        assert "OT_WEEKDAY_T1" in codes
        assert Decimal(codes["OT_WEEKDAY_T1"]["amount"]) == Decimal("1500.00")
        assert codes["OT_WEEKDAY_T1"]["is_basic"] is False
        # Rest day: 6h × 200 × 2.0 = 2400
        assert "OT_REST_DAY" in codes
        assert Decimal(codes["OT_REST_DAY"]["amount"]) == Decimal("2400.00")
        assert codes["OT_REST_DAY"]["is_basic"] is False

        # gross_total = 9000 + 1500 + 2400 = 12900
        assert Decimal(ps.gross) == Decimal("12900.00")

        # Audit meta present on OT buckets.
        assert codes["OT_REST_DAY"].get("meta", {}).get("multiplier") == "2.00"

    def test_finalize_recompute_matches_draft(
        self, db, hourly_employee, test_company_id, clean_payroll_state,
    ):
        priv_id = hourly_employee
        job = db.query(Job).filter(Job.private_user_id == priv_id).first()
        _clear_runs(db, test_company_id)
        _clear_logs(db, priv_id)
        for day_off in range(5):
            d = date(2026, 5, 4 + day_off)
            _add_log(db, priv_id, job.job_id,
                     datetime.combine(d, time(9, 0), tzinfo=timezone.utc),
                     datetime.combine(d, time(17, 0), tzinfo=timezone.utc))
        db.commit()

        run = payroll_engine.create_draft_run(
            db,
            PayrollRunCreate(
                company_id=test_company_id,
                period_start=date(2026, 5, 4),
                period_end=date(2026, 5, 10),
                private_user_ids=[priv_id],
            ),
            actor_user_id=None,
        )
        db.commit()
        draft_net = db.query(Payslip).filter(
            Payslip.payroll_run_id == run.id, Payslip.private_user_id == priv_id,
        ).one().net_pay

        # Finalize must recompute through v2 and match (no false "rules changed").
        finalized = payroll_engine.finalize_run(db, run.id, actor_user_id=None)
        db.commit()
        assert finalized.status == "finalized"
        final_net = db.query(Payslip).filter(
            Payslip.payroll_run_id == run.id, Payslip.private_user_id == priv_id,
        ).one().net_pay
        assert final_net == draft_net


# ---------------------------------------------------------------------------
# M7 — Madagascar end-to-end draft run
# ---------------------------------------------------------------------------


def _seed_mg(db):
    """Seed MG country + overtime rule (two-tier) + 2026 holidays. Idempotent."""
    from scripts.seed_overtime_rules_mg import (
        ensure_country, seed_mg_overtime_rule, seed_mg_holidays_2026,
    )
    ensure_country(db)
    seed_mg_overtime_rule(db)
    seed_mg_holidays_2026(db)


@pytest.fixture()
def mg_hourly_employee(db):
    """An MG hourly employee (MGA 200/hr) under an MG company in Etc/UTC so
    day-of-week / night-window classification is deterministic. Idempotent."""
    _seed_mg(db)  # MG country must exist before the company FK insert
    existing = (
        db.query(PrivateUser)
        .filter(PrivateUser.pass_port_number == "OT_MG_FIXTURE")
        .one_or_none()
    )
    if existing is not None:
        return existing.company_id, existing.private_user_id

    owner = User(user_type="company", email="ot-mg-owner@kontokaz.test",
                 user_name="ot-mg-owner", password_hash="x")
    db.add(owner)
    db.flush()
    company = Company(
        company_name="Kiruko MG Test Co.", brn="MG_BRN",
        user_id=owner.user_id, country_code="MG", timezone="Etc/UTC",
    )
    db.add(company)
    db.flush()
    emp_owner = User(user_type="private", email="ot-mg@kontokaz.test",
                     user_name="ot-mg", password_hash="x")
    db.add(emp_owner)
    db.flush()
    priv = PrivateUser(
        user_id=emp_owner.user_id, first_name="Rakoto", last_name="Andria",
        company_id=company.company_id, pass_port_number="OT_MG_FIXTURE", role="employee",
    )
    db.add(priv)
    db.flush()
    job = Job(
        private_user_id=priv.private_user_id, company_id=company.company_id,
        job_title="Hourly MG", employer_name="Kiruko MG Test Co.",
        employer_brn="MG_BRN", employer_email="ot-mg-employer@kontokaz.test",
        first_date_of_employment=date(2024, 1, 1),
        work_days=["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        weekly_rest_day_dow=7, overtime_eligibility="HOURLY",
    )
    db.add(job)
    db.flush()
    db.add(Salary(job_id=job.job_id, monthly_hours="173", salary=Decimal("0"),
                  hourly_rate=Decimal("200.00"), pay_basis="hourly"))
    basic = SalaryComponent(
        company_id=company.company_id, code="BASIC_MG", label="Basic",
        kind="earning", category="earning.basic", is_basic=True, is_taxable=True,
    )
    db.add(basic)
    db.flush()
    structure = SalaryStructure(company_id=company.company_id, name="MG Hourly", description="x")
    db.add(structure)
    db.flush()
    db.add(SalaryStructureLine(structure_id=structure.id, component_id=basic.id,
                               amount=Decimal("0"), order_index=0))
    db.add(EmployeeSalaryAssignment(
        private_user_id=priv.private_user_id, structure_id=structure.id,
        currency="MGA", effective_from=date(2024, 1, 1), notes="mg fixture"))
    db.commit()
    return company.company_id, priv.private_user_id


class TestMGDraftRun:
    def test_mg_50hr_week_plus_sunday_night_rest_day(self, db, mg_hourly_employee):
        _seed_mg(db)
        company_id, priv_id = mg_hourly_employee
        job = db.query(Job).filter(Job.private_user_id == priv_id).first()
        _clear_runs(db, company_id)
        _clear_logs(db, priv_id)

        # Mon-Fri 08:00-18:00 UTC = 10h × 5 = 50h → 40 REG + 8 T1 (1.30) + 2 T2 (1.50).
        for day_off in range(5):
            d = date(2026, 5, 4 + day_off)
            _add_log(db, priv_id, job.job_id,
                     datetime.combine(d, time(8, 0), tzinfo=timezone.utc),
                     datetime.combine(d, time(18, 0), tzinfo=timezone.utc))
        # Sunday 00:00-05:00 = 5h, rest-day + night window. NO_STACK → rest-day
        # 1.40 wins (does NOT stack with the 1.30 night premium).
        _add_log(db, priv_id, job.job_id, _utc(2026, 5, 10, 0), _utc(2026, 5, 10, 5))
        db.commit()

        run = payroll_engine.create_draft_run(
            db,
            PayrollRunCreate(
                company_id=company_id,
                period_start=date(2026, 5, 4), period_end=date(2026, 5, 10),
                private_user_ids=[priv_id],
            ),
            actor_user_id=None,
        )
        db.commit()

        assert run.compute_version == 2
        ps = db.query(Payslip).filter(
            Payslip.payroll_run_id == run.id, Payslip.private_user_id == priv_id,
        ).one()
        assert ps.currency == "MGA"
        codes = {c["code"]: c for c in ps.components if c["kind"] == "earning"}

        # 40h × 200 × 1.0 = 8000
        assert Decimal(codes["REG"]["amount"]) == Decimal("8000.00")
        assert codes["REG"]["is_basic"] is True
        # 8h × 200 × 1.30 = 2080
        assert Decimal(codes["OT_WEEKDAY_T1"]["amount"]) == Decimal("2080.00")
        # 2h × 200 × 1.50 = 600
        assert Decimal(codes["OT_WEEKDAY_T2"]["amount"]) == Decimal("600.00")
        # 5h × 200 × 1.40 = 1400 (rest-day wins over night under NO_STACK)
        assert Decimal(codes["OT_REST_DAY"]["amount"]) == Decimal("1400.00")
        assert codes["OT_REST_DAY"]["meta"]["multiplier"] == "1.40"

        # gross_total = 8000 + 2080 + 600 + 1400 = 12080
        assert Decimal(ps.gross) == Decimal("12080.00")


# ---------------------------------------------------------------------------
# Zero-pay diagnostics — payroll must surface WHY an hourly employee with
# clock-in data nonetheless computes 0, instead of silently dropping them.
# ---------------------------------------------------------------------------


def _zero_pay_run(db, company_id, priv_id, period_start, period_end):
    run = payroll_engine.create_draft_run(
        db,
        PayrollRunCreate(
            company_id=company_id,
            period_start=period_start,
            period_end=period_end,
            private_user_ids=[priv_id],
        ),
        actor_user_id=None,
    )
    db.commit()
    return run


class TestZeroPayDiagnostics:
    def test_open_log_yields_zero_payslip_with_reason(
        self, db, hourly_employee, test_company_id, clean_payroll_state,
    ):
        priv_id = hourly_employee
        job = db.query(Job).filter(Job.private_user_id == priv_id).first()
        _clear_runs(db, test_company_id)
        _clear_logs(db, priv_id)

        # A single still-open clock-in (no end_time) — nothing payable yet.
        db.add(TimeLog(
            job_id=job.job_id, private_user_id=priv_id,
            start_time=_utc(2026, 5, 4, 8), end_time=None,
            location={"lat": 0, "lng": 0}, admin_approved=True,
        ))
        db.commit()

        run = _zero_pay_run(db, test_company_id, priv_id, date(2026, 5, 4), date(2026, 5, 10))

        # The employee is no longer silently skipped — a zero payslip exists.
        ps = db.query(Payslip).filter(
            Payslip.payroll_run_id == run.id, Payslip.private_user_id == priv_id,
        ).one()
        assert Decimal(ps.gross) == Decimal("0.00")
        assert Decimal(ps.net_pay) == Decimal("0.00")
        # ...and the run carries the per-employee reason.
        assert f"u{priv_id}:hourly_zero_pay:open_logs:1" in run.compliance_flags

    def test_pending_overtime_yields_zero_payslip_with_reason(
        self, db, hourly_employee, test_company_id, clean_payroll_state,
    ):
        priv_id = hourly_employee
        job = db.query(Job).filter(Job.private_user_id == priv_id).first()
        _clear_runs(db, test_company_id)
        _clear_logs(db, priv_id)

        # Closed shift flagged as overtime but not yet confirmed by employer →
        # dropped from the draft compute.
        _add_log(db, priv_id, job.job_id,
                 _utc(2026, 5, 4, 8), _utc(2026, 5, 4, 16),
                 is_ot=True, ot_confirmed=False)
        db.commit()

        run = _zero_pay_run(db, test_company_id, priv_id, date(2026, 5, 4), date(2026, 5, 10))

        ps = db.query(Payslip).filter(
            Payslip.payroll_run_id == run.id, Payslip.private_user_id == priv_id,
        ).one()
        assert Decimal(ps.gross) == Decimal("0.00")
        assert f"u{priv_id}:hourly_zero_pay:pending_overtime:1" in run.compliance_flags

    def test_unapproved_clockins_yield_zero_payslip_with_reason(
        self, db, hourly_employee, test_company_id, clean_payroll_state,
    ):
        priv_id = hourly_employee
        job = db.query(Job).filter(Job.private_user_id == priv_id).first()
        company = db.query(Company).filter(Company.company_id == test_company_id).one()
        _clear_runs(db, test_company_id)
        _clear_logs(db, priv_id)

        # Closed, ordinary shift but NOT admin-approved, with the company
        # requiring approval for payroll → the gate drops it.
        db.add(TimeLog(
            job_id=job.job_id, private_user_id=priv_id,
            start_time=_utc(2026, 5, 4, 8), end_time=_utc(2026, 5, 4, 16),
            location={"lat": 0, "lng": 0},
            is_overtime=False, overtime_confirmed_by_employer=False,
            admin_approved=False,
        ))
        db.commit()

        prev = company.require_approved_clockins_for_payroll
        company.require_approved_clockins_for_payroll = True
        db.commit()
        try:
            run = _zero_pay_run(db, test_company_id, priv_id, date(2026, 5, 4), date(2026, 5, 10))
        finally:
            company.require_approved_clockins_for_payroll = prev
            db.commit()

        ps = db.query(Payslip).filter(
            Payslip.payroll_run_id == run.id, Payslip.private_user_id == priv_id,
        ).one()
        assert Decimal(ps.gross) == Decimal("0.00")
        assert f"u{priv_id}:hourly_zero_pay:unapproved_clockins:1" in run.compliance_flags
