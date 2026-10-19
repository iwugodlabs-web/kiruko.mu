"""field sales & commissions — Phase 3 (territories/credit, team overrides)

Adds `credit_assignments` (territory / outlet / house-account → rep, with split
percent) and the self-referential `private_users.manager_private_user_id` that
team-override rules read. Clawbacks and adjustments ride existing payslip rows
(EmployeeOneOffAllowance), so they need no table.

Revision ID: field_sales_phase3_20261017
Revises: field_sales_phase2_20261017
Create Date: 2026-10-17
"""

from alembic import op
import sqlalchemy as sa


revision = "field_sales_phase3_20261017"
down_revision = "field_sales_phase2_20261017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "credit_assignments",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("company_id", sa.Integer, sa.ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False),
        sa.Column("private_user_id", sa.Integer, sa.ForeignKey("private_users.private_user_id", ondelete="CASCADE"), nullable=False),
        sa.Column("outlet_id", sa.Integer, sa.ForeignKey("outlets.id", ondelete="CASCADE"), nullable=True),
        sa.Column("territory", sa.String(80), nullable=True),
        sa.Column("account", sa.String(120), nullable=True),
        sa.Column("split_percent", sa.Numeric(5, 2), nullable=False, server_default="100"),
        sa.Column("effective_from", sa.Date, nullable=True),
        sa.Column("effective_to", sa.Date, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_credit_assignments_company_id", "credit_assignments", ["company_id"])
    op.create_index("ix_credit_assignments_user", "credit_assignments", ["private_user_id"])
    op.create_index("ix_credit_assignments_outlet", "credit_assignments", ["outlet_id"])
    op.create_index("ix_credit_assignments_territory", "credit_assignments", ["territory"])
    op.create_index("ix_credit_assignments_account", "credit_assignments", ["account"])
    op.create_index("ix_credit_assignments_company_outlet", "credit_assignments", ["company_id", "outlet_id"])
    op.create_index("ix_credit_assignments_company_territory", "credit_assignments", ["company_id", "territory"])

    op.add_column("private_users", sa.Column(
        "manager_private_user_id", sa.Integer,
        sa.ForeignKey("private_users.private_user_id", ondelete="SET NULL"), nullable=True,
    ))
    op.add_column("sales", sa.Column("territory", sa.String(80), nullable=True))
    op.add_column("sales", sa.Column("account", sa.String(120), nullable=True))


def downgrade() -> None:
    op.drop_column("sales", "account")
    op.drop_column("sales", "territory")
    op.drop_column("private_users", "manager_private_user_id")
    op.drop_index("ix_credit_assignments_company_territory", table_name="credit_assignments")
    op.drop_index("ix_credit_assignments_company_outlet", table_name="credit_assignments")
    op.drop_index("ix_credit_assignments_account", table_name="credit_assignments")
    op.drop_index("ix_credit_assignments_territory", table_name="credit_assignments")
    op.drop_index("ix_credit_assignments_outlet", table_name="credit_assignments")
    op.drop_index("ix_credit_assignments_user", table_name="credit_assignments")
    op.drop_index("ix_credit_assignments_company_id", table_name="credit_assignments")
    op.drop_table("credit_assignments")
