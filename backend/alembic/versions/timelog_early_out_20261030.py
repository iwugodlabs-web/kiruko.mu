"""Add early clock-out signal to time_logs.

Adds time_logs.left_early (bool, default false — the mirror of is_late) and
early_out_reason (nullable text), captured via a mobile prompt when an employee
clocks out before their scheduled end. Surfaced to the employer in the
review-by-exception queue (classifier key "left_early").

Revision ID: timelog_early_out_20261030
Revises: field_sales_mkck_20261019
"""
from alembic import op
import sqlalchemy as sa


revision = "timelog_early_out_20261030"
down_revision = "field_sales_mkck_20261019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "time_logs",
        sa.Column("left_early", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "time_logs",
        sa.Column("early_out_reason", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("time_logs", "early_out_reason")
    op.drop_column("time_logs", "left_early")
