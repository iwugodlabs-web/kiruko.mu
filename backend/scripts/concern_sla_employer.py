"""Concern SLA digest for company admins (M6).

Run weekdays 09:00 via cron. For each company, finds internal concerns in
non-terminal states older than 5 working days and notifies the company's
admins. Idempotent within a 24-hour window via `last_sla_notified_at`.

Cron line (suggested):
  0 9 * * 1-5  cd /app && python3 scripts/concern_sla_employer.py

Flags:
  --dry-run     print the SQL it would run; do not execute, do not notify

Exit codes:
  0  success (any number of notifications, including zero)
  1  initialisation failure
"""
import argparse
import logging
import sys
from datetime import datetime, timedelta, timezone

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("concern_sla_employer")


SLA_WORKING_DAYS = 5
RESEND_COOLDOWN_HOURS = 24
NON_TERMINAL_STATES = (
    "received",
    "triaged",
    "investigating",
    "action_taken",
    "appealed",
)


def _n_working_days_ago(now: datetime, n: int) -> datetime:
    cutoff = now
    skipped = 0
    while skipped < n:
        cutoff -= timedelta(days=1)
        if cutoff.weekday() < 5:  # Mon-Fri
            skipped += 1
    return cutoff


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Print intent only; no notifications.")
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
        sla_cutoff = _n_working_days_ago(now, SLA_WORKING_DAYS)
        resend_cutoff = now - timedelta(hours=RESEND_COOLDOWN_HOURS)

        # Internal concerns past SLA, in a non-terminal state, and either
        # never notified or last notified more than RESEND_COOLDOWN_HOURS ago.
        candidates = (
            db.query(UserRight)
            .filter(UserRight.channel == "internal")
            .filter(UserRight.status.in_(NON_TERMINAL_STATES))
            .filter(UserRight.created_at < sla_cutoff)
            .filter(UserRight.closed_at.is_(None))
            .filter(
                (UserRight.last_sla_notified_at.is_(None))
                | (UserRight.last_sla_notified_at < resend_cutoff)
            )
            .order_by(UserRight.created_at.asc())
            .all()
        )

        if not candidates:
            logger.info("No internal concerns past SLA (cutoff=%s).", sla_cutoff.isoformat())
            return 0

        logger.info("Found %d concerns past SLA.", len(candidates))

        # Group by target company (resolved from reporter's PrivateUser) so
        # we can fire one digest per company rather than spamming admins
        # case-by-case.
        by_company: dict[int, list] = {}
        for c in candidates:
            pu = db.query(PrivateUser).filter(PrivateUser.private_user_id == c.private_user_id).first()
            if pu is None:
                continue
            job = next((j for j in (pu.jobs or []) if getattr(j, "company_id", None)), None)
            company_id = (job.company_id if job else None) or getattr(pu, "company_id", None)
            if not company_id:
                continue
            by_company.setdefault(int(company_id), []).append(c)

        notified_companies = 0
        notified_concerns = 0
        if args.dry_run:
            for company_id, group in by_company.items():
                logger.info(
                    "DRY-RUN — would notify company %d about %d concern(s): %s",
                    company_id,
                    len(group),
                    [c.right_id for c in group],
                )
        else:
            try:
                flat = [c for group in by_company.values() for c in group]
                # Helper groups by company internally and sends one push per
                # admin per company with the spec'd "concerns past SLA window"
                # copy (plan §Notification copy).
                sent = NotificationService.notify_company_concern_aging(db, flat)
                logger.info("Aging-digest helper notified %d admin(s).", sent)
                for group in by_company.values():
                    for c in group:
                        c.last_sla_notified_at = now
                    db.add_all(group)
                notified_companies = len(by_company)
                notified_concerns = sum(len(g) for g in by_company.values())
            except Exception:
                logger.exception("SLA aging-digest notification failed.")

        if not args.dry_run:
            db.commit()
        logger.info(
            "SLA digest complete: %d compan%s, %d concern%s.",
            notified_companies,
            "ies" if notified_companies != 1 else "y",
            notified_concerns,
            "s" if notified_concerns != 1 else "",
        )
        return 0
    except Exception:
        logger.exception("SLA digest failed.")
        db.rollback()
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
