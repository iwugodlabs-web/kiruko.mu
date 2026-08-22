"""Company lifecycle: status / deleted_at / status_changed_at columns

Revision ID: company_lifecycle_20260521
Revises: email_jobs_queue_20260520
Create Date: 2026-05-21

Adds a soft lifecycle to companies so platform admins can enable/disable and
soft-delete an employer without destroying the row. Replaces the previous
permanent hard-delete. All existing rows are backfilled to 'active'.
"""
from alembic import op
import sqlalchemy as sa


revision = 'company_lifecycle_20260521'
down_revision = 'email_jobs_queue_20260520'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'companies',
        sa.Column('status', sa.String(length=16), nullable=False, server_default='active'),
    )
    op.add_column(
        'companies',
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        'companies',
        sa.Column('status_changed_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('companies', 'status_changed_at')
    op.drop_column('companies', 'deleted_at')
    op.drop_column('companies', 'status')
