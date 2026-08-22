#!/bin/bash
#
# DB management dispatcher for the running container (e.g. the DO console).
# Short, memorable wrappers around the scripts you'd otherwise type out:
#
#   bash manage.sh migrate            # alembic upgrade head
#   bash manage.sh repair             # add missing columns (non-destructive)
#   bash manage.sh seed               # create/reset the super admin only
#   bash manage.sh seed-all           # full set: roles, admin, sectors, payroll+OT
#   bash manage.sh reset              # DROP schema + migrate + seed (destructive)
#   bash manage.sh psql [args...]     # psql connected to the app's DB
#   bash manage.sh check              # print DB + whether key columns exist
#
# `reset` is guarded — it refuses unless you pass CONFIRM_WIPE=yes:
#   CONFIRM_WIPE=yes bash manage.sh reset
#
# `seed`/`reset` read SUPER_USER_EMAIL + SUPER_USER_PASSWORD from the env.
set -e
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

cmd="${1:-help}"
shift || true

# psql against the app's database, using the same POSTGRES_* the app uses.
run_psql() {
  PGHOST="$POSTGRES_SERVER" PGPORT="$POSTGRES_PORT" PGUSER="$POSTGRES_USER" \
  PGPASSWORD="$POSTGRES_PASSWORD" PGDATABASE="$POSTGRES_DB" \
  PGSSLMODE="${POSTGRES_SSLMODE:-require}" psql "$@"
}

case "$cmd" in
  migrate)  alembic upgrade head ;;
  repair)   python3 scripts/repair_missing_columns.py ;;
  seed)     python3 scripts/super_admin_seeder.py ;;
  seed-all) python3 scripts/seed_all.py ;;
  reset)   python3 scripts/reset_and_migrate.py ;;
  psql)    run_psql "$@" ;;
  check)
    run_psql -c "SELECT current_database();"
    echo -n "users.preferred_locale present: "
    run_psql -tc "\d users" | grep -qc preferred_locale && echo yes || echo NO
    run_psql -c "SELECT version_num FROM alembic_version;"
    ;;
  *)
    echo "usage: bash manage.sh {migrate|repair|seed|seed-all|reset|psql|check}"
    echo "  reset is destructive — needs CONFIRM_WIPE=yes"
    ;;
esac
