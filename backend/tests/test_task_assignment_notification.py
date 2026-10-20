"""Task assignment notifications — assigning a task must reach its recipients.

Regression guard: tasks used to be created silently, so employees only saw them
if they happened to open the task screen. `notify_schedule_assigned` fans out
one in-app notification (+ queued push) to every assigned employee.
"""
from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace

from core.model import Notification, NotificationRecipient, PrivateUser, User


def _mk_employee(db, suffix):
    u = User(
        user_type="private",
        email=f"task-notify-{suffix}@kontokaz.test",
        user_name=f"task-notify-{suffix}",
        password_hash="x",
    )
    db.add(u)
    db.flush()
    pu = PrivateUser(
        user_id=u.user_id,
        first_name="Task",
        last_name="Worker",
        role="employee",
    )
    db.add(pu)
    db.commit()
    db.refresh(u)
    db.refresh(pu)
    return u, pu


def _schedule(**overrides):
    base = dict(
        schedule_id=987654,
        title="Cover the warehouse",
        company_id=None,
        location="HQ",
        start_time=datetime(2026, 10, 20, 9, 0),
        additional_remuneration_amount=None,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def test_notify_schedule_assigned_reaches_each_assignee(db):
    from services.notification_service import NotificationService

    suffix = datetime.utcnow().strftime("%H%M%S%f")
    u1, pu1 = _mk_employee(db, f"a{suffix}")
    u2, pu2 = _mk_employee(db, f"b{suffix}")

    ok = NotificationService.notify_schedule_assigned(
        db, _schedule(), [pu1.private_user_id, pu2.private_user_id]
    )

    assert ok is True
    recips = db.query(NotificationRecipient).filter(
        NotificationRecipient.user_id.in_([u1.user_id, u2.user_id])
    ).all()
    assert {r.user_id for r in recips} == {u1.user_id, u2.user_id}
    event = db.query(Notification).filter(
        Notification.notification_id == recips[0].notification_id
    ).one()
    assert event.type == "schedule_assigned"
    assert "Cover the warehouse" in event.title
    assert event.meta["schedule_id"] == 987654


def test_notify_schedule_assigned_noop_without_recipients(db):
    from services.notification_service import NotificationService

    assert NotificationService.notify_schedule_assigned(db, _schedule(), []) is False


def test_create_schedule_endpoint_notifies_and_still_serializes(db):
    """The real create endpoint must notify recipients and still return a
    serializable schedule (the fan-out commits the session)."""
    import asyncio

    from api.v1.job import create_schedule_endpoint
    from core.model import Company, Schedule, ScheduleAssigneeStatus
    from schema.job_schema import CreateSchedule, ShowSchedule

    suffix = datetime.utcnow().strftime("%H%M%S%f")
    owner = User(
        user_type="company",
        email=f"task-notify-owner-{suffix}@kontokaz.test",
        user_name=f"task-notify-owner-{suffix}",
        password_hash="x",
    )
    db.add(owner)
    db.flush()
    company = Company(
        user_id=owner.user_id,
        company_name=f"Task Notify Co {suffix}",
        email=f"task-notify-co-{suffix}@kontokaz.test",
        brn=f"TASKNOTIFY{suffix}",
        country_code="MU",
    )
    db.add(company)
    db.commit()
    db.refresh(company)

    employee_user, employee = _mk_employee(db, f"c{suffix}")
    payload = CreateSchedule(
        title="Cover the warehouse",
        company_id=company.company_id,
        location="HQ",
        start_time=datetime(2026, 10, 20, 9, 0),
        end_time=datetime(2026, 10, 20, 17, 0),
        status="pending",
        assigned_employee_ids=[employee.private_user_id],
    )

    sched = asyncio.run(create_schedule_endpoint(payload, db))
    try:
        assert sched.schedule_id is not None
        # Mimic FastAPI's response_model serialization after the notify commit.
        out = ShowSchedule.model_validate(sched)
        assert out.schedule_id == sched.schedule_id

        recips = db.query(NotificationRecipient).filter(
            NotificationRecipient.user_id == employee_user.user_id
        ).all()
        assert recips, "assigned employee should receive a notification"
        event = db.query(Notification).filter(
            Notification.notification_id == recips[-1].notification_id
        ).one()
        assert event.type == "schedule_assigned"
        assert event.meta["schedule_id"] == sched.schedule_id
    finally:
        db.query(NotificationRecipient).filter(
            NotificationRecipient.user_id == employee_user.user_id
        ).delete(synchronize_session=False)
        db.query(Notification).filter(
            Notification.meta["schedule_id"].astext == str(sched.schedule_id)
        ).delete(synchronize_session=False)
        db.query(ScheduleAssigneeStatus).filter(
            ScheduleAssigneeStatus.schedule_id == sched.schedule_id
        ).delete(synchronize_session=False)
        db.query(Schedule).filter(Schedule.schedule_id == sched.schedule_id).delete()
        db.query(PrivateUser).filter(
            PrivateUser.private_user_id == employee.private_user_id
        ).delete()
        db.query(Company).filter(Company.company_id == company.company_id).delete()
        db.query(User).filter(User.user_id.in_([owner.user_id, employee_user.user_id])).delete(
            synchronize_session=False
        )
        db.commit()
