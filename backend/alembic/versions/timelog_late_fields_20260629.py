"""add is_late + late_reason to time_logs (schedule-aware clock-in)

Revision ID: timelog_late_fields_20260629
Revises: rls_april_tables_fix_20260624
Create Date: 2026-06-29
"""
from alembic import op
import sqlalchemy as sa


revision = "timelog_late_fields_20260629"
down_revision = "rls_april_tables_fix_20260624"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "time_logs",
        sa.Column("is_late", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("time_logs", sa.Column("late_reason", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("time_logs", "late_reason")
    op.drop_column("time_logs", "is_late")
