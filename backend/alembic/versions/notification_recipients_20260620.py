"""Normalize notifications: event row + notification_recipients join.

Phase 1a of the notification fan-out work. A notification becomes an EVENT row;
recipients (with per-user read state) move to `notification_recipients`. The
legacy `notifications.user_id` / `is_read` columns are relaxed to nullable
during the transition (new events leave them NULL; the join is the source of
truth) and backfilled into the new table. A follow-up migration drops them once
soaked.

Revision ID: notification_recipients_20260620
Revises: leave_perm_backfill_20260620
"""
from alembic import op
import sqlalchemy as sa


revision = "notification_recipients_20260620"
down_revision = "leave_perm_backfill_20260620"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notification_recipients",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "notification_id", sa.Integer(),
            sa.ForeignKey("notifications.notification_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id", sa.Integer(),
            sa.ForeignKey("users.user_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("notification_id", "user_id", name="uq_notification_recipient"),
    )
    op.create_index(
        "ix_notification_recipients_user_unread",
        "notification_recipients", ["user_id", "is_read"],
    )

    op.add_column(
        "notifications",
        sa.Column(
            "company_id", sa.Integer(),
            sa.ForeignKey("companies.company_id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.alter_column("notifications", "user_id", existing_type=sa.Integer(), nullable=True)
    op.alter_column("notifications", "is_read", existing_type=sa.Boolean(), nullable=True)

    # Backfill: one recipient row per existing notification.
    op.execute(
        """
        INSERT INTO notification_recipients (notification_id, user_id, is_read, created_at)
        SELECT notification_id, user_id, COALESCE(is_read, false), created_at
          FROM notifications
         WHERE user_id IS NOT NULL
        ON CONFLICT (notification_id, user_id) DO NOTHING
        """
    )


def downgrade() -> None:
    # Best-effort: collapse recipients back onto the legacy columns for events
    # that have exactly one recipient, drop event-only rows we can't represent.
    op.execute(
        """
        UPDATE notifications n
           SET user_id = r.user_id, is_read = r.is_read
          FROM notification_recipients r
         WHERE r.notification_id = n.notification_id
           AND n.user_id IS NULL
        """
    )
    op.execute("DELETE FROM notifications WHERE user_id IS NULL")
    op.drop_index("ix_notification_recipients_user_unread", table_name="notification_recipients")
    op.drop_table("notification_recipients")
    op.drop_column("notifications", "company_id")
    op.alter_column("notifications", "user_id", existing_type=sa.Integer(), nullable=False)
    op.alter_column("notifications", "is_read", existing_type=sa.Boolean(), nullable=False)
