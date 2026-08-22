"""Concern acknowledgement reminder (M6).

Run daily. Nudges company admins when a concern is older than 5 days and
`acknowledged_at` is still NULL. EU directive expects acknowledgement
within 7 days; we ping at 5 to leave room.

Cron line (suggested):
  0 10 * * *  cd /app && python3 scripts/concern_acknowledge_reminder.py

Idempotency:
  Tied to `last_sla_notified_at`. A concern that already got an SLA digest
  in the past 24h is NOT also nudged here — we don't want double-pinging
  the same admins on the same case in the same day. The two scripts are
  complementary: SLA fires when status is in_progress past the deadline;
  this fires when the case hasn't even been acknowledged yet.

Flags:
  --dry-run    print the candidates; do not notify

Exit codes:
  0  success
  1  initialisation failure
"""
import argparse
import logging
import sys
from datetime import datetime, timedelta, timezone

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("concern_acknowledge_reminder")


ACK_NAG_AFTER_DAYS = 5
RESEND_COOLDOWN_HOURS = 24


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    sys.path.insert(0, "/app")
    sys.path.insert(0, ".")

    try:
        from core import config
        from core.model import UserRight, PrivateUser
        from services.notification_service import NotificationService
    except Exception as e:  # noqa: BLE001
        logger.error("Failed to import backend modules: %s", e)
        return 1

    SessionLocal = config.get_session_local()
    if SessionLocal is None:
        logger.error("Could not initialise DB session; is POSTGRES_* env set?")
        return 1

    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        ack_cutoff = now - timedelta(days=ACK_NAG_AFTER_DAYS)
        resend_cutoff = now - timedelta(hours=RESEND_COOLDOWN_HOURS)

        candidates = (
            db.query(UserRight)
            .filter(UserRight.channel == "internal")
            .filter(UserRight.acknowledged_at.is_(None))
            .filter(UserRight.created_at < ack_cutoff)
            .filter(UserRight.closed_at.is_(None))
            .filter(
                (UserRight.last_sla_notified_at.is_(None))
                | (UserRight.last_sla_notified_at < resend_cutoff)
            )
            .all()
        )

        if not candidates:
            logger.info("No unacknowledged concerns past ack window (cutoff=%s).", ack_cutoff.isoformat())
            return 0

        logger.info("Found %d unacknowledged concerns.", len(candidates))

        notified = 0
        for c in candidates:
            pu = db.query(PrivateUser).filter(PrivateUser.private_user_id == c.private_user_id).first()
            if pu is None:
                continue
            if args.dry_run:
                logger.info(
                    "DRY-RUN — would nudge company about case #%s (created %s)",
                    c.right_id,
                    c.created_at.isoformat() if c.created_at else "?",
                )
                continue
            try:
                # Spec'd unack copy per plan §Notification copy:
                # "Concern #{id} needs acknowledgment — {N} days open".
                NotificationService.notify_company_concern_unack(db, c)
                c.last_sla_notified_at = now
                db.add(c)
                notified += 1
            except Exception:
                logger.exception("Ack-reminder failed for right_id=%s", c.right_id)

        if not args.dry_run:
            db.commit()
        logger.info("Acknowledgement reminder complete: %d nudge(s).", notified)
        return 0
    except Exception:
        logger.exception("Acknowledgement reminder failed.")
        db.rollback()
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
