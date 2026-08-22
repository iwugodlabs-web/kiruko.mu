"""Task completion proof: add proof_image_url to schedule_assignee_statuses

Revision ID: task_proof_image_20260611
Revises: payrun_partial_uniq_20260609
Create Date: 2026-06-11

#4 — lets an employee attach a photo as proof when completing/updating an
assigned task. Stored per-assignee (on schedule_assignee_statuses) so each
assignee's proof is independent.
"""
from alembic import op


revision = 'task_proof_image_20260611'
down_revision = 'payrun_partial_uniq_20260609'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: the column may already have been added out-of-band to unblock a
    # model/DB mismatch, so guard with IF NOT EXISTS.
    op.execute("ALTER TABLE schedule_assignee_statuses ADD COLUMN IF NOT EXISTS proof_image_url VARCHAR")


def downgrade() -> None:
    op.execute("ALTER TABLE schedule_assignee_statuses DROP COLUMN IF EXISTS proof_image_url")
