"""Multi-employee payroll smoke test — de-risks the multi-company rollout.

One company, several salaried employees with DIFFERENT attendance (full, one
absence, two absences), run in a single draft. Confirms the run processes many
employees without error, produces one payslip each, and applies the #17 absence
deduction per-employee (more absences ⇒ lower net). Fully isolated (flush, no
commit, rollback on teardown).
"""
from datetime import date, datetime, time, timezone
from decimal import Decimal

import pytest

from core.model import (
    Company,
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
from services import payroll_engine, proration


PERIOD_START = date(2026, 5, 1)
PERIOD_END = date(2026, 5, 31)
BASIC = Decimal("30000.00")


@pytest.fixture()
def multi_company(db, seed_mu_rules):
    owner = User(user_type="company", email="multi-owner@kontokazdemo.com",
                 user_name="multi-owner", password_hash="x")
    db.add(owner); db.flush()
    company = Company(user_id=owner.user_id, company_name="Multi Co.",
                      email="multi-co@kontokazdemo.com", brn="MULTI_BRN",
                      country_code="MU", require_approved_clockins_for_payroll=True)
    db.add(company); db.flush()

    # Shared component + structure; each employee gets the same assignment.
    basic = SalaryComponent(company_id=company.company_id, code="BASIC",
                            label="Basic", kind="earning", category="earning.basic",
                            is_basic=True, is_taxable=True)
    db.add(basic); db.flush()
    structure = SalaryStructure(company_id=company.company_id, name="S", description="x")
    db.add(structure); db.flush()
    db.add(SalaryStructureLine(structure_id=structure.id, component_id=basic.id,
                               amount=BASIC, order_index=0))

    work = sorted(proration.working_dates_in_period(db, "MU", PERIOD_START, PERIOD_END, None))
    workers = []
    # (label, number of absent days)
    for i, absent_days in enumerate([("full", 0), ("one", 1), ("two", 2)]):
        label, nabs = absent_days
        u = User(user_type="private", email=f"multi-{label}@kontokazdemo.com",
                 user_name=f"multi-{label}", password_hash="x")
        db.add(u); db.flush()
        pu = PrivateUser(user_id=u.user_id, first_name=label.title(), last_name="Emp",
                         company_id=company.company_id, pass_port_number=f"MULTI_P{i}",
                         role="employee")
        db.add(pu); db.flush()
        job = Job(private_user_id=pu.private_user_id, company_id=company.company_id,
                  job_title="Salaried", employer_name="Multi Co.", employer_brn="MULTI_BRN",
                  employer_email=f"multi-employer-{i}@kontokazdemo.com",
                  first_date_of_employment=datetime(2024, 1, 1, tzinfo=timezone.utc),
                  work_days=["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
                  weekly_rest_day_dow=7)
        db.add(job); db.flush()
        db.add(Salary(job_id=job.job_id, pay_basis="monthly", salary=BASIC))
        db.add(EmployeeSalaryAssignment(private_user_id=pu.private_user_id,
               structure_id=structure.id, currency="MUR",
               effective_from=date(2024, 1, 1), notes="x"))
        db.flush()
        # Present on all working days except the last `nabs`.
        present = work if nabs == 0 else work[:-nabs]
        for d in present:
            db.add(TimeLog(private_user_id=pu.private_user_id, job_id=job.job_id,
                   day_of_week=d.strftime("%A"),
                   start_time=datetime.combine(d, time(8, 0), tzinfo=timezone.utc),
                   end_time=datetime.combine(d, time(16, 0), tzinfo=timezone.utc),
                   hours_worked=Decimal("8.00"), location={}, admin_approved=True))
        db.flush()
        workers.append((label, nabs, pu.private_user_id))

    yield company, workers, len(work)
    db.rollback()


def test_multi_employee_run_scales_and_applies_absence(db, multi_company):
    company, workers, total_working = multi_company

    payload = PayrollRunCreate(
        company_id=company.company_id,
        period_start=PERIOD_START, period_end=PERIOD_END,
        private_user_ids=[w[2] for w in workers],
    )
    run = payroll_engine.create_draft_run(db, payload, actor_user_id=None)
    db.flush()

    payslips = {
        ps.private_user_id: ps
        for ps in db.query(Payslip).filter(Payslip.payroll_run_id == run.id).all()
    }
    # One payslip per employee — the run handled all three.
    assert len(payslips) == 3

    day = (BASIC / Decimal(total_working)).quantize(Decimal("0.01"))
    nets = {}
    for label, nabs, pid in workers:
        ps = payslips[pid]
        nets[label] = ps.net_pay
        absence = next((c for c in (ps.components or []) if c.get("code") == "ABSENCE_DEDUCTION"), None)
        if nabs == 0:
            assert absence is None
        else:
            assert absence is not None and Decimal(absence["amount"]) == (day * nabs).quantize(Decimal("0.01"))

    # More absences ⇒ strictly lower net.
    assert nets["full"] > nets["one"] > nets["two"]
