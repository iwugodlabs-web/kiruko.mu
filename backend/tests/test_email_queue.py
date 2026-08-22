"""Durable email queue: enqueue + worker delivery / retry / dead-letter."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from core.model import EmailJob
from services import email_queue, email_service


@pytest.fixture(autouse=True)
def _clean_email_jobs(db):
    db.query(EmailJob).delete()
    db.commit()
    yield
    db.query(EmailJob).delete()
    db.commit()


def _make_job(db, **kw):
    defaults = dict(
        to_email="x@kontokaz.test", subject="s", html="<p>h</p>",
        status="pending", attempts=0, max_attempts=5,
        next_attempt_at=datetime.now(timezone.utc) - timedelta(seconds=1),
    )
    defaults.update(kw)
    job = EmailJob(**defaults)
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


class TestEnqueue:
    def test_enqueue_inserts_pending(self, db):
        jid = email_queue.enqueue_email("a@kontokaz.test", "Hi", "<p>hi</p>", kind="signup_otp")
        assert jid is not None
        job = db.query(EmailJob).filter(EmailJob.id == jid).one()
        assert job.status == "pending"
        assert job.attempts == 0
        assert job.kind == "signup_otp"
        assert job.to_email == "a@kontokaz.test"


class TestWorker:
    def test_delivers_pending_job(self, db, monkeypatch):
        sent = []
        monkeypatch.setattr(email_service, "deliver", lambda to, subj, html: sent.append(to))
        job = _make_job(db)
        n = email_queue.process_due_jobs(db)
        assert n == 1
        db.refresh(job)
        assert job.status == "sent"
        assert job.sent_at is not None
        assert sent == ["x@kontokaz.test"]

    def test_not_due_job_skipped(self, db, monkeypatch):
        monkeypatch.setattr(email_service, "deliver", lambda *a: None)
        job = _make_job(db, next_attempt_at=datetime.now(timezone.utc) + timedelta(hours=1))
        n = email_queue.process_due_jobs(db)
        assert n == 0
        db.refresh(job)
        assert job.status == "pending"

    def test_failure_retries_then_dead(self, db, monkeypatch):
        def boom(*a):
            raise RuntimeError("smtp down")
        monkeypatch.setattr(email_service, "deliver", boom)
        job = _make_job(db, max_attempts=2)

        # Attempt 1 — fails, stays pending, reschedules into the future.
        email_queue.process_due_jobs(db)
        db.refresh(job)
        assert job.status == "pending"
        assert job.attempts == 1
        assert "smtp down" in (job.last_error or "")
        assert job.next_attempt_at > datetime.now(timezone.utc)

        # Force it due again; attempt 2 hits max_attempts → dead.
        job.next_attempt_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.add(job); db.commit()
        email_queue.process_due_jobs(db)
        db.refresh(job)
        assert job.status == "dead"
        assert job.attempts == 2

    def test_enqueue_then_worker_end_to_end(self, db, monkeypatch):
        delivered = []
        monkeypatch.setattr(email_service, "deliver", lambda to, subj, html: delivered.append((to, subj)))
        email_queue.enqueue_email("e2e@kontokaz.test", "Verify", "<p>otp</p>", kind="signup_otp")
        email_queue.process_due_jobs(db)
        job = db.query(EmailJob).filter(EmailJob.to_email == "e2e@kontokaz.test").one()
        assert job.status == "sent"
        assert delivered == [("e2e@kontokaz.test", "Verify")]
