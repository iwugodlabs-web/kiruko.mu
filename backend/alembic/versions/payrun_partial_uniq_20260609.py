"""Payroll run uniqueness: exclude cancelled runs

Revision ID: payrun_partial_uniq_20260609
Revises: kiosk_clockin_20260530
Create Date: 2026-06-09

The original `uq_payroll_run_company_period` was a plain UNIQUE constraint on
(company_id, period_start, period_end). That contradicted the application
logic in payroll_engine.create_draft_run, which only rejects a new run when a
*non-cancelled* run already exists for the period — the intent being that a
cancelled run frees the period for a fresh one. With a plain constraint the
cancelled row still occupies the slot, so "cancel → start fresh" and the new
"Redo finalized run" flow both blew up with a duplicate-key IntegrityError.

Fix: replace the constraint with a PARTIAL unique index that applies only
WHERE status <> 'cancelled'. At most one live (draft|finalized) run per
company+period; any number of cancelled rows may coexist for audit.
"""
from alembic import op


revision = 'payrun_partial_uniq_20260609'
down_revision = 'kiosk_clockin_20260530'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop the plain unique constraint (idempotent), then recreate the same
    # name as a partial unique index excluding cancelled runs.
    op.execute("ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS uq_payroll_run_company_period")
    op.execute("DROP INDEX IF EXISTS uq_payroll_run_company_period")
    op.execute("""
        CREATE UNIQUE INDEX uq_payroll_run_company_period
            ON payroll_runs (company_id, period_start, period_end)
            WHERE status <> 'cancelled'
    """)


def downgrade() -> None:
    # Revert to the plain unique constraint. Note: if duplicate cancelled rows
    # exist for a period this will fail — expected, since the old schema could
    # never have produced them.
    op.execute("DROP INDEX IF EXISTS uq_payroll_run_company_period")
    op.execute("""
        ALTER TABLE payroll_runs
            ADD CONSTRAINT uq_payroll_run_company_period
            UNIQUE (company_id, period_start, period_end)
    """)
