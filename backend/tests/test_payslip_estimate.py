"""M4 — Estimated payslip endpoint guardrails.

Coverage:
  * holdback flag default (off → 503)
  * employee can fetch own (200 PDF when on, no persistence)
  * 409 when a finalized payslip already exists for the current month
  * audit log written per successful download
  * filesystem unchanged (no persistence)

Skipped from this file:
  * The raw PDF byte content / template visual (covered by manual smoke).
  * Cross-employee 403 (caller can only fetch own — endpoint reads
    private_user from current_user, so no path is exposed to fetch
    someone else's; just an authz simplification).
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
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


def _setup(db: Session) -> dict:
    from core.model import (
        Company, Job, PrivateUser, SalaryComponent, SalaryStructure,
        SalaryStructureLine, EmployeeSalaryAssignment, User,
    )

    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    db.commit()

    suffix = datetime.utcnow().strftime("%H%M%S%f")

    owner = User(
        user_type="company",
        email=f"est-owner-{suffix}@kontokaz.test",
        user_name=f"est-owner-{suffix}",
        password_hash="x",
    )
    db.add(owner)
    db.flush()

    co = Company(
        user_id=owner.user_id,
        company_name=f"EstCo {suffix}",
        email=f"est-{suffix}@kontokaz.test",
        brn=f"EST_{suffix}",
        country_code="MU",
    )
    db.add(co)
    db.flush()

    emp_user = User(
        user_type="private",
        email=f"est-emp-{suffix}@kontokaz.test",
        user_name=f"est-emp-{suffix}",
        password_hash="x",
    )
    db.add(emp_user)
    db.flush()

    priv = PrivateUser(
        user_id=emp_user.user_id,
        first_name="Est",
        last_name="Worker",
        company_id=co.company_id,
        role="employee",
    )
    db.add(priv)
    db.flush()

    job = Job(
        private_user_id=priv.private_user_id,
        company_id=co.company_id,
        job_title="Tester",
        employer_name=co.company_name,
        employer_brn=co.brn,
        has_contract=True,
        has_permission_to_work=True,
        working_on_tourist_visa=False,
        is_salary_deducted=False,
        is_accommodation_covered_by_employer=False,
        is_accommodation_a_dormitory=False,
        is_accommodation_decent=True,
        is_passport_retained=False,
        is_job_execution_same_as_description=True,
        doubts_about_compensation=False,
    )
    db.add(job)
    db.flush()

    # Minimal salary structure so the engine has something to compute.
    basic = SalaryComponent(
        company_id=co.company_id,
        code=f"BASIC_{suffix}",
        label="Basic",
        kind="earning",
        category="earning.basic",
        is_basic=True,
        is_taxable=True,
        is_recurring=True,
    )
    db.add(basic)
    db.flush()

    s = SalaryStructure(
        company_id=co.company_id,
        name=f"Default-{suffix}",
        is_default=True,
    )
    db.add(s)
    db.flush()

    db.add(SalaryStructureLine(
        structure_id=s.id, component_id=basic.id, amount=D("25000"),
    ))
    db.flush()

    from datetime import date as _date
    db.add(EmployeeSalaryAssignment(
        private_user_id=priv.private_user_id,
        structure_id=s.id,
        currency="MUR",
        effective_from=_date.today().replace(day=1),
        created_by_user_id=owner.user_id,
    ))
    db.commit()

    return {
        "owner_user_id": owner.user_id,
        "owner_email": owner.email,
        "company_id": co.company_id,
        "company_brn": co.brn,
        "company_email": co.email,
        "emp_user_id": emp_user.user_id,
        "emp_email": emp_user.email,
        "priv_id": priv.private_user_id,
        "job_id": job.job_id,
        "structure_id": s.id,
        "component_id": basic.id,
        "suffix": suffix,
    }


def _cleanup(db: Session, ctx: dict) -> None:
    db.rollback()
    db.execute(sql_text("DELETE FROM payslips WHERE private_user_id=:p"), {"p": ctx["priv_id"]})
    db.execute(sql_text("DELETE FROM payroll_runs WHERE company_id=:c"), {"c": ctx["company_id"]})
    db.execute(sql_text("DELETE FROM employee_salary_overrides WHERE assignment_id IN (SELECT id FROM employee_salary_assignments WHERE private_user_id=:p)"), {"p": ctx["priv_id"]})
    db.execute(sql_text("DELETE FROM employee_salary_assignments WHERE private_user_id=:p"), {"p": ctx["priv_id"]})
    db.execute(sql_text("DELETE FROM salary_structure_lines WHERE structure_id=:s"), {"s": ctx["structure_id"]})
    db.execute(sql_text("DELETE FROM salary_structures WHERE id=:s"), {"s": ctx["structure_id"]})
    db.execute(sql_text("DELETE FROM salary_components WHERE id=:c"), {"c": ctx["component_id"]})
    db.execute(sql_text("DELETE FROM jobs WHERE job_id=:j"), {"j": ctx["job_id"]})
    # audit_logs WORM trigger workaround — DELETE FROM users cascades a
    # SET NULL update to audit_logs.actor_user_id, so the whole user-
    # affecting block runs inside the unlock context.
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


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestHoldback:
    def test_holdback_off_returns_503(self, db: Session, _engine):
        os.environ["ESTIMATED_PAYSLIP_ENABLED"] = "false"
        ctx = _setup(db)
        try:
            client = _client(_engine, ctx["emp_user_id"])
            try:
                resp = client.get("/api/v1/private-users/me/payslips/estimated.pdf")
                assert resp.status_code == 503, resp.text
            finally:
                _clear()
        finally:
            _cleanup(db, ctx)


class TestSuccessfulDownload:
    def test_returns_pdf_writes_audit_no_persistence(self, db: Session, _engine):
        ctx = _setup(db)
        backend_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        uploads_dir = os.path.join(backend_root, "uploads")
        before = sum(1 for _ in os.walk(uploads_dir)) if os.path.isdir(uploads_dir) else 0

        try:
            client = _client(_engine, ctx["emp_user_id"])
            try:
                resp = client.get("/api/v1/private-users/me/payslips/estimated.pdf")
                assert resp.status_code == 200, resp.text
                assert resp.headers["content-type"] == "application/pdf"
                assert "estimated_payslip" in resp.headers.get("content-disposition", "")
                assert resp.content[:4] == b"%PDF", "response should be PDF bytes"
            finally:
                _clear()

            n = db.execute(sql_text(
                "SELECT COUNT(*) FROM audit_logs "
                "WHERE action='estimated_payslip.download' AND actor_user_id=:u"
            ), {"u": ctx["emp_user_id"]}).scalar()
            assert n == 1

            after = sum(1 for _ in os.walk(uploads_dir)) if os.path.isdir(uploads_dir) else 0
            assert before == after, "estimate must not write any files under uploads/"
        finally:
            _cleanup(db, ctx)


class TestFinalizedConflict:
    def test_409_when_finalized_payslip_exists_for_month(self, db: Session, _engine):
        from datetime import date as _date
        from core.model import PayrollRun, Payslip

        ctx = _setup(db)
        try:
            today = _date.today()
            ps_run = PayrollRun(
                company_id=ctx["company_id"],
                period_start=today.replace(day=1),
                period_end=(today.replace(day=28)),
                status="finalized",
                currency="MUR",
                created_by_user_id=ctx["owner_user_id"],
                finalized_at=datetime.now(timezone.utc),
                country_rules_snapshot={},
            )
            db.add(ps_run)
            db.flush()

            ps = Payslip(
                payroll_run_id=ps_run.id,
                private_user_id=ctx["priv_id"],
                gross=D("25000"),
                paye=D("0"),
                deductions_total=D("0"),
                net_pay=D("25000"),
                components=[],
                statutory_employee={},
                statutory_employer={},
                currency="MUR",
            )
            db.add(ps)
            db.commit()

            client = _client(_engine, ctx["emp_user_id"])
            try:
                resp = client.get("/api/v1/private-users/me/payslips/estimated.pdf")
                assert resp.status_code == 409, resp.text
                body = resp.json()
                assert "OFFICIAL_PAYSLIP_EXISTS" in str(body)
            finally:
                _clear()
        finally:
            _cleanup(db, ctx)


class TestJsonEstimateZeroReason:
    """The JSON estimate (GET /private-users/{id}/payslips/estimate, used by
    the web employer profile card) must never ship a bare 0 with no
    explanation — that was the actual bug. Unlike the PDF route, this one
    always returns 200 (the profile page must still render); `zero_reason`
    carries the explanation instead."""

    def test_zero_reason_null_when_gross_positive(self, db: Session, _engine):
        # _setup() already gives a monthly employee a real 25000 BASIC.
        ctx = _setup(db)
        try:
            client = _client(_engine, ctx["owner_user_id"])
            try:
                resp = client.get(f"/api/v1/private-users/{ctx['priv_id']}/payslips/estimate")
                assert resp.status_code == 200, resp.text
                body = resp.json()
                assert D(body["gross"]) > 0
                assert body["zero_reason"] is None
            finally:
                _clear()
        finally:
            _cleanup(db, ctx)

    def test_zero_reason_no_clockins_when_no_salary_assignment_and_no_shifts(self, db: Session, _engine):
        from core.model import EmployeeSalaryAssignment

        ctx = _setup(db)
        try:
            # Remove the assignment _setup() creates — no salary configured,
            # no clock-ins either, so both cause-branches read zero.
            db.query(EmployeeSalaryAssignment).filter(
                EmployeeSalaryAssignment.private_user_id == ctx["priv_id"]
            ).delete()
            db.commit()

            client = _client(_engine, ctx["owner_user_id"])
            try:
                resp = client.get(f"/api/v1/private-users/{ctx['priv_id']}/payslips/estimate")
                assert resp.status_code == 200, resp.text
                body = resp.json()
                assert D(body["gross"]) == 0
                assert body["zero_reason"] == "no_clockins"
            finally:
                _clear()
        finally:
            _cleanup(db, ctx)


class TestJsonEstimateAttendance:
    """The `attendance` day-count breakdown — added so the employer profile
    can show "N/M days present" instead of a bare, easily-misread hours
    total sitting next to the pay figure. Must be null whenever the
    underlying absence-deduction computation doesn't run at all (company
    hasn't opted into clock-driven payroll), and populated with real
    present/absent counts when it does."""

    def test_null_when_company_not_clock_driven(self, db: Session, _engine):
        # _setup()'s company defaults require_approved_clockins_for_payroll
        # to False — the common case, and where this must stay null.
        ctx = _setup(db)
        try:
            client = _client(_engine, ctx["owner_user_id"])
            try:
                resp = client.get(f"/api/v1/private-users/{ctx['priv_id']}/payslips/estimate")
                assert resp.status_code == 200, resp.text
                assert resp.json()["attendance"] is None
            finally:
                _clear()
        finally:
            _cleanup(db, ctx)

    def test_populated_with_absence_when_clock_driven(self, db: Session, _engine):
        from datetime import date, datetime as dt, timezone as tz
        from core.model import Company, Job, TimeLog

        ctx = _setup(db)
        try:
            db.query(Company).filter(Company.company_id == ctx["company_id"]).update(
                {"require_approved_clockins_for_payroll": True}
            )
            db.query(Job).filter(Job.job_id == ctx["job_id"]).update(
                {"work_days": {"Monday": "8", "Tuesday": "8", "Wednesday": "8", "Thursday": "8", "Friday": "8"}}
            )
            db.commit()

            period_start = date.today().replace(day=1)
            # Clock in on just the first scheduled weekday of the period so
            # there's at least one real clock-in (required for the guard
            # that distinguishes "absent" from "never tracked") but also at
            # least one later scheduled day left unclocked.
            cursor = period_start
            while cursor.weekday() > 4:  # roll forward to the first weekday
                cursor = cursor.replace(day=cursor.day + 1)
            start_dt = dt.combine(cursor, dt.min.time(), tzinfo=tz.utc).replace(hour=8)
            db.add(TimeLog(
                job_id=ctx["job_id"], private_user_id=ctx["priv_id"],
                day_of_week=cursor.strftime("%A"),
                start_time=start_dt, end_time=start_dt.replace(hour=16),
                hours_worked=D("8.00"), location={}, admin_approved=True,
            ))
            db.commit()

            client = _client(_engine, ctx["owner_user_id"])
            try:
                resp = client.get(
                    f"/api/v1/private-users/{ctx['priv_id']}/payslips/estimate",
                    params={"period_start": period_start.isoformat(), "period_end": date.today().isoformat()},
                )
                assert resp.status_code == 200, resp.text
                body = resp.json()
                attendance = body["attendance"]
                assert attendance is not None
                assert attendance["present_days"] == 1
                assert attendance["scheduled_days"] >= 1
                if attendance["scheduled_days"] > 1:
                    assert attendance["absent_days"] == attendance["scheduled_days"] - 1
                    assert any(d["code"] == "ABSENCE_DEDUCTION" for d in body["deductions"])
            finally:
                _clear()
        finally:
            _cleanup(db, ctx)


class TestOwnEstimateMeRoute:
    """GET /private-users/me/payslips/estimate — the self-service alias
    mobile's payroll.getEstimate() actually calls. Before this route
    existed, "me" matched the /{private_user_id}/... route's path shape
    (Starlette matches by shape before type-validating the parameter),
    failed int-parsing, and 422'd on every single call — silently, since
    the mobile client just falls back to its own local calculation on any
    error. This must return 200 with the same body the explicit-ID route
    would for that same employee."""

    def test_me_route_returns_own_estimate(self, db: Session, _engine):
        ctx = _setup(db)
        try:
            client = _client(_engine, ctx["emp_user_id"])
            try:
                r = client.get("/api/v1/private-users/me/payslips/estimate")
                assert r.status_code == 200, r.text
                body = r.json()
                assert D(body["gross"]) > 0
                assert body["pay_is_hours_driven"] is False
            finally:
                _clear()
        finally:
            _cleanup(db, ctx)

    def test_me_route_matches_explicit_id_route(self, db: Session, _engine):
        ctx = _setup(db)
        try:
            client = _client(_engine, ctx["emp_user_id"])
            try:
                me_body = client.get("/api/v1/private-users/me/payslips/estimate").json()
                explicit_body = client.get(f"/api/v1/private-users/{ctx['priv_id']}/payslips/estimate").json()
                assert me_body["gross"] == explicit_body["gross"]
                assert me_body["net"] == explicit_body["net"]
            finally:
                _clear()
        finally:
            _cleanup(db, ctx)
