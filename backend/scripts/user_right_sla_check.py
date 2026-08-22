"""Your Right SLA aging check (plan Phase 11 Step 5).

Run this as a daily cron job:
    0 9 * * 1-5  cd /app && python3 scripts/user_right_sla_check.py

Finds every Your Right report still in `pending` or `in_progress` state
where `created_at < NOW() - 5 working days`. Fans out a digest notification
to every user with the `compliance_officer` platform role (or platform_admin
as fallback). Idempotent: re-running on the same day notifies the same set
of officers again — that is intentional, the digest IS the page-on-the-pager
mechanic. If a quieter cadence is needed, gate the script on a state column
or run weekly.

Exit codes:
    0  — ran successfully (zero or more reports notified)
    1  — initialization failed (DB unreachable)
"""
import logging
import sys
from datetime import datetime, timedelta, timezone

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger("user_right_sla_check")


def _five_working_days_ago(now: datetime) -> datetime:
    """Approximate '5 working days ago'. Calendar days minus weekend
    skip — close enough for an SLA threshold without bringing in
    `dateutil.rrule` for one query."""
    cutoff = now
    skipped = 0
    while skipped < 5:
        cutoff -= timedelta(days=1)
        if cutoff.weekday() < 5:  # Mon-Fri
            skipped += 1
    return cutoff


def main() -> int:
    sys.path.insert(0, '/app')
    sys.path.insert(0, '.')

    try:
        from core import config
        from core.model import UserRight
        from services.notification_service import NotificationService
    except Exception as e:
        logger.error(f"Failed to import backend modules: {e}")
        return 1

    SessionLocal = config.get_session_local()
    if SessionLocal is None:
        logger.error("Could not initialise DB session — is POSTGRES_* env set?")
        return 1

    db = SessionLocal()
    try:
        cutoff = _five_working_days_ago(datetime.now(timezone.utc))
        aging = (
            db.query(UserRight)
            .filter(UserRight.status.in_(["pending", "in_progress"]))
            .filter(UserRight.created_at < cutoff)
            .order_by(UserRight.created_at.asc())
            .all()
        )

        if not aging:
            logger.info("No Your Right reports past SLA (cutoff=%s).", cutoff.isoformat())
            return 0

        logger.info(
            "Found %d Your Right report(s) past SLA. Fanning out digest...",
            len(aging),
        )
        notified = NotificationService.notify_compliance_user_right_aging(db, aging)
        logger.info("Digest sent to %d compliance officer(s).", notified)
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
