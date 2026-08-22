"""Concern retention purge (M6).

Run daily. Soft-archives concerns past their `retention_purge_at` date.

============================================================================
SAFETY: this script is ALWAYS in dry-run mode unless `--enable-purge` is
passed explicitly. Production cron entry should NOT pass `--enable-purge`
until the first real expiry approaches (years out from launch). The cron
exists to verify the script is in place and runnable; the purge itself is
gated by a deliberate flag.
============================================================================

Cron line (suggested — note ABSENT --enable-purge):
  0 2 * * *  cd /app && python3 scripts/concern_retention_purge.py

Behaviour:
  1. Compute `retention_purge_at` for any closed concern where it's NULL
     (closed_at + 7 years, configurable).
  2. Find concerns whose `retention_purge_at` is in the past.
  3. With --enable-purge: hard-delete the concern row and its dependent
     `concern_messages` / `concern_audit_log` rows (the FK cascades).
  4. Without --enable-purge (default): list what WOULD be deleted, log to
     stdout, and exit cleanly. The retention-audit log file
     (`/var/log/concern_retention.log` if writable; else stdout) records
     the dry-run output.

Idempotency:
  Stamping `retention_purge_at` is idempotent because we only stamp NULL
  rows. Actual deletion is destructive; we accept that re-running after a
  partial failure may need manual reconciliation.

Flags:
  --enable-purge       actually delete rows (default: dry-run)
  --retention-years N  override default 7-year window
  --log-file PATH      write deletions to this file (default: stdout only)

Exit codes:
  0  success
  1  initialisation failure
"""
import argparse
import logging
import sys
from datetime import datetime, timedelta, timezone

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("concern_retention_purge")


DEFAULT_RETENTION_YEARS = 7


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--enable-purge",
        action="store_true",
        help="Actually delete. Without this flag, the script is dry-run only.",
    )
    parser.add_argument(
        "--retention-years",
        type=int,
        default=DEFAULT_RETENTION_YEARS,
        help=f"Years to retain after closure (default {DEFAULT_RETENTION_YEARS}).",
    )
    parser.add_argument(
        "--log-file",
        default=None,
        help="If set, append deletion records here in addition to stdout.",
    )
    args = parser.parse_args()

    sys.path.insert(0, "/app")
    sys.path.insert(0, ".")

    try:
        from core import config
        from core.model import UserRight, PrivateUser, Company
        from services import concern_audit
        from core.concern_states import ActorKind
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
        retention_delta = timedelta(days=365 * args.retention_years)

        # 1) Stamp retention_purge_at on any closed concern missing it.
        # M8 closeout: honour the per-company override via
        # `companies.concern_retention_years` when present. Falls back to
        # the CLI --retention-years (default 7) when the company can't be
        # resolved (which is the case for legacy rows or external concerns).
        unstamped = (
            db.query(UserRight)
            .filter(UserRight.closed_at.isnot(None))
            .filter(UserRight.retention_purge_at.is_(None))
            .all()
        )
        if unstamped:
            logger.info("Stamping retention_purge_at on %d concerns.", len(unstamped))
            from datetime import timedelta as _td
            for c in unstamped:
                effective_years = args.retention_years
                pu = db.query(PrivateUser).filter(
                    PrivateUser.private_user_id == c.private_user_id
                ).first()
                if pu is not None:
                    job = next((j for j in (pu.jobs or []) if getattr(j, "company_id", None)), None)
                    company_id = (
                        job.company_id if job else None
                    ) or getattr(pu, "company_id", None)
                    if company_id:
                        company = db.query(Company).filter(Company.company_id == company_id).first()
                        if company is not None and getattr(company, "concern_retention_years", None):
                            effective_years = int(company.concern_retention_years)
                c.retention_purge_at = c.closed_at + _td(days=365 * effective_years)
                db.add(c)
            db.commit()

        # 2) Find expired concerns.
        expired = (
            db.query(UserRight)
            .filter(UserRight.retention_purge_at.isnot(None))
            .filter(UserRight.retention_purge_at <= now)
            .all()
        )

        if not expired:
            logger.info("Nothing past retention. (Earliest expiry not yet reached.)")
            return 0

        logger.info(
            "%d concerns past retention. enable_purge=%s",
            len(expired),
            args.enable_purge,
        )

        retention_log_lines: list[str] = []
        for c in expired:
            line = (
                f"right_id={c.right_id} closed_at={c.closed_at.isoformat() if c.closed_at else '?'} "
                f"retention_purge_at={c.retention_purge_at.isoformat() if c.retention_purge_at else '?'} "
                f"status={c.status} channel={c.channel}"
            )
            retention_log_lines.append(line)
            if args.enable_purge:
                # Audit the deletion BEFORE the row is gone — the audit_log
                # FK is ON DELETE CASCADE so we can't reference the row
                # after deletion.
                concern_audit.log(
                    db,
                    right_id=c.right_id,
                    actor_kind=ActorKind.SYSTEM.value,
                    action=concern_audit.ACTION_PURGED,
                    details={
                        "retention_years": args.retention_years,
                        "closed_at": c.closed_at.isoformat() if c.closed_at else None,
                    },
                )
                db.delete(c)

        if args.enable_purge:
            db.commit()
            logger.info("Purged %d concerns.", len(expired))
        else:
            logger.info("DRY-RUN — no rows deleted. Would have purged %d.", len(expired))

        # Persist the retention-audit log lines.
        for line in retention_log_lines:
            verb = "PURGED" if args.enable_purge else "WOULD-PURGE"
            logger.info("%s %s", verb, line)
        if args.log_file:
            try:
                with open(args.log_file, "a", encoding="utf-8") as fh:
                    stamp = now.isoformat()
                    for line in retention_log_lines:
                        verb = "PURGED" if args.enable_purge else "WOULD-PURGE"
                        fh.write(f"{stamp} {verb} {line}\n")
            except Exception:
                logger.exception("Failed to append to retention log file %s", args.log_file)

        return 0
    except Exception:
        logger.exception("Retention purge failed.")
        db.rollback()
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
