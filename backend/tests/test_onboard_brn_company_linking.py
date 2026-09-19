"""Onboard must link BRN-matched employers back to their registered company.

The company-less salary fix (DROP NOT NULL on the denormalized company_id
columns) only makes independent users work — it must NOT sever the company
link for users who DID name a registered employer. Onboard resolves
`employer_brn` -> company_id on the job AND the private_user, and
create_salary scopes the salary to that company. These prove the linkage
survives end-to-end through the real route, and that an unmatched BRN stays
legitimately company-less.
"""
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from core.config import get_engine_from_settings
from core.rls_denormalize import repair_denormalized_company_id
from core.model import Company, User, PrivateUser, Job, Salary


@pytest.fixture(autouse=True)
def _apply_repair(db: Session):
    repair_denormalized_company_id(get_engine_from_settings())
    # Self-heal against the suite's documented order-sensitivity: the pooled
    # connection the repair ran on may differ from this session's. Ensure the
    # column is nullable on THIS connection so the insert below can't 500.
    row = db.execute(sql_text(
        "SELECT is_nullable FROM information_schema.columns "
        "WHERE table_name='salaries' AND column_name='company_id'"
    )).fetchone()
    if row is not None and row[0] != "YES":
        db.execute(sql_text("ALTER TABLE salaries ALTER COLUMN company_id DROP NOT NULL"))
        db.commit()


def _company(db: Session) -> tuple[User, Company]:
    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    sfx = uuid.uuid4().hex[:8]
    owner = User(user_type="company", email=f"own-{sfx}@x.com", user_name=f"own-{sfx}", password_hash="x")
    db.add(owner)
    db.flush()
    co = Company(user_id=owner.user_id, company_name=f"C {sfx}", email=f"co-{sfx}@x.com", brn=f"BRN_{sfx}", country_code="MU")
    db.add(co)
    db.flush()
    db.commit()
    return owner, co


def _independent_employee(db: Session) -> tuple[User, PrivateUser, Job]:
    """A self-onboarded private user with a job but NO company (the bug's shape)."""
    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    sfx = uuid.uuid4().hex[:8]
    u = User(user_type="private", email=f"ind-{sfx}@x.com", user_name=f"ind-{sfx}", password_hash="x")
    db.add(u)
    db.flush()
    pu = PrivateUser(user_id=u.user_id, first_name="Solo", last_name="Worker", role="employee")
    db.add(pu)
    db.flush()
    job = Job(private_user_id=pu.private_user_id, job_title="Freelancer")
    db.add(job)
    db.flush()
    db.commit()
    return u, pu, job


def _client(_engine, current_user_id: int) -> TestClient:
    from fastapi import Depends as _Depends
    from sqlalchemy.orm import sessionmaker
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


def _onboard_payload(pu: PrivateUser, job: Job, employer_brn: str | None) -> dict:
    return {
        "user_data": {"private_user_id": pu.private_user_id},
        "job_data": {
            "private_user_id": pu.private_user_id,
            "job_title": job.job_title,
            "employer_name": "Some Employer",
            "employer_brn": employer_brn,
            "employer_email": None,
            "employer_phone": None,
            "employer_address": None,
            "first_date_of_employment": "2026-01-15",
        },
        "salary_data": {
            "monthly_hours": "180",
            "break_in_minutes_per_day": 60,
            "days_of_work_per_month": 22,
            "salary": "24000",
            "allowance": "2000",
        },
    }


def test_brn_matching_registered_company_still_links_job_user_and_salary(db: Session, _engine):
    _, co = _company(db)
    u, pu, job = _independent_employee(db)

    client = _client(_engine, u.user_id)
    try:
        resp = client.post("/api/v1/user/onboard", json=_onboard_payload(pu, job, co.brn))
    finally:
        _clear()
    assert resp.status_code in (200, 201), resp.text

    db.refresh(pu)
    db.refresh(job)
    salary = db.query(Salary).filter(Salary.job_id == job.job_id).one()
    assert pu.company_id == co.company_id  # private_user linked
    assert job.company_id == co.company_id  # job linked
    assert salary.company_id == co.company_id  # salary scoped to the company


def test_unmatched_or_missing_brn_stays_company_less(db: Session, _engine):
    # No registered company with this BRN anywhere.
    u, pu, job = _independent_employee(db)

    client = _client(_engine, u.user_id)
    try:
        resp = client.post("/api/v1/user/onboard", json=_onboard_payload(pu, job, f"NOBODY_{uuid.uuid4().hex[:8]}"))
    finally:
        _clear()
    assert resp.status_code in (200, 201), resp.text

    db.refresh(pu)
    db.refresh(job)
    salary = db.query(Salary).filter(Salary.job_id == job.job_id).one()
    assert pu.company_id is None
    assert job.company_id is None
    assert salary.company_id is None  # legitimately company-less — the original 500 fix


# ---------------------------------------------------------------------------
# GET /job/company-brn/{brn} — surfaces self-signup claimants for verification.
# These are draft placeholder jobs linked only by employer_brn, which the
# company roster (/users/company/{id}) excludes by design. Now authenticated
# and company-scoped (previously it leaked pending employees' PII to anyone).
# ---------------------------------------------------------------------------


def _draft_claimant(db: Session, employer_brn: str) -> tuple[User, PrivateUser, Job]:
    """A self-signup claimant: account exists, but company_id is unset and the
    only link is a draft job carrying employer_brn (is_onboarding_draft=True)."""
    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    sfx = uuid.uuid4().hex[:8]
    u = User(user_type="private", email=f"claim-{sfx}@x.com", user_name=f"claim-{sfx}",
             password_hash="x", user_verified=True)
    db.add(u); db.flush()
    pu = PrivateUser(user_id=u.user_id, first_name="Self", last_name="Signup",
                     role="employee", company_id=None)
    db.add(pu); db.flush()
    job = Job(private_user_id=pu.private_user_id, job_title="", employer_brn=employer_brn,
              work_days={}, is_onboarding_draft=True, verification_status="pending")
    db.add(job); db.flush(); db.commit()
    return u, pu, job


def test_company_brn_claimant_visible_to_company_admin(db: Session, _engine):
    owner, co = _company(db)
    u, pu, job = _draft_claimant(db, co.brn)
    client = _client(_engine, owner.user_id)
    try:
        resp = client.get(f"/api/v1/job/company-brn/{co.brn}")
    finally:
        _clear()
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert any(row["user_id"] == u.user_id for row in body), body


def test_company_brn_case_insensitive_match(db: Session, _engine):
    """A claimant who typed the BRN in a different case still surfaces."""
    owner, co = _company(db)
    u, pu, job = _draft_claimant(db, co.brn.lower())  # stored lower; company BRN is upper
    client = _client(_engine, owner.user_id)
    try:
        resp = client.get(f"/api/v1/job/company-brn/{co.brn}")
    finally:
        _clear()
    assert resp.status_code == 200, resp.text
    assert any(row["user_id"] == u.user_id for row in resp.json())


def test_company_brn_forbidden_for_other_company_admin(db: Session, _engine):
    owner_a, co_a = _company(db)
    owner_b, co_b = _company(db)
    _draft_claimant(db, co_a.brn)
    client = _client(_engine, owner_b.user_id)  # admin of a DIFFERENT company
    try:
        resp = client.get(f"/api/v1/job/company-brn/{co_a.brn}")
    finally:
        _clear()
    assert resp.status_code == 403, resp.text


def test_company_brn_unknown_returns_404(db: Session, _engine):
    owner, co = _company(db)
    client = _client(_engine, owner.user_id)
    try:
        resp = client.get(f"/api/v1/job/company-brn/NOPE_{uuid.uuid4().hex[:8]}")
    finally:
        _clear()
    assert resp.status_code == 404, resp.text