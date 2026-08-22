"""Link loan repayments to the payroll run that booked them.

Adds ``repayments.payroll_run_id`` (nullable FK → payroll_runs.id, SET NULL).
This makes payroll finalize idempotent (don't re-book a run's repayments) and
lets cancel reverse exactly the rows a run booked, instead of advancing the
loan ledger again on every redo. NULL = a manual repayment (untouched by
payroll).

Revision ID: repayment_run_link_20260619
Revises: merge_heads_20260619
"""
from alembic import op
import sqlalchemy as sa


revision = "repayment_run_link_20260619"
down_revision = "merge_heads_20260619"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "repayments",
        sa.Column("payroll_run_id", sa.Integer(), nullable=True),
    )
    op.create_index(
        "ix_repayments_payroll_run_id", "repayments", ["payroll_run_id"]
    )
    op.create_foreign_key(
        "fk_repayments_payroll_run_id",
        "repayments",
        "payroll_runs",
        ["payroll_run_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_repayments_payroll_run_id", "repayments", type_="foreignkey")
    op.drop_index("ix_repayments_payroll_run_id", table_name="repayments")
    op.drop_column("repayments", "payroll_run_id")
