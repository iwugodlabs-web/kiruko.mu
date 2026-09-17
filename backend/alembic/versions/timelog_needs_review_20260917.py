"""add needs_review + exception_reasons to time_logs (review-by-exception)

Revision ID: timelog_needs_review_20260917
Revises: vault_shared_visibility_20260907
Create Date: 2026-09-17

The columns are added nullable, then historical rows are classified IN THIS SAME
migration (atomic, one transaction) from the existing signal columns. This is a
one-time SQL mirror of services.time_log_classifier.classify_exceptions; the
Python classifier remains the source of truth for all ongoing writes. New rows
are recomputed on every write (create/update/auto-close/dispute).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY

from services.time_log_backfill import BACKFILL_REASONS_SQL


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
    # One-time classification of historical rows — folded here so production
    # gets a fully-populated "Needs review" view with no separate script step.
    op.execute(BACKFILL_REASONS_SQL)


def downgrade() -> None:
    op.drop_column("time_logs", "exception_reasons")
    op.drop_column("time_logs", "needs_review")
