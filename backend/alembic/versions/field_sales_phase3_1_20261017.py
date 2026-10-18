"""field sales & commissions — Phase 3.1 (returns / credit-notes)

A return is recorded against a specific approved sale + sale line, so a partial
return flows forward as a negative commission line in the period it lands —
never a rewrite of a closed month.

Revision ID: field_sales_phase3_1_20261017
Revises: field_sales_phase3_20261017
Create Date: 2026-10-17
"""

from alembic import op
import sqlalchemy as sa


revision = "field_sales_phase3_1_20261017"
down_revision = "field_sales_phase3_20261017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sales_returns",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("company_id", sa.Integer, sa.ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False),
        sa.Column("sale_id", sa.Integer, sa.ForeignKey("sales.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("returned_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reason", sa.String(300), nullable=True),
        sa.Column("currency", sa.String(3), nullable=False, server_default="MUR"),
        sa.Column("created_by_user_id", sa.Integer, sa.ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_sales_returns_company_id", "sales_returns", ["company_id"])
    op.create_index("ix_sales_returns_sale_id", "sales_returns", ["sale_id"])
    op.create_index("ix_sales_returns_company_returned_at", "sales_returns", ["company_id", "returned_at"])

    op.create_table(
        "sales_return_lines",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("return_id", sa.Integer, sa.ForeignKey("sales_returns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sale_line_id", sa.Integer, sa.ForeignKey("sale_lines.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("variant_id", sa.Integer, sa.ForeignKey("product_variants.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("quantity", sa.Numeric(14, 3), nullable=False, server_default="0"),
        sa.Column("unit_price_snapshot", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
        sa.Column("line_total", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
    )
    op.create_index("ix_sales_return_lines_return_id", "sales_return_lines", ["return_id"])
    op.create_index("ix_sales_return_lines_sale_line_id", "sales_return_lines", ["sale_line_id"])


def downgrade() -> None:
    op.drop_index("ix_sales_return_lines_sale_line_id", table_name="sales_return_lines")
    op.drop_index("ix_sales_return_lines_return_id", table_name="sales_return_lines")
    op.drop_table("sales_return_lines")
    op.drop_index("ix_sales_returns_company_returned_at", table_name="sales_returns")
    op.drop_index("ix_sales_returns_sale_id", table_name="sales_returns")
    op.drop_index("ix_sales_returns_company_id", table_name="sales_returns")
    op.drop_table("sales_returns")
