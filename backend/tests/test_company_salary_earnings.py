"""Tests for GET /job/salary/company/{company_id}/earnings — the aggregate
endpoint replacing mobile's N+1 fetch pattern on the Salaries screen
(see LOAD-TIME plan at ~/.claude/plans/velvety-questing-snowglobe.md).

Every case here uses hand-derivable expected values (not just "> 0" checks),
since this computation has only ever lived as untested TypeScript before
this endpoint existed. The endpoint always operates on "this calendar month"
in the company's local timezone, so all fixture dates are built relative to
`date.today()` rather than hardcoded — day 10 of the current month is used
as a "definitely not a seeded MU public holiday" anchor (checked against the
15 rows seeded for 2026: none fall on the 10th of any month), so non-holiday
test cases can't accidentally collide with the real seeded MU calendar.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from fastapi import Depends as _Depends
from fastapi.testclient import TestClient
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session, sessionmaker

from core.model import (
    Company,
    Department,
    EmployeeSalaryAssignment,
    Job,
    PrivateUser,
    PublicHoliday,
    Salary,
    SalaryComponent,
    SalaryStructure,
    SalaryStructureLine,
    TimeLog,
    User,
)

MU_TZ = ZoneInfo("Indian/Mauritius")
# The 10th never collides with any of the 15 seeded 2026 MU public holidays
# (Jan 1/2, Feb 1/1/15/17, Mar 12/19/21, May 1, Aug 15, Sep 16, Nov 2/8, Dec 25).
SAFE_DAY = 10


def _suffix() -> str:
    return uuid.uuid4().hex[:8]


def _current_month_first() -> date:
    return date.today().replace(day=1)


def _local_dt(day: int, hour: int = 9) -> datetime:
    d = _current_month_first().replace(day=day)
    return datetime(d.year, d.month, d.day, hour, 0, tzinfo=MU_TZ)


class _Fixture:
    """Builds an isolated company + owner for one test; every helper method
    tags rows with the same suffix for cleanup."""

    def __init__(self, db: Session):
        self.db = db
        self.s = _suffix()
        self.company = self._make_company()
        self.job_ids: list[int] = []
        self.pu_ids: list[int] = []
        self.user_ids: list[int] = []
        self.holiday_ids: list[int] = []
        self.user_ids.append(self.company.user_id)

    def _make_company(self) -> Company:
        owner = User(
            user_type="company",
            email=f"earn-owner-{self.s}@kontokaz.test",
            user_name=f"earn-owner-{self.s}",
            password_hash="x",
        )
        self.db.add(owner)
        self.db.flush()
        company = Company(
            user_id=owner.user_id,
            company_name=f"Earnings Co {self.s}",
            email=f"earn-co-{self.s}@kontokaz.test",
            brn=f"EARNBRN{self.s.upper()}",
            country_code="MU",
            timezone="Indian/Mauritius",
        )
        self.db.add(company)
        self.db.commit()
        return company

    def make_employee(self, tag: str, fte: str = "1.000", onboarding_status: str = "approved") -> PrivateUser:
        u = User(
            user_type="private",
            email=f"earn-{tag}-{self.s}@kontokaz.test",
            user_name=f"earn-{tag}-{self.s}",
            password_hash="x",
            company_onboarding_status=onboarding_status,
        )
        self.db.add(u)
        self.db.flush()
        pu = PrivateUser(
            user_id=u.user_id,
            first_name=tag.title(),
            last_name="Test",
            company_id=self.company.company_id,
            pass_port_number=f"EARN_{tag.upper()}_{self.s}",
            role="employee",
            fte=Decimal(fte),
        )
        self.db.add(pu)
        self.db.commit()
        self.user_ids.append(u.user_id)
        self.pu_ids.append(pu.private_user_id)
        return pu

    def make_job(self, pu: PrivateUser, tag: str, company: Company | None = None) -> Job:
        company = company or self.company
        job = Job(
            private_user_id=pu.private_user_id,
            company_id=company.company_id,
            department_id=None,
            job_title=f"{tag.title()} Role",
            employer_brn=company.brn,
            work_days=["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        )
        self.db.add(job)
        self.db.commit()
        self.job_ids.append(job.job_id)
        return job

    def make_legacy_salary(self, job: Job, salary: str, allowance: str = "0", monthly_hours: str | None = None) -> Salary:
        sal = Salary(
            job_id=job.job_id,
            monthly_hours=monthly_hours,
            days_of_work_per_month=22,
            salary=Decimal(salary),
            allowance=Decimal(allowance),
        )
        self.db.add(sal)
        self.db.commit()
        return sal

    def make_structure_assignment(self, pu: PrivateUser, tag: str, basic: str, allowance: str) -> None:
        basic_c = SalaryComponent(
            company_id=self.company.company_id, code=f"BASIC_{tag}_{self.s}", label="Basic",
            kind="earning", category="earning.basic", is_basic=True, is_taxable=True,
        )
        allow_c = SalaryComponent(
            company_id=self.company.company_id, code=f"ALLOW_{tag}_{self.s}", label="Allowance",
            kind="earning", category="allowance.general", is_basic=False, is_taxable=True,
        )
        self.db.add_all([basic_c, allow_c])
        self.db.flush()

        structure = SalaryStructure(company_id=self.company.company_id, name=f"Structure {tag} {self.s}")
        self.db.add(structure)
        self.db.flush()

        self.db.add_all([
            SalaryStructureLine(structure_id=structure.id, component_id=basic_c.id, amount=Decimal(basic), order_index=0),
            SalaryStructureLine(structure_id=structure.id, component_id=allow_c.id, amount=Decimal(allowance), order_index=1),
        ])
        self.db.add(EmployeeSalaryAssignment(
            private_user_id=pu.private_user_id,
            structure_id=structure.id,
            currency="MUR",
            effective_from=date(2024, 1, 1),
        ))
        self.db.commit()

    def make_time_log(self, job: Job, pu: PrivateUser, day: int, hours: str, is_overtime: bool = False, hour_of_day: int = 9) -> TimeLog:
        log = TimeLog(
            job_id=job.job_id,
            private_user_id=pu.private_user_id,
            start_time=_local_dt(day, hour_of_day),
            end_time=None,
            location={},
            hours_worked=Decimal(hours),
            is_overtime=is_overtime,
            # An overtime claim only counts as overtime pay once the employer
            # explicitly confirms it (api/v1/job.py:1504) — defaults False,
            # which mobile's own precedence check (`confirmed !== false`)
            # deliberately excludes from overtime bucketing. Tests exercising
            # confirmed overtime must set this explicitly.
            overtime_confirmed_by_employer=is_overtime,
        )
        self.db.add(log)
        self.db.commit()
        return log

    def make_holiday(self, day: int, name: str = "Test Holiday") -> PublicHoliday:
        d = _current_month_first().replace(day=day)
        h = PublicHoliday(country_code="MU", name=name, date=d, observed_date=d, year=d.year, is_recurring=False)
        self.db.add(h)
        self.db.commit()
        self.holiday_ids.append(h.holiday_id)
        return h

    def cleanup(self) -> None:
        db = self.db
        db.rollback()
        if self.holiday_ids:
            db.execute(sql_text("DELETE FROM public_holidays WHERE holiday_id = ANY(:ids)"), {"ids": self.holiday_ids})
        db.execute(sql_text("DELETE FROM time_logs WHERE job_id = ANY(:ids)"), {"ids": self.job_ids or [-1]})
        db.execute(sql_text(
            "DELETE FROM time_logs WHERE private_user_id = ANY(:ids)"
        ), {"ids": self.pu_ids or [-1]})
        db.execute(sql_text("DELETE FROM salaries WHERE job_id = ANY(:ids)"), {"ids": self.job_ids or [-1]})
        db.execute(sql_text(
            "DELETE FROM employee_salary_assignments WHERE private_user_id = ANY(:ids)"
        ), {"ids": self.pu_ids or [-1]})
        db.execute(sql_text(
            "DELETE FROM salary_structure_lines WHERE structure_id IN "
            "(SELECT id FROM salary_structures WHERE company_id = :cid)"
        ), {"cid": self.company.company_id})
        db.execute(sql_text("DELETE FROM salary_structures WHERE company_id = :cid"), {"cid": self.company.company_id})
        db.execute(sql_text("DELETE FROM salary_components WHERE company_id = :cid"), {"cid": self.company.company_id})
        db.execute(sql_text("DELETE FROM jobs WHERE job_id = ANY(:ids)"), {"ids": self.job_ids or [-1]})
        db.execute(sql_text("DELETE FROM private_users WHERE private_user_id = ANY(:ids)"), {"ids": self.pu_ids or [-1]})
        db.execute(sql_text("DELETE FROM companies WHERE company_id = :cid"), {"cid": self.company.company_id})
        db.execute(sql_text("DELETE FROM users WHERE user_id = ANY(:ids)"), {"ids": self.user_ids or [-1]})
        db.commit()


@pytest.fixture()
def fixture(db: Session):
    fx = _Fixture(db)
    yield fx
    fx.cleanup()


@pytest.fixture()
def authed_client(_engine, db: Session, fixture: _Fixture):
    """Authenticated as the company's own owner (satisfies
    require_company_admin's `Company.user_id == actor.user_id` check)."""
    from main import app
    from core import config as core_config
    from core.dependencies import get_current_user

    owner_user_id = fixture.company.user_id
    SessionFactory = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

    def _override_db():
        d = SessionFactory()
        try:
            yield d
        finally:
            d.close()

    def _override_user(d: Session = _Depends(core_config.get_db)) -> User:
        return d.query(User).filter(User.user_id == owner_user_id).one()

    app.dependency_overrides[core_config.get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_user
    client = TestClient(app, raise_server_exceptions=False)
    yield client
    app.dependency_overrides.clear()


def _row_for(resp_json, pu_id: int) -> dict:
    rows = {r["id"]: r for r in resp_json}
    assert pu_id in rows, f"private_user_id {pu_id} missing from response: {resp_json}"
    return rows[pu_id]


# ---------------------------------------------------------------------------
# (a) modern SalaryStructure system, known basic + allowance, exact totalIncome
# ---------------------------------------------------------------------------

def test_structure_income_and_regular_pay_exact(authed_client: TestClient, fixture: _Fixture):
    pu = fixture.make_employee("struct")
    job = fixture.make_job(pu, "struct")
    fixture.make_structure_assignment(pu, "struct", basic="20000", allowance="3000")
    # 3 shifts of 8h regular time on a non-holiday day -> 24h total.
    for day in (SAFE_DAY, SAFE_DAY + 1, SAFE_DAY + 2):
        fixture.make_time_log(job, pu, day, "8")

    resp = authed_client.get(f"/api/v1/job/salary/company/{fixture.company.company_id}/earnings")
    assert resp.status_code == 200, resp.text
    row = _row_for(resp.json(), pu.private_user_id)

    assert row["totalIncome"] == pytest.approx(23000.0)
    hourly_rate = 20000 / 195  # DEFAULT_MONTHLY_HOURS, fte=1.000
    assert row["hourlyRate"] == pytest.approx(hourly_rate)
    assert row["totalHoursWorked"] == pytest.approx(24.0)
    assert row["regularPay"] == pytest.approx(24 * hourly_rate)
    assert row["overtimePay"] == pytest.approx(0.0)
    assert row["holidayPay"] == pytest.approx(0.0)
    assert row["estimatedEarnings"] == pytest.approx(24 * hourly_rate)


# ---------------------------------------------------------------------------
# (b) legacy Salary only — exact salary + allowance, explicit monthly_hours honored
# ---------------------------------------------------------------------------

def test_legacy_fallback_exact(authed_client: TestClient, fixture: _Fixture):
    pu = fixture.make_employee("legacy")
    job = fixture.make_job(pu, "legacy")
    fixture.make_legacy_salary(job, salary="15000", allowance="1000", monthly_hours="160")

    resp = authed_client.get(f"/api/v1/job/salary/company/{fixture.company.company_id}/earnings")
    assert resp.status_code == 200, resp.text
    row = _row_for(resp.json(), pu.private_user_id)

    assert row["totalIncome"] == pytest.approx(16000.0)
    assert row["monthlyHours"] == pytest.approx(160.0)
    assert row["hourlyRate"] == pytest.approx(15000 / 160)


# ---------------------------------------------------------------------------
# (c) multi-job employee on the structure system — income NOT doubled
# ---------------------------------------------------------------------------

def test_multi_job_structure_income_not_doubled(authed_client: TestClient, fixture: _Fixture):
    pu = fixture.make_employee("multijob")
    job1 = fixture.make_job(pu, "multijob-1")
    job2 = fixture.make_job(pu, "multijob-2")
    fixture.make_structure_assignment(pu, "multijob", basic="20000", allowance="3000")

    resp = authed_client.get(f"/api/v1/job/salary/company/{fixture.company.company_id}/earnings")
    assert resp.status_code == 200, resp.text
    row = _row_for(resp.json(), pu.private_user_id)

    # Must equal the resolved structure income ONCE (23000), not doubled (46000).
    assert row["totalIncome"] == pytest.approx(23000.0)


# ---------------------------------------------------------------------------
# (d) holiday pay — real PublicHoliday date, exact hand-computed figure
# ---------------------------------------------------------------------------

def test_holiday_pay_exact(authed_client: TestClient, fixture: _Fixture):
    pu = fixture.make_employee("holiday")
    job = fixture.make_job(pu, "holiday")
    # salary=19500, monthly_hours=195 -> hourly_rate exactly 100.00
    fixture.make_legacy_salary(job, salary="19500", allowance="0", monthly_hours="195")
    fixture.make_holiday(SAFE_DAY)
    fixture.make_time_log(job, pu, SAFE_DAY, "8", is_overtime=False)

    resp = authed_client.get(f"/api/v1/job/salary/company/{fixture.company.company_id}/earnings")
    assert resp.status_code == 200, resp.text
    row = _row_for(resp.json(), pu.private_user_id)

    assert row["holidayPay"] == pytest.approx(8 * 100.0 * 2.0)  # 1600.00
    assert row["regularPay"] == pytest.approx(0.0)
    assert row["overtimePay"] == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# (e) zero-job employee — appears in response, hours-only, income = 0
# ---------------------------------------------------------------------------

def test_zero_job_employee_not_dropped(authed_client: TestClient, fixture: _Fixture):
    pu = fixture.make_employee("nojob")
    # No Job row for `pu` at all. TimeLog.job_id is NOT NULL at the DB level,
    # so we point it at a throwaway job belonging to someone else — this
    # endpoint's zero-job path queries by private_user_id directly, not by
    # job ownership, so this still exercises the real code path.
    filler_pu = fixture.make_employee("filler")
    filler_job = fixture.make_job(filler_pu, "filler")
    log = TimeLog(
        job_id=filler_job.job_id,
        private_user_id=pu.private_user_id,
        start_time=_local_dt(SAFE_DAY),
        end_time=None,
        location={},
        hours_worked=Decimal("5"),
        is_overtime=False,
    )
    fixture.db.add(log)
    fixture.db.commit()

    resp = authed_client.get(f"/api/v1/job/salary/company/{fixture.company.company_id}/earnings")
    assert resp.status_code == 200, resp.text
    row = _row_for(resp.json(), pu.private_user_id)

    assert row["totalIncome"] == pytest.approx(0.0)
    assert row["estimatedEarnings"] == pytest.approx(0.0)
    assert row["totalHoursWorked"] == pytest.approx(5.0)
    assert row["regularPay"] == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# (f) UTC/local month-boundary — log lands in the correct LOCAL month
# ---------------------------------------------------------------------------

def test_month_boundary_uses_company_local_timezone(authed_client: TestClient, fixture: _Fixture):
    pu = fixture.make_employee("boundary")
    job = fixture.make_job(pu, "boundary")
    fixture.make_legacy_salary(job, salary="19500", allowance="0", monthly_hours="195")
    # Local 02:00 on day 1 of the current month (MU, UTC+4) -> UTC 22:00 on
    # the LAST day of the PREVIOUS month. A naive UTC-date comparison would
    # misclassify this into last month; the company-timezone-aware bound
    # must still include it in THIS month's total.
    first_of_month = _current_month_first()
    log = TimeLog(
        job_id=job.job_id,
        private_user_id=pu.private_user_id,
        start_time=datetime(first_of_month.year, first_of_month.month, first_of_month.day, 2, 0, tzinfo=MU_TZ),
        end_time=None,
        location={},
        hours_worked=Decimal("5"),
        is_overtime=False,
    )
    fixture.db.add(log)
    fixture.db.commit()

    # Sanity-check the premise: this timestamp's UTC calendar date really is
    # the previous month, proving the test exercises the timezone fix.
    utc_date = log.start_time.astimezone(ZoneInfo("UTC")).date()
    assert utc_date < first_of_month

    resp = authed_client.get(f"/api/v1/job/salary/company/{fixture.company.company_id}/earnings")
    assert resp.status_code == 200, resp.text
    row = _row_for(resp.json(), pu.private_user_id)

    # Bucket-agnostic (this day could coincidentally be a real MU holiday in
    # some months, e.g. January) — the fix under test is inclusion, not bucket.
    assert row["totalHoursWorked"] == pytest.approx(5.0)


# ---------------------------------------------------------------------------
# (g) overtime + holiday same log — overtime wins (explicit precedence)
# ---------------------------------------------------------------------------

def test_overtime_beats_holiday_precedence(authed_client: TestClient, fixture: _Fixture):
    pu = fixture.make_employee("otholiday")
    job = fixture.make_job(pu, "otholiday")
    fixture.make_legacy_salary(job, salary="19500", allowance="0", monthly_hours="195")
    fixture.make_holiday(SAFE_DAY)
    fixture.make_time_log(job, pu, SAFE_DAY, "8", is_overtime=True)

    resp = authed_client.get(f"/api/v1/job/salary/company/{fixture.company.company_id}/earnings")
    assert resp.status_code == 200, resp.text
    row = _row_for(resp.json(), pu.private_user_id)

    assert row["overtimePay"] == pytest.approx(8 * 100.0 * 1.5)  # 1200.00
    assert row["holidayPay"] == pytest.approx(0.0)
    assert row["overtimeHours"] == pytest.approx(8.0)


# ---------------------------------------------------------------------------
# (h) FTE scaling for the structure case (decided during implementation)
# ---------------------------------------------------------------------------

def test_fte_scales_default_monthly_hours(authed_client: TestClient, fixture: _Fixture):
    pu = fixture.make_employee("halftime", fte="0.500")
    fixture.make_job(pu, "halftime")
    fixture.make_structure_assignment(pu, "halftime", basic="20000", allowance="0")

    resp = authed_client.get(f"/api/v1/job/salary/company/{fixture.company.company_id}/earnings")
    assert resp.status_code == 200, resp.text
    row = _row_for(resp.json(), pu.private_user_id)

    expected_monthly_hours = 195 * 0.5
    assert row["monthlyHours"] == pytest.approx(expected_monthly_hours)
    assert row["hourlyRate"] == pytest.approx(20000 / expected_monthly_hours)


# ---------------------------------------------------------------------------
# (i) Pending employees must still appear — regression for a real bug found
# after this endpoint shipped: get_company_salaries' roster helper defaults
# to onboarding_status='approved' (the web dashboard's semantics), but
# mobile's Salaries screen has always shown pending employees too (its old
# data source, getUsersByCompany(companyId) with no status filter, only
# excludes 'rejected'). Reusing the shared roster helper with its default
# silently dropped pending employees from the mobile earnings list.
# ---------------------------------------------------------------------------

def test_pending_employee_still_appears_in_earnings(authed_client: TestClient, fixture: _Fixture):
    pu = fixture.make_employee("pending", onboarding_status="pending")
    job = fixture.make_job(pu, "pending")
    fixture.make_legacy_salary(job, salary="10000", allowance="0", monthly_hours="195")

    resp = authed_client.get(f"/api/v1/job/salary/company/{fixture.company.company_id}/earnings")
    assert resp.status_code == 200, resp.text
    row = _row_for(resp.json(), pu.private_user_id)
    assert row["totalIncome"] == pytest.approx(10000.0)


def test_rejected_employee_excluded_from_earnings(authed_client: TestClient, fixture: _Fixture):
    pu = fixture.make_employee("rejected", onboarding_status="rejected")
    fixture.make_job(pu, "rejected")

    resp = authed_client.get(f"/api/v1/job/salary/company/{fixture.company.company_id}/earnings")
    assert resp.status_code == 200, resp.text
    ids = {r["id"] for r in resp.json()}
    assert pu.private_user_id not in ids
