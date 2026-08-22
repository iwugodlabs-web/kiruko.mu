"""Task additional remuneration: amount on schedules + per-assignee one-off link.

Adds:
  * schedules.additional_remuneration_amount — optional extra pay for the task.
  * schedule_assignee_statuses.remuneration_one_off_id — the one-off allowance
    booked when the employer verified that assignee's completion (idempotency).

Revision ID: task_remuneration_20260615
Revises: kiosk_admin_pin_20260614
"""
from alembic import op
import sqlalchemy as sa


revision = "task_remuneration_20260615"
down_revision = "kiosk_admin_pin_20260614"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "schedules",
        sa.Column("additional_remuneration_amount", sa.Numeric(14, 2), nullable=True),
    )
    op.add_column(
        "schedule_assignee_statuses",
        sa.Column("remuneration_one_off_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_assignee_status_remuneration_one_off",
        "schedule_assignee_statuses",
        "employee_one_off_allowances",
        ["remuneration_one_off_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_assignee_status_remuneration_one_off",
        "schedule_assignee_statuses",
        type_="foreignkey",
    )
    op.drop_column("schedule_assignee_statuses", "remuneration_one_off_id")
    op.drop_column("schedules", "additional_remuneration_amount")
