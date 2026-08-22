"""Per-assignee note on tasks.

Adds schedule_assignee_statuses.note — each employee's own private message on a
task. The employer's message stays on schedules.notes (shared); this column lets
every assignee leave an attributable note that the employer can see per-person,
without overwriting the shared field or other assignees' notes.

Revision ID: task_assignee_notes_20260807
Revises: shadow_payroll_20260730
"""
from alembic import op
import sqlalchemy as sa


revision = "task_assignee_notes_20260807"
down_revision = "shadow_payroll_20260730"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "schedule_assignee_statuses",
        sa.Column("note", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("schedule_assignee_statuses", "note")
