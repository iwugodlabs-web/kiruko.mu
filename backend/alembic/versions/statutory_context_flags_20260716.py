"""StatutoryDeduction.applies_to_overtime / applies_to_bonus

Revision ID: statutory_context_flags_20260716
Revises: leave_cycle_tier_20260716
Create Date: 2026-07-16

Generalizes two hardcoded MU-specific rules that were literal
statutory_base_codes lists baked into payroll_engine.py/bonus_engine.py:
overtime earnings exclude NSF-like codes from their base; bonus earnings
are PAYE-only (exclude every StatutoryDeduction code). Both NULL for every
existing row — the append-only trigger forbids backfilling existing rows
via UPDATE, so payroll_rules.default_statutory_base_codes() falls back to a
documented legacy heuristic for NULL specifically, preserving MU's exact
current output. New rows (TZ, future countries) set both explicitly.
"""

from alembic import op
import sqlalchemy as sa


revision = 'statutory_context_flags_20260716'
down_revision = 'leave_cycle_tier_20260716'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE statutory_deductions
        ADD COLUMN IF NOT EXISTS applies_to_overtime BOOLEAN
    """)
    op.execute("""
        ALTER TABLE statutory_deductions
        ADD COLUMN IF NOT EXISTS applies_to_bonus BOOLEAN
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE statutory_deductions DROP COLUMN IF EXISTS applies_to_bonus")
    op.execute("ALTER TABLE statutory_deductions DROP COLUMN IF EXISTS applies_to_overtime")
