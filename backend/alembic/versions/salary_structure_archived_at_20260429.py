"""Soft-delete column on salary_structures

Revision ID: salary_archived_20260429
Revises: identity_verified_20260429
Create Date: 2026-04-29

Adds ``archived_at`` to ``salary_structures`` so admins can retire a
structure without breaking historical assignments. Soft-delete semantics:

  * Existing ``EmployeeSalaryAssignment`` rows continue to resolve via
    their frozen ``structure_snapshot`` (M3) — no change to past payslips.
  * New assignments cannot reference an archived structure (enforced at
    the API layer; this migration only adds the column).
  * Auto-suggest (services/salary_resolver.suggest_structure_for) and
    the default list view filter out ``archived_at IS NOT NULL``.
"""

from alembic import op


revision = 'salary_archived_20260429'
down_revision = 'identity_verified_20260429'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE salary_structures
            ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE salary_structures
            DROP COLUMN IF EXISTS archived_at
    """)
