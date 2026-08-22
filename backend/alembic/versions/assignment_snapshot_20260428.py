"""Snapshot structure on assignment (M3)

Revision ID: assignment_snapshot_20260428
Revises: salary_scoping_20260428
Create Date: 2026-04-28

Adds employee_salary_assignments.structure_snapshot JSONB. The snapshot
freezes the structure's lines + component metadata at assignment-creation
time. The resolver reads from the snapshot, so editing the live structure
later doesn't retroactively change existing employees' salaries — only
new assignments pick up the change.

Existing assignments will have NULL until backfilled by
scripts/backfill_assignment_snapshots.py. The resolver falls back to the
live structure for snapshot-less rows during transition.
"""

from alembic import op


revision = 'assignment_snapshot_20260428'
down_revision = 'salary_scoping_20260428'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE employee_salary_assignments
            ADD COLUMN IF NOT EXISTS structure_snapshot JSONB
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE employee_salary_assignments
            DROP COLUMN IF EXISTS structure_snapshot
    """)
