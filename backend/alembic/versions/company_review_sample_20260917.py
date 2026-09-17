"""add companies.review_sample_pct (review-by-exception random-sample audit)

Revision ID: company_review_sample_20260917
Revises: timelog_needs_review_20260917
Create Date: 2026-09-17
"""
from alembic import op
import sqlalchemy as sa


revision = "company_review_sample_20260917"
down_revision = "timelog_needs_review_20260917"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "companies",
        sa.Column(
            "review_sample_pct",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )


def downgrade() -> None:
    op.drop_column("companies", "review_sample_pct")
