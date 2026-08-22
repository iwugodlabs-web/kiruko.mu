#!/usr/bin/env python3
"""Seed a Super Admin user with the platform_admin role.

Reads credentials from env vars (set in .env or Docker):
  SUPER_USER_EMAIL     - email address for the super admin
  SUPER_USER_PASSWORD  - password for the super admin

Usage:
  python3 backend/scripts/super_admin_seeder.py

Idempotent: safe to re-run. If the user is missing it's created; if it
already exists its password is left as-is UNLESS RESET_SUPER_USER_PASSWORD=true
(the recovery path for a locked-out admin). The platform_admin role is
ensured either way.
"""
import os
import sys

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_dir)

# Load backend/.env so SUPER_USER_* / SUPER_ADMIN_EMAILS are available when the
# script is run directly (main.py loads dotenv for the FastAPI app, but
# standalone scripts don't go through that entry point).
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(backend_dir, ".env"), override=False)
except Exception:
    pass

from core.config import get_session_local
from core.security import generate_passwd_hash
from db_models.crud.user import get_user_by_email
from db_models.crud.role import assign_role_to_user
from core.model import User, PrivateUser

def _resolve_email() -> str | None:
    """Email to seed. Prefer the dedicated SUPER_USER_EMAIL var, but fall back
    to the first address in SUPER_ADMIN_EMAILS so projects with the older
    single-var setup keep working without dual config."""
    explicit = os.getenv("SUPER_USER_EMAIL")
    if explicit:
        return explicit.strip()
    admins = os.getenv("SUPER_ADMIN_EMAILS", "")
    for raw in admins.split(","):
        addr = raw.strip().strip('"').strip("'")
        if addr:
            return addr
    return None


EMAIL = _resolve_email()
PASSWORD = os.getenv("SUPER_USER_PASSWORD")


def run():
    if not EMAIL or not PASSWORD:
        print(
            "ERROR: super-admin email and password must be set. Either set "
            "SUPER_USER_EMAIL + SUPER_USER_PASSWORD, or set SUPER_ADMIN_EMAILS "
            "(first entry is used) + SUPER_USER_PASSWORD."
        )
        sys.exit(1)

    SessionLocal = get_session_local()
    if not SessionLocal:
        print("ERROR: No DB session available — check DATABASE_URL / POSTGRES_* env vars.")
        sys.exit(1)

    db = SessionLocal()
    try:
        user = get_user_by_email(EMAIL, db)

        if not user:
            print(f"Creating super admin user: {EMAIL} ...")
            user = User(
                user_type="private",
                email=EMAIL,
                user_name=EMAIL,
                password_hash=generate_passwd_hash(PASSWORD),
                onboard_complete=True,
                user_verified=True,
                user_enabled=True,
            )
            db.add(user)
            db.flush()
            private_user = PrivateUser(
                user_id=user.user_id,
                first_name="Super",
                last_name="Admin",
                phone=None,
                role="owner",
            )
            db.add(private_user)
            db.commit()
            db.refresh(user)
            print(f"Created user {EMAIL} (user_id={user.user_id})")
        elif os.getenv("RESET_SUPER_USER_PASSWORD", "").lower() == "true":
            # Explicit recovery path: reset the password (and re-enable/verify)
            # to SUPER_USER_PASSWORD. Gated so the normal every-deploy seed does
            # NOT clobber a password the admin may have changed in-app.
            print(f"User {EMAIL} exists (user_id={user.user_id}) — RESET_SUPER_USER_PASSWORD=true, resetting password ...")
            user.password_hash = generate_passwd_hash(PASSWORD)
            user.user_enabled = True
            user.user_verified = True
            db.commit()
            db.refresh(user)
        else:
            print(f"User {EMAIL} already exists (user_id={user.user_id}) — leaving password as-is (set RESET_SUPER_USER_PASSWORD=true to reset).")

        # Always ensure platform_admin role is assigned (idempotent)
        print("Assigning platform_admin role ...")
        assign_role_to_user(user.user_id, "platform_admin", user.user_id, db)
        print("platform_admin role assigned.")

    except Exception as e:
        print(f"Error seeding super admin: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    run()
