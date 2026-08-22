"""Kiosk clock-in MVP (M26) — schema for tablet-based time logging

Revision ID: kiosk_clockin_20260530
Revises: salaries_numeric_repair_20260521
Create Date: 2026-05-30

Adds the database surface for the kiosk MVP (see KIOSK_IMPLEMENTATION_PLAN.md
section "Migration"). Five concrete changes:

  1. `time_logs.created_source` — distinguishes kiosk-originated rows from
     mobile/web/admin so payroll review can filter them. Defaults to
     'mobile' so every existing row is correctly classified post-upgrade
     and existing callers don't need a code change. Partial index on
     (company_id-equivalent join, admin_approved) WHERE source='kiosk'
     makes the kiosk-pending filter cheap on the time-logs review page.

  2. `private_users.kiosk_pin_hash` — bcrypt-hashed 4-digit PIN. NULL
     means "kiosk login disabled" (employee not yet enrolled). Set by
     POST /admin/private-users/{id}/kiosk-pin in v1; self-serve reset
     deferred to v1.1 once we see pilot reset-rate data.

  3. `kiosk_devices` — one row per registered tablet. Token stored as
     bcrypt hash; the raw token returned at registration follows the
     `{device_id}.{secret}` format so validation is an O(1) PK lookup
     plus one bcrypt-compare (not O(active-devices) bcrypt-compares as
     a naive "compare to all hashes" approach would force).

  4. `kiosk_idempotency` — replay-safe `/kiosk/clock-in`. Backend already
     accepts Idempotency-Key from day one so v2 frontend offline-queue
     (M31) is purely additive — no backend rework. Cleanup via a 7-day
     TTL helper in `services/kiosk_service.py` (no pg_cron in this
     project; cleanup is invoked by whatever scheduler runs the email
     queue worker — same pattern as the deferred cleanup TODO in
     step_up_tokens_20260428.py).

  5. Configurable max-shift-hours fallback chain — drives auto-close of
     forgotten clock-outs (Risk §8 in the plan). Resolution order at
     close time: Job.max_shift_hours → PrivateUser.max_shift_hours →
     Company.default_max_shift_hours → system constant (12h). The
     existing `TimeLogService.cleanup_active_time_logs` blanket-closes
     at 24h today; M27 wires this chain into that path. `auto_closed`
     marks closures so admins (and the employee dispute flow) can tell
     a missed-clockout closure apart from a real one.

Note on AuditLog: the plan originally specified a synthetic "Kiosk System"
User row to avoid NULL `actor_user_id`. Codebase audit (see
core/permission_guards.py, tests/test_smoke.py et al.) showed
`actor_user_id=None` is already the codebase's first-class convention for
system-originated actions; the synthetic user was unnecessary and has
been dropped. Kiosk audit entries write `actor_user_id=NULL` with full
device + employee context in `meta`.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID


revision = 'kiosk_clockin_20260530'
down_revision = 'salaries_numeric_repair_20260521'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ----- 1. time_logs.created_source + auto_closed + partial index ---------
    # server_default='mobile' so every existing row backfills correctly and
    # existing callers (mobile, web, admin entry) need no code change. The
    # column is NOT NULL because every TimeLog must have a known provenance.
    op.execute("""
        ALTER TABLE time_logs
            ADD COLUMN IF NOT EXISTS created_source VARCHAR(16) NOT NULL DEFAULT 'mobile',
            ADD COLUMN IF NOT EXISTS auto_closed    BOOLEAN     NOT NULL DEFAULT false
    """)
    op.execute("""
        ALTER TABLE time_logs
            ADD CONSTRAINT time_logs_created_source_chk
                CHECK (created_source IN ('mobile', 'web', 'kiosk', 'admin'))
    """)
    # Kiosk-pending hot path: the source filter banner on /dashboard/time-logs
    # (M30) needs cheap lookups of (kiosk source, awaiting admin approval).
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_time_logs_kiosk_pending
            ON time_logs (job_id, admin_approved)
         WHERE created_source = 'kiosk'
    """)

    # ----- 2. private_users.kiosk_pin_hash -----------------------------------
    op.execute("""
        ALTER TABLE private_users
            ADD COLUMN IF NOT EXISTS kiosk_pin_hash VARCHAR(255)
    """)

    # ----- 3. kiosk_devices --------------------------------------------------
    op.create_table(
        'kiosk_devices',
        sa.Column('device_id', UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'company_id',
            sa.Integer,
            sa.ForeignKey('companies.company_id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column('device_name', sa.String(120), nullable=False),
        sa.Column('location', JSONB, nullable=True),
        sa.Column('api_token_hash', sa.String(255), nullable=False),
        sa.Column('token_expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('is_active', sa.Boolean, nullable=False, server_default='true'),
        sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=True),
        # IPv6 max length is 45 chars (incl. embedded IPv4 + zone). Stolen-
        # tablet detection monitors deviations from the registration IP.
        sa.Column('last_seen_ip', sa.String(45), nullable=True),
        sa.Column(
            'created_by_user_id',
            sa.Integer,
            sa.ForeignKey('users.user_id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column(
            'created_at', sa.DateTime(timezone=True),
            nullable=False, server_default=sa.func.now(),
        ),
        sa.Column(
            'updated_at', sa.DateTime(timezone=True),
            nullable=False, server_default=sa.func.now(),
        ),
        sa.UniqueConstraint('company_id', 'device_name', name='uq_kiosk_devices_company_name'),
    )
    # Admin device-list hot path (M28): filter by company, active-only by default.
    op.create_index(
        'ix_kiosk_devices_company_active',
        'kiosk_devices', ['company_id', 'is_active'],
    )
    # Token validation hot path is the PK lookup itself — no extra index needed.

    # ----- 4. kiosk_idempotency ----------------------------------------------
    # Replay-safe /kiosk/clock-in. Composite PK keeps the row small and the
    # lookup O(log n). 7-day TTL cleanup is invoked from
    # services/kiosk_service.purge_old_idempotency_rows() — no pg_cron in
    # this project (see step_up_tokens_20260428.py for the same deferral).
    op.create_table(
        'kiosk_idempotency',
        sa.Column(
            'device_id',
            UUID(as_uuid=True),
            sa.ForeignKey('kiosk_devices.device_id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column('idempotency_key', sa.String(64), nullable=False),
        sa.Column(
            'timelog_id',
            sa.Integer,
            sa.ForeignKey('time_logs.timelog_id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'created_at', sa.DateTime(timezone=True),
            nullable=False, server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint('device_id', 'idempotency_key', name='pk_kiosk_idempotency'),
    )
    # Cleanup helper sweeps by created_at < now() - 7d.
    op.create_index(
        'ix_kiosk_idempotency_created',
        'kiosk_idempotency', ['created_at'],
    )

    # ----- 5. max_shift_hours fallback chain ---------------------------------
    # Drives the auto-close threshold in TimeLogService.cleanup_active_time_logs
    # (today: blanket 24h; M27 will swap to this chain). All three columns
    # are nullable — a NULL means "fall through to the next level"; if all
    # four levels are NULL the service constant (12h) wins.
    op.execute("""
        ALTER TABLE companies
            ADD COLUMN IF NOT EXISTS default_max_shift_hours NUMERIC(4, 2)
    """)
    op.execute("""
        ALTER TABLE private_users
            ADD COLUMN IF NOT EXISTS max_shift_hours NUMERIC(4, 2)
    """)
    op.execute("""
        ALTER TABLE jobs
            ADD COLUMN IF NOT EXISTS max_shift_hours NUMERIC(4, 2)
    """)


def downgrade() -> None:
    # Reverse order so FK references unwind cleanly.
    op.execute("ALTER TABLE jobs DROP COLUMN IF EXISTS max_shift_hours")
    op.execute("ALTER TABLE private_users DROP COLUMN IF EXISTS max_shift_hours")
    op.execute("ALTER TABLE companies DROP COLUMN IF EXISTS default_max_shift_hours")

    op.drop_index('ix_kiosk_idempotency_created', table_name='kiosk_idempotency')
    op.drop_table('kiosk_idempotency')

    op.drop_index('ix_kiosk_devices_company_active', table_name='kiosk_devices')
    op.drop_table('kiosk_devices')

    op.execute("ALTER TABLE private_users DROP COLUMN IF EXISTS kiosk_pin_hash")

    op.execute("DROP INDEX IF EXISTS ix_time_logs_kiosk_pending")
    op.execute("ALTER TABLE time_logs DROP CONSTRAINT IF EXISTS time_logs_created_source_chk")
    op.execute("""
        ALTER TABLE time_logs
            DROP COLUMN IF EXISTS auto_closed,
            DROP COLUMN IF EXISTS created_source
    """)
