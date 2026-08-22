"""Add KYC identity-verification flag to private_users

Revision ID: identity_verified_20260429
Revises: preferred_locale_20260429
Create Date: 2026-04-29

Splits the existing single profile-lock semantic into two purposes:

  * is_locked        — admin-controlled lock over COMPANY_FIELDS
                       (employment_type, fte, salary_assignments, jobs)
  * identity_verified — one-way KYC flag over IDENTITY_FIELDS
                       (first_name, last_name, date_of_birth,
                        pass_port_number, gender)

Once `identity_verified` is true the employee can no longer self-edit
identity fields. There is no "unverify" path by design — preventing
gaming. To accept new identity data, admin re-verifies after a fresh
check, overwriting the timestamp / by-user.
"""

from alembic import op


revision = 'identity_verified_20260429'
down_revision = 'preferred_locale_20260429'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE private_users
            ADD COLUMN IF NOT EXISTS identity_verified              BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS identity_verified_at           TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS identity_verified_by_user_id   INTEGER REFERENCES users(user_id) ON DELETE SET NULL
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE private_users
            DROP COLUMN IF EXISTS identity_verified_by_user_id,
            DROP COLUMN IF EXISTS identity_verified_at,
            DROP COLUMN IF EXISTS identity_verified
    """)
