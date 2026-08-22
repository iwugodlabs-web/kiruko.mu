"""Concern retaliation surveys (M6).

Run daily. For each concern closed in the past 30 / 60 / 90 days where the
corresponding `retaliation_check_*_at` is still NULL, fires a survey
notification to the reporter and stamps the column. Idempotent — a row
that's already been stamped for a given window is skipped.

Cron line (suggested):
  0 11 * * *  cd /app && python3 scripts/concern_retaliation_survey.py

Survey content is delivered as a `concern_messages` row authored by
`actor_kind='system'`. The reporter sees it as a normal thread message
asking a single yes/no plus optional details. Responses arrive via
`concern_retaliation_responses` rows (mobile UI not in this script; the
reporter-portal POST endpoint handles answer ingestion in a follow-up
PR).

Flags:
  --dry-run    print candidates; do not insert messages or stamp columns

Exit codes:
  0  success
  1  initialisation failure
"""
import argparse
import logging
import sys
from datetime import datetime, timedelta, timezone

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("concern_retaliation_survey")


WINDOWS = (
    # (days_post_closure, attribute_name, label)
    (30, "retaliation_check_30d_at", "30d"),
    (60, "retaliation_check_60d_at", "60d"),
    (90, "retaliation_check_90d_at", "90d"),
)

SURVEY_BODY = (
    "It's been {days} days since your concern was closed. Have you "
    "experienced any retaliation, retribution, or unfair treatment as a "
    "result of filing? Reply yes or no — your handler will follow up if "
    "needed. (You can ignore this message if everything is fine.)"
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    sys.path.insert(0, "/app")
    sys.path.insert(0, ".")

    try:
        from core import config
        from core.model import UserRight, ConcernMessage
        from core.concern_states import ActorKind
        from services import concern_audit
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
        total_sent = 0

        for days, column_name, window_label in WINDOWS:
            window_lower = now - timedelta(days=days + 1)
            window_upper = now - timedelta(days=days)

            column = getattr(UserRight, column_name)
            candidates = (
                db.query(UserRight)
                .filter(UserRight.closed_at.isnot(None))
                .filter(UserRight.closed_at >= window_lower)
                .filter(UserRight.closed_at < window_upper)
                .filter(column.is_(None))
                .all()
            )

            if not candidates:
                logger.info("No candidates for %s window.", window_label)
                continue

            logger.info("Found %d candidates for %s window.", len(candidates), window_label)
            for c in candidates:
                if args.dry_run:
                    logger.info(
                        "DRY-RUN — would post %s survey on case #%s (closed %s)",
                        window_label,
                        c.right_id,
                        c.closed_at.isoformat() if c.closed_at else "?",
                    )
                    continue
                try:
                    msg = ConcernMessage(
                        right_id=c.right_id,
                        author_kind=ActorKind.SYSTEM.value,
                        author_user_id=None,
                        body=SURVEY_BODY.format(days=days),
                        attachment_url=None,
                    )
                    db.add(msg)
                    setattr(c, column_name, now)
                    db.add(c)
                    db.commit()

                    concern_audit.log(
                        db,
                        right_id=c.right_id,
                        actor_kind=ActorKind.SYSTEM.value,
                        action="retaliation_survey_sent",
                        details={"window": window_label, "message_id": msg.message_id},
                    )
                    # M8 closeout — push notification to the reporter so the
                    # survey reaches them without requiring the app to be
                    # foregrounded. Best-effort; the in-thread message is
                    # the durable record.
                    try:
                        from services.notification_service import NotificationService
                        NotificationService.notify_employee_retaliation_survey(
                            db, c, window_label,
                        )
                    except Exception:
                        logger.exception(
                            "Retaliation push failed for right_id=%s window=%s",
                            c.right_id, window_label,
                        )
                    total_sent += 1
                except Exception:
                    logger.exception("Failed survey on right_id=%s window=%s", c.right_id, window_label)
                    db.rollback()

        logger.info("Retaliation surveys complete: %d sent.", total_sent)
        return 0
    except Exception:
        logger.exception("Retaliation survey script failed.")
        db.rollback()
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
