"""Regression: 'Complete Profile' dies with an IntegrityError inserting a salary.

Root cause: create_salary omitted `pay_basis`, relying on the column's
server_default('monthly'). On prod (schema create_all-bootstrapped, so the
employment_type_paybasis migration no-ops) salaries.pay_basis can be NOT NULL
WITHOUT that default — so the insert writes NULL and blows up (SQLAlchemy
IntegrityError, code gkpj). We reproduce the drift by dropping the default on
the isolated test DB, prove the old omit-style insert fails, and prove the fixed
create_salary (which sets pay_basis explicitly) succeeds.
"""
import asyncio
import uuid

import pytest
from sqlalchemy import text as sql_text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.model import Company, User, PrivateUser, Job, Salary as SalaryORM
from schema.job_schema import Salary as SalarySchema
from db_models.crud.job import create_salary


def _job(db: Session) -> Job:
    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    sfx = uuid.uuid4().hex[:8]
    owner = User(user_type="company", email=f"own-{sfx}@x.com", user_name=f"own-{sfx}", password_hash="x")
    db.add(owner); db.flush()
    co = Company(user_id=owner.user_id, company_name=f"C {sfx}", email=f"co-{sfx}@x.com", brn=f"B_{sfx}", country_code="MU")
    db.add(co); db.flush()
    emp = PrivateUser(user_id=owner.user_id, first_name="A", last_name="B", company_id=co.company_id, role="employee")
    # give the emp its own user so the unique user_id FK holds
    u2 = User(user_type="private", email=f"emp-{sfx}@x.com", user_name=f"emp-{sfx}", password_hash="x")
    db.add(u2); db.flush()
    emp.user_id = u2.user_id
    db.add(emp); db.flush()
    job = Job(private_user_id=emp.private_user_id, company_id=co.company_id, job_title="Cashier")
    db.add(job); db.flush()
    db.commit()
    return job


def test_paybasis_is_set_explicitly_even_without_db_default(db: Session):
    job = _job(db)
    # Simulate prod schema drift: pay_basis is NOT NULL but has NO default.
    db.execute(sql_text("ALTER TABLE salaries ALTER COLUMN pay_basis DROP DEFAULT"))
    db.commit()
    try:
        # 1) The OLD behaviour (omit pay_basis) now fails, exactly like prod.
        with pytest.raises(IntegrityError):
            db.add(SalaryORM(job_id=job.job_id, salary="24000"))
            db.flush()
        db.rollback()

        # 2) The FIX: create_salary sets pay_basis explicitly → insert succeeds.
        schema = SalarySchema(
            job_id=job.job_id, salary="24000", allowance="2000",
            monthly_hours="180", break_in_minutes_per_day=60, days_of_work_per_month=24,
        )
        asyncio.run(create_salary(schema, db))
        row = db.query(SalaryORM).filter(SalaryORM.job_id == job.job_id).one()
        assert row.pay_basis == "monthly"
        assert str(row.salary) == "24000.00"
    finally:
        # Restore the default so later tests in this session are unaffected.
        db.execute(sql_text("ALTER TABLE salaries ALTER COLUMN pay_basis SET DEFAULT 'monthly'"))
        db.commit()
