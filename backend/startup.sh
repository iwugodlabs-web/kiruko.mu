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

echo "Starting FastAPI on port ${PORT:-8080}..."
exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}
