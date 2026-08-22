#!/usr/bin/env python3
"""Non-destructive schema repair: add columns/tables the models expect but
that are missing from the live DB.

Why this exists: an earlier deploy hit the `create_all + stamp head` fallback,
which created any MISSING tables but never added new COLUMNS to tables that
already existed (e.g. users.preferred_locale, time_logs.admin_approved). The
DB ended up stamped at head yet missing columns, so every query selecting them
500s. Re-running migrations can't help (alembic thinks it's at head), and
down-stamping is risky because some migrations use unguarded create_table.

This script reconciles the DB to the ORM models additively and idempotently:
  - create_all() to add any wholly-missing tables (+ their enum types),
  - ALTER TABLE ... ADD COLUMN IF NOT EXISTS for each model column the DB
    lacks (added NULLABLE so it never fails on a populated table; keeps the
    model's server_default so existing rows get a sensible value).

It never drops or alters existing columns, so it is safe on a DB with data.
It does NOT add missing indexes/constraints — those don't cause the 500s; a
later clean migration baseline can reconcile them. Safe to re-run.

Usage:  cd /app && python3 scripts/repair_missing_columns.py
"""
import os
import sys

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_dir)

from sqlalchemy import inspect, text
from sqlalchemy.schema import CreateColumn

from core.config import get_engine_from_settings
from core.model import Base
from core import platform_role  # noqa: F401  (ensure all models import)


def run() -> None:
    engine = get_engine_from_settings()
    if engine is None:
        print("ERROR: no engine — check POSTGRES_* env vars.")
        sys.exit(1)

    print(f"DB: {engine.url.database} @ {engine.url.host}")

    # 1. Create any wholly-missing tables (and their enum types). No-op for
    #    tables that already exist.
    Base.metadata.create_all(bind=engine)

    # 2. Add missing columns on existing tables.
    insp = inspect(engine)
    db_tables = set(insp.get_table_names())
    added = 0
    skipped_tables = 0

    with engine.begin() as conn:
        # Iterate all tables (not sorted_tables): ADD COLUMN order is
        # irrelevant, and sorted_tables drops tables involved in FK cycles
        # (e.g. sponsored_content <-> sponsored_content_versions), which would
        # silently skip their columns.
        for table in Base.metadata.tables.values():
            if table.name not in db_tables:
                # create_all should have made it; if a brand-new table still
                # isn't here, skip rather than guess.
                skipped_tables += 1
                continue
            db_cols = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in db_cols:
                    continue
                coldef = str(CreateColumn(col).compile(dialect=engine.dialect)).strip()
                # Add NULLABLE so ADD COLUMN can't fail on a populated table;
                # keep any DEFAULT so existing rows + new inserts behave.
                coldef = coldef.replace(" NOT NULL", "")
                sql = f'ALTER TABLE "{table.name}" ADD COLUMN IF NOT EXISTS {coldef}'
                print("  +", sql)
                conn.execute(text(sql))
                added += 1

    print(f"\nDone. Columns added: {added}. Tables not found (skipped): {skipped_tables}.")
    print("Re-run is safe (IF NOT EXISTS). No existing data was modified.")


if __name__ == "__main__":
    run()
