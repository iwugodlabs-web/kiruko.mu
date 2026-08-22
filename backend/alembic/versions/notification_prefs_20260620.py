"""Per-user notification delivery preferences.

Phase 3: a `notification_preferences` row toggles in-app / push delivery per
category for a user. A missing row = both channels on (opt-out model), so
existing users are unaffected until they change something.

Revision ID: notification_prefs_20260620
Revises: push_jobs_queue_20260620
"""
from alembic import op
import sqlalchemy as sa


revision = "notification_prefs_20260620"
down_revision = "push_jobs_queue_20260620"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notification_preferences",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id", sa.Integer(),
            sa.ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("category", sa.String(length=40), nullable=False),
        sa.Column("in_app", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("push", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.UniqueConstraint("user_id", "category", name="uq_notification_pref"),
    )


def downgrade() -> None:
    op.drop_table("notification_preferences")
