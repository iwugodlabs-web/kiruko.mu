#!/usr/bin/env python3
"""Give the RLS role `kiruko_app` a LOGIN + password from env, so the app can
connect AS it (the NOBYPASSRLS role that makes Row-Level Security enforce).

Mirrors super_admin_seeder: the password comes from the environment
(`KIRUKO_APP_PASSWORD`), never the repo — which is why this is a seeder and not a
migration. The RLS structure (policies, the role itself, its grants) IS in
migrations; only the login secret lives here.

Idempotent. NO-OP if `KIRUKO_APP_PASSWORD` is unset, so it's safe to wire into
seed_all / the deploy before you're ready to flip — RLS stays dormant until you
also point the app's DATABASE_URL at kiruko_app.

IMPORTANT: run this as the DB OWNER / admin (doadmin) — granting LOGIN needs
CREATEROLE. It is part of the owner-connected migrate+seed phase, BEFORE the app
switches its runtime DATABASE_URL to kiruko_app.

Usage:  KIRUKO_APP_PASSWORD=... python3 backend/scripts/seed_kiruko_app_role.py
"""
import os
import sys

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_dir)

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(backend_dir, ".env"), override=False)
except Exception:
    pass

from sqlalchemy import text
from core.config import get_session_local


def run() -> None:
    pw = os.getenv("KIRUKO_APP_PASSWORD")
    if not pw:
        print("[kiruko_app] KIRUKO_APP_PASSWORD not set — skipping (RLS stays dormant).")
        return

    SessionLocal = get_session_local()
    if SessionLocal is None:
        print("[kiruko_app] DB not available — skipping.")
        return

    db = SessionLocal()
    try:
        if not db.execute(text("SELECT 1 FROM pg_roles WHERE rolname='kiruko_app'")).first():
            print("[kiruko_app] role missing — run migrations first; skipping.")
            return
        # Safety check: grants must be present, else connecting as kiruko_app would
        # 'permission denied' on every table. (rls_grant_kiruko_app migration sets these.)
        if not db.execute(text("SELECT has_table_privilege('kiruko_app','users','SELECT')")).scalar():
            print("[kiruko_app] WARNING: role lacks table grants — run migrations to head first; skipping.")
            return
        # ALTER ROLE ... PASSWORD takes a string literal (not a bind param); escape
        # single quotes by doubling. Password content is otherwise opaque.
        escaped = pw.replace("'", "''")
        db.execute(text(f"ALTER ROLE kiruko_app LOGIN PASSWORD '{escaped}'"))
        db.commit()
        print("[kiruko_app] LOGIN enabled + password set. Point the runtime DATABASE_URL "
              "at kiruko_app to enforce RLS (migrations stay on the owner role).")
    except Exception as e:
        db.rollback()
        print(f"[kiruko_app] ERROR (need to run as owner/doadmin with CREATEROLE?): {e}")
    finally:
        db.close()


if __name__ == "__main__":
    run()
