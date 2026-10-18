"""field sales & commissions — Phase 2 (full catalog, units, targets)

Adds the structured catalog (categories, options/values, units of measure,
versioned prices) and sales targets, and wires the new FKs onto the Phase 0
tables (variant.sell_uom_id, sale_line.uom_id, commission_rule.scope_option_value_id).

Revision ID: field_sales_phase2_20261017
Revises: field_sales_phase1_20261017
Create Date: 2026-10-17
"""

from alembic import op
import sqlalchemy as sa


revision = "field_sales_phase2_20261017"
down_revision = "field_sales_phase1_20261017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "product_categories",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("company_id", sa.Integer, sa.ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False),
        sa.Column("parent_id", sa.Integer, sa.ForeignKey("product_categories.id", ondelete="CASCADE"), nullable=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_product_categories_company_id", "product_categories", ["company_id"])

    op.create_table(
        "product_options",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("company_id", sa.Integer, sa.ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("company_id", "name", name="uq_product_option_company_name"),
    )
    op.create_index("ix_product_options_company_id", "product_options", ["company_id"])

    op.create_table(
        "option_values",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("option_id", sa.Integer, sa.ForeignKey("product_options.id", ondelete="CASCADE"), nullable=False),
        sa.Column("value", sa.String(80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("option_id", "value", name="uq_option_value_option_value"),
    )
    op.create_index("ix_option_values_option_id", "option_values", ["option_id"])

    op.create_table(
        "units_of_measure",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("company_id", sa.Integer, sa.ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False),
        sa.Column("code", sa.String(20), nullable=False),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("base_uom_id", sa.Integer, sa.ForeignKey("units_of_measure.id", ondelete="SET NULL"), nullable=True),
        sa.Column("factor", sa.Numeric(14, 4), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("company_id", "code", name="uq_uom_company_code"),
    )
    op.create_index("ix_units_of_measure_company_id", "units_of_measure", ["company_id"])

    op.create_table(
        "product_variant_option_values",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("variant_id", sa.Integer, sa.ForeignKey("product_variants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("option_value_id", sa.Integer, sa.ForeignKey("option_values.id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("variant_id", "option_value_id", name="uq_variant_option_value"),
    )
    op.create_index("ix_pvov_variant_id", "product_variant_option_values", ["variant_id"])
    op.create_index("ix_pvov_option_value_id", "product_variant_option_values", ["option_value_id"])

    op.create_table(
        "product_prices",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("company_id", sa.Integer, sa.ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False),
        sa.Column("variant_id", sa.Integer, sa.ForeignKey("product_variants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
        sa.Column("currency", sa.String(3), nullable=False, server_default="MUR"),
        sa.Column("territory", sa.String(80), nullable=True),
        sa.Column("effective_from", sa.Date, nullable=True),
        sa.Column("effective_to", sa.Date, nullable=True),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("products.id", ondelete="CASCADE"), nullable=True),
        sa.Column("reference", sa.String(200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("variant_id", "territory", "effective_from", name="uq_product_price_version"),
    )
    op.create_index("ix_product_prices_company_id", "product_prices", ["company_id"])
    op.create_index("ix_product_prices_variant_id", "product_prices", ["variant_id"])

    op.create_table(
        "sales_targets",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("company_id", sa.Integer, sa.ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False),
        sa.Column("private_user_id", sa.Integer, sa.ForeignKey("private_users.private_user_id", ondelete="CASCADE"), nullable=False),
        sa.Column("period_start", sa.Date, nullable=False),
        sa.Column("period_end", sa.Date, nullable=False),
        sa.Column("scope_category", sa.String(120), nullable=True),
        sa.Column("target_amount", sa.Numeric(14, 2), nullable=True),
        sa.Column("target_units", sa.Numeric(14, 3), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_sales_targets_company_id", "sales_targets", ["company_id"])
    op.create_index("ix_sales_targets_user", "sales_targets", ["private_user_id"])
    op.create_index("ix_sales_targets_company_period", "sales_targets", ["company_id", "period_start", "period_end"])

    op.add_column("product_variants", sa.Column("sell_uom_id", sa.Integer,
                  sa.ForeignKey("units_of_measure.id", ondelete="SET NULL"), nullable=True))
    op.add_column("sale_lines", sa.Column("uom_id", sa.Integer,
                  sa.ForeignKey("units_of_measure.id", ondelete="SET NULL"), nullable=True))
    op.add_column("commission_rules", sa.Column("scope_option_value_id", sa.Integer,
                  sa.ForeignKey("option_values.id", ondelete="SET NULL"), nullable=True))


def downgrade() -> None:
    op.drop_column("commission_rules", "scope_option_value_id")
    op.drop_column("sale_lines", "uom_id")
    op.drop_column("product_variants", "sell_uom_id")
    op.drop_index("ix_sales_targets_company_period", table_name="sales_targets")
    op.drop_index("ix_sales_targets_user", table_name="sales_targets")
    op.drop_index("ix_sales_targets_company_id", table_name="sales_targets")
    op.drop_table("sales_targets")
    op.drop_index("ix_product_prices_variant_id", table_name="product_prices")
    op.drop_index("ix_product_prices_company_id", table_name="product_prices")
    op.drop_table("product_prices")
    op.drop_index("ix_pvov_option_value_id", table_name="product_variant_option_values")
    op.drop_index("ix_pvov_variant_id", table_name="product_variant_option_values")
    op.drop_table("product_variant_option_values")
    op.drop_index("ix_units_of_measure_company_id", table_name="units_of_measure")
    op.drop_table("units_of_measure")
    op.drop_index("ix_option_values_option_id", table_name="option_values")
    op.drop_table("option_values")
    op.drop_index("ix_product_options_company_id", table_name="product_options")
    op.drop_table("product_options")
    op.drop_index("ix_product_categories_company_id", table_name="product_categories")
    op.drop_table("product_categories")
