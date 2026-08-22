"""#17 — salaried absence deduction.

Unit tests for `payroll_engine._compute_salaried_absence_for_period`: a
monthly-paid employee's fixed basic is docked for scheduled working days they
neither clocked in for nor took approved leave on — but only when the company
runs clock-driven payroll, and never for an untracked employee.

These build a throwaway monthly employee and call the function directly. Nothing
is committed, so the rows are discarded when the session closes (plus an explicit
rollback at fixture teardown) — no cross-test pollution.
"""

from datetime import date, datetime, time, timezone
from decimal import Decimal

import pytest

from core.model import Job, Leave, PrivateUser, Salary, TimeLog, User
from services import payroll_engine, proration


PERIOD_START = date(2026, 6, 1)
PERIOD_END = date(2026, 6, 30)
BASIC = Decimal("30000.00")
TZ = "Indian/Mauritius"


@pytest.fixture()
def salaried_worker(db, test_company_id):
    """A throwaway monthly-paid employee (pay_basis='monthly', Mon–Fri default
    schedule). Never committed → auto-discarded; explicit rollback on teardown."""
    owner = User(
        user_type="private",
        email="absence-test@kontokaz.test",
        user_name="absence-test",
        password_hash="x",
    )
    db.add(owner)
    db.flush()
    priv = PrivateUser(
        user_id=owner.user_id,
        first_name="Abs",
        last_name="Ent",
        company_id=test_company_id,
        pass_port_number="ABS_TEST_FIXTURE",
        role="employee",
    )
    db.add(priv)
    db.flush()
    job = Job(
        private_user_id=priv.private_user_id,
        company_id=test_company_id,
        job_title="Tester",
        employer_name="Kontokaz Test Co.",
        employer_brn="TEST_BRN_FIXTURE",
        employer_email="employer@kontokaz.test",
        first_date_of_employment=date(2024, 1, 1),
    )
    db.add(job)
    db.flush()
    db.add(Salary(job_id=job.job_id, pay_basis="monthly", salary=BASIC))
    db.flush()
    priv._job_id = job.job_id  # stash for clock-in helper
    yield priv
    db.rollback()


def _add_clockins(db, worker, dates, *, approved=True, rejected=False):
    for d in dates:
        db.add(TimeLog(
            private_user_id=worker.private_user_id,
            job_id=worker._job_id,
            start_time=datetime.combine(d, time(8, 0), tzinfo=timezone.utc),
            end_time=datetime.combine(d, time(16, 0), tzinfo=timezone.utc),
            hours_worked=Decimal("8.00"),
            location={},
            admin_approved=approved,
            admin_rejected=rejected,
        ))
    db.flush()


def _working_dates(db):
    return sorted(
        proration.working_dates_in_period(db, "MU", PERIOD_START, PERIOD_END, None)
    )


def _call(db, worker, *, require_approved=True):
    return payroll_engine._compute_salaried_absence_for_period(
        db, "MU", worker, BASIC, PERIOD_START, PERIOD_END, TZ, require_approved,
    )


def test_two_missed_days_deducts_two_daily_slices(db, salaried_worker):
    work = _working_dates(db)
    total = len(work)
    assert total > 2
    # Present on every working day except the last two.
    _add_clockins(db, salaried_worker, work[:-2])

    expected = (BASIC / Decimal(total) * Decimal(2)).quantize(Decimal("0.01"))
    assert _call(db, salaried_worker) == expected


def test_full_attendance_deducts_nothing(db, salaried_worker):
    _add_clockins(db, salaried_worker, _working_dates(db))
    assert _call(db, salaried_worker) == Decimal("0.00")


def test_untracked_employee_is_never_zeroed(db, salaried_worker):
    # Zero clock-ins ⇒ untracked, not absent-every-day. Must skip.
    flags: list[str] = []
    result = payroll_engine._compute_salaried_absence_for_period(
        db, "MU", salaried_worker, BASIC, PERIOD_START, PERIOD_END, TZ, True,
        flags_out=flags,
    )
    assert result == Decimal("0.00")
    assert any(f.startswith("salaried_absence_skipped") for f in flags)


def test_gating_off_deducts_nothing(db, salaried_worker):
    # Company hasn't opted into clock-driven payroll → no deduction even with
    # missing days.
    _add_clockins(db, salaried_worker, _working_dates(db)[:-3])
    assert _call(db, salaried_worker, require_approved=False) == Decimal("0.00")


def test_pending_clockins_count_as_presence(db, salaried_worker):
    # Presence is approval-independent: a pending (not-yet-approved) clock-in
    # still proves the person showed up, so it must NOT be docked as absence.
    # This is what keeps the pre-approval estimate equal to the finalized run.
    _add_clockins(db, salaried_worker, _working_dates(db), approved=False)
    assert _call(db, salaried_worker) == Decimal("0.00")


def test_rejected_clockins_fall_back_to_absence(db, salaried_worker):
    work = _working_dates(db)
    total = len(work)
    # Present on every day, but the last two clock-ins were admin-rejected
    # (judged invalid) → those days fall back to absence.
    _add_clockins(db, salaried_worker, work[:-2], approved=True)
    _add_clockins(db, salaried_worker, work[-2:], approved=False, rejected=True)
    expected = (BASIC / Decimal(total) * Decimal(2)).quantize(Decimal("0.01"))
    assert _call(db, salaried_worker) == expected


def _set_days_of_work(db, worker, days):
    sal = db.query(Salary).filter(Salary.job_id == worker._job_id).first()
    sal.days_of_work_per_month = days
    db.flush()


def test_absence_divisor_uses_profile_days_when_set(db, salaried_worker):
    """#1 — one absent day is docked at BASIC ÷ days_of_work_per_month (the
    employer-set 22/26), NOT BASIC ÷ calendar-working-days. Use 26 so the two
    divisors genuinely differ from this month's working-day count."""
    work = _working_dates(db)
    total = len(work)
    _set_days_of_work(db, salaried_worker, 26)
    _add_clockins(db, salaried_worker, work[:-1])  # absent the last working day

    expected = (BASIC / Decimal(26)).quantize(Decimal("0.01"))
    got = _call(db, salaried_worker)
    assert got == expected, f"dock {got} != BASIC/26 {expected}"
    # ...and it genuinely diverges from the old calendar-days behaviour.
    assert got != (BASIC / Decimal(total)).quantize(Decimal("0.01"))


def test_absence_divisor_falls_back_to_calendar_when_unset(db, salaried_worker):
    """#1 — with no days_of_work_per_month configured, the dock falls back to the
    period's actual working days (prior behaviour, unchanged)."""
    work = _working_dates(db)
    total = len(work)
    _add_clockins(db, salaried_worker, work[:-1])  # days_of_work left NULL
    expected = (BASIC / Decimal(total)).quantize(Decimal("0.01"))
    assert _call(db, salaried_worker) == expected


def test_absence_dock_capped_at_gross(db, salaried_worker):
    """#1 — the dock can never exceed the basic, even when a tiny days divisor
    and many absent days would otherwise over-dock."""
    work = _working_dates(db)
    _set_days_of_work(db, salaried_worker, 1)         # each absence = whole salary
    _add_clockins(db, salaried_worker, work[:1])      # present only day 1
    assert _call(db, salaried_worker) == BASIC


def test_mid_period_joiner_not_docked_for_pre_hire_days(db, salaried_worker):
    """Joiner — a mid-month joiner present on every post-join working day is NOT
    docked for the working days before they were hired (proration already pays
    only the post-join portion; docking pre-hire days double-penalises them)."""
    work = _working_dates(db)
    join = work[len(work) // 2]
    job = db.query(Job).filter(Job.job_id == salaried_worker._job_id).first()
    job.first_date_of_employment = datetime.combine(join, time.min)
    db.flush()
    _add_clockins(db, salaried_worker, [d for d in work if d >= join])
    assert _call(db, salaried_worker) == Decimal("0.00")


def test_leaver_not_docked_for_post_termination_days(db, salaried_worker):
    """Leaver — a worker who left mid-month is NOT docked for working days after
    their end_date."""
    work = _working_dates(db)
    end = work[len(work) // 2]
    job = db.query(Job).filter(Job.job_id == salaried_worker._job_id).first()
    job.end_date = end
    db.flush()
    _add_clockins(db, salaried_worker, [d for d in work if d <= end])
    assert _call(db, salaried_worker) == Decimal("0.00")


def test_projection_as_of_excludes_future_days(db, salaried_worker):
    """Projection — with as_of mid-period, scheduled days AFTER as_of are not
    counted as absences, so a mid-period run is a true 'so far' projection."""
    work = _working_dates(db)
    mid = work[len(work) // 2]
    _add_clockins(db, salaried_worker, [d for d in work if d <= mid])  # nothing after mid
    impact = payroll_engine._compute_salaried_absence_for_period(
        db, "MU", salaried_worker, BASIC, PERIOD_START, PERIOD_END, TZ, True, as_of=mid,
    )
    assert impact == Decimal("0.00")


def test_without_as_of_future_days_are_docked(db, salaried_worker):
    """Contrast — a normal final run (no as_of) DOES dock the not-yet-worked
    days, which is why mid-period projections need as_of."""
    work = _working_dates(db)
    mid = work[len(work) // 2]
    _add_clockins(db, salaried_worker, [d for d in work if d <= mid])
    full = payroll_engine._compute_salaried_absence_for_period(
        db, "MU", salaried_worker, BASIC, PERIOD_START, PERIOD_END, TZ, True,
    )
    assert full > Decimal("0.00")


def test_approved_leave_covers_absence(db, salaried_worker):
    work = _working_dates(db)
    total = len(work)
    # Missing the last two working days, but one is covered by approved leave →
    # only one true absence.
    _add_clockins(db, salaried_worker, work[:-2])
    db.add(Leave(
        private_user_id=salaried_worker.private_user_id,
        leave_type="annual",
        start_date=work[-1],
        end_date=work[-1],
        status="approved",
    ))
    db.flush()
    expected = (BASIC / Decimal(total) * Decimal(1)).quantize(Decimal("0.01"))
    assert _call(db, salaried_worker) == expected
