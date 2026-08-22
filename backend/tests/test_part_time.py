"""M20 — Part-time fields + engine branching.

Verifies the proration helpers and the payroll engine's pay-basis branching.
"""

from datetime import date, datetime, timedelta, time, timezone
from decimal import Decimal

import pytest

from services import payroll_engine, payroll_rules, proration
from services.salary_resolver import resolve_components


# ---------------------------------------------------------------------------
# Proration helpers
# ---------------------------------------------------------------------------


class TestWorkingDaysInPeriod:
    def test_full_business_month(self, db, seed_mu_rules):
        # May 2026: 1 May (Fri) ... 31 May (Sun). Mon-Fri count, minus the
        # one seeded MU public holiday in May 2026: Labour Day (Fri 1 May).
        days = proration.working_days_in_period(
            db, country_code="MU", start=date(2026, 5, 1), end=date(2026, 5, 31)
        )
        # 1 (Fri), 4-8, 11-15, 18-22, 25-29 = 21 weekdays, less Labour Day
        # (Fri 1 May) = 20 working days.
        assert days == 20

    def test_partial_period(self, db, seed_mu_rules):
        # Mon 4 May → Fri 8 May = 5 working days
        days = proration.working_days_in_period(
            db, country_code="MU", start=date(2026, 5, 4), end=date(2026, 5, 8)
        )
        assert days == 5

    def test_six_day_week_mask(self, db, seed_mu_rules):
        # Same May 2026 but with Saturday included.
        mask = {"Monday": "...", "Tuesday": "...", "Wednesday": "...",
                "Thursday": "...", "Friday": "...", "Saturday": "..."}
        days = proration.working_days_in_period(
            db, country_code="MU", start=date(2026, 5, 1), end=date(2026, 5, 31),
            work_days_mask=mask,
        )
        # 21 weekdays + 5 Saturdays (May 2, 9, 16, 23, 30) = 26, less the
        # Labour Day public holiday (Fri 1 May) = 25.
        assert days == 25

    def test_end_before_start_returns_zero(self, db, seed_mu_rules):
        days = proration.working_days_in_period(
            db, country_code="MU", start=date(2026, 5, 10), end=date(2026, 5, 1)
        )
        assert days == 0


class TestComputeProrationFactor:
    def test_full_month_returns_one(self, db, seed_mu_rules):
        f = proration.compute_proration_factor(
            db,
            employee_start=None,
            employee_end=None,
            period_start=date(2026, 5, 1),
            period_end=date(2026, 5, 31),
            country_code="MU",
        )
        assert f == Decimal("1.00000000")

    def test_mid_month_joiner(self, db, seed_mu_rules):
        # Joins Mon 18 May 2026 → 10 working days (18-22, 25-29), none of
        # them holidays. Full-month denominator is 20 working days (21
        # weekdays less Labour Day, Fri 1 May).
        f = proration.compute_proration_factor(
            db,
            employee_start=date(2026, 5, 18),
            employee_end=None,
            period_start=date(2026, 5, 1),
            period_end=date(2026, 5, 31),
            country_code="MU",
        )
        # 10/20 = 0.50000000 at 8dp
        assert f == Decimal("0.50000000")

    def test_leaver_before_period_returns_zero(self, db, seed_mu_rules):
        f = proration.compute_proration_factor(
            db,
            employee_start=date(2024, 1, 1),
            employee_end=date(2026, 4, 30),
            period_start=date(2026, 5, 1),
            period_end=date(2026, 5, 31),
            country_code="MU",
        )
        assert f == Decimal("0.00000000")


# ---------------------------------------------------------------------------
# Engine branching
# ---------------------------------------------------------------------------


def _set_employment(db, employee_id, *, fte=Decimal("1.000"), employment_type="full_time"):
    from core.model import PrivateUser
    e = db.query(PrivateUser).filter(PrivateUser.private_user_id == employee_id).one()
    e.fte = fte
    e.employment_type = employment_type
    db.flush()


def _set_pay_basis(db, employee_id, *, pay_basis="monthly", hourly_rate=None, daily_rate=None):
    from core.model import Job, Salary
    salary = (
        db.query(Salary)
        .join(Job, Salary.job_id == Job.job_id)
        .filter(Job.private_user_id == employee_id)
        .order_by(Salary.created_at.desc())
        .first()
    )
    salary.pay_basis = pay_basis
    salary.hourly_rate = hourly_rate
    salary.daily_rate = daily_rate
    db.flush()


def _set_job_dates(db, employee_id, *, start_date=None, end_date=None):
    from core.model import Job
    job = (
        db.query(Job)
        .filter(Job.private_user_id == employee_id)
        .order_by(Job.created_at.desc())
        .first()
    )
    if start_date is not None:
        # first_date_of_employment is DateTime
        job.first_date_of_employment = datetime.combine(start_date, time.min)
    job.end_date = end_date
    db.flush()


class TestMonthlyFteAndProration:
    def test_full_time_full_month_unchanged(self, db, seed_mu_rules, test_employee):
        # Default fixture: fte=1.000, full_time, joined 2024-01-01.
        from core.model import PrivateUser
        company_country = "MU"
        period_start, period_end = date(2026, 5, 1), date(2026, 5, 31)

        resolved_before = resolve_components(db, test_employee.private_user_id, period_start)
        basic_before = next(c.amount for c in resolved_before.components if c.is_basic)
        allowance_before = next(c.amount for c in resolved_before.components if not c.is_basic)

        # Full path through engine helper
        from services.payroll_engine import _apply_pay_basis
        resolved_after = resolve_components(db, test_employee.private_user_id, period_start)
        _apply_pay_basis(db, test_employee, period_start, period_end, company_country, resolved_after)
        basic_after = next(c.amount for c in resolved_after.components if c.is_basic)
        allowance_after = next(c.amount for c in resolved_after.components if not c.is_basic)

        assert basic_after == basic_before
        assert allowance_after == allowance_before

    def test_half_time_fte_halves_earnings(self, db, seed_mu_rules, test_employee):
        _set_employment(db, test_employee.private_user_id, fte=Decimal("0.500"), employment_type="part_time")
        from services.payroll_engine import _apply_pay_basis
        resolved = resolve_components(db, test_employee.private_user_id, date(2026, 5, 1))
        _apply_pay_basis(db, test_employee, date(2026, 5, 1), date(2026, 5, 31), "MU", resolved)
        basic = next(c.amount for c in resolved.components if c.is_basic)
        allowance = next(c.amount for c in resolved.components if not c.is_basic)
        assert basic == Decimal("15000.00")  # 30000 × 0.5
        assert allowance == Decimal("3000.00")  # 6000 × 0.5

        # Restore
        _set_employment(db, test_employee.private_user_id, fte=Decimal("1.000"), employment_type="full_time")

    def test_mid_month_joiner_prorates_earnings(self, db, seed_mu_rules, test_employee):
        from services.payroll_engine import _apply_pay_basis
        _set_job_dates(db, test_employee.private_user_id, start_date=date(2026, 5, 18))

        resolved = resolve_components(db, test_employee.private_user_id, date(2026, 5, 1))
        _apply_pay_basis(db, test_employee, date(2026, 5, 1), date(2026, 5, 31), "MU", resolved)
        basic = next(c.amount for c in resolved.components if c.is_basic)
        # 30000 × 10/20 = 15000.00 (denominator excludes Labour Day, 1 May)
        assert basic == Decimal("15000.00")

        # Restore
        _set_job_dates(db, test_employee.private_user_id, start_date=date(2024, 1, 1), end_date=None)


class TestHourlyBasis:
    def test_hourly_replaces_basic_with_hours_times_rate(
        self, db, seed_mu_rules, test_employee, test_company,
    ):
        from core.model import TimeLog, Job
        from services.payroll_engine import _apply_pay_basis

        _set_pay_basis(
            db, test_employee.private_user_id,
            pay_basis="hourly", hourly_rate=Decimal("250.00"),
        )

        # Insert two time logs in May 2026 totalling 80 hours.
        job = db.query(Job).filter(Job.private_user_id == test_employee.private_user_id).first()
        period = date(2026, 5, 1)
        for offset, hrs in [(0, Decimal("40.00")), (7, Decimal("40.00"))]:
            day = period + timedelta(days=offset)
            db.add(TimeLog(
                job_id=job.job_id,
                private_user_id=test_employee.private_user_id,
                day_of_week=day.strftime("%A"),
                start_time=datetime.combine(day, time(9, 0)),
                end_time=datetime.combine(day, time(17, 0)),
                location={"lat": 0, "lng": 0},
                hours_worked=hrs,
            ))
        db.flush()

        resolved = resolve_components(db, test_employee.private_user_id, period)
        _apply_pay_basis(db, test_employee, period, date(2026, 5, 31), "MU", resolved)

        # Basic = 80 × 250 = 20000
        basic = next(c.amount for c in resolved.components if c.is_basic)
        assert basic == Decimal("20000.00")
        # The structure-sourced ALLOWANCE is dropped under hourly basis.
        non_basic_earnings = [c for c in resolved.components if c.kind == "earning" and not c.is_basic]
        assert non_basic_earnings == []

        # Cleanup
        db.query(TimeLog).filter(TimeLog.private_user_id == test_employee.private_user_id).delete()
        _set_pay_basis(db, test_employee.private_user_id, pay_basis="monthly")
        db.flush()

    def test_hourly_with_no_logs_yields_zero(self, db, seed_mu_rules, test_employee):
        from services.payroll_engine import _apply_pay_basis
        _set_pay_basis(
            db, test_employee.private_user_id,
            pay_basis="hourly", hourly_rate=Decimal("250.00"),
        )

        resolved = resolve_components(db, test_employee.private_user_id, date(2026, 5, 1))
        _apply_pay_basis(db, test_employee, date(2026, 5, 1), date(2026, 5, 31), "MU", resolved)

        basic = next(c.amount for c in resolved.components if c.is_basic)
        assert basic == Decimal("0.00")

        _set_pay_basis(db, test_employee.private_user_id, pay_basis="monthly")

    def test_hourly_break_fallback_when_none_logged(self, db, seed_mu_rules, test_employee):
        """#3 — an hourly shift with NO logged break has the salary profile's
        break_in_minutes_per_day deducted; a shift that DID log a break keeps the
        logged value. Exercises the bucketed overtime engine path (an overtime
        rule is passed in, so this doesn't hit the no-rule-configured fallback)."""
        from core.model import TimeLog, BreakLog, Job, Salary
        from services.payroll_engine import _apply_pay_basis

        _set_pay_basis(db, test_employee.private_user_id, pay_basis="hourly", hourly_rate=Decimal("200.00"))
        sal = (
            db.query(Salary).join(Job, Salary.job_id == Job.job_id)
            .filter(Job.private_user_id == test_employee.private_user_id)
            .order_by(Salary.created_at.desc()).first()
        )
        job = db.query(Job).filter(Job.private_user_id == test_employee.private_user_id).first()

        ps, pe = date(2026, 5, 4), date(2026, 5, 31)  # Mon 4 May (1 May is a public holiday)

        def add_shift(d, logged_break_min):
            tl = TimeLog(
                job_id=job.job_id, private_user_id=test_employee.private_user_id,
                day_of_week=d.strftime("%A"),
                start_time=datetime.combine(d, time(9, 0), tzinfo=timezone.utc),
                end_time=datetime.combine(d, time(17, 0), tzinfo=timezone.utc),
                location={}, hours_worked=Decimal("8.00"), admin_approved=True,
            )
            db.add(tl); db.flush()
            if logged_break_min:
                bs = datetime.combine(d, time(12, 0), tzinfo=timezone.utc)
                db.add(BreakLog(timelog_id=tl.timelog_id, start_time=bs,
                                end_time=bs + timedelta(minutes=logged_break_min)))
            db.flush()

        add_shift(date(2026, 5, 4), 30)   # logged 30m  -> 7.5h
        add_shift(date(2026, 5, 5), 0)    # no break    -> profile fills it
        db.flush()

        rule = payroll_rules.resolve_overtime_rule(db, "MU", ps)

        def basic_for(break_cfg):
            sal.break_in_minutes_per_day = break_cfg
            db.flush()
            resolved = resolve_components(db, test_employee.private_user_id, ps)
            _apply_pay_basis(db, test_employee, ps, pe, "MU", resolved,
                             overtime_rule=rule)
            return sum((c.amount for c in resolved.components if c.kind == "earning"), Decimal("0"))

        # Profile break OFF → the un-logged day pays a full 8h.
        assert basic_for(0) == Decimal("3100.00")   # (7.5 + 8.0) × 200
        # Profile break ON (30m) → un-logged day drops to 7.5h; logged day unchanged.
        assert basic_for(30) == Decimal("3000.00")  # (7.5 + 7.5) × 200

        db.query(BreakLog).filter(BreakLog.timelog_id.in_(
            db.query(TimeLog.timelog_id).filter(TimeLog.private_user_id == test_employee.private_user_id)
        )).delete(synchronize_session=False)
        db.query(TimeLog).filter(TimeLog.private_user_id == test_employee.private_user_id).delete()
        _set_pay_basis(db, test_employee.private_user_id, pay_basis="monthly")
        db.flush()

    def test_hourly_open_break_deducted_through_bucketed_engine(
        self, db, seed_mu_rules, test_employee, test_company,
    ):
        """A break the worker never explicitly ended (BreakLog.end_time NULL)
        must still be deducted through to the shift's own end_time when the
        real payroll engine buckets hours for overtime — not silently paid
        through. This is the same class of bug fixed in
        db_models/crud/job.py::update_time_log's stored hours_worked calc
        (test_open_break_clockout.py), but here in the bucketed engine that
        create_draft_run/finalize_run actually use for real money."""
        from core.model import TimeLog, BreakLog, Job
        from services.payroll_engine import _apply_pay_basis

        _set_pay_basis(db, test_employee.private_user_id, pay_basis="hourly", hourly_rate=Decimal("200.00"))
        job = db.query(Job).filter(Job.private_user_id == test_employee.private_user_id).first()

        ps, pe = date(2026, 5, 4), date(2026, 5, 31)  # Mon 4 May (1 May is a public holiday)
        d = date(2026, 5, 4)
        tl = TimeLog(
            job_id=job.job_id, private_user_id=test_employee.private_user_id,
            day_of_week=d.strftime("%A"),
            start_time=datetime.combine(d, time(9, 0), tzinfo=timezone.utc),
            end_time=datetime.combine(d, time(17, 0), tzinfo=timezone.utc),
            location={}, hours_worked=Decimal("8.00"), admin_approved=True,
        )
        db.add(tl); db.flush()
        # Break started at noon, never explicitly ended (end_time stays NULL).
        db.add(BreakLog(
            timelog_id=tl.timelog_id,
            start_time=datetime.combine(d, time(12, 0), tzinfo=timezone.utc),
            end_time=None,
        ))
        db.flush()

        rule = payroll_rules.resolve_overtime_rule(db, "MU", ps)
        resolved = resolve_components(db, test_employee.private_user_id, ps)
        _apply_pay_basis(db, test_employee, ps, pe, "MU", resolved, overtime_rule=rule)

        earnings = sum((c.amount for c in resolved.components if c.kind == "earning"), Decimal("0"))
        # 09:00-17:00 = 8h raw. The open break (12:00 -> shift end 17:00 = 5h)
        # must be deducted through to the shift's end, not ignored -> 3h paid.
        assert earnings == Decimal("600.00")  # 3h x 200

        db.query(BreakLog).filter(BreakLog.timelog_id == tl.timelog_id).delete(synchronize_session=False)
        db.query(TimeLog).filter(TimeLog.private_user_id == test_employee.private_user_id).delete()
        _set_pay_basis(db, test_employee.private_user_id, pay_basis="monthly")
        db.flush()
