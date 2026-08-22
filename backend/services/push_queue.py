"""Durable outbound push-notification queue.

Every Expo push is enqueued as a `push_jobs` row (status='pending') instead of
being sent inline on the request thread. A background worker (`start_worker()`,
kicked off at app startup) polls for due jobs, delivers them via
`NotificationService.send_expo_push`, and applies retry/backoff. Jobs that
exhaust `max_attempts` move to the terminal 'dead' state with `last_error`.

Mirrors `email_queue` — DB-backed for durability: enqueued pushes survive a
process restart and can be enqueued from anywhere (services, jobs, the
notification fan-out), not only inside a request handler.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from core import config
from core.model import PushJob

logger = logging.getLogger("kontokaz.push_queue")

# Worker tuning (mirrors email_queue).
POLL_INTERVAL_S = 2.0
BATCH_SIZE = 50
DEFAULT_MAX_ATTEMPTS = 5
_BACKOFF_S = [30, 120, 600, 1800, 3600]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _session():
    factory = config.get_session_local()
    if factory is None:
        raise RuntimeError("push_queue: database not available")
    return factory()


def enqueue_push(
    token: str,
    title: str,
    body: str,
    data: Optional[dict] = None,
    *,
    kind: Optional[str] = None,
    max_attempts: int = DEFAULT_MAX_ATTEMPTS,
) -> Optional[int]:
    """Insert a pending push job. Opens its own short-lived session so callers
    don't need to thread a `db` through. Returns the job id, or None if the DB
    is unavailable or the token is empty."""
    if not token:
        return None
    try:
        db = _session()
    except Exception:
        logger.error("push_queue: cannot enqueue (no DB) — kind=%s", kind)
        return None
    try:
        job = PushJob(
            to_token=token, title=title, body=body, data=data, kind=kind,
            status="pending", attempts=0, max_attempts=max_attempts,
            next_attempt_at=_now(),
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        return job.id
    except Exception:
        db.rollback()
        logger.exception("push_queue: enqueue failed (kind=%s)", kind)
        return None
    finally:
        db.close()


def _backoff_for(attempt: int) -> int:
    idx = min(max(attempt, 1), len(_BACKOFF_S)) - 1
    return _BACKOFF_S[idx]


def process_due_jobs(db, *, batch_size: int = BATCH_SIZE, now: Optional[datetime] = None) -> int:
    """Claim and deliver up to `batch_size` due pending jobs. Returns the number
    processed. Claiming uses SELECT … FOR UPDATE SKIP LOCKED so multiple workers
    never grab the same row."""
    from services.notification_service import NotificationService

    now = now or _now()
    rows = (
        db.query(PushJob)
        .filter(PushJob.status == "pending")
        .filter(PushJob.next_attempt_at <= now)
        .order_by(PushJob.next_attempt_at.asc())
        .limit(batch_size)
        .with_for_update(skip_locked=True)
        .all()
    )
    processed = 0
    for job in rows:
        processed += 1
        try:
            ok = NotificationService.send_expo_push(
                token=job.to_token, title=job.title, body=job.body, data=job.data or {},
            )
            if ok is False:
                raise RuntimeError("send_expo_push returned False")
            job.status = "sent"
            job.sent_at = _now()
            job.attempts += 1
            job.last_error = None
        except Exception as e:
            job.attempts += 1
            job.last_error = str(e)[:2000]
            if job.attempts >= job.max_attempts:
                job.status = "dead"
                logger.error("push_queue: job=%s DEAD after %s attempts: %s", job.id, job.attempts, e)
            else:
                job.next_attempt_at = _now() + timedelta(seconds=_backoff_for(job.attempts))
                logger.warning("push_queue: job=%s attempt %s failed, retry at %s: %s",
                               job.id, job.attempts, job.next_attempt_at.isoformat(), e)
        db.add(job)
    db.commit()
    return processed


def run_worker_loop(stop_event: Optional[threading.Event] = None) -> None:
    """Blocking poll loop. Runs until `stop_event` is set (or forever)."""
    logger.info("push_queue: worker started (poll=%ss batch=%s)", POLL_INTERVAL_S, BATCH_SIZE)
    while not (stop_event and stop_event.is_set()):
        try:
            db = _session()
            try:
                n = process_due_jobs(db)
            finally:
                db.close()
            if n < BATCH_SIZE:
                time.sleep(POLL_INTERVAL_S)
        except Exception:
            logger.exception("push_queue: worker tick failed; backing off")
            time.sleep(POLL_INTERVAL_S)


_worker_thread: Optional[threading.Thread] = None


def start_worker() -> None:
    """Start the worker in a daemon thread. Idempotent. No-op if disabled via
    PUSH_WORKER_ENABLED=false (e.g. in tests, where jobs are drained manually)."""
    import os

    global _worker_thread
    if os.environ.get("PUSH_WORKER_ENABLED", "true").lower() in ("0", "false", "no"):
        logger.info("push_queue: worker disabled via PUSH_WORKER_ENABLED")
        return
    if _worker_thread is not None and _worker_thread.is_alive():
        return
    _worker_thread = threading.Thread(target=run_worker_loop, daemon=True, name="push-queue-worker")
    _worker_thread.start()
