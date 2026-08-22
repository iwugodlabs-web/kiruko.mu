"""M27 — Profile-driven missed-clockout auto-close.

Covers the fallback chain (Job → PrivateUser → Company → 12h) and the
side effects of an auto-close: ``auto_closed=True`` set on the row, a
``time_log_auto_closed`` notification to the company admin, and the
close timestamp = ``start_time + resolved_hours`` (NOT ``now()``).

Bypasses HTTP entirely — exercises the service directly with sessions
opened against the test DB.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Iterator

import pytest
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from core.model import (
    Company,
    Job,
    Notification,
    NotificationRecipient,
    PrivateUser,
    TimeLog,
    User,
)
from services.time_log_service import TimeLogService


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_active_timelog(
    db: Session,
    private_user: PrivateUser,
    job: Job,
    started_hours_ago: float,
) -> TimeLog:
    """Insert an active (end_time IS NULL) TimeLog backdated by N hours."""
    start = datetime.now(timezone.utc) - timedelta(hours=started_hours_ago)
    log = TimeLog(
        job_id=job.job_id,
        private_user_id=private_user.private_user_id,
        day_of_week=start.strftime("%A"),
        start_time=start,
        end_time=None,
        location={"latitude": -20.16, "longitude": 57.50},
        created_source="mobile",
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


def _purge_notifications_and_active_logs(db: Session, private_user_id: int) -> None:
    try:
        db.query(Notification).filter(
            Notification.type == "time_log_auto_closed",
            sql_text("meta->>'private_user_id' = :pid").bindparams(pid=str(private_user_id)),
        ).delete(synchronize_session=False)
    except Exception:
        db.rollback()
    # Close any test-created active logs so the next test starts clean.
    active = db.query(TimeLog).filter(
        TimeLog.private_user_id == private_user_id,
        TimeLog.end_time.is_(None),
    ).all()
    for log in active:
        log.end_time = datetime.now(timezone.utc)
    db.commit()


@pytest.fixture()
def fresh_employee(db: Session, test_company_id: int) -> Iterator[tuple[PrivateUser, Job]]:
    """A unique PrivateUser + Job per test so max_shift_hours overrides don't
    bleed across cases. The session fixture's test_employee is shared, so
    we'd otherwise have to remember to null-out the override each time."""
    owner = User(
        user_type="private",
        email=f"m27-{uuid.uuid4().hex[:8]}@kontokaz.test",
        password_hash="not-used",
    )
    db.add(owner)
    db.flush()
    pu = PrivateUser(
        user_id=owner.user_id,
        first_name="M27",
        last_name="Test",
        company_id=test_company_id,
        role="employee",
        pass_port_number=f"M27-{uuid.uuid4().hex[:8]}",
    )
    db.add(pu)
    db.flush()
    job = Job(
        private_user_id=pu.private_user_id,
        company_id=test_company_id,
        job_title="M27 test job",
        employer_name="Kiruko Test Co.",
        employer_brn="TEST_BRN_FIXTURE",
        employer_email=f"m27-employer-{uuid.uuid4().hex[:8]}@kontokaz.test",
        first_date_of_employment=datetime(2024, 1, 1).date(),
    )
    db.add(job)
    db.commit()
    db.refresh(pu)
    db.refresh(job)
    try:
        yield pu, job
    finally:
        _purge_notifications_and_active_logs(db, pu.private_user_id)
        # Clean up the closed-by-test TimeLogs + job + user.
        db.query(TimeLog).filter(TimeLog.private_user_id == pu.private_user_id).delete()
        db.delete(job)
        db.delete(pu)
        db.delete(owner)
        db.commit()


def _reset_company_default(db: Session, company_id: int) -> None:
    company = db.query(Company).filter(Company.company_id == company_id).first()
    if company is not None:
        company.default_max_shift_hours = None
        db.commit()


# ---------------------------------------------------------------------------
# Pure helper tests — fallback chain
# ---------------------------------------------------------------------------


class TestResolveMaxShiftHours:

    class _O:
        def __init__(self, **kw):
            self.__dict__.update(kw)

    def test_job_override_wins_over_everything(self):
        job = self._O(max_shift_hours=Decimal("6.5"))
        user = self._O(max_shift_hours=Decimal("8"))
        assert TimeLogService.resolve_max_shift_hours(job, user, 10.0) == 6.5

    def test_user_wins_when_job_is_none(self):
        job = self._O(max_shift_hours=None)
        user = self._O(max_shift_hours=Decimal("8"))
        assert TimeLogService.resolve_max_shift_hours(job, user, 10.0) == 8.0

    def test_company_wins_when_job_and_user_null(self):
        job = self._O(max_shift_hours=None)
        user = self._O(max_shift_hours=None)
        assert TimeLogService.resolve_max_shift_hours(job, user, 10.0) == 10.0

    def test_system_default_when_everything_null(self):
        job = self._O(max_shift_hours=None)
        user = self._O(max_shift_hours=None)
        assert TimeLogService.resolve_max_shift_hours(job, user, None) == 12.0

    def test_handles_none_objects(self):
        # If the lookup returns no Job (orphaned TimeLog) we still resolve.
        assert TimeLogService.resolve_max_shift_hours(None, None, None) == 12.0


# ---------------------------------------------------------------------------
# End-to-end via cleanup_active_time_logs
# ---------------------------------------------------------------------------


class TestCleanupAutoCloses:

    def test_session_under_resolved_cap_stays_open(self, db: Session, fresh_employee):
        pu, job = fresh_employee
        # System default = 12h; backdate 6h means it's still within budget.
        log = _make_active_timelog(db, pu, job, started_hours_ago=6)
        TimeLogService.cleanup_active_time_logs(db, pu.private_user_id)
        db.refresh(log)
        assert log.end_time is None
        assert log.auto_closed is False

    def test_session_past_system_default_gets_closed_at_start_plus_12h(
        self, db: Session, fresh_employee,
    ):
        pu, job = fresh_employee
        log = _make_active_timelog(db, pu, job, started_hours_ago=15)
        start = log.start_time
        closed = TimeLogService.cleanup_active_time_logs(db, pu.private_user_id)
        db.refresh(log)
        assert closed == 1
        assert log.end_time is not None
        assert log.auto_closed is True
        # end_time MUST equal start + 12h (NOT now()), so the employee isn't
        # billed for the unattended trailing hours.
        expected_end = start + timedelta(hours=12)
        # Within 1s tolerance for timestamp roundtrip precision.
        assert abs((log.end_time - expected_end).total_seconds()) < 1
        assert log.hours_worked == Decimal("12.00")

    def test_job_override_takes_precedence(self, db: Session, fresh_employee):
        pu, job = fresh_employee
        job.max_shift_hours = Decimal("6.0")
        db.commit()
        # Backdate 7h → past the 6h job cap.
        log = _make_active_timelog(db, pu, job, started_hours_ago=7)
        start = log.start_time
        closed = TimeLogService.cleanup_active_time_logs(db, pu.private_user_id)
        db.refresh(log)
        assert closed == 1
        assert log.auto_closed is True
        expected_end = start + timedelta(hours=6)
        assert abs((log.end_time - expected_end).total_seconds()) < 1

    def test_user_override_used_when_job_null(self, db: Session, fresh_employee):
        pu, job = fresh_employee
        pu.max_shift_hours = Decimal("8.0")
        # job.max_shift_hours stays NULL
        db.commit()
        log = _make_active_timelog(db, pu, job, started_hours_ago=9)
        start = log.start_time
        TimeLogService.cleanup_active_time_logs(db, pu.private_user_id)
        db.refresh(log)
        assert log.auto_closed is True
        expected_end = start + timedelta(hours=8)
        assert abs((log.end_time - expected_end).total_seconds()) < 1

    def test_company_default_used_when_job_and_user_null(
        self, db: Session, fresh_employee, test_company_id: int,
    ):
        pu, job = fresh_employee
        company = db.query(Company).filter(Company.company_id == test_company_id).first()
        company.default_max_shift_hours = Decimal("10.0")
        db.commit()
        try:
            log = _make_active_timelog(db, pu, job, started_hours_ago=11)
            start = log.start_time
            TimeLogService.cleanup_active_time_logs(db, pu.private_user_id)
            db.refresh(log)
            assert log.auto_closed is True
            expected_end = start + timedelta(hours=10)
            assert abs((log.end_time - expected_end).total_seconds()) < 1
        finally:
            _reset_company_default(db, test_company_id)

    def test_notification_created_for_admin_on_auto_close(
        self, db: Session, fresh_employee, test_company_id: int,
    ):
        pu, job = fresh_employee
        company = db.query(Company).filter(Company.company_id == test_company_id).first()
        admin_user_id = company.user_id
        assert admin_user_id is not None, "fixture company should have an owner"

        log = _make_active_timelog(db, pu, job, started_hours_ago=15)
        TimeLogService.cleanup_active_time_logs(db, pu.private_user_id)

        notifs = (
            db.query(Notification)
            .join(NotificationRecipient, NotificationRecipient.notification_id == Notification.notification_id)
            .filter(NotificationRecipient.user_id == admin_user_id)
            .filter(Notification.type == "time_log_auto_closed")
            .filter(sql_text("meta->>'timelog_id' = :tid").bindparams(tid=str(log.timelog_id)))
            .all()
        )
        assert len(notifs) == 1
        n = notifs[0]
        assert n.meta["timelog_id"] == log.timelog_id
        assert n.meta["private_user_id"] == pu.private_user_id
        assert n.meta["job_id"] == job.job_id
        assert "did not clock out" in n.message.lower()

    def test_rerun_does_not_duplicate_notification(
        self, db: Session, fresh_employee, test_company_id: int,
    ):
        """Once a session is auto-closed, end_time is set, so the next
        cron pass filters it out. Notification count stays at 1."""
        pu, job = fresh_employee
        company = db.query(Company).filter(Company.company_id == test_company_id).first()
        admin_user_id = company.user_id

        log = _make_active_timelog(db, pu, job, started_hours_ago=15)
        TimeLogService.cleanup_active_time_logs(db, pu.private_user_id)
        TimeLogService.cleanup_active_time_logs(db, pu.private_user_id)
        TimeLogService.cleanup_active_time_logs(db, pu.private_user_id)

        count = (
            db.query(Notification)
            .join(NotificationRecipient, NotificationRecipient.notification_id == Notification.notification_id)
            .filter(NotificationRecipient.user_id == admin_user_id)
            .filter(Notification.type == "time_log_auto_closed")
            .filter(sql_text("meta->>'timelog_id' = :tid").bindparams(tid=str(log.timelog_id)))
            .count()
        )
        assert count == 1

    def test_redundant_session_close_is_not_marked_auto_closed(
        self, db: Session, fresh_employee,
    ):
        """If a user somehow has two open sessions, the older one is
        closed as a hygiene measure — that's NOT a missed-clockout, so
        auto_closed must stay False on it."""
        pu, job = fresh_employee
        older = _make_active_timelog(db, pu, job, started_hours_ago=2)
        newer = _make_active_timelog(db, pu, job, started_hours_ago=1)
        TimeLogService.cleanup_active_time_logs(db, pu.private_user_id)
        db.refresh(older)
        db.refresh(newer)
        # Older was closed (redundancy pass), newer stayed open.
        assert older.end_time is not None
        assert older.auto_closed is False
        assert newer.end_time is None
