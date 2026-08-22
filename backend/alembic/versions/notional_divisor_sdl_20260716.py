"""CountryOvertimeRule.notional_hourly_divisor + Company.sdl_applicable

Revision ID: notional_divisor_sdl_20260716
Revises: statutory_context_flags_20260716
Create Date: 2026-07-16

notional_hourly_divisor: the WRA s.25 "monthly basic / 195" formula was a
bare Python constant in payroll_engine.py. NULL falls back to 195 for every
existing row, preserving MU's exact current output.

sdl_applicable: Tanzania's SDL (Skills Development Levy) only applies to
employers with 10+ staff — a headcount condition, not the income threshold
StatutoryDeduction already models. Platform-admin-set toggle, not a live
per-run count.
"""

from alembic import op
import sqlalchemy as sa


revision = 'notional_divisor_sdl_20260716'
down_revision = 'statutory_context_flags_20260716'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE country_overtime_rules
        ADD COLUMN IF NOT EXISTS notional_hourly_divisor NUMERIC(6,2)
    """)
    op.execute("""
        ALTER TABLE companies
        ADD COLUMN IF NOT EXISTS sdl_applicable BOOLEAN
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE companies DROP COLUMN IF EXISTS sdl_applicable")
    op.execute("ALTER TABLE country_overtime_rules DROP COLUMN IF EXISTS notional_hourly_divisor")
