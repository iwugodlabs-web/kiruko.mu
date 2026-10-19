"""field sales maker-checker flag + price approval fields

Revision ID: field_sales_mkck_20261019
Revises: commission_plan_ver_20261019
Create Date: 2026-10-19

Step C of plan/price versioning. Opt-in segregation of duties for the Field
Sales module: when `companies.field_sales_maker_checker` is true, a plan/price
version created by one admin must be activated by a *different* admin.

Additive, default false — single-admin companies are unaffected. Existing
product prices are backfilled as `active` so they keep resolving.
"""
from alembic import op
import sqlalchemy as sa


revision = "field_sales_mkck_20261019"
down_revision = "commission_plan_ver_20261019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "companies",
        sa.Column("field_sales_maker_checker", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column(
        "product_prices",
        sa.Column("status", sa.String(20), server_default=sa.text("'active'"), nullable=False),
    )
    op.add_column(
        "product_prices",
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "product_prices",
        sa.Column("approved_by_user_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "product_prices",
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("product_prices", "approved_at")
    op.drop_column("product_prices", "approved_by_user_id")
    op.drop_column("product_prices", "created_by_user_id")
    op.drop_column("product_prices", "status")
    op.drop_column("companies", "field_sales_maker_checker")
