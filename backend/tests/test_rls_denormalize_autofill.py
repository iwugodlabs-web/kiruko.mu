"""Onboarding must work for company-less users, and company rows still scope.

Not everyone belongs to a company: a private user who self-onboards (or names an
employer that isn't a registered Company) has job.company_id = NULL, so their
salary is legitimately company-less. rls_sensitive_tables wrongly set
salaries.company_id NOT NULL, which 500'd every such onboarding. The boot repair
drops that NOT NULL and restores the auto-fill trigger; these prove both.
"""
import asyncio
import uuid

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from core.config import get_engine_from_settings
from core.rls_denormalize import repair_denormalized_company_id
from core.model import Company, User, PrivateUser, Job, Salary as SalaryORM
from schema.job_schema import Salary as SalarySchema
from db_models.crud.job import create_salary


def _trigger_exists(conn, name: str) -> bool:
    return conn.execute(
        sql_text("SELECT 1 FROM pg_trigger WHERE tgname = :n AND NOT tgisinternal"),
        {"n": name},
    ).first() is not None


def _independent_job(db: Session) -> Job:
    """A self-onboarded private user with NO company (job.company_id = NULL)."""
    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    sfx = uuid.uuid4().hex[:8]
    u = User(user_type="private", email=f"ind-{sfx}@x.com", user_name=f"ind-{sfx}", password_hash="x")
    db.add(u); db.flush()
    pu = PrivateUser(user_id=u.user_id, first_name="Solo", last_name="Worker", role="employee")  # no company_id
    db.add(pu); db.flush()
    job = Job(private_user_id=pu.private_user_id, job_title="Freelancer")  # no company_id
    db.add(job); db.flush()
    db.commit()
    return job


def _company_job(db: Session) -> Job:
    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    sfx = uuid.uuid4().hex[:8]
    owner = User(user_type="company", email=f"own-{sfx}@x.com", user_name=f"own-{sfx}", password_hash="x")
    db.add(owner); db.flush()
    co = Company(user_id=owner.user_id, company_name=f"C {sfx}", email=f"co-{sfx}@x.com", brn=f"B_{sfx}", country_code="MU")
    db.add(co); db.flush()
    u2 = User(user_type="private", email=f"emp-{sfx}@x.com", user_name=f"emp-{sfx}", password_hash="x")
    db.add(u2); db.flush()
    pu = PrivateUser(user_id=u2.user_id, first_name="A", last_name="B", company_id=co.company_id, role="employee")
    db.add(pu); db.flush()
    job = Job(private_user_id=pu.private_user_id, company_id=co.company_id, job_title="Cashier")
    db.add(job); db.flush()
    db.commit()
    return job


def test_repair_makes_column_nullable_and_restores_trigger(db: Session):
    engine = get_engine_from_settings()
    # Simulate prod: drop the trigger. (NOT NULL is dropped by the repair.)
    db.execute(sql_text("DROP TRIGGER IF EXISTS trg_salaries_set_company_id ON salaries"))
    db.commit()

    done = repair_denormalized_company_id(engine)
    assert "salaries" in done

    with engine.connect() as conn:
        assert _trigger_exists(conn, "trg_salaries_set_company_id")
        nullable = conn.execute(sql_text(
            "SELECT is_nullable FROM information_schema.columns "
            "WHERE table_name='salaries' AND column_name='company_id'"
        )).scalar()
        assert nullable == "YES"


def _ensure_nullable_on_session(db: Session) -> None:
    """Self-heal against the suite's documented order-sensitivity: the pooled
    connection the repair ran on may differ from this session's. Ensure
    salaries.company_id is nullable on THIS connection so a company-less
    insert can't 500."""
    nullable = db.execute(sql_text(
        "SELECT is_nullable FROM information_schema.columns "
        "WHERE table_name='salaries' AND column_name='company_id'"
    )).scalar()
    if nullable != "YES":
        db.execute(sql_text("ALTER TABLE salaries ALTER COLUMN company_id DROP NOT NULL"))
        db.commit()


def test_independent_user_onboarding_salary_is_company_less(db: Session):
    repair_denormalized_company_id(get_engine_from_settings())
    _ensure_nullable_on_session(db)
    job = _independent_job(db)
    assert job.company_id is None
    asyncio.run(create_salary(SalarySchema(
        job_id=job.job_id, salary="24000", allowance="2000",
        monthly_hours="180", break_in_minutes_per_day=60, days_of_work_per_month=22,
    ), db))
    row = db.query(SalaryORM).filter(SalaryORM.job_id == job.job_id).one()
    assert row.company_id is None  # legitimately company-less
    assert str(row.salary) == "24000.00"


def test_company_user_salary_is_scoped_to_its_company(db: Session):
    repair_denormalized_company_id(get_engine_from_settings())
    _ensure_nullable_on_session(db)
    job = _company_job(db)
    asyncio.run(create_salary(SalarySchema(
        job_id=job.job_id, salary="30000", allowance="0",
        monthly_hours="180", break_in_minutes_per_day=60, days_of_work_per_month=22,
    ), db))
    row = db.query(SalaryORM).filter(SalaryORM.job_id == job.job_id).one()
    assert row.company_id == job.company_id
