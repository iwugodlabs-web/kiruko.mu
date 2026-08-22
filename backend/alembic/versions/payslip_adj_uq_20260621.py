"""Relax uq_payslip_run_user to exclude adjustment payslips.

An adjustment payslip (is_adjustment=true) corrects an original and
deliberately shares its (payroll_run_id, private_user_id). The old
UNIQUE CONSTRAINT blocked that — the first correction collided with the
original. Replace the table constraint with a PARTIAL UNIQUE INDEX that
only enforces uniqueness on originals (is_adjustment = false), so each
run+employee still has exactly one original but may have many adjustments.

Revision ID: payslip_adj_uq_20260621
Revises: payslip_adjustment_20260621
"""
from alembic import op
import sqlalchemy as sa


revision = "payslip_adj_uq_20260621"
down_revision = "payslip_adjustment_20260621"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop the old all-rows unique constraint, then recreate uniqueness as a
    # partial index scoped to originals only.
    op.drop_constraint("uq_payslip_run_user", "payslips", type_="unique")
    op.create_index(
        "uq_payslip_run_user",
        "payslips",
        ["payroll_run_id", "private_user_id"],
        unique=True,
        postgresql_where=sa.text("is_adjustment = false"),
    )


def downgrade() -> None:
    op.drop_index("uq_payslip_run_user", table_name="payslips")
    op.create_unique_constraint(
        "uq_payslip_run_user", "payslips", ["payroll_run_id", "private_user_id"]
    )
