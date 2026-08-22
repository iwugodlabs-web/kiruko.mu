"""Add loans.loan_type to separate personal (self-tracked) loans from
employer loans / salary advances.

Only 'employer' loans are repaid via payroll deduction. Existing rows backfill
to 'personal' so no employee-self-tracked loan is ever deducted from pay
(fixes the latent conflation where every active loan was deducted).

Revision ID: loan_type_20260619
Revises: repayment_run_link_20260619
"""
from alembic import op
import sqlalchemy as sa


revision = "loan_type_20260619"
down_revision = "repayment_run_link_20260619"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "loans",
        sa.Column(
            "loan_type",
            sa.String(length=20),
            nullable=False,
            server_default="personal",
        ),
    )


def downgrade() -> None:
    op.drop_column("loans", "loan_type")
