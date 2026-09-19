"""API/route-layer tests for payroll — auth/RBAC, finalize guards (idempotency +
step-up), the off-hours overtime-review endpoint (#6), and the salary-correction
adjustment route. These exercise the HTTP layer the engine tests bypass.
"""
import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from core.model import Company, Job, PayrollRun, Payslip, PrivateUser, Salary, TimeLog, User
from schema.payroll_schema import PayrollRunCreate
from services import employee_import_service as imp, payroll_engine, proration

PS, PE = date(2026, 5, 1), date(2026, 5, 31)


def _client(_engine, current_user_id: int) -> TestClient:
    from fastapi import Depends as _Depends
    from sqlalchemy.orm import sessionmaker
    from core import config as core_config
    from core.dependencies import get_current_user
    from main import app

    SF = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

    def _odb():
        s = SF()
        try:
            yield s
        finally:
            s.close()

    def _ouser(db: Session = _Depends(core_config.get_db)) -> User:
        return db.query(User).filter(User.user_id == current_user_id).one()

    app.dependency_overrides[core_config.get_db] = _odb
    app.dependency_overrides[get_current_user] = _ouser
    return TestClient(app, raise_server_exceptions=False)


def _clear():
    from main import app
    app.dependency_overrides.clear()


def _seed(db, *, require_approved=False):
    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)")); db.commit()
    sfx = uuid.uuid4().hex[:8]
    owner = User(user_type="company", email=f"own-{sfx}@x.com", user_name=f"own-{sfx}", password_hash="x")
    db.add(owner); db.flush()
    co = Company(user_id=owner.user_id, company_name=f"C{sfx}", email=f"co-{sfx}@x.com",
                 brn=f"BRN_{sfx}", country_code="MU", require_approved_clockins_for_payroll=require_approved)
    db.add(co); db.flush()
    csv = ("first_name,last_name,email,job_title,start_date,base_salary,currency,work_days_per_week,pay_basis\n"
           f"W,{sfx},worker-{sfx}@x.com,Clerk,2024-01-01,30000,MUR,5,monthly\n").encode()
    imp.commit(db, co.company_id, imp.parse(csv, "s.csv"), actor_user_id=None)
    db.commit()
    wu = db.query(User).filter(User.email == f"worker-{sfx}@x.com").one()
    pu = db.query(PrivateUser).filter(PrivateUser.user_id == wu.user_id).one()
    job = db.query(Job).filter(Job.private_user_id == pu.private_user_id).one()
    return owner, co, wu, pu, job


def _clock(db, pu, job, dates):
    for d in dates:
        st = datetime.combine(d, time(8, 0), tzinfo=timezone.utc)
        db.add(TimeLog(private_user_id=pu.private_user_id, job_id=job.job_id, day_of_week=d.strftime("%A"),
                       start_time=st, end_time=st + timedelta(hours=8), hours_worked=Decimal("8.00"),
                       location={}, admin_approved=True))
    db.commit()


def test_create_run_requires_company_admin(db, _engine, seed_mu_rules):
    owner, co, wu, pu, job = _seed(db)
    body = {"company_id": co.company_id, "period_start": "2026-05-01", "period_end": "2026-05-31"}
    # worker (non-admin) → 403
    c = _client(_engine, wu.user_id)
    r_worker = c.post("/api/v1/payroll/runs", json=body)
    _clear()
    # owner (admin) → 201
    c = _client(_engine, owner.user_id)
    r_owner = c.post("/api/v1/payroll/runs", json=body)
    _clear()
    assert r_worker.status_code == 403, r_worker.text
    assert r_owner.status_code == 201, r_owner.text
    assert r_owner.json()["company_id"] == co.company_id


def test_finalize_enforces_idempotency_and_step_up(db, _engine, seed_mu_rules):
    owner, co, wu, pu, job = _seed(db)
    run = payroll_engine.create_draft_run(db, PayrollRunCreate(
        company_id=co.company_id, period_start=PS, period_end=PE), actor_user_id=None)
    db.commit()
    c = _client(_engine, owner.user_id)
    no_key = c.post(f"/api/v1/payroll/runs/{run.id}/finalize")
    with_key_no_stepup = c.post(f"/api/v1/payroll/runs/{run.id}/finalize", headers={"Idempotency-Key": "k1"})
    _clear()
    assert no_key.status_code in (400, 422)          # missing Idempotency-Key
    assert with_key_no_stepup.status_code == 401      # missing X-Step-Up-Token


def test_adjustment_route_persists_signed_delta(db, _engine, seed_mu_rules):
    owner, co, wu, pu, job = _seed(db, require_approved=True)
    wd = sorted(proration.working_dates_in_period(db, "MU", PS, PE, job.work_days))
    _clock(db, pu, job, wd[:-1])  # one absence → docked
    run = payroll_engine.create_draft_run(db, PayrollRunCreate(
        company_id=co.company_id, period_start=PS, period_end=PE), actor_user_id=None)
    db.flush(); payroll_engine.finalize_run(db, run.id, actor_user_id=None); db.commit()
    orig = db.query(Payslip).filter(Payslip.payroll_run_id == run.id,
                                    Payslip.private_user_id == pu.private_user_id,
                                    Payslip.is_adjustment.is_(False)).one()
    _clock(db, pu, job, [wd[-1]])  # employer fixes the wrongly-absent day
    c = _client(_engine, owner.user_id)
    resp = c.post(f"/api/v1/payroll/runs/{run.id}/payslips/{orig.id}/adjustment", json={})
    _clear()
    assert resp.status_code == 201, resp.text
    db.expire_all()
    adjustments = db.query(Payslip).filter(Payslip.payroll_run_id == run.id,
                                           Payslip.private_user_id == pu.private_user_id,
                                           Payslip.is_adjustment.is_(True)).all()
    assert len(adjustments) == 1
    assert Decimal(str(adjustments[0].net_pay)) > Decimal("0")  # positive delta credited back


def _make_hourly(db, job, rate="200.00"):
    """Flip the seeded (monthly) employee's active salary to hourly so the
    shift-pay preview gate (`salary.hourly_rate is not None`) passes."""
    sal = (db.query(Salary).filter(Salary.job_id == job.job_id)
           .order_by(Salary.created_at.desc()).first())
    sal.hourly_rate = Decimal(rate)
    db.commit()
    return sal


def test_preview_shift_prices_full_overnight_shift(db, _engine, seed_mu_rules):
    """Regression: a shift crossing midnight (22:00–06:00) must price all 8h.
    The endpoint previously bucketed with period_end=shift_date, so slices whose
    observed_date landed on the next day were dropped and the overnight portion
    silently vanished (an 8h shift priced as ~2h)."""
    owner, co, wu, pu, job = _seed(db)
    _make_hourly(db, job, "200.00")
    c = _client(_engine, wu.user_id)  # worker previews their own shift
    # 2026-05-20 is a Wednesday (not the default Sunday rest day) and not a MU holiday.
    r = c.get("/api/v1/overtime/preview-shift", params={
        "private_user_id": pu.private_user_id, "shift_date": "2026-05-20",
        "start_hhmm": "22:00", "end_hhmm": "06:00",
    })
    _clear()
    assert r.status_code == 200, r.text
    body = r.json()
    total_hours = sum(float(b["hours"]) for b in body["buckets"])
    assert abs(total_hours - 8.0) < 0.01, body


def test_preview_shift_rejects_salaried_employee(db, _engine, seed_mu_rules):
    """The seeded employee is monthly (no hourly_rate) → the preview is gated."""
    owner, co, wu, pu, job = _seed(db)
    c = _client(_engine, wu.user_id)
    r = c.get("/api/v1/overtime/preview-shift", params={
        "private_user_id": pu.private_user_id, "shift_date": "2026-05-20",
        "start_hhmm": "09:00", "end_hhmm": "17:00",
    })
    _clear()
    assert r.status_code == 400, r.text
    assert "hourly-paid" in r.json()["detail"].lower()


def test_overtime_cost_preview_counts_full_overnight_shift(db, _engine, seed_mu_rules):
    """Regression: the employer OT-cost preview must count every hour of an
    overnight clock-in. period_end was the start date, so post-midnight slices
    were dropped and the OT cost was understated (8h counted as ~2h)."""
    owner, co, wu, pu, job = _seed(db)
    _make_hourly(db, job, "200.00")
    # 2026-05-20 22:00 → 05-21 06:00 local (MU is UTC+4) = 18:00Z → 02:00Z next day.
    start = datetime(2026, 5, 20, 18, 0, tzinfo=timezone.utc)
    log = TimeLog(private_user_id=pu.private_user_id, job_id=job.job_id, day_of_week="Wednesday",
                  start_time=start, end_time=start + timedelta(hours=8), hours_worked=Decimal("8.00"),
                  location={}, admin_approved=True)
    db.add(log); db.commit()
    c = _client(_engine, owner.user_id)
    r = c.get(f"/api/v1/payroll/timelogs/{log.timelog_id}/overtime-cost-preview")
    _clear()
    assert r.status_code == 200, r.text
    total_hours = sum(float(b["hours"]) for b in r.json()["buckets"])
    assert abs(total_hours - 8.0) < 0.01, r.json()


def test_get_run_embeds_employee_name_and_code(db, _engine, seed_mu_rules):
    """GET /payroll/runs/{id}'s embedded payslips must show who they're for —
    the run-level endpoint previously returned the raw ORM object with no
    employee_name/employee_code enrichment, so the UI fell back to a bare
    '#<private_user_id>' for every row."""
    owner, co, wu, pu, job = _seed(db)
    run = payroll_engine.create_draft_run(db, PayrollRunCreate(
        company_id=co.company_id, period_start=PS, period_end=PE), actor_user_id=None)
    db.commit()
    c = _client(_engine, owner.user_id)
    resp = c.get(f"/api/v1/payroll/runs/{run.id}")
    _clear()
    assert resp.status_code == 200, resp.text
    body = resp.json()
    payslips = [p for p in body["payslips"] if p["private_user_id"] == pu.private_user_id]
    assert len(payslips) == 1
    assert payslips[0]["employee_name"] == f"{pu.first_name} {pu.last_name}".strip()
    assert payslips[0]["employee_code"] == pu.employee_code


def _payslip_for(db, run, pu):
    return db.query(Payslip).filter(
        Payslip.payroll_run_id == run.id,
        Payslip.private_user_id == pu.private_user_id,
        Payslip.is_adjustment.is_(False),
    ).one()


def test_timesheet_reconciles_and_reports_rows(db, _engine, seed_mu_rules):
    """GET /payslips/{id}/timesheet returns the period's clock-ins, and the
    per-row paid_hours sum ties to totals.counted_paid_hours (the canonical
    hours proration feeds into pay)."""
    owner, co, wu, pu, job = _seed(db)
    wd = sorted(proration.working_dates_in_period(db, "MU", PS, PE, job.work_days))
    _clock(db, pu, job, wd[:3])  # three 8h approved days
    run = payroll_engine.create_draft_run(db, PayrollRunCreate(
        company_id=co.company_id, period_start=PS, period_end=PE), actor_user_id=None)
    db.commit()
    ps = _payslip_for(db, run, pu)
    c = _client(_engine, owner.user_id)
    r = c.get(f"/api/v1/payslips/{ps.id}/timesheet")
    _clear()
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["rows"]) == 3
    assert all(row["status"] == "approved" for row in body["rows"])
    row_sum = sum(float(row["paid_hours"]) for row in body["rows"])
    assert abs(row_sum - float(body["totals"]["total_paid_hours"])) < 0.01
    assert abs(row_sum - float(body["totals"]["counted_paid_hours"])) < 0.01
    assert body["totals"]["unapproved_count"] == 0


def test_timesheet_excludes_unconfirmed_overtime_from_paid(db, _engine, seed_mu_rules):
    """An overtime row not yet confirmed by the employer is surfaced as
    'pending', excluded from paid hours, and counted as unapproved."""
    owner, co, wu, pu, job = _seed(db)
    d = sorted(proration.working_dates_in_period(db, "MU", PS, PE, job.work_days))[0]
    st = datetime.combine(d, time(8, 0), tzinfo=timezone.utc)
    db.add(TimeLog(private_user_id=pu.private_user_id, job_id=job.job_id, day_of_week=d.strftime("%A"),
                   start_time=st, end_time=st + timedelta(hours=10), hours_worked=Decimal("10.00"),
                   location={}, admin_approved=True, is_overtime=True,
                   overtime_confirmed_by_employer=False))
    db.commit()
    run = payroll_engine.create_draft_run(db, PayrollRunCreate(
        company_id=co.company_id, period_start=PS, period_end=PE), actor_user_id=None)
    db.commit()
    ps = _payslip_for(db, run, pu)
    c = _client(_engine, owner.user_id)
    r = c.get(f"/api/v1/payslips/{ps.id}/timesheet")
    _clear()
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["rows"]) == 1
    assert body["rows"][0]["status"] == "pending"
    assert float(body["rows"][0]["paid_hours"]) == 0.0
    assert float(body["totals"]["total_paid_hours"]) == 0.0
    assert body["totals"]["unapproved_count"] == 1


def test_timesheet_clamp_reconciles_and_reports_pay_basis(db, _engine, seed_mu_rules):
    """An early clock-in (before the scheduled shift start) is clamped: paid_hours
    < raw hours_worked, and the row sum still ties to totals.counted_paid_hours
    AND to proration.sum_hours_worked_in_period — the shared per-row helper keeps
    the timesheet and the engine's aggregate from drifting. Also reports pay_basis."""
    from datetime import time as _t
    owner, co, wu, pu, job = _seed(db)
    sal = _make_hourly(db, job, "200.00")
    sal.pay_basis = "hourly"  # engine branches on pay_basis, not just hourly_rate
    # Scheduled 09:00–17:00 local (MU is UTC+4 → 05:00Z–13:00Z).
    job.work_start_time = _t(9, 0)
    job.work_end_time = _t(17, 0)
    db.commit()
    d = sorted(proration.working_dates_in_period(db, "MU", PS, PE, job.work_days))[0]
    # Clock in an hour early: 08:00 local = 04:00Z; out 17:00 local = 13:00Z. Raw 9h.
    st = datetime.combine(d, time(4, 0), tzinfo=timezone.utc)
    db.add(TimeLog(private_user_id=pu.private_user_id, job_id=job.job_id, day_of_week=d.strftime("%A"),
                   start_time=st, end_time=st + timedelta(hours=9), hours_worked=Decimal("9.00"),
                   location={}, admin_approved=True))
    db.commit()
    run = payroll_engine.create_draft_run(db, PayrollRunCreate(
        company_id=co.company_id, period_start=PS, period_end=PE), actor_user_id=None)
    db.commit()
    ps = _payslip_for(db, run, pu)
    c = _client(_engine, owner.user_id)
    r = c.get(f"/api/v1/payslips/{ps.id}/timesheet")
    _clear()
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["pay_basis"] == "hourly"
    assert len(body["rows"]) == 1
    row = body["rows"][0]
    assert float(row["hours_worked"]) == 9.0       # raw
    assert float(row["paid_hours"]) == 8.0          # early hour clamped off
    # Row sum == the engine's own aggregate, both ways.
    canonical = float(proration.sum_hours_worked_in_period(
        db, private_user_id=pu.private_user_id, period_start=PS, period_end=PE,
        company_timezone=co.timezone))
    assert canonical == 8.0
    assert abs(float(body["totals"]["total_paid_hours"]) - canonical) < 0.01
    assert abs(float(body["totals"]["counted_paid_hours"]) - canonical) < 0.01


def test_timesheet_overtime_hours_read_from_payslip_components(db, _engine, seed_mu_rules):
    """The footer's OT hours come from the payslip's OWN overtime components (the
    bucketing engine's split), not the coarse per-row is_overtime flag — so it
    ties to the Components drill-down. Only premium buckets (category
    'earning.overtime') count; the regular 'REG' bucket ('earning.basic') and
    non-overtime earnings are excluded."""
    owner, co, wu, pu, job = _seed(db)
    run = payroll_engine.create_draft_run(db, PayrollRunCreate(
        company_id=co.company_id, period_start=PS, period_end=PE), actor_user_id=None)
    db.commit()
    ps = _payslip_for(db, run, pu)
    # Inject a known bucket split: 8h regular (REG) + 2h premium OT + a flat
    # allowance. Only the 2h premium bucket should be reported as overtime.
    ps.components = [
        {"code": "BASIC", "label": "Basic", "kind": "earning", "category": "earning.basic",
         "amount": "30000.00", "is_taxable": True, "is_basic": True, "source": "structure"},
        {"code": "REG", "label": "Regular hours", "kind": "earning", "category": "earning.basic",
         "amount": "1600.00", "is_taxable": True, "is_basic": True, "source": "overtime",
         "meta": {"multiplier": "1.0", "hours": "8.0"}},
        {"code": "OT15", "label": "Overtime 1.5x", "kind": "earning", "category": "earning.overtime",
         "amount": "600.00", "is_taxable": True, "is_basic": False, "source": "overtime",
         "meta": {"multiplier": "1.5", "hours": "2.0"}},
    ]
    db.commit()
    c = _client(_engine, owner.user_id)
    r = c.get(f"/api/v1/payslips/{ps.id}/timesheet")
    _clear()
    assert r.status_code == 200, r.text
    assert float(r.json()["totals"]["total_overtime_hours"]) == 2.0


def test_timesheet_forbidden_for_other_company_admin(db, _engine, seed_mu_rules):
    """A company admin from a different tenant cannot read the payslip's
    timesheet — mirrors GET /payslips/{id}'s access rules."""
    owner_a, co_a, wu_a, pu_a, job_a = _seed(db)
    owner_b, co_b, wu_b, pu_b, job_b = _seed(db)
    run = payroll_engine.create_draft_run(db, PayrollRunCreate(
        company_id=co_a.company_id, period_start=PS, period_end=PE), actor_user_id=None)
    db.commit()
    ps = _payslip_for(db, run, pu_a)
    # Admin of company B → 403; the employee themselves → 200.
    c = _client(_engine, owner_b.user_id)
    r_other = c.get(f"/api/v1/payslips/{ps.id}/timesheet")
    _clear()
    c = _client(_engine, wu_a.user_id)
    r_self = c.get(f"/api/v1/payslips/{ps.id}/timesheet")
    _clear()
    assert r_other.status_code == 403, r_other.text
    assert r_self.status_code == 200, r_self.text
