"""Per-payslip leave summary

Revision ID: payslip_leave_summary_20260430
Revises: timelog_approval_20260430
Create Date: 2026-04-30

Adds ``payslips.leave_summary`` (JSONB) so the payslip viewer can show
"Sick leave: 2 days" and similar rows. Computed on draft creation by
the payroll engine — counts approved Leave rows whose [start, end]
intersects the period, grouped by leave type.
"""

from alembic import op


revision = 'payslip_leave_summary_20260430'
down_revision = 'timelog_approval_20260430'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE payslips
            ADD COLUMN IF NOT EXISTS leave_summary JSONB
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE payslips
            DROP COLUMN IF EXISTS leave_summary
    """)
