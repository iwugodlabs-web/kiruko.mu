"""jobs.is_onboarding_draft — placeholder job flag

Revision ID: job_onboarding_draft_20260906
Revises: geofence_soft_delete_20260818
Create Date: 2026-09-06

Self-signup private users type their employer name/BRN. We now persist that
as a placeholder Job (so onboarding can PRE-FILL it and the employer's verify
list sees the claim) instead of discarding it. `is_onboarding_draft=true`
marks such a placeholder so the onboarding gate (`_evaluate_private`) does not
count it as the employee's completed setup. Cleared on onboarding completion.

Additive, server_default 'false' → every existing job counts exactly as
before. No backfill needed.
"""
from alembic import op
import sqlalchemy as sa


revision = "job_onboarding_draft_20260906"
down_revision = "geofence_soft_delete_20260818"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "jobs",
        sa.Column(
            "is_onboarding_draft",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("jobs", "is_onboarding_draft")
