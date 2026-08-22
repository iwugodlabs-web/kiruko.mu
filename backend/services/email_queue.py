"""Durable outbound-email queue.

Every outbound email is enqueued as an `email_jobs` row (status='pending')
instead of being sent inline on the request thread. A background worker
(`start_worker()`, kicked off at app startup) polls for due jobs, delivers
them via `email_service.deliver()`, and applies retry/backoff. Jobs that
exhaust `max_attempts` move to the terminal 'dead' state with `last_error`.

Why DB-backed (vs. FastAPI BackgroundTasks): durability. Enqueued mail
survives a process restart/crash and is retried, and it can be enqueued from
anywhere (services, jobs) — not only inside a request handler.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import text

from core import config
from core.model import EmailJob

logger = logging.getLogger("kontokaz.email_queue")

# Worker tuning.
POLL_INTERVAL_S = 2.0      # how often to look for due jobs (keeps OTP latency low)
BATCH_SIZE = 20            # jobs claimed per tick
DEFAULT_MAX_ATTEMPTS = 5
# Exponential backoff per attempt number (1-indexed), capped. attempt 1 -> 30s, …
_BACKOFF_S = [30, 120, 600, 1800, 3600]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _session():
    factory = config.get_session_local()
    if factory is None:
        raise RuntimeError("email_queue: database not available")
    return factory()


def enqueue_email(
    to_email: str,
    subject: str,
    html: str,
    *,
    kind: Optional[str] = None,
    max_attempts: int = DEFAULT_MAX_ATTEMPTS,
    meta: Optional[dict] = None,
) -> Optional[int]:
    """Insert a pending email job. Opens its own short-lived session so callers
    don't need to thread a `db` through. Returns the job id, or None if the DB
    is unavailable (the email is logged as a last resort so it isn't silently
    lost in dev)."""
    try:
        db = _session()
    except Exception:
        logger.error("email_queue: cannot enqueue (no DB) — to=%s subject=%r", to_email, subject)
        return None
    try:
        job = EmailJob(
            to_email=to_email, subject=subject, html=html, kind=kind,
            status="pending", attempts=0, max_attempts=max_attempts,
            next_attempt_at=_now(), meta=meta,
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        logger.info("email_queue: enqueued job=%s kind=%s to=%s", job.id, kind, to_email)
        return job.id
    except Exception:
        db.rollback()
        logger.exception("email_queue: enqueue failed for to=%s", to_email)
        return None
    finally:
        db.close()


def _backoff_for(attempt: int) -> int:
    """Seconds to wait before the next attempt (attempt is the just-failed,
    1-indexed attempt number)."""
    idx = min(max(attempt, 1), len(_BACKOFF_S)) - 1
    return _BACKOFF_S[idx]


def process_due_jobs(db, *, batch_size: int = BATCH_SIZE, now: Optional[datetime] = None) -> int:
    """Claim and deliver up to `batch_size` due pending jobs. Returns the number
    of jobs processed (delivered or moved to dead/retry this tick).

    Claiming uses SELECT … FOR UPDATE SKIP LOCKED so multiple workers (or
    multiple app processes) never grab the same row. Delivery happens via
    `email_service.deliver`, imported lazily to avoid an import cycle.
    """
    from services import email_service

    now = now or _now()
    rows = (
        db.query(EmailJob)
        .filter(EmailJob.status == "pending")
        .filter(EmailJob.next_attempt_at <= now)
        .order_by(EmailJob.next_attempt_at.asc())
        .limit(batch_size)
        .with_for_update(skip_locked=True)
        .all()
    )
    processed = 0
    for job in rows:
        processed += 1
        try:
            email_service.deliver(job.to_email, job.subject, job.html)
            job.status = "sent"
            job.sent_at = _now()
            job.attempts += 1
            job.last_error = None
        except Exception as e:  # delivery failed — retry or dead-letter
            job.attempts += 1
            job.last_error = str(e)[:2000]
            if job.attempts >= job.max_attempts:
                job.status = "dead"
                logger.error(
                    "email_queue: job=%s DEAD after %s attempts to=%s: %s",
                    job.id, job.attempts, job.to_email, e,
                )
            else:
                job.next_attempt_at = _now() + timedelta(seconds=_backoff_for(job.attempts))
                logger.warning(
                    "email_queue: job=%s attempt %s failed, retrying at %s: %s",
                    job.id, job.attempts, job.next_attempt_at.isoformat(), e,
                )
        db.add(job)
    db.commit()
    return processed


def run_worker_loop(stop_event: Optional[threading.Event] = None) -> None:
    """Blocking poll loop. Runs until `stop_event` is set (or forever)."""
    logger.info("email_queue: worker started (poll=%ss batch=%s)", POLL_INTERVAL_S, BATCH_SIZE)
    while not (stop_event and stop_event.is_set()):
        try:
            db = _session()
            try:
                n = process_due_jobs(db)
            finally:
                db.close()
            # If we drained a full batch, loop again immediately; else sleep.
            if n < BATCH_SIZE:
                time.sleep(POLL_INTERVAL_S)
        except Exception:
            logger.exception("email_queue: worker tick failed; backing off")
            time.sleep(POLL_INTERVAL_S)


_worker_thread: Optional[threading.Thread] = None


def start_worker() -> None:
    """Start the worker in a daemon thread. Idempotent. No-op if disabled via
    EMAIL_WORKER_ENABLED=false (e.g. in tests, where jobs are drained manually)."""
    import os

    global _worker_thread
    if os.environ.get("EMAIL_WORKER_ENABLED", "true").lower() in ("0", "false", "no"):
        logger.info("email_queue: worker disabled via EMAIL_WORKER_ENABLED")
        return
    if _worker_thread is not None and _worker_thread.is_alive():
        return
    _worker_thread = threading.Thread(target=run_worker_loop, daemon=True, name="email-queue-worker")
    _worker_thread.start()
