"""End-to-end payroll scenario harness (STEP 1 — baseline + proration).

Builds realistic companies through the REAL import service, runs them through
the REAL payroll engine, and asserts the money — no mocking of the math. This is
the matrix the payroll-integration harness grows into; step 1 proves the shape
with three rows:

  1. monthly, Mon-Fri, full month       → full gross, statutory actually deducted
  2. monthly, Mon-Fri, mid-month joiner  → gross == base × proration factor
  3. 6-day vs 5-day, same join date      → engine prorates on the 6-day schedule
     (regression guard for the CSV-import work_days bug — if work_days were
     dropped to {}, the engine would silently prorate on a Mon-Fri week)

Pipeline per row: imp.commit → payroll_engine.create_draft_run → Payslip.

Isolation note: the import service commits, so these tests commit too and rely on
conftest's per-test cleanup (same pattern as tests/test_employee_import.py).
"""
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Optional
import uuid

import pytest
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from core.model import Company, CompanyGeofence, Job, Loan, Payslip, PrivateUser, TimeLog, User
from schema.payroll_schema import PayrollRunCreate
from services import employee_import_service as imp
from services import payroll_engine, proration
from services.time_log_service import TimeLogService


PERIOD_START = date(2026, 5, 1)
PERIOD_END = date(2026, 5, 31)

# Explicit work-day masks (day-name keyed, the shape Job.work_days uses).
_MASK_5 = {d: "8" for d in ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday")}
_MASK_6 = {**_MASK_5, "Saturday": "8"}


# ── Harness helpers ───────────────────────────────────────────────────────────
def _company(db: Session, require_approved: bool = False) -> Company:
    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    db.commit()
    sfx = uuid.uuid4().hex[:8]
    owner = User(user_type="company", email=f"ps-own-{sfx}@x.com",
                 user_name=f"ps-own-{sfx}", password_hash="x")
    db.add(owner); db.flush()
    co = Company(user_id=owner.user_id, company_name=f"PS {sfx}",
                 email=f"psco-{sfx}@x.com", brn=f"PS_{sfx}", country_code="MU",
                 require_approved_clockins_for_payroll=require_approved)
    db.add(co); db.commit()
    return co


def _import_employee(db: Session, company_id: int, *, base_salary: str = "30000",
                     work_days_per_week: int = 5,
                     work_start_time: str = "", work_end_time: str = ""):
    """Create one payroll-ready employee via the real import path. start_date is
    well before the period so the salary assignment resolves at period_start;
    a mid-month JOIN is modelled separately via _set_join_date (proration reads
    Job.first_date_of_employment, not the assignment date). work_start/end_time
    are optional CSV columns that drive the schedule-anchored auto clock-out."""
    sfx = uuid.uuid4().hex[:8]
    csv = (
        "first_name,last_name,email,job_title,start_date,base_salary,currency,work_days_per_week,work_start_time,work_end_time\n"
        f"E,{sfx},emp-{sfx}@x.com,Clerk,2024-01-01,{base_salary},MUR,{work_days_per_week},{work_start_time},{work_end_time}\n"
    ).encode()
    imp.commit(db, company_id, imp.parse(csv, "s.csv"), actor_user_id=None)
    db.commit()
    u = db.query(User).filter(User.email == f"emp-{sfx}@x.com").one()
    pu = db.query(PrivateUser).filter(PrivateUser.user_id == u.user_id).one()
    job = db.query(Job).filter(Job.private_user_id == pu.private_user_id).one()
    return pu, job


def _open_session(db: Session, pu: PrivateUser, job: Job, *, days_ago: int = 3,
                  local_start_hour_utc: int = 4) -> TimeLog:
    """A forgotten clock-in: an open TimeLog (no end_time) a few days back, so
    'now' is well past any shift end + grace. 04:00 UTC == 08:00 in Mauritius
    (UTC+4, the company default tz) so a 16:00 scheduled end is an 8h shift."""
    day = (datetime.now(timezone.utc) - timedelta(days=days_ago)).date()
    log = TimeLog(
        private_user_id=pu.private_user_id, job_id=job.job_id,
        day_of_week=day.strftime("%A"),
        start_time=datetime.combine(day, time(local_start_hour_utc, 0), tzinfo=timezone.utc),
        end_time=None, location={},
    )
    db.add(log); db.commit(); db.refresh(log)
    return log


def _set_join_date(db: Session, job: Job, d: date) -> None:
    job.first_date_of_employment = datetime.combine(d, datetime.min.time())
    db.add(job); db.commit(); db.refresh(job)


def _run(db: Session, company: Company, pids: list[int]) -> dict[int, Payslip]:
    payload = PayrollRunCreate(
        company_id=company.company_id,
        period_start=PERIOD_START, period_end=PERIOD_END,
        private_user_ids=pids,
    )
    run = payroll_engine.create_draft_run(db, payload, actor_user_id=None)
    db.flush()
    return {
        ps.private_user_id: ps
        for ps in db.query(Payslip).filter(Payslip.payroll_run_id == run.id).all()
    }


def _factor(db: Session, mask, start: Optional[date], end: Optional[date] = None) -> Decimal:
    return proration.compute_proration_factor(
        db, employee_start=start, employee_end=end,
        period_start=PERIOD_START, period_end=PERIOD_END,
        country_code="MU", work_days_mask=mask,
    )


def _money(base: str, factor: Decimal) -> Decimal:
    return (Decimal(base) * factor).quantize(Decimal("0.01"))


# ── Scenario matrix (rows 1-2 — single employee, assert gross) ────────────────
@dataclass
class Scenario:
    name: str
    work_days_per_week: int = 5
    base_salary: str = "30000"
    join_date: Optional[date] = None  # override Job.first_date_of_employment


SCENARIOS = [
    Scenario("monthly_full_month"),
    Scenario("monthly_mid_month_joiner", join_date=date(2026, 5, 16)),
]


@pytest.mark.parametrize("scn", SCENARIOS, ids=lambda s: s.name)
def test_payroll_scenario(db: Session, seed_mu_rules, scn: Scenario):
    co = _company(db)
    pu, job = _import_employee(
        db, co.company_id, base_salary=scn.base_salary,
        work_days_per_week=scn.work_days_per_week,
    )
    if scn.join_date:
        _set_join_date(db, job, scn.join_date)

    payslips = _run(db, co, [pu.private_user_id])
    assert len(payslips) == 1
    ps = payslips[pu.private_user_id]

    emp_start = job.first_date_of_employment.date() if job.first_date_of_employment else None
    expected = _money(scn.base_salary, _factor(db, job.work_days, emp_start))
    assert Decimal(ps.gross) == expected, f"{scn.name}: gross {ps.gross} != {expected}"

    # Statutory (PAYE/CSG/NSF) actually came off — a payslip that doesn't deduct
    # is the classic "looks fine, pays wrong" bug.
    assert Decimal(ps.net_pay) < Decimal(ps.gross)

    if scn.join_date:
        assert expected < Decimal(scn.base_salary)  # proration genuinely reduced pay


# ── Row 3 — the work_days import-bug guard ────────────────────────────────────
def test_workweek_feeds_proration(db: Session, seed_mu_rules):
    """A 6-day worker must be prorated on a 6-day schedule, not a silent Mon-Fri.

    Asserts the engine's gross matches base × factor(explicit 6-day mask). If the
    import dropped work_days to {} (the bug), the engine would prorate on Mon-Fri
    and the gross would match the 5-day basis instead — caught here.
    """
    co = _company(db)
    pu6, job6 = _import_employee(db, co.company_id, work_days_per_week=6)
    join = date(2026, 5, 16)
    _set_join_date(db, job6, join)

    f6 = _factor(db, _MASK_6, join)
    f5 = _factor(db, _MASK_5, join)

    ps = _run(db, co, [pu6.private_user_id])[pu6.private_user_id]
    assert Decimal(ps.gross) == _money("30000", f6), "engine did not prorate on the 6-day schedule"

    # Only meaningful when the two schedules genuinely diverge this period; if they
    # happen to coincide the inequality would be a false signal, so guard it.
    if f5 != f6:
        assert Decimal(ps.gross) != _money("30000", f5), "engine fell back to a Mon-Fri week"


# ── Rows 4-5 — forgotten clock-out (the auto clock-out bug class) ──────────────
def test_forgotten_clockout_closes_at_scheduled_end(db: Session, seed_mu_rules):
    """work_end_time set → a forgotten clock-out auto-closes AT the shift end
    (~8h), not the blunt 12h max-shift cap. Regression guard for the CSV import
    populating work_end_time."""
    co = _company(db)
    pu, job = _import_employee(db, co.company_id, work_start_time="08:00", work_end_time="16:00")
    assert job.work_end_time is not None  # import actually set it
    log = _open_session(db, pu, job)

    closed = TimeLogService.close_past_schedule_unclaimed(db, private_user_id=pu.private_user_id)
    db.refresh(log)

    assert closed == 1
    assert log.end_time is not None
    assert log.auto_closed is True
    assert Decimal(log.hours_worked) == Decimal("8.00"), f"closed at {log.hours_worked}h, expected 8 (shift end)"


def test_forgotten_clockout_without_schedule_rides_max_shift_cap(db: Session, seed_mu_rules):
    """No work_end_time → the schedule-anchored close can't fire; the session
    rides the max-shift cap (12h system default) instead. Documents the cost of
    importing without a shift end (over-records 4h vs the 8h scheduled day)."""
    co = _company(db)
    pu, job = _import_employee(db, co.company_id)  # no work_start/end_time
    assert job.work_end_time is None
    log = _open_session(db, pu, job)

    closed = TimeLogService.cleanup_active_time_logs(db, private_user_id=pu.private_user_id)
    db.refresh(log)

    assert closed == 1
    assert log.auto_closed is True
    assert Decimal(log.hours_worked) == Decimal("12.00"), f"closed at {log.hours_worked}h, expected 12 (max-shift cap)"


def _rest_day_shift(db: Session, pu: PrivateUser, job: Job) -> None:
    """An 8h shift on Sunday 3 May 2026 — an unambiguous rest-day, OT-eligible at
    2× under WRA s.24. 04:00 UTC == 08:00 in Mauritius (UTC+4)."""
    rest_day = date(2026, 5, 3)
    db.add(TimeLog(
        private_user_id=pu.private_user_id, job_id=job.job_id, day_of_week="Sunday",
        start_time=datetime.combine(rest_day, time(4, 0), tzinfo=timezone.utc),
        end_time=datetime.combine(rest_day, time(12, 0), tzinfo=timezone.utc),
        hours_worked=Decimal("8.00"), location={}, admin_approved=True,
    ))
    db.commit()


# ── Row 6 — salaried overtime: unclassified worker is untouched ───────────────
def test_salaried_overtime_unclassified_worker_untouched(db: Session, seed_mu_rules):
    """Detection is opt-in: a monthly worker left at the default HOURLY
    overtime_eligibility gets NO salaried-OT handling — no flag, no pay change —
    even after working a rest day. (Employers must deliberately classify a worker
    MONTHLY_ELIGIBLE before the s.24 review fires.)"""
    co = _company(db)  # monthly pay basis, default overtime_eligibility=HOURLY
    pu, job = _import_employee(db, co.company_id)
    _rest_day_shift(db, pu, job)

    ps = _run(db, co, [pu.private_user_id])[pu.private_user_id]
    ot = [c for c in (ps.components or [])
          if c.get("source") == "overtime" or "overtime" in (c.get("category") or "")]
    assert ot == []
    assert Decimal(ps.gross) == Decimal("30000.00")


# ── Row 6b — salaried OT warn mode: review flag, pay unchanged ─────────────────
def test_salaried_overtime_warn_mode_flags_without_paying(db: Session, seed_mu_rules):
    """A MONTHLY_ELIGIBLE worker who works a rest day → default SALARIED_OT_MODE
    'warn' emits a `salaried_ot_review` flag (so the employer can pay it via the
    manual Additional-duty rail) WITHOUT changing pay. Guards both halves: the
    flag fires, and gross stays the flat monthly salary."""
    co = _company(db)
    pu, job = _import_employee(db, co.company_id)
    job.overtime_eligibility = "MONTHLY_ELIGIBLE"   # employer classifies the worker
    db.add(job); db.commit()
    _rest_day_shift(db, pu, job)

    payload = PayrollRunCreate(
        company_id=co.company_id, period_start=PERIOD_START, period_end=PERIOD_END,
        private_user_ids=[pu.private_user_id],
    )
    run = payroll_engine.create_draft_run(db, payload, actor_user_id=None)
    db.flush()
    ps = db.query(Payslip).filter(
        Payslip.payroll_run_id == run.id,
        Payslip.private_user_id == pu.private_user_id,
    ).one()

    # warn mode: pay is untouched ...
    assert Decimal(ps.gross) == Decimal("30000.00"), "warn mode must not change pay"
    assert [c for c in (ps.components or []) if c.get("source") == "overtime"] == []
    # ... but the run surfaces the owed OT for the employer to act on.
    review = [f for f in (run.compliance_flags or []) if "salaried_ot_review" in f]
    assert review, f"expected a salaried_ot_review flag, got {run.compliance_flags}"


# ── Row 7 — loans: employer-only deduction (M1 fix guard) ─────────────────────
def test_only_employer_loans_deducted_not_personal(db: Session, seed_mu_rules):
    """Salary deductions take ONLY employer loans. A personal (self-tracked) loan
    must never reduce pay — guards the employer-loan M1 fix against regression.
    """
    co = _company(db)
    pu, job = _import_employee(db, co.company_id)

    # Employer loan: 12000 over 12 months → 1000/period (deducted).
    db.add(Loan(private_user_id=pu.private_user_id, description="Salary advance",
                amount=12000, currency="MUR", loan_type="employer", status="active",
                start_date=date(2024, 1, 1), duration_months=12, payment_frequency="monthly"))
    # Personal loan: would add 2000/period if (wrongly) deducted → total 3000.
    db.add(Loan(private_user_id=pu.private_user_id, description="Personal car loan",
                amount=24000, currency="MUR", loan_type="personal", status="active",
                start_date=date(2024, 1, 1), duration_months=12, payment_frequency="monthly"))
    db.commit()

    ps = _run(db, co, [pu.private_user_id])[pu.private_user_id]
    loan = next((c for c in (ps.components or []) if c.get("code") == "LOAN"), None)
    assert loan is not None, "employer loan was not deducted"
    assert Decimal(loan["amount"]) == Decimal("1000.00"), \
        f"expected employer-only 1000, got {loan['amount']} (personal loan leaked in?)"


# ── Net-pay floor — net can never be negative ─────────────────────────────────
def test_net_pay_floor_caps_loan_and_never_goes_negative(db: Session, seed_mu_rules):
    """A loan installment far larger than take-home must not push net below zero.
    The floor caps the loan to what's affordable (rest carries forward via the
    ledger) and clamps net at 0, flagging loan_capped_to_net."""
    co = _company(db)
    pu, job = _import_employee(db, co.company_id, base_salary="20000")
    # 600000 over 12 months → 50000/period installment, far above the ~20000 pay.
    db.add(Loan(private_user_id=pu.private_user_id, description="Oversized advance",
                amount=600000, currency="MUR", loan_type="employer", status="active",
                start_date=date(2024, 1, 1), duration_months=12, payment_frequency="monthly"))
    db.commit()

    payload = PayrollRunCreate(
        company_id=co.company_id, period_start=PERIOD_START, period_end=PERIOD_END,
        private_user_ids=[pu.private_user_id],
    )
    run = payroll_engine.create_draft_run(db, payload, actor_user_id=None)
    db.flush()
    ps = db.query(Payslip).filter(
        Payslip.payroll_run_id == run.id, Payslip.private_user_id == pu.private_user_id,
    ).one()

    assert Decimal(ps.net_pay) >= Decimal("0.00"), f"net went negative: {ps.net_pay}"
    assert Decimal(ps.net_pay) == Decimal("0.00")
    # The booked loan repayment was capped to what was affordable (< 50000).
    assert Decimal(ps.loan_repayments) < Decimal("50000.00")
    assert any("loan_capped_to_net" in f for f in (run.compliance_flags or [])), \
        f"expected loan_capped_to_net flag, got {run.compliance_flags}"


def test_statutory_base_excludes_absent_pay(db: Session, seed_mu_rules):
    """Absence docks BASIC the worker never earned, so CSG/NSF/PAYE must be
    assessed on the EARNED remainder — not full gross. A fully-absent month then
    nets statutory 0 and pay 0 naturally (no negative, no floor needed)."""
    from services import payroll_rules
    from services.salary_resolver import ResolvedSalary
    from schema.salary_structure_schema import ResolvedComponent

    snap = payroll_rules.resolve(db, "MU", date(2026, 5, 1))

    def _resolved():
        return ResolvedSalary(
            private_user_id=1, period_start=date(2026, 5, 1), assignment_id=None,
            structure_id=None, currency="MUR",
            components=[ResolvedComponent(
                component_id=0, code="BASIC", label="Basic", kind="earning",
                category="earning.basic", amount=Decimal("26000"), is_taxable=True,
                is_basic=True, source="structure",
                statutory_base_codes=["PAYE", "CSG_EE", "CSG_ER", "NSF_EE", "NSF_ER"],
            )],
        )

    _kw = dict(db=db, private_user_id=1, period_start=date(2026, 5, 1), country_code="MU")

    full_pay = payroll_engine.compute_for_resolved(_resolved(), snap, **_kw)
    csg_full = Decimal(full_pay["statutory_employee"]["CSG_EE"])
    assert csg_full > 0  # baseline: statutory on the full 26000

    fully_absent = payroll_engine.compute_for_resolved(
        _resolved(), snap, absence_deduction=Decimal("26000"), **_kw
    )
    assert Decimal(fully_absent["statutory_employee"]["CSG_EE"]) == Decimal("0.00")
    assert Decimal(fully_absent["statutory_employee"]["NSF_EE"]) == Decimal("0.00")
    assert Decimal(fully_absent["net_pay"]) == Decimal("0.00")

    half_absent = payroll_engine.compute_for_resolved(
        _resolved(), snap, absence_deduction=Decimal("13000"), **_kw
    )
    assert Decimal(half_absent["statutory_employee"]["CSG_EE"]) < csg_full   # on earned half only
    assert Decimal(half_absent["net_pay"]) >= Decimal("0.00")


# ── Coverage map (rows 8-10) ──────────────────────────────────────────────────
# The remaining matrix rows are guarded elsewhere; listed here so this file
# indexes payroll-scenario coverage even where the assertion lives nearby:
#   8. below-minimum-wage import warning
#        → tests/test_employee_import.py::test_validate_flags_errors_dupes_and_warnings
#   9. estimate == finalized run (preview equals booked)
#        → tests/test_estimate_equals_run.py
#  10. correction → linked dispute advances
#        → tests/test_dispute_flow_fixes.py::test_correction_advances_linked_dispute


# ── Rows 11-13 — days-basis absence, joiner, and as_of projection (end-to-end) ──
def _clock_days(db: Session, pu: PrivateUser, job: Job, dates, approved: bool = True) -> None:
    for d in dates:
        st = datetime.combine(d, time(8, 0), tzinfo=timezone.utc)
        db.add(TimeLog(
            private_user_id=pu.private_user_id, job_id=job.job_id, day_of_week=d.strftime("%A"),
            start_time=st, end_time=st + timedelta(hours=8), hours_worked=Decimal("8.00"),
            location={}, admin_approved=approved,
        ))
    db.commit()


def _wdays(db: Session, job: Job):
    return sorted(proration.working_dates_in_period(db, "MU", PERIOD_START, PERIOD_END, job.work_days))


def _absence_amount(ps) -> Decimal:
    return next((Decimal(str(c["amount"])) for c in (ps.components or [])
                 if c.get("code") == "ABSENCE_DEDUCTION"), Decimal("0.00"))


def test_salaried_absence_docks_profile_days_end_to_end(db: Session, seed_mu_rules):
    """One unexplained absence is docked at base ÷ days_of_work_per_month (22 for
    a 5-day week), through the real run — not the calendar working-day count."""
    co = _company(db, require_approved=True)
    pu, job = _import_employee(db, co.company_id, work_days_per_week=5)  # → 22-day profile
    _clock_days(db, pu, job, _wdays(db, job)[:-1])  # absent the last working day
    ps = _run(db, co, [pu.private_user_id])[pu.private_user_id]
    assert _absence_amount(ps) == (Decimal("30000") / 22).quantize(Decimal("0.01"))


def test_joiner_not_double_docked_end_to_end(db: Session, seed_mu_rules):
    """A mid-month joiner present on every post-join day is prorated but NOT also
    docked for pre-hire days."""
    co = _company(db, require_approved=True)
    pu, job = _import_employee(db, co.company_id)
    wd = _wdays(db, job)
    join = wd[len(wd) // 2]
    _set_join_date(db, job, join)
    _clock_days(db, pu, job, [d for d in wd if d >= join])
    ps = _run(db, co, [pu.private_user_id])[pu.private_user_id]
    assert _absence_amount(ps) == Decimal("0.00")
    assert Decimal(ps.gross) < Decimal("30000")  # proration still applied


def test_as_of_projection_excludes_future_days_end_to_end(db: Session, seed_mu_rules):
    """A normal mid-period run docks not-yet-worked days; an as_of projection
    counts only days up to as_of."""
    from core.model import PayrollRun
    co = _company(db, require_approved=True)
    pu, job = _import_employee(db, co.company_id)
    wd = _wdays(db, job)
    mid = wd[len(wd) // 2]
    _clock_days(db, pu, job, [d for d in wd if d <= mid])  # only first half worked
    full = _run(db, co, [pu.private_user_id])[pu.private_user_id]
    assert _absence_amount(full) > Decimal("0.00")
    for r in db.query(PayrollRun).filter(
        PayrollRun.company_id == co.company_id, PayrollRun.period_start == PERIOD_START,
        PayrollRun.status != "cancelled",
    ).all():
        payroll_engine.cancel_run(db, r.id)
    db.flush()
    run = payroll_engine.create_draft_run(db, PayrollRunCreate(
        company_id=co.company_id, period_start=PERIOD_START, period_end=PERIOD_END,
        private_user_ids=[pu.private_user_id], as_of=mid,
    ), actor_user_id=None)
    db.flush()
    pj = db.query(Payslip).filter(
        Payslip.payroll_run_id == run.id, Payslip.private_user_id == pu.private_user_id,
    ).first()
    assert _absence_amount(pj) == Decimal("0.00")


# ── Rows 14-18 — allowance, employer loan + net floor, rest-day, termination ───
def _add_allowance(db: Session, company_id: int, pu: PrivateUser, amount: str) -> None:
    """Attach a recurring ALLOWANCE line to the imported (BASIC-only) employee's
    structure and re-snapshot the assignment so the resolver picks it up."""
    from core.model import SalaryComponent, SalaryStructureLine, EmployeeSalaryAssignment
    from services.salary_resolver import build_structure_snapshot
    asg = db.query(EmployeeSalaryAssignment).filter(
        EmployeeSalaryAssignment.private_user_id == pu.private_user_id).first()
    comp = db.query(SalaryComponent).filter(
        SalaryComponent.company_id == company_id, SalaryComponent.code == "ALLOWANCE").first()
    if comp is None:
        comp = SalaryComponent(company_id=company_id, code="ALLOWANCE", label="Allowance",
                               kind="earning", category="allowance.general",
                               is_basic=False, is_taxable=True)
        db.add(comp); db.flush()
    db.add(SalaryStructureLine(structure_id=asg.structure_id, component_id=comp.id,
                               amount=Decimal(amount), order_index=1))
    db.flush()
    asg.structure_snapshot = build_structure_snapshot(db, asg.structure_id)
    db.commit()


def _set_hourly(db: Session, job: Job, rate: str) -> None:
    from core.model import Salary
    s = db.query(Salary).filter(Salary.job_id == job.job_id).order_by(Salary.created_at.desc()).first()
    s.pay_basis = "hourly"; s.hourly_rate = Decimal(rate); s.break_in_minutes_per_day = 0
    db.commit()


def test_allowance_adds_to_gross_but_absence_docks_basic_only(db: Session, seed_mu_rules):
    """A recurring allowance lifts gross, but an absence is docked on BASIC only
    (the allowance is never reduced by the absence)."""
    co = _company(db, require_approved=True)
    pu, job = _import_employee(db, co.company_id, work_days_per_week=5)
    _add_allowance(db, co.company_id, pu, "6000")
    _clock_days(db, pu, job, _wdays(db, job)[:-1])  # one absence
    ps = _run(db, co, [pu.private_user_id])[pu.private_user_id]
    assert Decimal(ps.gross) == Decimal("36000.00")                       # 30000 basic + 6000 allowance
    assert _absence_amount(ps) == (Decimal("30000") / 22).quantize(Decimal("0.01"))  # basic only


def test_employer_loan_installment_deducted(db: Session, seed_mu_rules):
    """An active employer loan deducts its monthly installment (amount ÷
    duration) from pay."""
    co = _company(db)  # require_approved off → isolate the loan
    pu, job = _import_employee(db, co.company_id)
    db.add(Loan(private_user_id=pu.private_user_id, description="advance", amount=12000.0,
                loan_type="employer", status="active", start_date=date(2024, 1, 1),
                duration_months=12, payment_frequency="monthly"))
    db.commit()
    ps = _run(db, co, [pu.private_user_id])[pu.private_user_id]
    assert Decimal(ps.loan_repayments) == Decimal("1000.00")  # 12000 / 12


def test_loan_repayment_floored_at_zero_net(db: Session, seed_mu_rules):
    """A loan installment bigger than the pay is capped so net never goes
    negative (the unpaid slice carries forward via the loan ledger)."""
    co = _company(db)
    pu, job = _import_employee(db, co.company_id)
    db.add(Loan(private_user_id=pu.private_user_id, description="big", amount=600000.0,
                loan_type="employer", status="active", start_date=date(2024, 1, 1),
                duration_months=1, payment_frequency="monthly"))
    db.commit()
    ps = _run(db, co, [pu.private_user_id])[pu.private_user_id]
    assert Decimal(ps.net_pay) == Decimal("0.00")              # floored, not negative
    assert Decimal(ps.loan_repayments) < Decimal("600000")     # capped to what pay could cover


def test_hourly_rest_day_shift_paid_at_double(db: Session, seed_mu_rules):
    """A shift on the weekly rest day (Sunday) is paid at the 2× rest-day rate."""
    co = _company(db)
    pu, job = _import_employee(db, co.company_id)
    _set_hourly(db, job, "200")
    job.weekly_rest_day_dow = 7  # Sunday
    db.commit()
    d = date(2026, 5, 10)        # Sunday in the May period
    st = datetime.combine(d, time(9, 0), tzinfo=timezone.utc)
    db.add(TimeLog(private_user_id=pu.private_user_id, job_id=job.job_id, day_of_week="Sunday",
                   start_time=st, end_time=st + timedelta(hours=6), hours_worked=Decimal("6.00"),
                   location={}, admin_approved=True))
    db.commit()
    ps = _run(db, co, [pu.private_user_id])[pu.private_user_id]
    assert Decimal(ps.gross) == Decimal("2400.00")  # 6h × 200 × 2


def test_termination_final_pay_prorated_no_post_term_dock(db: Session, seed_mu_rules):
    """A leaver is prorated to their pre-termination period and NOT docked for
    working days after their end_date."""
    co = _company(db, require_approved=True)
    pu, job = _import_employee(db, co.company_id)
    wd = _wdays(db, job)
    end = wd[len(wd) // 2]
    job.end_date = end
    db.commit()
    _clock_days(db, pu, job, [d for d in wd if d <= end])  # present every employed day
    ps = _run(db, co, [pu.private_user_id])[pu.private_user_id]
    assert _absence_amount(ps) == Decimal("0.00")
    assert Decimal(ps.gross) < Decimal("30000")  # prorated to pre-termination


def test_mid_period_joiner_assignment_still_gets_a_payslip(db: Session, seed_mu_rules):
    """A joiner whose salary ASSIGNMENT only becomes effective mid-period (not
    active on period_start) is still included in the run and paid pro-rata —
    previously they were silently dropped from their joining month entirely."""
    from core.model import EmployeeSalaryAssignment
    co = _company(db, require_approved=True)
    pu, job = _import_employee(db, co.company_id)
    join = PERIOD_START.replace(day=16)
    job.first_date_of_employment = datetime.combine(join, time.min)
    asg = db.query(EmployeeSalaryAssignment).filter(
        EmployeeSalaryAssignment.private_user_id == pu.private_user_id).first()
    asg.effective_from = join                       # assignment not active on period_start
    db.commit()
    _clock_days(db, pu, job, [d for d in _wdays(db, job) if d >= join])
    payslips = _run(db, co, [pu.private_user_id])
    assert pu.private_user_id in payslips, "mid-period joiner was dropped from the run"
    ps = payslips[pu.private_user_id]
    assert _absence_amount(ps) == Decimal("0.00")
    assert Decimal("0") < Decimal(ps.gross) < Decimal("30000")  # paid, pro-rated


# ── Rows 20-25 — EOY bonus, salaried-OT WARN, holiday, paid leave, loan ledger, correction ──
def test_eoy_gratuity_paid_on_december_run(db: Session, seed_mu_rules):
    """End-of-Year Gratuity (MU): on the December run an employee with >=12
    months service gets a bonus = annual earnings / 12 (a 13th month)."""
    import calendar as _cal
    co = _company(db)
    pu, job = _import_employee(db, co.company_id, base_salary="30000")  # employed since 2024
    for m in range(1, 12):  # finalize Jan..Nov 2026 to build the YTD ledger
        last = _cal.monthrange(2026, m)[1]
        r = payroll_engine.create_draft_run(db, PayrollRunCreate(
            company_id=co.company_id, period_start=date(2026, m, 1), period_end=date(2026, m, last)), actor_user_id=None)
        db.flush(); payroll_engine.finalize_run(db, r.id, actor_user_id=None); db.commit()
    dec = payroll_engine.create_draft_run(db, PayrollRunCreate(
        company_id=co.company_id, period_start=date(2026, 12, 1), period_end=date(2026, 12, 31)), actor_user_id=None)
    db.commit()
    ps = db.query(Payslip).filter(Payslip.payroll_run_id == dec.id, Payslip.private_user_id == pu.private_user_id).first()
    bonus = next((Decimal(str(c["amount"])) for c in (ps.components or []) if c.get("source") == "bonus"), Decimal("0"))
    assert bonus == Decimal("30000.00")          # 12 × 30000 / 12 = one month's pay
    assert Decimal(ps.bonus) == bonus


def test_salaried_eligible_overtime_flagged_not_paid(db: Session, seed_mu_rules):
    """A MONTHLY_ELIGIBLE salaried worker UNDER the OT cap who works >45h in a
    week is flagged for review (WARN) but NOT auto-paid the overtime."""
    import os
    os.environ["SALARIED_OT_MODE"] = "warn"
    co = _company(db, require_approved=True)
    pu, job = _import_employee(db, co.company_id, base_salary="30000")  # 360k/yr < 600k cap
    job.overtime_eligibility = "MONTHLY_ELIGIBLE"; db.commit()
    wd = _wdays(db, job)
    week = [d for d in wd if (d - wd[0]).days < 7][:5]   # 5 days × 10h = 50h
    for d in wd:
        st = datetime.combine(d, time(8, 0), tzinfo=timezone.utc)
        hrs = 10 if d in week else 8
        db.add(TimeLog(private_user_id=pu.private_user_id, job_id=job.job_id, day_of_week=d.strftime("%A"),
                       start_time=st, end_time=st + timedelta(hours=hrs), hours_worked=Decimal(hrs), location={}, admin_approved=True))
    db.commit()
    run = payroll_engine.create_draft_run(db, PayrollRunCreate(
        company_id=co.company_id, period_start=PERIOD_START, period_end=PERIOD_END, private_user_ids=[pu.private_user_id]), actor_user_id=None)
    db.flush()
    ps = db.query(Payslip).filter(Payslip.payroll_run_id == run.id, Payslip.private_user_id == pu.private_user_id).first()
    assert any("salaried_ot_review" in f for f in (run.compliance_flags or [])), "WARN flag missing"
    ot = sum((Decimal(str(c["amount"])) for c in (ps.components or []) if c.get("kind") == "earning" and not c.get("is_basic")), Decimal("0"))
    assert ot == Decimal("0.00")                 # WARN: not auto-paid
    assert Decimal(ps.gross) == Decimal("30000.00")


def test_public_holiday_shift_paid_at_premium(db: Session, seed_mu_rules):
    """An hourly worker who works on a MU public holiday (1 May, Labour Day) is
    paid the holiday premium, not the flat base rate."""
    co = _company(db)
    pu, job = _import_employee(db, co.company_id)
    _set_hourly(db, job, "200")
    d = date(2026, 5, 1)  # seeded MU holiday
    st = datetime.combine(d, time(9, 0), tzinfo=timezone.utc)
    db.add(TimeLog(private_user_id=pu.private_user_id, job_id=job.job_id, day_of_week="Friday",
                   start_time=st, end_time=st + timedelta(hours=6), hours_worked=Decimal("6"), location={}, admin_approved=True))
    db.commit()
    ps = _run(db, co, [pu.private_user_id])[pu.private_user_id]
    assert Decimal(ps.gross) > Decimal("1200")   # > 6h × 200 flat
    assert any("HOLIDAY" in (c.get("code") or "") for c in (ps.components or []))


def test_paid_leave_is_not_docked(db: Session, seed_mu_rules):
    """Approved PAID leave (e.g. annual) is not deducted from pay, and is not
    counted as an absence."""
    from core.model import Leave
    co = _company(db, require_approved=True)
    pu, job = _import_employee(db, co.company_id)
    wd = _wdays(db, job)
    _clock_days(db, pu, job, wd[:-1])
    db.add(Leave(private_user_id=pu.private_user_id, leave_type="annual",
                 start_date=wd[-1], end_date=wd[-1], status="approved"))
    db.commit()
    ps = _run(db, co, [pu.private_user_id])[pu.private_user_id]
    assert _absence_amount(ps) == Decimal("0.00")
    assert Decimal(ps.leave_impact) == Decimal("0.00")
    assert Decimal(ps.gross) == Decimal("30000.00")


def test_loan_repayment_recorded_to_ledger_on_finalize(db: Session, seed_mu_rules):
    """On finalize, the loan installment is stamped as a Repayment row and
    advances Loan.repaid_amount (durable ledger)."""
    from core.model import Repayment
    co = _company(db)
    pu, job = _import_employee(db, co.company_id)
    loan = Loan(private_user_id=pu.private_user_id, description="advance", amount=12000.0,
                loan_type="employer", status="active", start_date=date(2024, 1, 1),
                duration_months=12, payment_frequency="monthly")
    db.add(loan); db.commit()
    run = payroll_engine.create_draft_run(db, PayrollRunCreate(
        company_id=co.company_id, period_start=PERIOD_START, period_end=PERIOD_END, private_user_ids=[pu.private_user_id]), actor_user_id=None)
    db.flush(); payroll_engine.finalize_run(db, run.id, actor_user_id=None); db.commit()
    db.refresh(loan)
    assert Decimal(str(loan.repaid_amount)) == Decimal("1000.00")  # 12000 / 12
    rep = db.query(Repayment).filter(Repayment.loan_id == loan.loan_id, Repayment.payroll_run_id == run.id).first()
    assert rep is not None and Decimal(str(rep.amount)) == Decimal("1000.00")


def test_salary_correction_recomputes_after_data_fix(db: Session, seed_mu_rules):
    """Salary correction: after fixing a wrongly-docked absence, recomputing the
    employee for the finalized run reflects the corrected (higher) pay."""
    co = _company(db, require_approved=True)
    pu, job = _import_employee(db, co.company_id)
    wd = _wdays(db, job)
    _clock_days(db, pu, job, wd[:-1])  # one "absence"
    run = payroll_engine.create_draft_run(db, PayrollRunCreate(
        company_id=co.company_id, period_start=PERIOD_START, period_end=PERIOD_END, private_user_ids=[pu.private_user_id]), actor_user_id=None)
    db.flush(); payroll_engine.finalize_run(db, run.id, actor_user_id=None); db.commit()
    orig = db.query(Payslip).filter(Payslip.payroll_run_id == run.id, Payslip.private_user_id == pu.private_user_id).first()
    assert _absence_amount(orig) > Decimal("0")
    _clock_days(db, pu, job, [wd[-1]])  # correction: add the missing day
    corrected = payroll_engine.recompute_employee_for_run(db, run, pu.private_user_id)
    assert Decimal(str(corrected["gross"])) == Decimal("30000.00")
    assert Decimal(str(corrected["net_pay"])) > Decimal(str(orig.net_pay))  # credited back


def test_terminated_employee_excluded_from_later_runs(db: Session, seed_mu_rules):
    """A worker who left mid-period is in their FINAL month's run but is excluded
    from any LATER run — no phantom payslip / EOY months after they've gone."""
    from core.model import EmployeeSalaryAssignment, PayrollRun
    co = _company(db, require_approved=True)
    pu, job = _import_employee(db, co.company_id)
    end = PERIOD_START.replace(day=15)
    job.end_date = end
    asg = db.query(EmployeeSalaryAssignment).filter(
        EmployeeSalaryAssignment.private_user_id == pu.private_user_id).first()
    asg.effective_to = end
    db.commit()
    _clock_days(db, pu, job, [d for d in _wdays(db, job) if d <= end])
    # final (May) run includes them
    assert pu.private_user_id in _run(db, co, [pu.private_user_id])
    # a later month (June) excludes them entirely
    for r in db.query(PayrollRun).filter(
        PayrollRun.company_id == co.company_id, PayrollRun.period_start == PERIOD_START,
        PayrollRun.status != "cancelled").all():
        payroll_engine.cancel_run(db, r.id)
    db.flush()
    jun = payroll_engine.create_draft_run(db, PayrollRunCreate(
        company_id=co.company_id, period_start=date(2026, 6, 1), period_end=date(2026, 6, 30),
        private_user_ids=[pu.private_user_id]), actor_user_id=None)
    db.flush()
    assert db.query(Payslip).filter(
        Payslip.payroll_run_id == jun.id, Payslip.private_user_id == pu.private_user_id).count() == 0


# ── Rows 26-29 — interaction edge cases ──────────────────────────────────────
def test_absence_and_unpaid_leave_dock_distinct_days_only(db: Session, seed_mu_rules):
    """An absence and an unpaid-leave day in the same month are each docked once,
    on their own day — they never stack on the same day."""
    from core.model import Leave
    co = _company(db, require_approved=True)
    pu, job = _import_employee(db, co.company_id)
    wd = _wdays(db, job)
    _clock_days(db, pu, job, wd[:-2])  # absent wd[-2]; wd[-1] is unpaid leave
    db.add(Leave(private_user_id=pu.private_user_id, leave_type="unpaid",
                 start_date=wd[-1], end_date=wd[-1], status="approved"))
    db.commit()
    ps = _run(db, co, [pu.private_user_id])[pu.private_user_id]
    assert _absence_amount(ps) == (Decimal("30000") / 22).quantize(Decimal("0.01"))           # 1 absent day
    assert Decimal(ps.leave_impact) == (Decimal("30000") / len(wd)).quantize(Decimal("0.01"))  # 1 unpaid leave day


def test_multiple_loans_summed_with_final_installment_capped(db: Session, seed_mu_rules):
    """Two employer loans both deduct; the near-complete one is capped at its
    remaining balance (no over-deduction on the last installment)."""
    co = _company(db)
    pu, job = _import_employee(db, co.company_id)
    db.add(Loan(private_user_id=pu.private_user_id, description="A", amount=12000.0,
                loan_type="employer", status="active", start_date=date(2024, 1, 1),
                duration_months=12, payment_frequency="monthly"))                  # 1000/mo
    db.add(Loan(private_user_id=pu.private_user_id, description="B", amount=6000.0,
                repaid_amount=5500.0, loan_type="employer", status="active",
                start_date=date(2024, 1, 1), duration_months=6, payment_frequency="monthly"))  # 1000 inst, 500 left
    db.commit()
    ps = _run(db, co, [pu.private_user_id])[pu.private_user_id]
    assert Decimal(ps.loan_repayments) == Decimal("1500.00")  # 1000 + capped 500


def test_personal_loan_never_deducted_from_pay(db: Session, seed_mu_rules):
    """A 'personal' (self-tracked) loan is NOT deducted from salary — only
    employer loans are."""
    co = _company(db)
    pu, job = _import_employee(db, co.company_id)
    db.add(Loan(private_user_id=pu.private_user_id, description="personal", amount=12000.0,
                loan_type="personal", status="active", start_date=date(2024, 1, 1),
                duration_months=12, payment_frequency="monthly"))
    db.commit()
    ps = _run(db, co, [pu.private_user_id])[pu.private_user_id]
    assert Decimal(ps.loan_repayments) == Decimal("0.00")


def test_payslip_snapshots_home_site_branch(db: Session, seed_mu_rules):
    """The employee's assigned site/branch is frozen on the payslip at run time,
    and the read endpoint resolves its display name."""
    from api.v1.payroll import _enrich_payslip

    # Unassigned employee → payslip carries no site.
    co0 = _company(db)
    pu0, _ = _import_employee(db, co0.company_id)
    ps0 = _run(db, co0, [pu0.private_user_id])[pu0.private_user_id]
    assert ps0.home_geofence_id is None

    # Assigned employee → the run snapshots the branch; enrich names it.
    co1 = _company(db)
    pu1, _ = _import_employee(db, co1.company_id)
    site = CompanyGeofence(company_id=co1.company_id, name="Vacoas Branch",
                           address="Vacoas", latitude=-20.30, longitude=57.48,
                           radius_meters=200, mode="flag")
    db.add(site)
    db.commit()
    db.refresh(site)
    pu1.home_geofence_id = site.geofence_id
    db.commit()
    ps1 = _run(db, co1, [pu1.private_user_id])[pu1.private_user_id]
    assert ps1.home_geofence_id == site.geofence_id
    out = _enrich_payslip(ps1, db)
    assert out.home_geofence_id == site.geofence_id
    assert out.home_site_name == "Vacoas Branch"
