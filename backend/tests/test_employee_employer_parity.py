"""Simulates the original reported bug: an employer viewing an employee's
profile on web and the employee viewing their own pay on mobile disagreed
on hours and pay for the same period.

Three real, independent bugs stacked to cause this (all fixed in this
session, see commits 68efa30e / 0674e15d / this file's payroll_engine.py
change):

  1. mobile's payroll.getEstimate() called GET /private-users/me/payslips/
     estimate — a route that never existed, so it silently 422'd on every
     call and mobile always fell back to its own local hours x rate math.
  2. db_models/crud/job.py::update_time_log excluded an unclosed
     (never explicitly ended) break from hours_worked entirely, inflating
     the *stored* hours for the employee's own local calc source data.
  3. services/payroll_engine.py::_load_and_bucket_overtime made the exact
     same mistake in the real bucketed payroll engine used by
     create_draft_run/finalize_run/the estimate service — an unclosed
     break was dropped from breaks_by_log outright instead of being
     deducted through to the shift's end_time.

This test reproduces the scenario end-to-end through the actual HTTP
routes: an hourly employee clocks in, takes a break, and clocks out
without ever pressing "end break" (a very ordinary real-world slip). It
then hits both estimate routes exactly as mobile ("me") and web (explicit
private_user_id, as the employer) do, and asserts they agree — on the
correct, break-deducted figure, not the inflated one.
"""
from __future__ import annotations

import os
from datetime import date, datetime, time, timezone
from decimal import Decimal as D

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session


@pytest.fixture(autouse=True)
def _reset_holdback():
    prior = os.environ.get("ESTIMATED_PAYSLIP_ENABLED")
    os.environ["ESTIMATED_PAYSLIP_ENABLED"] = "true"
    yield
    if prior is None:
        os.environ.pop("ESTIMATED_PAYSLIP_ENABLED", None)
    else:
        os.environ["ESTIMATED_PAYSLIP_ENABLED"] = prior


def _setup_hourly(db: Session) -> dict:
    from core.model import Company, Job, PrivateUser, Salary, User

    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    db.commit()

    suffix = datetime.utcnow().strftime("%H%M%S%f")

    owner = User(
        user_type="company", email=f"par-owner-{suffix}@kontokaz.test",
        user_name=f"par-owner-{suffix}", password_hash="x",
    )
    db.add(owner)
    db.flush()

    co = Company(
        user_id=owner.user_id, company_name=f"ParityCo {suffix}",
        email=f"par-{suffix}@kontokaz.test", brn=f"PAR_{suffix}",
        country_code="MU",
    )
    db.add(co)
    db.flush()

    emp_user = User(
        user_type="private", email=f"par-emp-{suffix}@kontokaz.test",
        user_name=f"par-emp-{suffix}", password_hash="x",
    )
    db.add(emp_user)
    db.flush()

    priv = PrivateUser(
        user_id=emp_user.user_id, first_name="Parity", last_name="Worker",
        company_id=co.company_id, role="employee",
    )
    db.add(priv)
    db.flush()

    job = Job(
        private_user_id=priv.private_user_id, company_id=co.company_id,
        job_title="Hourly Tester", employer_name=co.company_name,
        employer_brn=co.brn, has_contract=True, has_permission_to_work=True,
        working_on_tourist_visa=False, is_salary_deducted=False,
        is_accommodation_covered_by_employer=False,
        is_accommodation_a_dormitory=False, is_accommodation_decent=True,
        is_passport_retained=False, is_job_execution_same_as_description=True,
        doubts_about_compensation=False,
    )
    db.add(job)
    db.flush()

    salary = Salary(
        job_id=job.job_id, pay_basis="hourly", hourly_rate=D("200.00"),
        monthly_hours="173", break_in_minutes_per_day=0,
        days_of_work_per_month=22,
    )
    db.add(salary)
    db.commit()

    return {
        "owner_user_id": owner.user_id,
        "owner_email": owner.email,
        "company_id": co.company_id,
        "emp_user_id": emp_user.user_id,
        "emp_email": emp_user.email,
        "priv_id": priv.private_user_id,
        "job_id": job.job_id,
    }


def _cleanup(db: Session, ctx: dict) -> None:
    db.rollback()
    db.execute(sql_text("DELETE FROM break_logs WHERE timelog_id IN "
                         "(SELECT timelog_id FROM time_logs WHERE private_user_id=:p)"),
               {"p": ctx["priv_id"]})
    db.execute(sql_text("DELETE FROM time_logs WHERE private_user_id=:p"), {"p": ctx["priv_id"]})
    db.execute(sql_text("DELETE FROM payslips WHERE private_user_id=:p"), {"p": ctx["priv_id"]})
    db.execute(sql_text("DELETE FROM payroll_runs WHERE company_id=:c"), {"c": ctx["company_id"]})
    db.execute(sql_text("DELETE FROM salaries WHERE job_id=:j"), {"j": ctx["job_id"]})
    db.execute(sql_text("DELETE FROM jobs WHERE job_id=:j"), {"j": ctx["job_id"]})
    from tests.conftest import audit_logs_unlocked
    with audit_logs_unlocked(db):
        db.execute(sql_text("DELETE FROM audit_logs WHERE actor_user_id=:u"), {"u": ctx["emp_user_id"]})
        db.execute(sql_text("DELETE FROM private_users WHERE user_id=:u"), {"u": ctx["emp_user_id"]})
        db.execute(sql_text("DELETE FROM companies WHERE company_id=:c"), {"c": ctx["company_id"]})
        db.execute(sql_text("DELETE FROM users WHERE email IN (:e1, :e2)"), {"e1": ctx["owner_email"], "e2": ctx["emp_email"]})
        db.commit()


def _client(_engine, current_user_id: int) -> TestClient:
    from fastapi import Depends as _Depends
    from sqlalchemy.orm import Session, sessionmaker
    from core import config as core_config
    from core.dependencies import get_current_user
    from core.model import User
    from main import app

    SessionFactory = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

    def _override_db():
        s = SessionFactory()
        try:
            yield s
        finally:
            s.close()

    def _override_user(db: Session = _Depends(core_config.get_db)) -> User:
        return db.query(User).filter(User.user_id == current_user_id).one()

    app.dependency_overrides[core_config.get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_user
    return TestClient(app, raise_server_exceptions=False)


def _clear() -> None:
    from main import app
    app.dependency_overrides.clear()


class TestEmployeeEmployerParity:
    def test_open_break_shift_matches_between_me_and_employer_routes(self, db: Session, _engine, seed_mu_rules):
        from core.model import TimeLog, BreakLog

        ctx = _setup_hourly(db)
        try:
            # Employee clocks in at 09:00, takes a break at 12:00, forgets to
            # end it, and clocks out at 17:00 — the exact real-world slip
            # that originally caused mobile and web to disagree.
            d = date(2026, 5, 4)  # Mon 4 May 2026 (1 May is a MU public holiday)
            tl = TimeLog(
                job_id=ctx["job_id"], private_user_id=ctx["priv_id"],
                day_of_week=d.strftime("%A"),
                start_time=datetime.combine(d, time(9, 0), tzinfo=timezone.utc),
                end_time=datetime.combine(d, time(17, 0), tzinfo=timezone.utc),
                location={}, admin_approved=True,
            )
            db.add(tl)
            db.flush()
            db.add(BreakLog(
                timelog_id=tl.timelog_id,
                start_time=datetime.combine(d, time(12, 0), tzinfo=timezone.utc),
                end_time=None,  # never explicitly ended
            ))
            db.commit()

            period_start, period_end = date(2026, 5, 1), date(2026, 5, 31)
            params = {"period_start": period_start.isoformat(), "period_end": period_end.isoformat()}

            # Mobile's own view — GET /private-users/me/payslips/estimate.
            emp_client = _client(_engine, ctx["emp_user_id"])
            try:
                me_resp = emp_client.get("/api/v1/private-users/me/payslips/estimate", params=params)
            finally:
                _clear()
            assert me_resp.status_code == 200, me_resp.text
            me_body = me_resp.json()

            # Web's employer view — GET /private-users/{id}/payslips/estimate.
            employer_client = _client(_engine, ctx["owner_user_id"])
            try:
                employer_resp = employer_client.get(
                    f"/api/v1/private-users/{ctx['priv_id']}/payslips/estimate", params=params,
                )
            finally:
                _clear()
            assert employer_resp.status_code == 200, employer_resp.text
            employer_body = employer_resp.json()

            # The two platforms must agree, exactly.
            assert me_body["gross"] == employer_body["gross"]
            assert me_body["net"] == employer_body["net"]
            assert me_body["pay_is_hours_driven"] is True

            # And they must agree on the *correct* figure: 09:00-17:00 is 8h
            # raw, minus the open break (12:00 -> shift end 17:00 = 5h)
            # deducted all the way through to clock-out -> 3h paid at
            # Rs200/h = Rs600 gross. Before the fixes this session, both
            # the stored hours_worked path and the bucketed-engine path
            # would have paid straight through the open break, inflating
            # this to 8h x 200 = Rs1600.
            assert D(me_body["gross"]) == D("600.00"), (
                "expected the open break to be deducted through to clock-out; "
                f"got {me_body['gross']} — looks like the pre-fix inflated figure"
            )
        finally:
            _cleanup(db, ctx)
