"""add overtime_reason to time_logs

Revision ID: timelog_overtime_reason_20260717
Revises: notional_divisor_sdl_20260716
Create Date: 2026-07-17

The employee's optional reason, captured on mobile when marking a session
as overtime (POST /job/time-log/{id}/overtime), was accepted by the API but
only ever used to build a one-time notification message — never persisted,
so it was unrecoverable and the web Overtime dashboard had nothing to show.
Mirrors the existing time_logs.late_reason column/pattern
(timelog_late_fields_20260629).
"""
from alembic import op
import sqlalchemy as sa


revision = "timelog_overtime_reason_20260717"
down_revision = "notional_divisor_sdl_20260716"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("time_logs", sa.Column("overtime_reason", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("time_logs", "overtime_reason")
