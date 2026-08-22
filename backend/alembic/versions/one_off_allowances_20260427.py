"""employee_one_off_allowances table

Revision ID: one_off_allowances_20260427
Revises: leave_types_20260427
Create Date: 2026-04-27

Ad-hoc payslip line items: signing bonus, mid-year commission, equipment
reimbursement, etc. Lifecycle is admin creates a row, the payroll engine
picks it up during draft for (year, month), then stamps applied_to_payslip_id
on finalize so the one-off can't be paid twice.
"""

from alembic import op


revision = 'one_off_allowances_20260427'
down_revision = 'leave_types_20260427'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS employee_one_off_allowances (
            id                       SERIAL PRIMARY KEY,
            private_user_id          INTEGER NOT NULL REFERENCES private_users(private_user_id) ON DELETE CASCADE,
            component_id             INTEGER NOT NULL REFERENCES salary_components(id) ON DELETE RESTRICT,
            amount                   NUMERIC(14, 2) NOT NULL,
            payable_in_year          INTEGER NOT NULL,
            payable_in_month         INTEGER NOT NULL,
            applied_to_payslip_id    INTEGER REFERENCES payslips(id) ON DELETE SET NULL,
            notes                    VARCHAR,
            created_by_user_id       INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
            created_at               TIMESTAMPTZ DEFAULT now(),
            CONSTRAINT chk_one_off_month CHECK (payable_in_month BETWEEN 1 AND 12)
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_one_off_user_period
        ON employee_one_off_allowances (private_user_id, payable_in_year, payable_in_month)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_one_off_pending
        ON employee_one_off_allowances (private_user_id, payable_in_year, payable_in_month)
        WHERE applied_to_payslip_id IS NULL
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS employee_one_off_allowances")
