"""#19 — the profile ESTIMATE must equal the finalized payroll RUN.

This is the trust property behind "the clock is the constant": the number a
worker sees on their profile (estimated payslip) is the number the employer's
payroll run produces, once the review queue is cleared. We prove it end-to-end:
seed a full month of clock-ins, build the estimate, create the draft run, and
assert gross + net match — both at full attendance and with one absent day
(where the #17 deduction must land identically on both sides).

Fully isolated: a throwaway MU company + salaried employee is built with
flush-but-no-commit, so everything is discarded when the session closes.
"""

from datetime import date, datetime, time, timezone
from decimal import Decimal

import pytest

from core.model import (
    Company,
    EmployeeOneOffAllowance,
    EmployeeSalaryAssignment,
    Job,
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
from services import (
    one_off_allowances_service,
    payroll_engine,
    payslip_estimate_service,
    proration,
)


PERIOD_START = date(2026, 5, 1)
PERIOD_END = date(2026, 5, 31)
BASIC = Decimal("30000.00")
TZ = "Indian/Mauritius"


@pytest.fixture()
def demo(db, seed_mu_rules):
    """A throwaway MU company + one salaried (monthly) employee on a Mon–Fri
    schedule, opted into clock-driven payroll. Not committed → auto-discarded."""
    owner = User(
        user_type="company", email="estrun-owner@kontokaz.test",
        user_name="estrun-owner", password_hash="x",
    )
    db.add(owner)
    db.flush()
    company = Company(
        user_id=owner.user_id,
        company_name="Estimate=Run Test Co.",
        email="estrun-co@kontokaz.test",
        brn="ESTRUN_BRN",
        country_code="MU",
        require_approved_clockins_for_payroll=True,
    )
    db.add(company)
    db.flush()

    emp_user = User(
        user_type="private", email="estrun-emp@kontokaz.test",
        user_name="estrun-emp", password_hash="x",
    )
    db.add(emp_user)
    db.flush()
    emp = PrivateUser(
        user_id=emp_user.user_id, first_name="Esti", last_name="Mate",
        company_id=company.company_id, pass_port_number="ESTRUN_PASS",
        role="employee",
    )
    db.add(emp)
    db.flush()
    job = Job(
        private_user_id=emp.private_user_id, company_id=company.company_id,
        job_title="Salaried", employer_name="Estimate=Run Test Co.",
        employer_brn="ESTRUN_BRN", employer_email="estrun-employer@kontokaz.test",
        first_date_of_employment=datetime(2024, 1, 1, tzinfo=timezone.utc),
        work_days=["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        weekly_rest_day_dow=7,
    )
    db.add(job)
    db.flush()
    db.add(Salary(job_id=job.job_id, pay_basis="monthly", salary=BASIC))

    basic = SalaryComponent(
        company_id=company.company_id, code="BASIC", label="Basic salary",
        kind="earning", category="earning.basic", is_basic=True, is_taxable=True,
    )
    db.add(basic)
    db.flush()
    structure = SalaryStructure(company_id=company.company_id, name="S", description="x")
    db.add(structure)
    db.flush()
    db.add(SalaryStructureLine(
        structure_id=structure.id, component_id=basic.id,
        amount=BASIC, order_index=0,
    ))
    db.add(EmployeeSalaryAssignment(
        private_user_id=emp.private_user_id, structure_id=structure.id,
        currency="MUR", effective_from=date(2024, 1, 1), notes="x",
    ))
    db.flush()

    emp._job_id = job.job_id
    yield company, emp, job
    db.rollback()


def _seed_clockins(db, emp, dates):
    for d in dates:
        db.add(TimeLog(
            private_user_id=emp.private_user_id, job_id=emp._job_id,
            start_time=datetime.combine(d, time(8, 0), tzinfo=timezone.utc),
            end_time=datetime.combine(d, time(16, 0), tzinfo=timezone.utc),
            hours_worked=Decimal("8.00"), location={}, admin_approved=True,
        ))
    db.flush()


def _estimate(db, company, emp, job):
    ctx = payslip_estimate_service.build_context(
        db, employee=emp, company=company, job=job,
        period_start=PERIOD_START, period_end=PERIOD_END, locale="en",
    )
    return ctx["gross_decimal"], ctx["net_decimal"]


def _run_payslip(db, company, emp):
    payload = PayrollRunCreate(
        company_id=company.company_id,
        period_start=PERIOD_START, period_end=PERIOD_END,
        private_user_ids=[emp.private_user_id],
    )
    run = payroll_engine.create_draft_run(db, payload, actor_user_id=None)
    db.flush()
    return (
        db.query(Payslip)
        .filter(Payslip.payroll_run_id == run.id)
        .filter(Payslip.private_user_id == emp.private_user_id)
        .one()
    )


def test_estimate_equals_run_full_attendance(db, demo):
    company, emp, job = demo
    work = sorted(proration.working_dates_in_period(db, "MU", PERIOD_START, PERIOD_END, job.work_days))
    _seed_clockins(db, emp, work)

    est_gross, est_net = _estimate(db, company, emp, job)
    ps = _run_payslip(db, company, emp)

    assert est_gross == ps.gross, f"gross: estimate {est_gross} != run {ps.gross}"
    assert est_net == ps.net_pay, f"net: estimate {est_net} != run {ps.net_pay}"
    # No absence at full attendance.
    assert not any(c.get("code") == "ABSENCE_DEDUCTION" for c in (ps.components or []))


def test_estimate_equals_run_with_one_absence(db, demo):
    company, emp, job = demo
    work = sorted(proration.working_dates_in_period(db, "MU", PERIOD_START, PERIOD_END, job.work_days))
    # Skip the last working day → exactly one unexplained absence.
    _seed_clockins(db, emp, work[:-1])
    total = len(work)
    expected_deduction = (BASIC / Decimal(total)).quantize(Decimal("0.01"))

    est_gross, est_net = _estimate(db, company, emp, job)
    ps = _run_payslip(db, company, emp)

    # The estimate still equals the run — the absence lands identically on both.
    assert est_gross == ps.gross
    assert est_net == ps.net_pay

    # And the absence actually reduced pay by exactly one daily slice.
    absence = next(
        (c for c in (ps.components or []) if c.get("code") == "ABSENCE_DEDUCTION"),
        None,
    )
    assert absence is not None, "expected an ABSENCE_DEDUCTION line on the payslip"
    assert Decimal(absence["amount"]) == expected_deduction


def test_additional_remuneration_in_estimate_and_run(db, demo):
    # #18 — additional duty pay (a one-off earning) must show on BOTH the
    # estimate and the run, identically, and lift gross by exactly its amount.
    company, emp, job = demo
    work = sorted(proration.working_dates_in_period(db, "MU", PERIOD_START, PERIOD_END, job.work_days))
    _seed_clockins(db, emp, work)

    comp = one_off_allowances_service.ensure_additional_duty_component(db, company.company_id)
    assert comp.is_taxable is True and comp.is_basic is False
    extra = Decimal("2000.00")
    db.add(EmployeeOneOffAllowance(
        private_user_id=emp.private_user_id, component_id=comp.id, amount=extra,
        payable_in_year=PERIOD_START.year, payable_in_month=PERIOD_START.month,
    ))
    db.flush()

    est_gross, est_net = _estimate(db, company, emp, job)
    ps = _run_payslip(db, company, emp)

    assert est_gross == ps.gross
    assert est_net == ps.net_pay
    # Gross lifted by exactly the additional-duty amount (basic + 2000).
    assert ps.gross == BASIC + extra
    duty = next((c for c in (ps.components or []) if c.get("code") == "ADDITIONAL_DUTY"), None)
    assert duty is not None, "expected an ADDITIONAL_DUTY earning line on the payslip"
    assert Decimal(duty["amount"]) == extra
    assert duty["kind"] == "earning" and duty["is_basic"] is False


def test_ensure_additional_duty_component_idempotent(db, demo):
    company, _emp, _job = demo
    a = one_off_allowances_service.ensure_additional_duty_component(db, company.company_id)
    b = one_off_allowances_service.ensure_additional_duty_component(db, company.company_id)
    assert a.id == b.id
    assert a.code == "ADDITIONAL_DUTY"
    assert a.category == "earning.additional_duty"
