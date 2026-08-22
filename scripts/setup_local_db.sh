#!/usr/bin/env bash
set -euo pipefail

# Setup local ivor_db script
# - Creates the DB if it does not exist
# - Optionally resets (truncates) the DB
# - Runs Alembic migrations
# - Optionally seeds the DB
#
# Usage examples:
#  ./scripts/setup_local_db.sh --create-db --migrate --seed       # create DB, migrate and seed
#  ./scripts/setup_local_db.sh --format                            # drop existing DB, create, migrate and seed (fresh start)
#  ./scripts/setup_local_db.sh --reset --no-backup                 # truncate local DB (no backup)
#  ./scripts/setup_local_db.sh --migrate                           # run migrations only
#
# Flags:
#  --create-db     : create the database if it doesn't exist
#  --format        : drop database if exists, create new, migrate and seed
#  --reset         : truncate all public tables and restart identities (destructive)
#  --migrate       : run alembic upgrade head (apply migrations)
#  --seed          : run seeds (sector seeder with --apply)
#  --no-backup     : skip backup when doing a reset
#  --dry-run       : print planned actions and exit (no changes)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/backend/.env"

# All subsequent commands expect the repo root as CWD (backend/, alembic, etc.)
cd "$REPO_ROOT"

# Load .env if present
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "POSTGRES_USER=${POSTGRES_USER:-postgres}"
: "POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-}"
: "POSTGRES_PORT=${POSTGRES_PORT:-5432}"
: "POSTGRES_DB=${POSTGRES_DB:-ivor_db}"
: "POSTGRES_SERVER=${POSTGRES_SERVER:-}"

# Safety guard — refuse to run any destructive action (drop / reset / format)
# against a database whose host isn't on this allowlist. POSTGRES_SERVER may
# be unset (psql defaults to local socket); that's still treated as local.
LOCAL_HOSTS=("" "localhost" "127.0.0.1" "::1" "host.docker.internal" "db")
function _is_local_host() {
  local h="${1:-}"
  for ok in "${LOCAL_HOSTS[@]}"; do
    if [[ "$h" == "$ok" ]]; then return 0; fi
  done
  return 1
}

function require_local_db() {
  if [[ "${ENVIRONMENT:-dev}" =~ ^(prod|production|staging)$ ]]; then
    echo >&2 "❌ Refusing destructive action: ENVIRONMENT=${ENVIRONMENT}. This script is dev-only."
    exit 2
  fi
  if ! _is_local_host "$POSTGRES_SERVER"; then
    echo >&2 "❌ Refusing destructive action: POSTGRES_SERVER='${POSTGRES_SERVER}' is not in the local allowlist."
    echo >&2 "   Allowlist: ${LOCAL_HOSTS[*]}"
    echo >&2 "   If you really meant to wipe this DB, edit LOCAL_HOSTS in this script."
    exit 2
  fi
}

CREATE_DB=false
DO_RESET=false
DO_MIGRATE=false
DO_SEED=false
DO_DROP=false
NO_BACKUP=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --create-db) CREATE_DB=true; shift ;;
    --format) DO_DROP=true; CREATE_DB=true; DO_MIGRATE=true; DO_SEED=true; shift ;;
    --reset) DO_RESET=true; shift ;;
    --migrate) DO_MIGRATE=true; shift ;;
    --seed) DO_SEED=true; shift ;;
    --no-backup) NO_BACKUP=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown argument: $1"; echo "Usage: $0 [--create-db] [--format] [--reset] [--migrate] [--seed] [--no-backup] [--dry-run]"; exit 1 ;;
  esac
done

# Helpers
PSQL=(psql -p "$POSTGRES_PORT" -U "$POSTGRES_USER")
CREATEDB=(createdb -p "$POSTGRES_PORT" -U "$POSTGRES_USER")
DROPDB=(dropdb -p "$POSTGRES_PORT" -U "$POSTGRES_USER")

function db_exists() {
  if [[ -n "${POSTGRES_PASSWORD}" ]]; then export PGPASSWORD="$POSTGRES_PASSWORD"; fi
  if "${PSQL[@]}" -d "$POSTGRES_DB" -c '\q' 2>/dev/null; then
    unset PGPASSWORD || true
    return 0
  else
    unset PGPASSWORD || true
    return 1
  fi
}

function create_db() {
  echo "Creating database '$POSTGRES_DB' (local)..."
  if [[ -n "${POSTGRES_PASSWORD}" ]]; then export PGPASSWORD="$POSTGRES_PASSWORD"; fi
  "${CREATEDB[@]}" "$POSTGRES_DB"
  unset PGPASSWORD || true
}

function drop_db() {
  echo "Dropping database '$POSTGRES_DB' (if exists)..."
  if [[ -n "${POSTGRES_PASSWORD}" ]]; then export PGPASSWORD="$POSTGRES_PASSWORD"; fi
  "${DROPDB[@]}" --if-exists --force "$POSTGRES_DB"
  unset PGPASSWORD || true
}

function run_migrations() {
  echo "Running alembic migrations..."
  if ! (cd backend && python3 manage_migrations.py upgrade); then
    echo >&2 "ERROR: Alembic migrations failed. Tips:"
    echo >&2 "  - Ensure you're running this from the repository root: '(cd backend && python3 manage_migrations.py upgrade)'"
    echo >&2 "  - Inspect 'backend/alembic/versions' for multiple heads and consult the team if needed"
    echo >&2 "  - For more details, re-run the script to see the full traceback"
    exit 1
  fi
} 

function run_seed() {
  echo "Running seeders: sectors..."
  if ! PYTHONPATH=backend python3 backend/scripts/seed_sectors_run.py \
        --file backend/mauritius_sector_rates.csv --apply; then
    echo >&2 "ERROR: Sector seeder failed."
    exit 1
  fi

  echo "Seeding Mauritius payroll rules (tax / statutory / leave / bonus)..."
  if ! (cd backend && python3 -m scripts.seed_mu_payroll_rules); then
    echo >&2 "ERROR: MU payroll rules seeder failed."
    exit 1
  fi

  # Platform roles (platform_admin, engineer, compliance_officer, …) must be
  # seeded BEFORE the super admin user — otherwise super_admin_seeder falls
  # back to get_or_create_role and creates platform_admin with EMPTY
  # permissions, leaving the super-admin powerless.
  echo "Seeding platform roles (platform_admin, engineer, ...)..."
  if ! (cd backend && python3 -m scripts.seed_platform_roles); then
    echo >&2 "ERROR: Platform role seeder failed."
    exit 1
  fi

  # Resolve the super-admin email: explicit SUPER_USER_EMAIL wins, else first
  # entry in SUPER_ADMIN_EMAILS (matches super_admin_seeder._resolve_email).
  ADMIN_EMAIL="${SUPER_USER_EMAIL:-}"
  if [[ -z "$ADMIN_EMAIL" && -n "${SUPER_ADMIN_EMAILS:-}" ]]; then
    ADMIN_EMAIL="$(printf '%s' "${SUPER_ADMIN_EMAILS}" | tr -d '"' | tr -d "'" | awk -F',' '{print $1}' | xargs)"
  fi

  if [[ -z "$ADMIN_EMAIL" || -z "${SUPER_USER_PASSWORD:-}" ]]; then
    echo "⚠️  Super admin email / password not set — skipping super admin seed."
    echo "   Set either SUPER_USER_EMAIL or SUPER_ADMIN_EMAILS (+ SUPER_USER_PASSWORD)."
  else
    # super_admin_seeder assigns the freshly-seeded platform_admin role to
    # the super-admin user.
    echo "Seeding super admin (${ADMIN_EMAIL})..."
    PYTHONPATH=backend python3 backend/scripts/super_admin_seeder.py
  fi

  echo "Seeding default departments..."
  PYTHONPATH=backend python3 backend/scripts/seed_default_departments.py
}

function run_reset() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "DRY RUN: would truncate all tables in $POSTGRES_DB"
    if [[ -n "${POSTGRES_PASSWORD}" ]]; then export PGPASSWORD="$POSTGRES_PASSWORD"; fi
    psql -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -At -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public';"
    unset PGPASSWORD || true
    return
  fi

  if [[ "$NO_BACKUP" == "false" ]]; then
    echo "Creating backup before reset..."
    if [[ -n "${POSTGRES_PASSWORD}" ]]; then export PGPASSWORD="$POSTGRES_PASSWORD"; fi
    pg_dump -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -F p | gzip > "${POSTGRES_DB}_backup_$(date +%Y%m%d_%H%M%S).sql.gz"
    unset PGPASSWORD || true
  else
    echo "Skipping backup (as requested)"
  fi

  echo "Truncating all tables in 'public' schema and restarting identities..."
  # Use a non-expanding here-doc to preserve the $$ quoting for the DO block
  read -r -d '' TRUNCATE_SQL <<'SQL'
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
  END LOOP;
END $$;
SQL
  if [[ -n "${POSTGRES_PASSWORD}" ]]; then export PGPASSWORD="$POSTGRES_PASSWORD"; fi
  if ! psql -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$TRUNCATE_SQL"; then
    echo >&2 "ERROR: Failed to truncate tables. Troubleshooting tips:"
    echo >&2 "  - Confirm Postgres is running and reachable on port $POSTGRES_PORT"
    echo >&2 "  - Verify credentials in the environment (.env) or your shell variables"
    echo >&2 "  - Try running the DO block manually to inspect errors:"
    echo >&2 "      psql -p $POSTGRES_PORT -U $POSTGRES_USER -d $POSTGRES_DB -c \"DO $$ ... $$;\""
    unset PGPASSWORD || true
    exit 1
  fi
  unset PGPASSWORD || true
}

# Dry-run summary
if [[ "$DRY_RUN" == "true" ]]; then
  echo "DRY RUN: actions planned for database '$POSTGRES_DB':"
  $DO_DROP && echo "  - drop database (if exists)"
  $CREATE_DB && echo "  - create database if missing"
  $DO_RESET && echo "  - reset (truncate) all tables"
  $DO_MIGRATE && echo "  - run alembic migrations"
  $DO_SEED && echo "  - run seeders (sectors, MU payroll rules, platform roles, super admin, default departments)"
  echo "Run this script without --dry-run to execute the above actions."
  exit 0
fi

# Execute actions. Destructive ops (drop / reset) require a local-host DB.
if $DO_DROP || $DO_RESET; then
  require_local_db
fi

if $DO_DROP; then
  drop_db
fi

if $CREATE_DB; then
  if db_exists; then
    echo "Database '$POSTGRES_DB' already exists."
  else
    create_db
  fi

  # Build the schema in one shot via ORM (the historical migration chain was
  # never designed to run from scratch on an empty DB).  Then stamp Alembic
  # so subsequent 'alembic upgrade head' calls only apply new migrations.
  echo "Initializing schema via ORM (create_all)..."
  PYTHONPATH=backend python3 backend/scripts/create_tables.py
  echo "Stamping Alembic at head..."
  (cd backend && alembic stamp head)
fi

if $DO_RESET; then
  run_reset
fi

if $DO_MIGRATE; then
  # Incremental upgrade on an already-stamped DB.
  run_migrations
fi

if $DO_SEED; then
  run_seed
fi

echo "Setup actions completed."

# If we dropped and recreated the DB, remind the user to restart uvicorn.
# SQLAlchemy's connection pool holds connections to the old (now dropped) DB
# and will return 500 errors until the server is restarted.
if $DO_DROP; then
  echo ""
  echo "⚠️  DB was dropped and recreated — restart the backend server to flush"
  echo "   the SQLAlchemy connection pool:"
  echo "   cd backend && uvicorn main:app --host 0.0.0.0 --port 8000 --reload"
fi
