"""Smart schedule-anchored auto-close — TimeLogService.close_past_schedule_unclaimed.

A session past work_end_time + grace that the employee did NOT confirm as
overtime is closed AT the scheduled end. Confirmed-overtime sessions are left
running (handled by the max-shift safety net). Within the grace window, nothing
is closed.

Times are anchored to `now` so the test is deterministic regardless of wall clock;
company timezone is set to UTC so local == UTC.
"""
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import text as sql_text

from core.model import Company, Job, PrivateUser, TimeLog, User, UserType
from services.time_log_service import TimeLogService


def _suffix() -> str:
    return uuid.uuid4().hex[:10]


def _setup(db, *, start_hours_ago: float, sched_end_after_start_min: int, is_overtime: bool = False,
           work_days=None):
    s = _suffix()
    owner = User(user_type=UserType.company, email=f"sa-own-{s}@kontokaz.test",
                 user_name=f"sa-own-{s}", password_hash="x")
    db.add(owner); db.flush()
    company = Company(user_id=owner.user_id, company_name=f"SA Co {s}",
                      email=f"sa-co-{s}@kontokaz.test", brn=f"SA-{s}",
                      country_code="MU", timezone="UTC")
    db.add(company); db.flush()
    emp = User(user_type=UserType.private, email=f"sa-emp-{s}@kontokaz.test",
               user_name=f"sa-emp-{s}", password_hash="x")
    db.add(emp); db.flush()
    pu = PrivateUser(user_id=emp.user_id, first_name="Sam", last_name="Shift",
                     company_id=company.company_id, pass_port_number=f"SA-PP-{s}")
    db.add(pu); db.flush()

    now = datetime.now(timezone.utc)
    start = now - timedelta(hours=start_hours_ago)
    sched_end = start + timedelta(minutes=sched_end_after_start_min)
    # Set BOTH clock times (as real jobs / the CSV import do). work_start_time is
    # what lets the auto-close tell a genuine overnight shift (end < start) apart
    # from a same-day shift — without it, a clock-in late enough that "4h ago"
    # pushes the scheduled end past midnight falls to the day-boundary backstop,
    # making this test wall-clock-flaky (fails when the suite runs in the small
    # hours UTC).
    job = Job(private_user_id=pu.private_user_id, company_id=company.company_id,
              employer_name="SA Co", work_start_time=start.time(), work_end_time=sched_end.time(),
              work_days={start.strftime("%A"): "8"} if work_days is None else work_days)
    db.add(job); db.flush()
    log = TimeLog(job_id=job.job_id, private_user_id=pu.private_user_id,
                  day_of_week=start.strftime("%A"), start_time=start, is_overtime=is_overtime)
    db.add(log); db.commit()
    return {"owner": owner.user_id, "emp": emp.user_id, "company": company.company_id,
            "pu": pu.private_user_id, "log": log.timelog_id}


def _cleanup(db, ctx):
    db.rollback()
    db.execute(sql_text("ALTER TABLE audit_logs DISABLE TRIGGER USER"))
    db.query(Job).filter(Job.private_user_id == ctx["pu"]).delete(synchronize_session=False)  # cascades TimeLog
    db.query(User).filter(User.user_id.in_([ctx["owner"], ctx["emp"]])).delete(synchronize_session=False)
    db.query(Company).filter(Company.company_id == ctx["company"]).delete(synchronize_session=False)
    db.execute(sql_text("ALTER TABLE audit_logs ENABLE TRIGGER USER"))
    db.commit()


def test_closes_unclaimed_session_at_scheduled_end(db):
    # Started 4h ago, scheduled to end 2h after start (= 2h ago) → well past grace.
    ctx = _setup(db, start_hours_ago=4, sched_end_after_start_min=120, is_overtime=False)
    try:
        n = TimeLogService.close_past_schedule_unclaimed(db, ctx["pu"])
        assert n == 1
        db.expire_all()
        log = db.query(TimeLog).filter(TimeLog.timelog_id == ctx["log"]).first()
        assert log.end_time is not None            # closed
        assert log.auto_closed is True             # by the system
        assert abs(float(log.hours_worked) - 2.0) < 0.05   # closed AT scheduled end (~2h)
        # An append-only audit row is written (actor NULL = system action),
        # with the load-bearing `reason` so the admin audit view can surface it.
        rows = db.execute(sql_text(
            "SELECT actor_user_id, meta FROM audit_logs "
            "WHERE action = 'time_log.auto_closed' AND target_id = :tid"
        ), {"tid": str(ctx["log"])}).fetchall()
        assert len(rows) == 1
        assert rows[0][0] is None                   # system action — no human actor
        assert rows[0][1]["reason"] == "schedule"   # max_shift vs schedule
    finally:
        _cleanup(db, ctx)


def test_closes_when_work_days_empty(db):
    # Regression: most real jobs (Excel import, web onboarding) leave work_days
    # as {} — the old _is_workday gate then suppressed the scheduled-end close and
    # let the clock tick to midnight. With a work_end_time set, an open session
    # past it + grace MUST still close, regardless of work_days.
    ctx = _setup(db, start_hours_ago=4, sched_end_after_start_min=120, work_days={})
    try:
        n = TimeLogService.close_past_schedule_unclaimed(db, ctx["pu"])
        assert n == 1
        db.expire_all()
        log = db.query(TimeLog).filter(TimeLog.timelog_id == ctx["log"]).first()
        assert log.end_time is not None            # closed despite empty work_days
        assert log.auto_closed is True
        assert abs(float(log.hours_worked) - 2.0) < 0.05   # closed AT scheduled end
    finally:
        _cleanup(db, ctx)


def test_skips_confirmed_overtime(db):
    ctx = _setup(db, start_hours_ago=4, sched_end_after_start_min=120, is_overtime=True)
    try:
        n = TimeLogService.close_past_schedule_unclaimed(db, ctx["pu"])
        assert n == 0
        db.expire_all()
        log = db.query(TimeLog).filter(TimeLog.timelog_id == ctx["log"]).first()
        assert log.end_time is None                # left running — real overtime
    finally:
        _cleanup(db, ctx)


def test_skips_within_grace_window(db):
    # Scheduled end was 5 min ago (inside the 15-min grace) → not yet closed.
    ctx = _setup(db, start_hours_ago=1, sched_end_after_start_min=55, is_overtime=False)
    try:
        n = TimeLogService.close_past_schedule_unclaimed(db, ctx["pu"])
        assert n == 0
        db.expire_all()
        log = db.query(TimeLog).filter(TimeLog.timelog_id == ctx["log"]).first()
        assert log.end_time is None
    finally:
        _cleanup(db, ctx)
