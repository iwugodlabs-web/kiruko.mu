"""Add profile-lock columns to private_users

Revision ID: profile_lock_20260427
Revises: salary_numeric_20260427
Create Date: 2026-04-27

When `is_locked = true`, employees cannot self-edit fields listed in
core.profile_lock.LOCKABLE_FIELDS. Employers can still update via the
admin path. Lock and unlock actions are audited via audit_logs.
"""

from alembic import op


revision = 'profile_lock_20260427'
down_revision = 'salary_numeric_20260427'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE private_users
            ADD COLUMN IF NOT EXISTS is_locked          BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS locked_at          TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS locked_by_user_id  INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS lock_reason        VARCHAR
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE private_users
            DROP COLUMN IF EXISTS lock_reason,
            DROP COLUMN IF EXISTS locked_by_user_id,
            DROP COLUMN IF EXISTS locked_at,
            DROP COLUMN IF EXISTS is_locked
    """)
