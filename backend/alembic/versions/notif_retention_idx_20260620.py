"""Indexes supporting notification retention + joins.

Phase 4: add indexes the retention sweep and the recipient join rely on —
notification_recipients(notification_id) (FK / orphan check / cascade),
plus created_at on both tables for the age-based purge.

Revision ID: notif_retention_idx_20260620
Revises: notification_prefs_20260620
"""
from alembic import op


revision = "notif_retention_idx_20260620"
down_revision = "notification_prefs_20260620"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_notification_recipients_notif_id",
        "notification_recipients", ["notification_id"],
    )
    op.create_index(
        "ix_notification_recipients_created_at",
        "notification_recipients", ["created_at"],
    )
    op.create_index(
        "ix_notifications_created_at",
        "notifications", ["created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_notifications_created_at", table_name="notifications")
    op.drop_index("ix_notification_recipients_created_at", table_name="notification_recipients")
    op.drop_index("ix_notification_recipients_notif_id", table_name="notification_recipients")
