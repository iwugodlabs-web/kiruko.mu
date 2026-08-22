#!/usr/bin/env python3
"""Run every seeder needed for a functional MU instance, idempotently.

migrate.sh historically seeded only the super admin + sectors, which left a
fresh/wiped DB missing the payroll rule set (tax brackets, statutory
deductions, overtime rule) and the platform-role permission catalogue — so
payroll features had nothing to compute against. This runs the full set in
dependency order. Each step is self-idempotent or guarded, so it's safe to
re-run on every seeded deploy.

Steps:
  1. platform roles      — refreshes system roles' permission lists (idempotent)
  2. super admin         — create/reset (only if SUPER_USER_* provided)
  3. sectors             — Mauritius sector salary grid (skips existing rows)
  4. MU payroll rules    — tax brackets + statutory + leave/bonus defaults
                           (GUARDED: supersede() rejects a duplicate
                           effective_from, so only seed when absent)
  5. MU overtime rule    — required by M2 payroll-run creation (self-skips)

Usage:  cd /app && python3 scripts/seed_all.py
"""
import os
import sys

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_dir)

from sqlalchemy import text
from core.config import get_session_local


def _count(sql: str) -> int:
    SessionLocal = get_session_local()
    db = SessionLocal()
    try:
        return db.execute(text(sql)).scalar() or 0
    finally:
        db.close()


def main() -> None:
    # 1. Platform roles (idempotent — refreshes system roles in place).
    print("[seed_all] platform roles ...")
    from scripts import seed_platform_roles
    seed_platform_roles.main()

    # 2. Super admin — only if creds are set. Idempotent (creates or resets).
    if os.getenv("SUPER_USER_PASSWORD") and (
        os.getenv("SUPER_USER_EMAIL") or os.getenv("SUPER_ADMIN_EMAILS")
    ):
        print("[seed_all] super admin ...")
        import runpy
        runpy.run_path(
            os.path.join(backend_dir, "scripts", "super_admin_seeder.py"),
            run_name="__main__",
        )
    else:
        print("[seed_all] skip super admin (set SUPER_USER_EMAIL + SUPER_USER_PASSWORD)")

    # 2b. RLS app-role login — gives kiruko_app a LOGIN + password from
    # KIRUKO_APP_PASSWORD so the app can connect AS it (NOBYPASSRLS -> RLS
    # enforces). No-op if the env var is unset, so RLS stays dormant until you
    # ALSO point the runtime DATABASE_URL at kiruko_app. Runs here (owner phase).
    print("[seed_all] kiruko_app login ...")
    from scripts import seed_kiruko_app_role
    seed_kiruko_app_role.run()

    # 3. Sectors (idempotent — internal row-level skip).
    print("[seed_all] sectors ...")
    from jobs.seed_sectors_from_excel import SectorExcelSeeder
    SessionLocal = get_session_local()
    db = SessionLocal()
    try:
        report = SectorExcelSeeder(db).seed_file(
            os.path.join(backend_dir, "mauritius_sector_rates.csv"), dry_run=False
        )
        print("[seed_all] sectors:", report)
    finally:
        db.close()

    # 4. MU payroll rules — guard on existing tax brackets (not self-idempotent).
    if _count("SELECT count(*) FROM tax_bracket_sets WHERE country_code = 'MU'") > 0:
        print("[seed_all] MU payroll rules already present — skipping")
    else:
        print("[seed_all] MU payroll rules ...")
        from scripts import seed_mu_payroll_rules
        seed_mu_payroll_rules.main()

    # 5. MU overtime rule (self-idempotent — skips if a rule exists).
    print("[seed_all] MU overtime rule ...")
    from scripts import seed_overtime_rules_mu
    seed_overtime_rules_mu.main()

    print("[seed_all] complete.")


if __name__ == "__main__":
    main()
