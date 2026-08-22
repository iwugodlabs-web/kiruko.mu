"""Seed the system platform roles (platform_admin, engineer, etc.) with the
current permission catalogue.

Thin CLI wrapper around `core.platform_permissions.seed_platform_roles`. Run
once per DB setup AND any time `platform_permissions.SYSTEM_ROLE_DEFAULTS`
changes — it refreshes existing system roles' permission lists in place, so
adding a new permission to the catalogue propagates to platform_admin
automatically.

Idempotent: safe to re-run. Touches only `system=True` roles, never the
admin-customised platform roles.

Run from backend/ with the venv active:
    python -m scripts.seed_platform_roles
"""

from __future__ import annotations

import sys

from core.config import get_session_local
from core.platform_permissions import SYSTEM_ROLE_DEFAULTS, seed_platform_roles


def main() -> None:
    SessionLocal = get_session_local()
    if SessionLocal is None:
        print("ERROR: No DB session available — check POSTGRES_* env vars.")
        sys.exit(1)

    db = SessionLocal()
    try:
        seed_platform_roles(db)
        names = ", ".join(spec["name"] for spec in SYSTEM_ROLE_DEFAULTS)
        print(f"✅ Platform roles seeded / refreshed: {names}")
    except Exception as e:
        db.rollback()
        print(f"ERROR seeding platform roles: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
