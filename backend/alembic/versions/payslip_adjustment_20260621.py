"""Per-employee payslip correction: adjustment columns.

Adds payslips.is_adjustment + parent_payslip_id (self-FK, SET NULL) +
adjustment_reason so a correction can post a signed-delta payslip linked to
the immutable original (the original is never mutated).

Revision ID: payslip_adjustment_20260621
Revises: concern_payroll_link_20260621
"""
from alembic import op
import sqlalchemy as sa


revision = "payslip_adjustment_20260621"
down_revision = "concern_payroll_link_20260621"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("payslips", sa.Column("is_adjustment", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("payslips", sa.Column("parent_payslip_id", sa.Integer(), nullable=True))
    op.add_column("payslips", sa.Column("adjustment_reason", sa.String(length=255), nullable=True))
    op.create_foreign_key(
        "fk_payslips_parent", "payslips", "payslips",
        ["parent_payslip_id"], ["id"], ondelete="SET NULL",
    )
    op.create_index("ix_payslips_parent_payslip_id", "payslips", ["parent_payslip_id"])


def downgrade() -> None:
    op.drop_index("ix_payslips_parent_payslip_id", table_name="payslips")
    op.drop_constraint("fk_payslips_parent", "payslips", type_="foreignkey")
    op.drop_column("payslips", "adjustment_reason")
    op.drop_column("payslips", "parent_payslip_id")
    op.drop_column("payslips", "is_adjustment")
