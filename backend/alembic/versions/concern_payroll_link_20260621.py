"""Link concerns to a payroll run / payslip.

Adds user_rights.payroll_run_id + payslip_id (nullable FKs, SET NULL on
delete) so an employee's "Raise a query" from a payslip is structurally
linked to the run/payslip it's about — the employer can jump straight to it.

Revision ID: concern_payroll_link_20260621
Revises: notif_retention_idx_20260620
"""
from alembic import op
import sqlalchemy as sa


revision = "concern_payroll_link_20260621"
down_revision = "notif_retention_idx_20260620"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user_rights", sa.Column("payroll_run_id", sa.Integer(), nullable=True))
    op.add_column("user_rights", sa.Column("payslip_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_user_rights_payroll_run", "user_rights", "payroll_runs",
        ["payroll_run_id"], ["id"], ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_user_rights_payslip", "user_rights", "payslips",
        ["payslip_id"], ["id"], ondelete="SET NULL",
    )
    op.create_index("ix_user_rights_payroll_run_id", "user_rights", ["payroll_run_id"])
    op.create_index("ix_user_rights_payslip_id", "user_rights", ["payslip_id"])


def downgrade() -> None:
    op.drop_index("ix_user_rights_payslip_id", table_name="user_rights")
    op.drop_index("ix_user_rights_payroll_run_id", table_name="user_rights")
    op.drop_constraint("fk_user_rights_payslip", "user_rights", type_="foreignkey")
    op.drop_constraint("fk_user_rights_payroll_run", "user_rights", type_="foreignkey")
    op.drop_column("user_rights", "payslip_id")
    op.drop_column("user_rights", "payroll_run_id")
