"""field sales & commissions — Phase 0 (catalog · sales · commission · ledger)

Adds the Phase 0 tables for the field-sales module: a minimal product catalog
(products + default variants), admin-entered sales (sales + sale_lines), the
self-service commission layer (plans, rules, assignments, runs, line items),
and the CommissionPayable ledger seam that bridges to payroll via an
EmployeeOneOffAllowance for on-payroll reps.

Purely additive — no existing table is touched.

Revision ID: field_sales_phase0_20261017
Revises: payroll_backfill_20260924
Create Date: 2026-10-17
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "field_sales_phase0_20261017"
down_revision = "payroll_backfill_20260924"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Catalog ──────────────────────────────────────────────────────────
    op.create_table(
        "products",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("company_id", sa.Integer, sa.ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("brand", sa.String(120), nullable=True),
        sa.Column("category", sa.String(120), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("company_id", "name", name="uq_product_company_name"),
    )
    op.create_index("ix_products_company_id", "products", ["company_id"])

    op.create_table(
        "product_variants",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("products.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sku", sa.String(64), nullable=False),
        sa.Column("barcode", sa.String(64), nullable=True),
        sa.Column("unit_price", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
        sa.Column("currency", sa.String(3), nullable=False, server_default="MUR"),
        sa.Column("is_default", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("product_id", "sku", name="uq_variant_product_sku"),
    )
    op.create_index("ix_product_variants_product_id", "product_variants", ["product_id"])
    op.create_index("ix_product_variants_barcode", "product_variants", ["barcode"])

    # ── Sales ────────────────────────────────────────────────────────────
    op.create_table(
        "sales",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("company_id", sa.Integer, sa.ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False),
        sa.Column("rep_private_user_id", sa.Integer, sa.ForeignKey("private_users.private_user_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("credited_to_private_user_id", sa.Integer, sa.ForeignKey("private_users.private_user_id", ondelete="RESTRICT"), nullable=True),
        sa.Column("outlet_id", sa.Integer, nullable=True),
        sa.Column("sold_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="approved"),
        sa.Column("payment_status", sa.String(20), nullable=False, server_default="paid"),
        sa.Column("collected_amount", sa.Numeric(14, 2), nullable=True),
        sa.Column("collected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("currency", sa.String(3), nullable=False, server_default="MUR"),
        sa.Column("source", sa.String(20), nullable=False, server_default="admin"),
        sa.Column("client_uuid", sa.String(64), nullable=True),
        sa.Column("notes", sa.String, nullable=True),
        sa.Column("created_by_user_id", sa.Integer, sa.ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("company_id", "client_uuid", name="uq_sale_company_client_uuid"),
    )
    op.create_index("ix_sales_company_id", "sales", ["company_id"])
    op.create_index("ix_sales_rep", "sales", ["rep_private_user_id"])
    op.create_index("ix_sales_company_sold_at", "sales", ["company_id", "sold_at"])

    op.create_table(
        "sale_lines",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("sale_id", sa.Integer, sa.ForeignKey("sales.id", ondelete="CASCADE"), nullable=False),
        sa.Column("variant_id", sa.Integer, sa.ForeignKey("product_variants.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("quantity", sa.Numeric(14, 3), nullable=False, server_default="0"),
        sa.Column("unit_price_snapshot", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
        sa.Column("line_total", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
    )
    op.create_index("ix_sale_lines_sale_id", "sale_lines", ["sale_id"])

    # ── Commission ───────────────────────────────────────────────────────
    op.create_table(
        "commission_plans",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("company_id", sa.Integer, sa.ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.String, nullable=True),
        sa.Column("trigger", sa.String(20), nullable=False, server_default="on_sale"),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("company_id", "name", name="uq_commission_plan_company_name"),
    )
    op.create_index("ix_commission_plans_company_id", "commission_plans", ["company_id"])

    op.create_table(
        "commission_rules",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("plan_id", sa.Integer, sa.ForeignKey("commission_plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("rule_type", sa.String(30), nullable=False, server_default="flat_percent"),
        sa.Column("params", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("scope_category", sa.String(120), nullable=True),
        sa.Column("scope_product_id", sa.Integer, sa.ForeignKey("products.id", ondelete="SET NULL"), nullable=True),
        sa.Column("scope_variant_id", sa.Integer, sa.ForeignKey("product_variants.id", ondelete="SET NULL"), nullable=True),
        sa.Column("effective_from", sa.Date, nullable=True),
        sa.Column("effective_to", sa.Date, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_commission_rules_plan_id", "commission_rules", ["plan_id"])

    op.create_table(
        "commission_plan_assignments",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("plan_id", sa.Integer, sa.ForeignKey("commission_plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("private_user_id", sa.Integer, sa.ForeignKey("private_users.private_user_id", ondelete="CASCADE"), nullable=False),
        sa.Column("effective_from", sa.Date, nullable=True),
        sa.Column("effective_to", sa.Date, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("plan_id", "private_user_id", name="uq_plan_assignment_plan_user"),
    )
    op.create_index("ix_plan_assignments_plan_id", "commission_plan_assignments", ["plan_id"])
    op.create_index("ix_plan_assignments_user", "commission_plan_assignments", ["private_user_id"])

    op.create_table(
        "commission_runs",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("company_id", sa.Integer, sa.ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False),
        sa.Column("period_start", sa.Date, nullable=False),
        sa.Column("period_end", sa.Date, nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("currency", sa.String(3), nullable=False, server_default="MUR"),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by_user_id", sa.Integer, sa.ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_by_user_id", sa.Integer, sa.ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_commission_runs_company_id", "commission_runs", ["company_id"])
    op.create_index(
        "uq_commission_run_company_period", "commission_runs",
        ["company_id", "period_start", "period_end"],
        unique=True, postgresql_where=sa.text("status <> 'cancelled'"),
    )

    op.create_table(
        "commission_line_items",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("run_id", sa.Integer, sa.ForeignKey("commission_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("private_user_id", sa.Integer, sa.ForeignKey("private_users.private_user_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("rule_id", sa.Integer, sa.ForeignKey("commission_rules.id", ondelete="SET NULL"), nullable=True),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
        sa.Column("currency", sa.String(3), nullable=False, server_default="MUR"),
        sa.Column("trace", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_commission_line_items_run_id", "commission_line_items", ["run_id"])
    op.create_index("ix_commission_line_items_user", "commission_line_items", ["private_user_id"])

    op.create_table(
        "commission_payables",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("company_id", sa.Integer, sa.ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False),
        sa.Column("private_user_id", sa.Integer, sa.ForeignKey("private_users.private_user_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("run_id", sa.Integer, sa.ForeignKey("commission_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
        sa.Column("currency", sa.String(3), nullable=False, server_default="MUR"),
        sa.Column("payout_channel", sa.String(20), nullable=False, server_default="payroll"),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("one_off_allowance_id", sa.Integer, sa.ForeignKey("employee_one_off_allowances.id", ondelete="SET NULL"), nullable=True),
        sa.Column("settled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("run_id", "private_user_id", name="uq_payable_run_user"),
    )
    op.create_index("ix_commission_payables_company_id", "commission_payables", ["company_id"])
    op.create_index("ix_commission_payables_run_id", "commission_payables", ["run_id"])
    op.create_index("ix_commission_payables_user", "commission_payables", ["private_user_id"])


def downgrade() -> None:
    op.drop_table("commission_payables")
    op.drop_table("commission_line_items")
    op.drop_index("uq_commission_run_company_period", table_name="commission_runs")
    op.drop_table("commission_runs")
    op.drop_table("commission_plan_assignments")
    op.drop_table("commission_rules")
    op.drop_table("commission_plans")
    op.drop_table("sale_lines")
    op.drop_table("sales")
    op.drop_table("product_variants")
    op.drop_table("products")
