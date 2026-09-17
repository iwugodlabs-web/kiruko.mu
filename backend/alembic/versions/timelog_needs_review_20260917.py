"""add needs_review + exception_reasons to time_logs (review-by-exception)

Revision ID: timelog_needs_review_20260917
Revises: vault_shared_visibility_20260907
Create Date: 2026-09-17

Nullable by design: existing rows are NULL ("not yet classified") until the
backfill script (scripts/backfill_needs_review.py) runs the classifier over
them. New writes recompute the columns via services.time_log_classifier.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY


revision = "timelog_needs_review_20260917"
down_revision = "vault_shared_visibility_20260907"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "time_logs",
        sa.Column("needs_review", sa.Boolean(), nullable=True),
    )
    op.add_column(
        "time_logs",
        sa.Column("exception_reasons", ARRAY(sa.String()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("time_logs", "exception_reasons")
    op.drop_column("time_logs", "needs_review")
