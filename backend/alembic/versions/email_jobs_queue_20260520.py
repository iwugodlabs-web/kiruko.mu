"""email_jobs durable outbound-email queue

Adds `email_jobs` — a DB-backed queue so every outbound email is enqueued
(status='pending') and delivered by a background worker with retry/backoff and
a dead-letter terminal state, instead of being sent synchronously inline.

Revision ID: email_jobs_queue_20260520
Revises: overtime_engine_schema_20260520
Create Date: 2026-05-20
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = 'email_jobs_queue_20260520'
down_revision = 'overtime_engine_schema_20260520'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'email_jobs',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('to_email', sa.String(320), nullable=False),
        sa.Column('subject', sa.String(998), nullable=False),
        sa.Column('html', sa.Text, nullable=False),
        sa.Column('kind', sa.String(50), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('attempts', sa.Integer, nullable=False, server_default='0'),
        sa.Column('max_attempts', sa.Integer, nullable=False, server_default='5'),
        sa.Column('last_error', sa.Text, nullable=True),
        sa.Column('next_attempt_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('meta', JSONB, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "status IN ('pending','sent','dead')", name='email_jobs_status_chk',
        ),
    )
    # Worker hot path: pull due pending jobs oldest-first.
    op.create_index(
        'ix_email_jobs_pending_due', 'email_jobs', ['next_attempt_at'],
        postgresql_where=sa.text("status = 'pending'"),
    )


def downgrade() -> None:
    op.drop_index('ix_email_jobs_pending_due', table_name='email_jobs')
    op.drop_table('email_jobs')
