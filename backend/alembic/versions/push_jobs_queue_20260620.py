"""Durable outbound push-notification queue (push_jobs).

Phase 1b: move Expo push delivery off the request thread. Mirrors email_jobs —
a background worker drains pending rows with retry/backoff. Notification
fan-out enqueues here instead of calling Expo inline.

Revision ID: push_jobs_queue_20260620
Revises: notification_recipients_20260620
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "push_jobs_queue_20260620"
down_revision = "notification_recipients_20260620"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "push_jobs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("to_token", sa.String(length=255), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("data", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("kind", sa.String(length=50), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("status IN ('pending','sent','dead')", name="push_jobs_status_chk"),
    )
    op.create_index(
        "ix_push_jobs_due", "push_jobs", ["status", "next_attempt_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_push_jobs_due", table_name="push_jobs")
    op.drop_table("push_jobs")
