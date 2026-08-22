"""StatutoryDeduction.reduces_base_code — cross-deduction base dependency

Revision ID: statutory_reduces_base_20260716
Revises: tax_computation_mode_20260716
Create Date: 2026-07-16

Tanzania's NSSF employee contribution reduces the PAYE taxable base — a
deduction's own computed amount affecting another deduction's base, which
no existing mechanism supports (bases_by_code is built once, from earnings
only, before any deduction is computed). NULL for every existing (MU) row;
the base-reduction pass in payroll_engine.compute_for_resolved() is an
unconditional no-op unless a row opts in.
"""

from alembic import op
import sqlalchemy as sa


revision = 'statutory_reduces_base_20260716'
down_revision = 'tax_computation_mode_20260716'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE statutory_deductions
        ADD COLUMN IF NOT EXISTS reduces_base_code VARCHAR(40)
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE statutory_deductions DROP COLUMN IF EXISTS reduces_base_code")
