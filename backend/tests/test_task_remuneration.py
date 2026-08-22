"""Tasks-driven additional remuneration (#22).

Verify-before-pay: an employer verifying a completed task books the additional
remuneration as a one-off allowance for each COMPLETED assignee (full amount
each), idempotently. A non-completed assignee is not paid; re-verifying never
double-pays.
"""
import asyncio
from decimal import Decimal

import pytest

from core.model import (
    Company,
    EmployeeOneOffAllowance,
    PrivateUser,
    Schedule,
    ScheduleAssigneeStatus,
    SalaryComponent,
    User,
)
from db_models.crud.job import verify_schedule_completion


AMOUNT = Decimal("500.00")


@pytest.fixture()
def task_setup(db):
    """A throwaway company, two workers, and a completed-ish task carrying
    additional remuneration. Committed (the crud commits); cleaned up after."""
    owner = User(user_type="company", email="taskpay-owner@kontokazdemo.com",
                 user_name="taskpay-owner", password_hash="x")
    db.add(owner); db.flush()
    company = Company(user_id=owner.user_id, company_name="TaskPay Co.",
                      email="taskpay-co@kontokazdemo.com", brn="TASKPAY_BRN",
                      country_code="MU")
    db.add(company); db.flush()

    workers = []
    for i in (1, 2):
        u = User(user_type="private", email=f"taskpay-w{i}@kontokazdemo.com",
                 user_name=f"taskpay-w{i}", password_hash="x")
        db.add(u); db.flush()
        pu = PrivateUser(user_id=u.user_id, first_name=f"W{i}", last_name="Worker",
                         company_id=company.company_id, pass_port_number=f"TASKPAY_P{i}",
                         role="employee")
        db.add(pu); db.flush()
        workers.append(pu)

    from datetime import datetime
    sched = Schedule(
        title="Cover the warehouse", company_id=company.company_id,
        location="HQ", status="pending",
        start_time=datetime(2026, 6, 10, 9, 0), end_time=datetime(2026, 6, 10, 17, 0),
        additional_remuneration_amount=AMOUNT,
    )
    db.add(sched); db.flush()
    # Worker 1 completed; worker 2 only started.
    db.add(ScheduleAssigneeStatus(schedule_id=sched.schedule_id,
           private_user_id=workers[0].private_user_id, status="completed"))
    db.add(ScheduleAssigneeStatus(schedule_id=sched.schedule_id,
           private_user_id=workers[1].private_user_id, status="started"))
    db.commit()

    yield company, workers, sched

    # Cleanup (crud commits, so rows persist).
    db.query(EmployeeOneOffAllowance).filter(
        EmployeeOneOffAllowance.private_user_id.in_([w.private_user_id for w in workers])
    ).delete(synchronize_session=False)
    db.query(Schedule).filter(Schedule.schedule_id == sched.schedule_id).delete()
    db.query(SalaryComponent).filter(SalaryComponent.company_id == company.company_id).delete()
    for w in workers:
        db.query(PrivateUser).filter(PrivateUser.private_user_id == w.private_user_id).delete()
    db.query(Company).filter(Company.company_id == company.company_id).delete()
    db.query(User).filter(User.email.like("taskpay-%@kontokazdemo.com")).delete(synchronize_session=False)
    db.commit()


def _id_of(db, schedule_id, private_user_id):
    return (
        db.query(ScheduleAssigneeStatus.remuneration_one_off_id)
        .filter(ScheduleAssigneeStatus.schedule_id == schedule_id,
                ScheduleAssigneeStatus.private_user_id == private_user_id)
        .scalar()
    )


def test_verify_pays_completed_assignees_only(db, task_setup):
    company, workers, sched = task_setup
    res = asyncio.run(verify_schedule_completion(sched.schedule_id, actor_user_id=None, db=db))

    assert res["paid_count"] == 1          # only the completed worker
    assert res["skipped_count"] == 1       # the 'started' worker
    assert res["amount_each"] == AMOUNT
    assert res["total_booked"] == AMOUNT

    # The completed worker has a one-off for the task's month (June 2026).
    oid = _id_of(db, sched.schedule_id, workers[0].private_user_id)
    assert oid is not None
    o = db.query(EmployeeOneOffAllowance).filter(EmployeeOneOffAllowance.id == oid).one()
    assert o.amount == AMOUNT
    assert o.payable_in_year == 2026 and o.payable_in_month == 6
    comp = db.query(SalaryComponent).filter(SalaryComponent.id == o.component_id).one()
    assert comp.code == "ADDITIONAL_DUTY" and comp.is_taxable is True and comp.is_basic is False

    # The 'started' worker was not paid.
    assert _id_of(db, sched.schedule_id, workers[1].private_user_id) is None


def test_pending_signal_flags_unverified_task_pay(db, task_setup):
    from datetime import date
    from services.payroll_engine import _pending_period_signals
    company, workers, sched = task_setup
    flags = _pending_period_signals(db, company.company_id, date(2026, 6, 1), date(2026, 6, 30))
    assert "unverified_task_pay:1" in flags  # worker1 completed but unpaid; worker2 only started
    # Verifying clears the signal — its pay is now booked into the run.
    asyncio.run(verify_schedule_completion(sched.schedule_id, actor_user_id=None, db=db))
    flags2 = _pending_period_signals(db, company.company_id, date(2026, 6, 1), date(2026, 6, 30))
    assert not any(f.startswith("unverified_task_pay") for f in flags2)


def test_reverify_is_idempotent(db, task_setup):
    company, workers, sched = task_setup
    asyncio.run(verify_schedule_completion(sched.schedule_id, actor_user_id=None, db=db))
    res2 = asyncio.run(verify_schedule_completion(sched.schedule_id, actor_user_id=None, db=db))
    assert res2["paid_count"] == 0         # nothing new — no double-pay
    # Exactly one allowance exists for the completed worker.
    n = (db.query(EmployeeOneOffAllowance)
         .filter(EmployeeOneOffAllowance.private_user_id == workers[0].private_user_id)
         .count())
    assert n == 1
