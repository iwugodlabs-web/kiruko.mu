# Backend scripts

This folder contains maintenance and seeding scripts for development and ops.

**Note (2025-12-29):** `set_user_password.py` was removed because it allowed setting arbitrary user passwords directly and is considered a security risk. Prefer the idempotent seeding scripts and password-reset flows for managing credentials:

- `seed_platform_roles.py` — seeds the system platform roles (`platform_admin`, `engineer`, etc.) with the current permission catalogue from `core.platform_permissions.SYSTEM_ROLE_DEFAULTS`. Idempotent; refreshes permissions on existing system roles. **Run before `super_admin_seeder.py`** so the assigned role actually carries permissions.
- `super_admin_seeder.py` — creates the super-admin user from `SUPER_USER_EMAIL` / `SUPER_USER_PASSWORD` env and assigns them the `platform_admin` role.
- `migrate_and_seed.py` — runs migrations and seeds sector data (use with caution in production).
- `run_seed_dry.py` — dry-run seeding for previews.
- `clean_empty_assignments.py` — deletes `EmployeeSalaryAssignment` rows that reference no structure and have no overrides (junk rows the resolver can't use). Dry-run by default; `--apply` to delete.

For a full wipe-and-reseed in dev (drop DB, re-run migrations, seed sectors + MU payroll rules + super admin + default departments), use `scripts/setup_local_db.sh --format` at the repo root instead of any Python entry point. It refuses to run unless `POSTGRES_SERVER` is on its local-host allowlist.

If you want the removed script restored in a hardened form (dev-only guard, interactive confirmation), I can implement that.
