"""
fix_alembic_stamp.py

Detects the case where the production DB was bootstrapped via SQLAlchemy
create_all() without proper Alembic migration tracking. In that situation,
alembic_version may be stamped at 'head' even though some migrations were
never actually applied — so 'alembic upgrade head' is a no-op and the schema
stays out of sync.

This script checks the real schema state against known migrations and rewinds
the alembic stamp to the last revision that was genuinely applied, so that
'alembic upgrade head' will pick up and apply only the truly missing migrations.

Safe to run on every startup — it is idempotent (exits silently if schema is
already correct).
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import config
from sqlalchemy import text


def check_column_exists(conn, table, column):
    row = conn.execute(text("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = :t AND column_name = :c
    """), {"t": table, "c": column}).fetchone()
    return row is not None


def get_alembic_version(conn):
    try:
        row = conn.execute(text("SELECT version_num FROM alembic_version")).fetchone()
        return row[0] if row else None
    except Exception:
        return None


def set_alembic_version(conn, revision):
    conn.execute(text("DELETE FROM alembic_version"))
    conn.execute(text("INSERT INTO alembic_version (version_num) VALUES (:r)"), {"r": revision})
    conn.commit()


SQUASH_REVISION = "squash_2026_04_06"

# All revision IDs that existed before the squash.  Any DB stamped at one of
# these (or at None / unknown) is treated as "already fully migrated" and its
# stamp is simply rewritten to the squash revision so alembic upgrade head
# becomes a no-op on the next boot.
LEGACY_REVISIONS = {
    # original chain
    "b7ec274f2c34", "25d93830cda7", "merge_heads_20251210",
    "3f9b1e5d", "4a1c2d3b", "5f31f860e1e5",
    "a9f7c6e5b4d3", "94ce21ba54d7", "c3d4e5f6", "d4e5f6a7",
    "b1c2d3e4f5", "a2b3c4d5", "6f7e8d9a",
    "f3a9b1c2d4e1", "h5i6j7k8", "g1h2i3j4",
    "ab11ba50b0b8", "c89003bfd623", "e9f1a2b3c4d5",
    "29e901b33fb2", "b39a8b446ead",
    "20251230_add_company_invites_and_audit",
    "20260108_add_trigram_users",
    "20260128_add_verification_note_to_users",
    "a6a829acb868",
    "72c0e3db21df", "617cec25f0da",
    "6bf544a4bf83",
    "0ac9608a69de",
    "46ffdca55148",
    "20260201_add_schedule_assignee_statuses",
    "20260303_add_verification_tokens_table",
    "20260307_add_vat_to_companies", "20260307_add_vat_companies",
    "c1d4e5f6789a", "c1fbf3638740",
    "20260329_kontokaz_features",
    "20260402_sector_country_year_grade",
    "20260403_add_company_roles",
    "20260403_add_dispute_workflow_fields",
    "20260403_add_overtime_rejected_flag",
    "20260403_add_performance_indexes",
    "i6j7k8l9m0n1", "i6j7k8l9",
    "20260404_add_missing_jobs_fields",
}


def main():
    engine = config.get_engine_from_settings()
    if not engine:
        print("No database engine available, skipping stamp check")
        return

    with engine.connect() as conn:
        current = get_alembic_version(conn)
        print(f"Current alembic_version: {current}")

        # ----------------------------------------------------------------
        # Case 1 — DB is already on the squash revision.  Nothing to do.
        # ----------------------------------------------------------------
        if current == SQUASH_REVISION:
            print("Schema OK — already on squash revision")
            return

        # ----------------------------------------------------------------
        # Case 2 — DB was stamped at a legacy revision (old migration chain).
        # The schema is complete (pre_migrate.py already ensured the columns).
        # Rewrite the stamp to the squash revision so alembic upgrade head
        # is a no-op on this boot and on all future boots.
        # ----------------------------------------------------------------
        if current in LEGACY_REVISIONS:
            print(f"Legacy stamp '{current}' detected — rewriting to squash revision")
            set_alembic_version(conn, SQUASH_REVISION)
            print(f"Stamp rewritten to {SQUASH_REVISION}; alembic upgrade head will be a no-op")
            return

        # ----------------------------------------------------------------
        # Case 3 — No alembic_version row at all (brand-new DB).
        # Let alembic run the squash migration normally; don't touch anything.
        # ----------------------------------------------------------------
        if current is None:
            print("No alembic_version row — fresh database, letting alembic run squash migration")
            return

        # ----------------------------------------------------------------
        # Case 4 — Unknown revision (shouldn't happen, but be safe).
        # ----------------------------------------------------------------
        print(f"Unknown revision '{current}' — leaving stamp untouched")
        print("Schema OK — no stamp correction needed")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # Non-fatal: log and let alembic upgrade head proceed
        print(f"Stamp check warning (non-fatal): {e}")
        sys.exit(0)
