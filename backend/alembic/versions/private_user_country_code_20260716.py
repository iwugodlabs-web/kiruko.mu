"""PrivateUser.country_code — independent/personal users' self-reported country

Revision ID: private_user_country_20260716
Revises: tanzania_scaffold_20260716
Create Date: 2026-07-16

Nullable, no backfill. Company-affiliated employees ignore this column
entirely (they inherit their employer's Company.country_code) — see
PrivateUser.effective_country_code. Only independent/personal users (no
company_id, self-reported Salary on their own profile) read it, and every
existing one keeps defaulting to 'MU' via the resolver property until they
actively set it — nothing to migrate in the data itself.
"""

from alembic import op
import sqlalchemy as sa


revision = 'private_user_country_20260716'
down_revision = 'tanzania_scaffold_20260716'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE private_users
        ADD COLUMN IF NOT EXISTS country_code VARCHAR(2)
    """)
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'fk_private_users_country_code'
            ) THEN
                ALTER TABLE private_users
                ADD CONSTRAINT fk_private_users_country_code
                FOREIGN KEY (country_code) REFERENCES countries(code);
            END IF;
        END $$
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE private_users DROP CONSTRAINT IF EXISTS fk_private_users_country_code")
    op.execute("ALTER TABLE private_users DROP COLUMN IF EXISTS country_code")
