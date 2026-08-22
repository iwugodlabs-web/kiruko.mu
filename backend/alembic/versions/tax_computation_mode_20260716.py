"""TaxBracketSet.tax_computation_mode — CUMULATIVE_YTD vs FLAT_PERIODIC

Revision ID: tax_computation_mode_20260716
Revises: private_user_country_20260716
Create Date: 2026-07-16

Mauritius's WRA PAYE is cumulative year-to-date (see payroll_engine.py's
_ytd_paye_state); Tanzania's TRA PAYE is flat/independent per period, with
no year-end reconciliation for simple employment income. Bolting TZ's
bracket numbers onto MU's cumulative machinery would silently produce wrong
withholding from month 2 onward — see doc/TANZANIA-ONBOARDING-PLAN.md.

server_default='CUMULATIVE_YTD' means every existing row (all MU today)
keeps its exact current behavior with zero code-path change.
"""

from alembic import op
import sqlalchemy as sa


revision = 'tax_computation_mode_20260716'
down_revision = 'private_user_country_20260716'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE tax_bracket_sets
        ADD COLUMN IF NOT EXISTS tax_computation_mode VARCHAR(20)
        NOT NULL DEFAULT 'CUMULATIVE_YTD'
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE tax_bracket_sets DROP COLUMN IF EXISTS tax_computation_mode")
