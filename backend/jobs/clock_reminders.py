#!/usr/bin/env python3
"""Server-side clock-in / clock-out reminder push notifications.

Replaces the unreliable on-device local notifications (which only fired if the
profile happened to be saved with reminders on, permission granted, and the OS
hadn't cleared the schedule). This runs server-side so it fires regardless of
app state.

Invoked every tick by the in-app scheduler thread in ``main.py`` (the same
5-minute loop that runs auto-clockout), so it needs no external cron. It can
still be run standalone for one-off/backfill use:

    python -m jobs.clock_reminders

For each employee whose job has clock reminders enabled (``auto_clockin_enabled``)
and a work schedule, on a scheduled work day:
  - at their local ``work_start_time``  → "time to clock in"  (only if NOT already clocked in)
  - at their local ``work_end_time``    → "time to clock out" (only if STILL clocked in)

Times are interpreted in the employee's company timezone (``Company.timezone``,
IANA, default ``Indian/Mauritius``). A reminder fires only when its target local
minute falls inside ``(now - WINDOW, now]``. Because the in-app loop ticks every
5 min while ``WINDOW`` is 10 min, a target lands in TWO consecutive windows, so an
in-process per-day dedup set (``_sent_keys``) makes each reminder fire exactly
once per local day. Keeping ``WINDOW`` > tick cadence also closes the gaps that
loop drift would otherwise open. Single-instance correct (the caller already
holds a pg advisory lock per tick); for multi-instance HA move the dedup to a
shared store.
"""
from __future__ import annotations

import logging
import sys
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session, sessionmaker

from core import config
from core.model import Job, TimeLog, User
from services.notification_service import NotificationService

logger = logging.getLogger("clock_reminders")

# Window must be >= the caller's tick cadence so loop drift can't open a gap that
# skips a reminder. The in-app scheduler ticks every 5 min; 10 min is safe. The
# resulting double-match (target falls in two consecutive windows) is absorbed by
# the per-day dedup set below.
WINDOW_MINUTES = 10
_UTC = ZoneInfo("UTC")
_DEFAULT_TZ = "Indian/Mauritius"

# In-process idempotency: (local_date_iso, private_user_id, kind) tuples already
# sent. Scoped to a UTC date and cleared on rollover so it self-prunes (reminders
# fire during daytime work hours, never across UTC midnight for Mauritius UTC+4,
# so clearing at UTC-midnight can't drop a still-live entry).
_sent_keys: set[tuple] = set()
_sent_anchor: date | None = None


def _is_workday(work_days: dict | None, local_dt: datetime) -> bool:
    """work_days is a JSONB dict keyed by day name. Keys may be capitalized
    ('Monday') or lowercase ('monday'); an enabled day is present with a truthy,
    non-'off' value (days toggled off are removed from the object)."""
    if not work_days:
        return False
    name = local_dt.strftime("%A")  # 'Monday'
    for key in (name, name.lower()):
        if key in work_days:
            v = work_days[key]
            return bool(v) and str(v).strip().lower() not in ("off", "false", "0", "")
    return False


def _in_window(target_time, now_local: datetime) -> bool:
    """True when the scheduled local clock (target_time, a datetime.time) falls
    inside (now_local - WINDOW, now_local]."""
    if target_time is None:
        return False
    target = now_local.replace(
        hour=target_time.hour, minute=target_time.minute, second=0, microsecond=0
    )
    return (now_local - timedelta(minutes=WINDOW_MINUTES)) < target <= now_local


def _has_open_session(db: Session, private_user_id: int) -> bool:
    return (
        db.query(TimeLog.timelog_id)
        .filter(TimeLog.private_user_id == private_user_id, TimeLog.end_time.is_(None))
        .first()
        is not None
    )


def run(db: Session) -> int:
    """Returns the number of push reminders sent."""
    global _sent_anchor
    now_utc = datetime.now(_UTC)
    # Reset the dedup set when the UTC day rolls over.
    if _sent_anchor != now_utc.date():
        _sent_keys.clear()
        _sent_anchor = now_utc.date()
    sent = 0

    jobs = (
        db.query(Job)
        .filter(Job.auto_clockin_enabled.is_(True))
        .filter(Job.work_start_time.isnot(None))
        .all()
    )

    for job in jobs:
        pu = job.private_user
        if not pu:
            continue
        user = db.query(User).filter(User.user_id == pu.user_id).first()
        token = getattr(user, "expo_push_token", None) if user else None
        if not token:
            continue

        company = pu.company
        tz_name = (company.timezone if company and company.timezone else _DEFAULT_TZ)
        try:
            now_local = now_utc.astimezone(ZoneInfo(tz_name))
        except Exception:
            now_local = now_utc.astimezone(ZoneInfo(_DEFAULT_TZ))

        if not _is_workday(job.work_days, now_local):
            continue

        day_key = now_local.date().isoformat()

        # Clock-in reminder — only if they are NOT already clocked in.
        in_key = (day_key, pu.private_user_id, "clock_in")
        if (
            in_key not in _sent_keys
            and _in_window(job.work_start_time, now_local)
            and not _has_open_session(db, pu.private_user_id)
        ):
            if NotificationService.send_expo_push(
                token,
                "⏰ Time to clock in",
                "Your work day starts now — don't forget to clock in!",
                {"type": "clock_reminder", "kind": "clock_in"},
            ):
                _sent_keys.add(in_key)
                sent += 1

        # Clock-out reminder — only if they are STILL clocked in.
        out_key = (day_key, pu.private_user_id, "clock_out")
        if (
            out_key not in _sent_keys
            and _in_window(job.work_end_time, now_local)
            and _has_open_session(db, pu.private_user_id)
        ):
            if NotificationService.send_expo_push(
                token,
                "\U0001f3c1 Time to clock out",
                "Your work day is ending — don't forget to clock out!",
                {"type": "clock_reminder", "kind": "clock_out"},
            ):
                _sent_keys.add(out_key)
                sent += 1

    return sent


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    engine = config.get_engine_from_settings()
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = SessionLocal()
    try:
        count = run(db)
        logger.info("clock_reminders: sent %d reminder(s)", count)
        return 0
    except Exception:
        logger.exception("clock_reminders failed")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
