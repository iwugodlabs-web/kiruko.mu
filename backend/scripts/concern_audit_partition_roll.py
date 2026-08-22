"""Concern audit-log partition roll (M6).

Run as a daily cron job; intended to be invoked on the 25th of each month
but safe to run any day (idempotent).

What it does:
  1. Computes the next-month partition that should exist on
     `concern_audit_log`. If missing, CREATEs it.
  2. Detaches partitions whose entire month is past the audit retention
     window (default 7 years), moving them into a separate
     `concern_audit_log_archive_<YYYY>` schema so the rows remain
     queryable for legal forensics without slowing down the live index.

Idempotency:
  - The next-month CREATE is wrapped in `IF NOT EXISTS`.
  - Detaches are skipped when the partition has already been moved.
  - Re-running on the same day is a no-op.

Cron line (suggested):
  0 2 25 * *  cd /app && python3 scripts/concern_audit_partition_roll.py

Flags:
  --dry-run         print the SQL it would run; do not execute
  --keep-years N    override the retention window (default 7)

Exit codes:
  0  success (any number of partitions created/detached)
  1  initialisation failure (DB unreachable, missing modules)
"""
import argparse
import logging
import sys
from datetime import date

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("concern_audit_partition_roll")


DEFAULT_RETENTION_YEARS = 7
ARCHIVE_SCHEMA_PREFIX = "concern_audit_log_archive_"


def _next_month(year: int, month: int) -> tuple[int, int]:
    if month == 12:
        return year + 1, 1
    return year, month + 1


def _partition_name(year: int, month: int) -> str:
    return f"concern_audit_log_{year:04d}_{month:02d}"


def _format_bound(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}-01"


def _create_partition_sql(year: int, month: int) -> str:
    ny, nm = _next_month(year, month)
    return (
        f"CREATE TABLE IF NOT EXISTS {_partition_name(year, month)} "
        f"PARTITION OF concern_audit_log "
        f"FOR VALUES FROM ('{_format_bound(year, month)}') "
        f"TO ('{_format_bound(ny, nm)}');"
    )


def _archive_schema_for(year: int) -> str:
    return f"{ARCHIVE_SCHEMA_PREFIX}{year:04d}"


def _detach_sql(year: int, month: int) -> list[str]:
    """Detach a partition and move it into the archive schema for its year.

    Postgres requires the schema to exist before the move; we CREATE
    SCHEMA IF NOT EXISTS up-front.
    """
    pname = _partition_name(year, month)
    archive_schema = _archive_schema_for(year)
    return [
        f"CREATE SCHEMA IF NOT EXISTS {archive_schema};",
        f"ALTER TABLE concern_audit_log DETACH PARTITION {pname};",
        f"ALTER TABLE {pname} SET SCHEMA {archive_schema};",
    ]


def _list_existing_partitions(db) -> list[tuple[int, int]]:
    """Return (year, month) for every partition currently attached to
    concern_audit_log."""
    from sqlalchemy import text as _text
    result = db.execute(
        _text(
            "SELECT inhrelid::regclass::text AS child "
            "FROM pg_inherits WHERE inhparent = 'concern_audit_log'::regclass;"
        )
    )
    out: list[tuple[int, int]] = []
    for row in result:
        name = row[0] if isinstance(row, tuple) else row.child
        # Strip optional "public." prefix.
        if "." in name:
            name = name.split(".", 1)[1]
        if not name.startswith("concern_audit_log_"):
            continue
        rest = name[len("concern_audit_log_"):]
        # rest = "YYYY_MM"
        try:
            y_str, m_str = rest.split("_", 1)
            out.append((int(y_str), int(m_str)))
        except (ValueError, IndexError):
            continue
    return sorted(out)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Print SQL only.")
    parser.add_argument(
        "--keep-years",
        type=int,
        default=DEFAULT_RETENTION_YEARS,
        help=f"Retention window in years (default {DEFAULT_RETENTION_YEARS}).",
    )
    args = parser.parse_args()

    sys.path.insert(0, "/app")
    sys.path.insert(0, ".")

    try:
        from core import config
    except Exception as e:  # noqa: BLE001
        logger.error("Failed to import backend modules: %s", e)
        return 1

    SessionLocal = config.get_session_local()
    if SessionLocal is None:
        logger.error("Could not initialise DB session; is POSTGRES_* env set?")
        return 1

    db = SessionLocal()
    try:
        today = date.today()
        # Target = the partition for next month; ensure it exists.
        next_y, next_m = _next_month(today.year, today.month)
        create_stmt = _create_partition_sql(next_y, next_m)

        # Retention cutoff: any partition whose ENTIRE month is older than
        # `cutoff_year, cutoff_month` is archived.
        cutoff_y = today.year - args.keep_years
        cutoff_m = today.month

        existing = _list_existing_partitions(db)
        to_archive = [
            (y, m) for (y, m) in existing
            if (y, m) < (cutoff_y, cutoff_m)
            # Skip if already in archive schema — _list_existing only returns
            # attached partitions, so this filter is implicit.
        ]

        logger.info(
            "today=%s · next-month partition=%s · existing=%d · to-archive=%d",
            today.isoformat(),
            _partition_name(next_y, next_m),
            len(existing),
            len(to_archive),
        )

        sql_to_run: list[str] = [create_stmt]
        for (y, m) in to_archive:
            sql_to_run.extend(_detach_sql(y, m))

        if args.dry_run:
            logger.info("DRY-RUN — would execute:")
            for stmt in sql_to_run:
                logger.info("  %s", stmt)
            return 0

        from sqlalchemy import text as _text
        for stmt in sql_to_run:
            logger.info("Executing: %s", stmt)
            db.execute(_text(stmt))
        db.commit()
        logger.info("Done. Created 1 partition (or noop). Archived %d.", len(to_archive))
        return 0
    except Exception:
        logger.exception("Partition roll failed.")
        db.rollback()
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
