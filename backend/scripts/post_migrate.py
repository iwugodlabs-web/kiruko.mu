"""
post_migrate.py

Runs AFTER `alembic upgrade head` (see migrate.sh) to reconcile any remaining
schema drift against the ORM models — creating missing tables and adding missing
columns idempotently (delegates to pre_migrate.ensure_model_schema).

Why AFTER alembic, not before:
    Prod's alembic_version is stamped at head while the real schema was built by
    an old create_all() + stamp — so `alembic upgrade head` is a no-op and the
    genuinely-missing tables/columns never get created. This backfills them.
    Running it BEFORE alembic would be actively harmful: it would pre-create a
    column that a brand-new forward migration then tries to `op.add_column`,
    failing that (non-idempotent) migration and aborting the whole deploy. After
    alembic, real migrations apply first and this only fills what's still absent.

Non-fatal: any error is caught and we exit 0, so a hiccup here can never block a
deploy (a genuinely broken schema still 500s at request time, exactly as before).
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.pre_migrate import ensure_model_schema


if __name__ == "__main__":
    try:
        ensure_model_schema()
    except Exception as e:
        print(f"[post_migrate] Non-fatal error: {e}")

    # Repair the RLS denormalized company_id columns: make them nullable
    # (independent/company-less users legitimately have NULL) and restore the
    # auto-fill triggers (missing on prod's create_all-bootstrapped schema). Both
    # were making onboarding 500 with a company_id not-null violation. Idempotent
    # + non-fatal.
    try:
        from core.rls_denormalize import repair_denormalized_company_id
        from core.config import get_engine_from_settings
        engine = get_engine_from_settings()
        if engine is not None:
            done = repair_denormalized_company_id(engine)
            print(f"[post_migrate] company_id denormalization repaired on: {done}")
    except Exception as e:
        print(f"[post_migrate] Non-fatal error (rls company_id): {e}")

    sys.exit(0)
