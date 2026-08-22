"""Add allowance field to salaries and backfill revenue as total compensation

Revision ID: add_allowance_20260416
Revises: squash_2026_04_06
Create Date: 2026-04-16
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_allowance_20260416'
down_revision = 'squash_2026_04_06'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('salaries', sa.Column('allowance', sa.String(), nullable=True))

    op.execute("""
        UPDATE salaries
        SET allowance = COALESCE(revenue, '0')
        WHERE allowance IS NULL
    """)

    op.execute("""
        UPDATE salaries
        SET revenue = (
            COALESCE(NULLIF(salary, ''), '0')::numeric
            + COALESCE(NULLIF(allowance, ''), '0')::numeric
        )::varchar
        WHERE allowance IS NOT NULL
    """)


def downgrade() -> None:
    op.drop_column('salaries', 'allowance')
