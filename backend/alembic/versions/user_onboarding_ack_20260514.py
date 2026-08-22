"""Onboarding: private_users.onboarding_acknowledged_no_employer column

Revision ID: user_onboarding_ack_20260514
Revises: user_right_workflow_20260514
Create Date: 2026-05-14

Implements plan Phase 12.A: an escape hatch for the "I have no current
employer" case in the onboarding gate. Without this, users between jobs
were permanently stuck on the profile-completion screen because the gate
required at least one Job row. Acknowledging this checkbox satisfies the
employer-link check.

Default false; existing rows are not affected (the calculator works just
the same without it).
"""
from alembic import op
import sqlalchemy as sa


revision = 'user_onboarding_ack_20260514'
down_revision = 'user_right_workflow_20260514'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'private_users',
        sa.Column(
            'onboarding_acknowledged_no_employer',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('false'),
        ),
    )


def downgrade() -> None:
    op.drop_column('private_users', 'onboarding_acknowledged_no_employer')
