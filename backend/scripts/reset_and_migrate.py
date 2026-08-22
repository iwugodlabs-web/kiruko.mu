#!/usr/bin/env python3
"""DESTRUCTIVE one-shot DB reset: drop the public schema, re-run all
migrations from base, and (optionally) seed the super admin.

It connects via get_engine_from_settings() — the EXACT same connection the
app uses — so it always targets the app's database (no shell-env / .env
ambiguity). Alembic runs through the same POSTGRES_* config.

Guarded: refuses to run unless CONFIRM_WIPE=yes, because it deletes ALL data.

Usage (DO console):
  cd /app && CONFIRM_WIPE=yes \
    SUPER_USER_EMAIL=iwugodlabs@gmail.com SUPER_USER_PASSWORD='strong-pass' \
    python3 scripts/reset_and_migrate.py
"""
import os
import sys

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_dir)

from sqlalchemy import text, inspect
from core.config import get_engine_from_settings


def main() -> None:
    engine = get_engine_from_settings()
    if engine is None:
        print("ERROR: no engine — check POSTGRES_* env vars.")
        sys.exit(1)

    print(f"TARGET DB: {engine.url.host} / {engine.url.database}")

    if os.getenv("CONFIRM_WIPE") != "yes":
        print("Refusing to wipe. Re-run with CONFIRM_WIPE=yes to proceed.")
        sys.exit(1)

    # 1. Wipe everything.
    #
    # Preferred: drop + recreate the public schema (clean slate, self-hosted PG).
    # But on MANAGED Postgres (e.g. DigitalOcean) the app role does NOT own the
    # `public` schema — it's owned by pg_database_owner / the cluster admin — so
    # `DROP SCHEMA public CASCADE` is refused with "must be owner of schema
    # public". In that case fall back to `DROP OWNED BY CURRENT_USER CASCADE`,
    # which drops every object the app role created (all our tables, sequences,
    # types + alembic_version) without needing schema ownership. For our
    # single-role setup that's the practical equivalent of a full wipe.
    print("Wiping all objects ...")
    dropped = False
    try:
        with engine.begin() as conn:
            conn.execute(text("DROP SCHEMA public CASCADE"))
            conn.execute(text("CREATE SCHEMA public"))
        dropped = True
        print("Schema reset (dropped + recreated public).")
    except Exception as e:  # noqa: BLE001 — managed PG ownership restriction
        print(
            f"DROP SCHEMA refused ({e.__class__.__name__}); "
            "falling back to DROP OWNED BY CURRENT_USER ..."
        )

    if not dropped:
        with engine.begin() as conn:
            conn.execute(text("DROP OWNED BY CURRENT_USER CASCADE"))
        print("Wiped all objects owned by the app role.")

    # 2. Run all migrations from base, through the same POSTGRES_* config.
    print("Running alembic upgrade head ...")
    from alembic import command
    from alembic.config import Config

    cfg = Config(os.path.join(backend_dir, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(backend_dir, "alembic"))
    command.upgrade(cfg, "head")
    print("alembic upgrade head DONE.")

    # 3. Verify the previously-missing column now exists on THIS DB.
    insp = inspect(engine)
    has_pref = "preferred_locale" in [c["name"] for c in insp.get_columns("users")]
    print(f"users.preferred_locale present: {has_pref}")
    if not has_pref:
        print("ERROR: column still missing — alembic targeted a different DB?")
        sys.exit(1)

    # 4. Full seed set (platform roles, super admin, sectors, MU payroll +
    #    overtime rules) so the fresh DB is a functional instance, not just
    #    an empty schema. Idempotent/guarded internally.
    print("Seeding (full set) ...")
    from scripts import seed_all
    seed_all.main()

    with engine.connect() as conn:
        n = conn.execute(text("SELECT count(*) FROM users")).scalar()
    print(f"Done. users count: {n}")


if __name__ == "__main__":
    main()
