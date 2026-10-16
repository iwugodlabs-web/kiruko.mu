#!/bin/bash
#
# Container entrypoint: migrate + seed, then serve. This is what the DO
# run_command (`bash /app/startup.sh`) invokes, so every deploy
# automatically brings the schema to head and seeds the reference data
# (platform roles, sectors, MU payroll + overtime rules) before serving —
# no manual console steps.
#
# Fail-loud: if migrate.sh exits non-zero the container exits and DO keeps
# the previous working deployment serving (no half-migrated schema).
#
# NOTE on scale: this migrates on boot, which is correct for
# instance_count: 1. If you scale past one instance, move migrate.sh to a
# DO `kind: PRE_DEPLOY` job so instances don't race to migrate the same DB,
# and revert this script to serve-only.

echo "Starting Ivor Mobile Backend..."

export PYTHONPATH=/app:$PYTHONPATH
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Testing main app import..."
python3 -c "
import sys
sys.path.insert(0, '/app')
try:
    from main import app
    print('✅ Main app imported — ', len(app.routes), 'routes')
except Exception as e:
    print('❌ Failed to import main app:', e)
    import traceback; traceback.print_exc(); exit(1)
"
if [ $? -ne 0 ]; then
    echo "Failed to import main application"
    exit 1
fi

# Migrate + seed (fail-loud: migrate.sh runs `set -e`).
bash "${APP_DIR}/migrate.sh"
if [ $? -ne 0 ]; then
    echo "❌ migrate.sh failed — refusing to serve on an unmigrated/unseeded DB."
    exit 1
fi

# Legacy salary backfill — convert pre-structured `salaries` rows into
# EmployeeSalaryAssignments so monthly staff set up the old way aren't silently
# dropped from payroll. Runs AFTER migrate.sh so the new columns/tables exist.
#
# Safe to run automatically on every deploy:
#   * ADDITIVE ONLY — creates assignment/structure rows; never updates or
#     deletes existing pay data; the legacy `salaries` table is left untouched.
#   * IDEMPOTENT — skips anyone already covered, so re-runs create 0 new rows
#     and converge; it also self-heals any future legacy rows.
#   * ISOLATED — one SAVEPOINT per employee, so a single bad record can't
#     corrupt or discard the others.
#   * FAIL-SOFT — unlike migrate.sh this must NEVER block serving: a hiccup
#     leaves existing data intact and simply retries next deploy. Every row it
#     creates is tagged notes='Backfilled from legacy salaries row', so it is
#     fully identifiable and reversible.
# Set RUN_LEGACY_BACKFILL=false to skip once the data has converged.
# NOTE: like migrate.sh above, this assumes instance_count=1 (migrate-on-boot).
# If you scale past one instance, move both to a PRE_DEPLOY job so instances
# don't race.
if [ "${RUN_LEGACY_BACKFILL:-true}" = "true" ]; then
    echo "Running legacy salary backfill (additive, idempotent)..."
    python3 -m scripts.backfill_salary_structures \
        || echo "⚠️  backfill reported errors (non-fatal) — existing data untouched; will retry next deploy."
else
    echo "Skipping legacy salary backfill (RUN_LEGACY_BACKFILL=false)."
fi

echo "Starting FastAPI on port ${PORT:-8080}..."
exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}
