"""private_users off-payroll standing status

Revision ID: private_user_off_payroll_20260921
Revises: payroll_member_status_20260920
Create Date: 2026-09-21

Phase 2 of payroll completeness. A standing "this person is deliberately not on
payroll" marker (contractor, director's fees, unpaid leave, suspended) so a
stable exclusion auto-satisfies the completeness ledger every run instead of
being hand-acknowledged month after month.

Additive: every existing employee defaults to 'on_payroll', so behaviour is
unchanged until an admin marks someone off-payroll.
"""
from alembic import op
import sqlalchemy as sa


revision = "pu_off_payroll_20260921"
down_revision = "payroll_member_status_20260920"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "private_users",
        sa.Column("payroll_status", sa.String(length=16), nullable=False,
                  server_default=sa.text("'on_payroll'")),
    )
    op.add_column("private_users", sa.Column("off_payroll_reason", sa.String(length=32), nullable=True))
    op.add_column("private_users", sa.Column("off_payroll_from", sa.Date(), nullable=True))
    op.add_column("private_users", sa.Column("off_payroll_to", sa.Date(), nullable=True))
    op.add_column("private_users", sa.Column("off_payroll_set_by_user_id", sa.Integer(), nullable=True))
    op.add_column("private_users", sa.Column("off_payroll_note", sa.String(length=500), nullable=True))
    op.create_foreign_key(
        "fk_private_users_off_payroll_set_by",
        "private_users", "users",
        ["off_payroll_set_by_user_id"], ["user_id"], ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_private_users_off_payroll_set_by", "private_users", type_="foreignkey")
    op.drop_column("private_users", "off_payroll_note")
    op.drop_column("private_users", "off_payroll_set_by_user_id")
    op.drop_column("private_users", "off_payroll_to")
    op.drop_column("private_users", "off_payroll_from")
    op.drop_column("private_users", "off_payroll_reason")
    op.drop_column("private_users", "payroll_status")
