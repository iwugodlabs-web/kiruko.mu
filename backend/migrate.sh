#!/bin/bash
#
# Migrate + seed. Invoked by startup.sh on every deploy (and runnable on its
# own via `bash manage.sh migrate`-style use). Brings the schema to head and
# seeds the reference data so a fresh/wiped DB is a functional instance.
#
# Fail-loud: `set -e` means any failure exits non-zero, so startup.sh aborts
# and DO keeps the previous working deployment serving. We never fall back to
# create_all + stamp (that silently leaves the schema incomplete).
set -euo pipefail

export PYTHONPATH=/app:${PYTHONPATH:-}
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "--- DB ENV CHECK ---"
echo "POSTGRES_SERVER=${POSTGRES_SERVER:-<NOT SET>}"
echo "POSTGRES_DB=${POSTGRES_DB:-<NOT SET>}"
echo "POSTGRES_USER=${POSTGRES_USER:-<NOT SET>}"
echo "POSTGRES_PASSWORD=$([ -n "${POSTGRES_PASSWORD:-}" ] && echo '***SET***' || echo '<NOT SET>')"
echo "--------------------"

echo "Applying critical schema columns (pre-migration safety net)..."
python3 "${APP_DIR}/scripts/pre_migrate.py"

echo "Correcting alembic stamp if schema is out of sync..."
python3 "${APP_DIR}/scripts/fix_alembic_stamp.py"

echo "Running alembic upgrade head..."
alembic upgrade head
echo "✅ Database schema is up to date."

# Reconcile any residual schema drift AFTER alembic. Prod is stamped at head
# while parts of the schema were never migration-built (create_all + stamp), so
# `alembic upgrade head` no-ops and leaves tables/columns missing. This backfills
# them from the ORM models. It runs AFTER alembic on purpose — running before
# would pre-create objects a new forward migration then re-creates, failing it.
# Non-fatal (post_migrate exits 0) so it can't turn a schema gap into a failed deploy.
echo "Reconciling residual schema drift against the models (post-alembic backstop)..."
python3 "${APP_DIR}/scripts/post_migrate.py" || echo "[migrate] post_migrate reported an issue (non-fatal); continuing."

# Seed the reference data on every deploy. seed_all.py is idempotent and
# non-clobbering: roles refresh in place, sectors/payroll/overtime skip when
# present, and the super admin is created-if-missing (its password is only
# reset when RESET_SUPER_USER_PASSWORD=true), so this is safe to always run.
echo "🌱 Seeding (platform roles, super admin, sectors, MU payroll + overtime rules)..."
python3 "${APP_DIR}/scripts/seed_all.py"

echo "Migration step complete."
