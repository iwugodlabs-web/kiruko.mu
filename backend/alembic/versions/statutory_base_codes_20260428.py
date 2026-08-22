"""Statutory base mapping per component (M4)

Revision ID: statutory_bases_20260428
Revises: assignment_snapshot_20260428
Create Date: 2026-04-28

Adds salary_components.statutory_base_codes JSONB. Each component now
declares which statutory deduction codes (PAYE, CSG_EE, CSG_ER, NSF_EE,
NSF_ER, etc.) it contributes to. The payroll engine builds per-deduction
bases instead of using a single global "gross" for all of them — fixing
a current compliance bug where every taxable allowance was included in
CSG/NSF bases regardless of whether it should have been.

Default '[]' (empty). Empty is interpreted by the engine via legacy
inference: is_basic → all bases; non-basic taxable → PAYE+CSG; non-taxable
or deduction → none. Existing components keep working without manual
migration; new components and bonus components are created with explicit
lists.
"""

from alembic import op


revision = 'statutory_bases_20260428'
down_revision = 'assignment_snapshot_20260428'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE salary_components
            ADD COLUMN IF NOT EXISTS statutory_base_codes JSONB
                NOT NULL DEFAULT '[]'::jsonb
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE salary_components
            DROP COLUMN IF EXISTS statutory_base_codes
    """)
