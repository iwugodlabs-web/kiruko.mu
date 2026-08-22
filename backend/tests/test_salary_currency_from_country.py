"""Salary currency is server-authoritative, derived from the employee's country.

Bug: the mobile client hardcoded currency='MUR' and create_salary never set it,
so every salary was stored MUR regardless of country — a Tanzania company's
salaries showed MUR on payslips. Now crud/job.resolve_salary_currency stamps the
country's currency (MU→MUR, TZ→TZS) over any client value.
"""
import asyncio
import uuid

from sqlalchemy.orm import Session

from core.model import Company, Job, PrivateUser, User
from db_models.crud.job import create_salary, resolve_salary_currency
from schema.job_schema import Salary as SalarySchema


def _company_employee(db: Session, country_code: str):
    sfx = uuid.uuid4().hex[:8]
    owner = User(user_type="company", email=f"own-{sfx}@x.com",
                 user_name=f"own-{sfx}", password_hash="x")
    db.add(owner)
    db.flush()
    co = Company(user_id=owner.user_id, company_name=f"Co-{sfx}",
                 email=f"co-{sfx}@x.com", brn=f"B_{sfx}", country_code=country_code)
    db.add(co)
    db.flush()
    u = User(user_type="private", email=f"emp-{sfx}@x.com",
             user_name=f"emp-{sfx}", password_hash="x")
    db.add(u)
    db.flush()
    pu = PrivateUser(user_id=u.user_id, first_name="E", last_name="E",
                     company_id=co.company_id, role="employee")
    db.add(pu)
    db.flush()
    job = Job(private_user_id=pu.private_user_id, company_id=co.company_id,
              job_title="Worker")
    db.add(job)
    db.flush()
    return job


def test_tz_company_salary_stored_in_tzs(db: Session):
    job = _company_employee(db, "TZ")
    assert resolve_salary_currency(db, job) == "TZS"

    # Client sends 'MUR' — must be overridden to the country's currency.
    schema = SalarySchema(job_id=job.job_id, monthly_hours="180",
                          break_in_minutes_per_day=30, days_of_work_per_month=22,
                          currency="MUR", salary=500000)
    salary = asyncio.run(create_salary(schema, db))
    assert salary.currency == "TZS", "TZ company salary must be stored in TZS, not MUR"


def test_mu_company_salary_stored_in_mur(db: Session):
    job = _company_employee(db, "MU")
    assert resolve_salary_currency(db, job) == "MUR"

    schema = SalarySchema(job_id=job.job_id, monthly_hours="180",
                          break_in_minutes_per_day=30, days_of_work_per_month=22,
                          currency=None, salary=30000)
    salary = asyncio.run(create_salary(schema, db))
    assert salary.currency == "MUR"
