"""Regression coverage for GET /job/salary/company/{company_id} (job.py:141-304),
written BEFORE extracting its inline roster query into a shared helper
(_resolve_company_employee_roster) for the new /earnings endpoint.

This endpoint had zero test coverage before this file. Its behavior must not
change as a side effect of the roster-helper extraction, so this locks in:
  - department resolution fallback (job.department_id, else PrivateUser.department_id)
  - has_salary / missing_only filtering
  - BRN-matched employees (linked via employer_brn, not company_id) appear in
    the roster
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from fastapi import Depends as _Depends
from fastapi.testclient import TestClient
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session, sessionmaker

from core.model import Company, Department, Job, PrivateUser, Salary, User


def _suffix() -> str:
    return uuid.uuid4().hex[:8]


def _build_company_with_employees(db: Session) -> dict:
    """Builds an isolated company with:
      - emp_job_dept: job.department_id set (has a Salary row -> has_salary=True)
      - emp_pu_dept_fallback: job.department_id NULL, PrivateUser.department_id
        set (no Salary row -> has_salary=False, for missing_only coverage)
      - emp_brn_matched: linked to this company only via employer_brn match
        (job.company_id points elsewhere)
    """
    s = _suffix()
    owner = User(
        user_type="company",
        email=f"legacy-sal-owner-{s}@kontokaz.test",
        user_name=f"legacy-sal-owner-{s}",
        password_hash="x",
    )
    db.add(owner)
    db.flush()

    company = Company(
        user_id=owner.user_id,
        company_name=f"Legacy Salary Co {s}",
        email=f"legacy-sal-{s}@kontokaz.test",
        brn=f"LEGSAL{s.upper()}",
        country_code="MU",
    )
    db.add(company)
    db.flush()

    # A second company purely so emp_brn_matched's job.company_id can point
    # somewhere OTHER than `company`, proving the BRN-match path (not the
    # company_id path) is what includes them.
    other_owner = User(
        user_type="company",
        email=f"legacy-sal-other-owner-{s}@kontokaz.test",
        user_name=f"legacy-sal-other-owner-{s}",
        password_hash="x",
    )
    db.add(other_owner)
    db.flush()
    other_company = Company(
        user_id=other_owner.user_id,
        company_name=f"Other Co {s}",
        email=f"legacy-sal-other-{s}@kontokaz.test",
        brn=f"OTHERBRN{s.upper()}",
        country_code="MU",
    )
    db.add(other_company)
    db.flush()

    dept_job = Department(company_id=company.company_id, name=f"JobDept-{s}")
    dept_pu = Department(company_id=company.company_id, name=f"PuDept-{s}")
    db.add_all([dept_job, dept_pu])
    db.flush()

    def _make_user(tag: str) -> User:
        u = User(
            user_type="private",
            email=f"legacy-sal-{tag}-{s}@kontokaz.test",
            user_name=f"legacy-sal-{tag}-{s}",
            password_hash="x",
            company_onboarding_status="approved",
        )
        db.add(u)
        db.flush()
        return u

    # emp_job_dept: department resolved via job.department_id, has a salary.
    u1 = _make_user("jobdept")
    pu1 = PrivateUser(
        user_id=u1.user_id,
        first_name="Job",
        last_name="Dept",
        company_id=company.company_id,
        pass_port_number=f"LEGSAL_JD_{s}",
        role="employee",
    )
    db.add(pu1)
    db.flush()
    job1 = Job(
        private_user_id=pu1.private_user_id,
        company_id=company.company_id,
        department_id=dept_job.department_id,
        job_title="Job Dept Role",
        employer_brn=company.brn,
        work_days=["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    )
    db.add(job1)
    db.flush()
    db.add(
        Salary(
            job_id=job1.job_id,
            monthly_hours="195",
            days_of_work_per_month=22,
            salary=Decimal("50000.00"),
            allowance=Decimal("0.00"),
        )
    )

    # emp_pu_dept_fallback: job.department_id NULL, must fall back to
    # PrivateUser.department_id. No Salary row -> has_salary False.
    u2 = _make_user("pudept")
    pu2 = PrivateUser(
        user_id=u2.user_id,
        first_name="Pu",
        last_name="DeptFallback",
        company_id=company.company_id,
        department_id=dept_pu.department_id,
        pass_port_number=f"LEGSAL_PD_{s}",
        role="employee",
    )
    db.add(pu2)
    db.flush()
    job2 = Job(
        private_user_id=pu2.private_user_id,
        company_id=company.company_id,
        department_id=None,
        job_title="Pu Dept Role",
        employer_brn=company.brn,
        work_days=["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    )
    db.add(job2)
    db.flush()

    # emp_brn_matched: job.company_id points at `other_company`, but
    # employer_brn matches `company`'s BRN -> should still appear in
    # `company`'s roster via the BRN-match fallback.
    u3 = _make_user("brn")
    pu3 = PrivateUser(
        user_id=u3.user_id,
        first_name="Brn",
        last_name="Matched",
        company_id=other_company.company_id,
        pass_port_number=f"LEGSAL_BRN_{s}",
        role="employee",
    )
    db.add(pu3)
    db.flush()
    job3 = Job(
        private_user_id=pu3.private_user_id,
        company_id=other_company.company_id,
        department_id=None,
        job_title="Brn Matched Role",
        employer_brn=company.brn,  # matches `company`, not `other_company`
        work_days=["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    )
    db.add(job3)
    db.commit()

    return {
        "company_id": company.company_id,
        "other_company_id": other_company.company_id,
        "dept_job_id": dept_job.department_id,
        "dept_pu_id": dept_pu.department_id,
        "pu1_id": pu1.private_user_id,
        "pu2_id": pu2.private_user_id,
        "pu3_id": pu3.private_user_id,
        "suffix": s,
    }


def _cleanup(db: Session, setup: dict) -> None:
    db.rollback()
    s = setup["suffix"]
    db.execute(sql_text(
        "DELETE FROM salaries WHERE job_id IN (SELECT job_id FROM jobs WHERE employer_brn LIKE :brn)"
    ), {"brn": f"LEGSAL{s.upper()}"})
    db.execute(sql_text(
        "DELETE FROM jobs WHERE private_user_id IN "
        "(SELECT private_user_id FROM private_users WHERE pass_port_number LIKE :p)"
    ), {"p": f"LEGSAL_%_{s}"})
    db.execute(sql_text("DELETE FROM private_users WHERE pass_port_number LIKE :p"), {"p": f"LEGSAL_%_{s}"})
    db.execute(sql_text("DELETE FROM users WHERE email LIKE :e"), {"e": f"legacy-sal-%-{s}@kontokaz.test"})
    db.execute(sql_text("DELETE FROM departments WHERE company_id = :cid"), {"cid": setup["company_id"]})
    db.execute(sql_text("DELETE FROM companies WHERE company_id IN (:c1, :c2)"),
               {"c1": setup["company_id"], "c2": setup["other_company_id"]})
    db.commit()


@pytest.fixture()
def authed_client(_engine, db: Session):
    """Authenticated TestClient — get_company_salaries doesn't scope by
    current_user's own company today (a separate, pre-existing gap noted but
    not fixed here), so any authenticated user reaches it. Uses the same
    dependency_overrides pattern as test_company_rbac_sweep.py."""
    from main import app
    from core import config as core_config
    from core.dependencies import get_current_user

    s = _suffix()
    u = User(user_type="company", email=f"legacy-sal-caller-{s}@kontokaz.test",
             user_name=f"legacy-sal-caller-{s}", password_hash="x")
    db.add(u)
    db.commit()
    uid = u.user_id

    SessionFactory = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

    def _override_db():
        d = SessionFactory()
        try:
            yield d
        finally:
            d.close()

    def _override_user(d: Session = _Depends(core_config.get_db)) -> User:
        return d.query(User).filter(User.user_id == uid).one()

    app.dependency_overrides[core_config.get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_user
    client = TestClient(app, raise_server_exceptions=False)
    yield client
    app.dependency_overrides.clear()
    db.execute(sql_text("DELETE FROM users WHERE user_id = :uid"), {"uid": uid})
    db.commit()


def test_department_resolution_job_then_private_user_fallback(authed_client: TestClient, db: Session):
    setup = _build_company_with_employees(db)
    try:
        resp = authed_client.get(f"/api/v1/job/salary/company/{setup['company_id']}")
        assert resp.status_code == 200, resp.text
        rows = {r["private_user_id"]: r for r in resp.json()["data"]}

        assert rows[setup["pu1_id"]]["department"] == f"JobDept-{setup['suffix']}"
        assert rows[setup["pu1_id"]]["department_id"] == setup["dept_job_id"]

        # No job.department_id -> falls back to PrivateUser.department_id.
        assert rows[setup["pu2_id"]]["department"] == f"PuDept-{setup['suffix']}"
    finally:
        _cleanup(db, setup)


def test_has_salary_and_missing_only_filter(authed_client: TestClient, db: Session):
    setup = _build_company_with_employees(db)
    try:
        resp = authed_client.get(f"/api/v1/job/salary/company/{setup['company_id']}")
        assert resp.status_code == 200, resp.text
        rows = {r["private_user_id"]: r for r in resp.json()["data"]}

        assert rows[setup["pu1_id"]]["has_salary"] is True
        assert rows[setup["pu1_id"]]["salary"] == "50000.00"
        assert rows[setup["pu2_id"]]["has_salary"] is False

        missing_resp = authed_client.get(
            f"/api/v1/job/salary/company/{setup['company_id']}?missing_only=true"
        )
        assert missing_resp.status_code == 200, missing_resp.text
        missing_ids = {r["private_user_id"] for r in missing_resp.json()["data"]}
        assert setup["pu2_id"] in missing_ids
        assert setup["pu1_id"] not in missing_ids
    finally:
        _cleanup(db, setup)


def test_brn_matched_employee_included_in_roster(authed_client: TestClient, db: Session):
    """An employee whose job.company_id points at a DIFFERENT company, but
    whose job.employer_brn matches this company's BRN, must still appear —
    this is the fallback link_filter clause, distinct from the direct
    PrivateUser.company_id / Job.company_id matches."""
    setup = _build_company_with_employees(db)
    try:
        resp = authed_client.get(f"/api/v1/job/salary/company/{setup['company_id']}")
        assert resp.status_code == 200, resp.text
        pu_ids = {r["private_user_id"] for r in resp.json()["data"]}
        assert setup["pu3_id"] in pu_ids

        # And it must NOT leak into the other company's own roster query —
        # emp_brn_matched's job.company_id is `other_company`, but its BRN
        # doesn't match `other_company`'s BRN, so this proves the fallback
        # is BRN-specific, not "any job at all".
        other_resp = authed_client.get(f"/api/v1/job/salary/company/{setup['other_company_id']}")
        assert other_resp.status_code == 200, other_resp.text
        other_pu_ids = {r["private_user_id"] for r in other_resp.json()["data"]}
        assert setup["pu3_id"] in other_pu_ids  # linked via direct Job.company_id here
    finally:
        _cleanup(db, setup)
