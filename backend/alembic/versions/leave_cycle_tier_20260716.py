"""CountryLeaveDefault.cycle_months + reduced_pay_days/rate

Revision ID: leave_cycle_tier_20260716
Revises: statutory_reduces_base_20260716
Create Date: 2026-07-16

Tanzania's sick leave is 126 days over a 36-month cycle (not annual), split
63 days full pay + 63 days half pay — CountryLeaveDefault only had
days_per_year (annual) with no cycle length or pay-rate tier concept.

Schema only — no engine logic yet consumes these two new fields. Existing
rows get cycle_months=12 (preserves "days_per_year means annual") and NULL
reduced_pay_days (whole entitlement at full pay) — zero behavior change.
"""

from alembic import op
import sqlalchemy as sa


revision = 'leave_cycle_tier_20260716'
down_revision = 'statutory_reduces_base_20260716'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE country_leave_defaults
        ADD COLUMN IF NOT EXISTS cycle_months INTEGER NOT NULL DEFAULT 12
    """)
    op.execute("""
        ALTER TABLE country_leave_defaults
        ADD COLUMN IF NOT EXISTS reduced_pay_days INTEGER
    """)
    op.execute("""
        ALTER TABLE country_leave_defaults
        ADD COLUMN IF NOT EXISTS reduced_pay_rate NUMERIC(4,3)
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE country_leave_defaults DROP COLUMN IF EXISTS reduced_pay_rate")
    op.execute("ALTER TABLE country_leave_defaults DROP COLUMN IF EXISTS reduced_pay_days")
    op.execute("ALTER TABLE country_leave_defaults DROP COLUMN IF EXISTS cycle_months")
