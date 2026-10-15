"""Onboarded-into-company ⇒ payroll-ready.

October-forward rule: anyone attached to a company must resolve pay in a
run (late joiners prorated), instead of silently dropping out.

Covers the three onboarding gaps found in the September production data
(7 payslips for 27 company members):
  1. Job approval now links PrivateUser.company_id + backfills sibling
     jobs/salaries company_id (previously job-only, so assignment creation
     400d and payroll's company filter excluded them).
  2. Approval/onboard bootstraps a salary assignment from the legacy salary
     row (previously manual-only; monthly staff without one resolved to
     zero components and were skipped).
  3. Payroll eligibility explicitly skips onboarding-draft placeholders.
"""
import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session, sessionmaker

from core.config import get_engine_from_settings
from core.rls_denormalize import repair_denormalized_company_id
from core.model import Company, EmployeeSalaryAssignment, Job, PrivateUser, Salary, User


@pytest.fixture(autouse=True)
def _apply_repair(db: Session):
    # Production has salaries.company_id nullable (company-less salary fix);
    # the fresh test DB migrates it as NOT NULL — repair it like the
    # onboard-linking tests so NULL-company setups can be exercised.
    repair_denormalized_company_id(get_engine_from_settings())
    row = db.execute(sql_text(
        "SELECT is_nullable FROM information_schema.columns "
        "WHERE table_name='salaries' AND column_name='company_id'"
    )).fetchone()
    if row is not None and row[0] != "YES":
        db.execute(sql_text("ALTER TABLE salaries ALTER COLUMN company_id DROP NOT NULL"))
        db.commit()


def _client(_engine, current_user_id: int) -> TestClient:
    from fastapi import Depends as _Depends

    from core import config as core_config
    from core.dependencies import get_current_user
    from core.model import User as UserORM
    from main import app

    SessionFactory = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

    def _override_db():
        s = SessionFactory()
        try:
            yield s
        finally:
            s.close()

    def _override_user(db: Session = _Depends(core_config.get_db)) -> UserORM:
        return db.query(UserORM).filter(UserORM.user_id == current_user_id).one()

    app.dependency_overrides[core_config.get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_user
    return TestClient(app, raise_server_exceptions=False)


def _clear() -> None:
    from main import app

    app.dependency_overrides.clear()


def _setup(db: Session):
    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    sfx = uuid.uuid4().hex[:8]
    admin = User(user_type="company", email=f"adm-{sfx}@x.com", user_name=f"adm-{sfx}", password_hash="x")
    db.add(admin)
    db.flush()
    co = Company(user_id=admin.user_id, company_name=f"C {sfx}", email=f"co-{sfx}@x.com",
                 brn=f"BRN_{sfx}", country_code="MU")
    db.add(co)
    db.flush()
    # The admin owns the company (Company.user_id) — satisfies
    # assert_company_access via is_company_admin_for.
    # A BRN-matched but company-less employee with a legacy monthly salary.
    u = User(user_type="private", email=f"emp-{sfx}@x.com", user_name=f"emp-{sfx}", password_hash="x")
    db.add(u)
    db.flush()
    pu = PrivateUser(user_id=u.user_id, first_name="New", last_name="Joiner", role="employee")
    db.add(pu)
    db.flush()
    job = Job(private_user_id=pu.private_user_id, company_id=None,
              employer_name=co.company_name, employer_brn=co.brn,
              first_date_of_employment=None, verification_status="pending")
    db.add(job)
    db.flush()
    sal = Salary(job_id=job.job_id, company_id=None, salary="20000", allowance="0",
                 currency="MUR", pay_basis="monthly")
    db.add(sal)
    db.flush()
    db.commit()
    return admin, co, u, pu, job


def test_job_approval_links_company_and_bootstraps_assignment(db: Session, _engine):
    admin, co, u, pu, job = _setup(db)
    client = _client(_engine, admin.user_id)
    try:
        r = client.post(f"/api/v1/job/verify/{job.job_id}/approve")
        assert r.status_code == 200, r.text
    finally:
        _clear()

    db.expire_all()
    pu2 = db.query(PrivateUser).filter(PrivateUser.private_user_id == pu.private_user_id).one()
    assert pu2.company_id == co.company_id
    job2 = db.query(Job).filter(Job.job_id == job.job_id).one()
    assert job2.company_id == co.company_id
    assert job2.first_date_of_employment is not None
    sal2 = db.query(Salary).filter(Salary.job_id == job.job_id).one()
    assert sal2.company_id == co.company_id
    asg = db.query(EmployeeSalaryAssignment).filter(
        EmployeeSalaryAssignment.private_user_id == pu.private_user_id,
        EmployeeSalaryAssignment.effective_to.is_(None),
    ).one_or_none()
    assert asg is not None
    assert asg.effective_from <= date.today()


def test_eligibility_skips_onboarding_drafts(db: Session):
    from services.payroll_engine import _eligible_employees

    admin, co, u, pu, job = _setup(db)
    job.is_onboarding_draft = True
    pu.company_id = co.company_id
    db.add(job)
    db.add(pu)
    db.commit()

    from services.salary_assignment_bootstrap import ensure_assignment_from_legacy
    # Bootstrap refuses drafts too.
    assert ensure_assignment_from_legacy(db, pu.private_user_id) is None
    db.rollback()

    eligible = _eligible_employees(db, co.company_id, date(2026, 10, 1))
    assert pu.private_user_id not in [e.private_user_id for e in eligible]


def test_bootstrap_is_idempotent(db: Session):
    from services.salary_assignment_bootstrap import ensure_assignment_from_legacy

    admin, co, u, pu, job = _setup(db)
    pu.company_id = co.company_id
    job.company_id = co.company_id
    db.add(pu)
    db.add(job)
    db.commit()

    first = ensure_assignment_from_legacy(db, pu.private_user_id)
    db.commit()
    assert first is not None
    second = ensure_assignment_from_legacy(db, pu.private_user_id)
    db.commit()
    assert second is not None
    assert second.id == first.id
