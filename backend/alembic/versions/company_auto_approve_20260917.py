"""add companies.auto_approve_clean_clockins (review-by-exception P2)

Revision ID: company_auto_approve_20260917
Revises: company_review_sample_20260917
Create Date: 2026-09-17
"""
from alembic import op
import sqlalchemy as sa


revision = "company_auto_approve_20260917"
down_revision = "company_review_sample_20260917"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "companies",
        sa.Column(
            "auto_approve_clean_clockins",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("companies", "auto_approve_clean_clockins")
