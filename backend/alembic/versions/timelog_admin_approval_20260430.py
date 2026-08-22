"""TimeLog admin-approval columns + Company opt-in flag + dispute table

Revision ID: timelog_approval_20260430
Revises: salary_archived_20260429
Create Date: 2026-04-30

Adds the admin-review surface for clock-ins (M3):

  * time_logs.admin_approved + provenance + rejection mirror
  * companies.require_approved_clockins_for_payroll (per-company opt-in,
    default false so existing payroll flows aren't disrupted)
  * time_log_disputes table (one open dispute per log; resolved disputes
    stay for audit)

**Backfill**: existing time_logs rows are marked admin_approved=true on
upgrade. This is intentional — without it, flipping the per-company flag
would silently exclude every historical clock-in from proration sums
and zero out the next payroll run. New clock-ins created after the
migration default to admin_approved=false (server_default in the model).
"""

from alembic import op


revision = 'timelog_approval_20260430'
down_revision = 'salary_archived_20260429'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. time_logs columns + backfill
    op.execute("""
        ALTER TABLE time_logs
            ADD COLUMN IF NOT EXISTS admin_approved              BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS admin_approved_at           TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS admin_approved_by_user_id   INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS admin_rejected              BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS admin_rejected_at           TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS admin_rejected_by_user_id   INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS admin_rejected_reason       VARCHAR
    """)
    # Backfill existing rows so the require_approved gate doesn't zero them.
    op.execute("""
        UPDATE time_logs
           SET admin_approved = true,
               admin_approved_at = COALESCE(updated_at, created_at, NOW())
         WHERE admin_approved IS DISTINCT FROM true
    """)

    # 2. companies opt-in flag
    op.execute("""
        ALTER TABLE companies
            ADD COLUMN IF NOT EXISTS require_approved_clockins_for_payroll
                BOOLEAN NOT NULL DEFAULT false
    """)

    # 3. time_log_disputes table
    op.execute("""
        CREATE TABLE IF NOT EXISTS time_log_disputes (
            id                   SERIAL PRIMARY KEY,
            time_log_id          INTEGER NOT NULL UNIQUE
                                    REFERENCES time_logs(timelog_id) ON DELETE CASCADE,
            employee_user_id     INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
            employee_comment     VARCHAR NOT NULL,
            created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            resolution           VARCHAR(32) NOT NULL DEFAULT 'pending',
            admin_response       VARCHAR,
            resolved_at          TIMESTAMPTZ,
            resolved_by_user_id  INTEGER REFERENCES users(user_id) ON DELETE SET NULL
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_time_log_disputes_time_log_id
            ON time_log_disputes(time_log_id)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_time_log_disputes_resolution
            ON time_log_disputes(resolution)
            WHERE resolution = 'pending'
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS time_log_disputes")
    op.execute("""
        ALTER TABLE companies
            DROP COLUMN IF EXISTS require_approved_clockins_for_payroll
    """)
    op.execute("""
        ALTER TABLE time_logs
            DROP COLUMN IF EXISTS admin_rejected_reason,
            DROP COLUMN IF EXISTS admin_rejected_by_user_id,
            DROP COLUMN IF EXISTS admin_rejected_at,
            DROP COLUMN IF EXISTS admin_rejected,
            DROP COLUMN IF EXISTS admin_approved_by_user_id,
            DROP COLUMN IF EXISTS admin_approved_at,
            DROP COLUMN IF EXISTS admin_approved
    """)
