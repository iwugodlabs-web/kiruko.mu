"""company feature entitlements — company_modules table

Adds `company_modules`: one row per (company, module_key) recording whether a
paid module is switched on for that company, plus who flipped it and when.
Absence of a row means the module's registry default applies (off for paid
modules). Platform admins toggle these from the employer detail page.

Revision ID: company_modules_20261018
Revises: field_sales_phase3_2_20261017
Create Date: 2026-10-18
"""

from alembic import op
import sqlalchemy as sa


revision = "company_modules_20261018"
down_revision = "field_sales_phase3_2_20261017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "company_modules",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("module_key", sa.String(length=64), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("enabled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("disabled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("changed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["company_id"], ["companies.company_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["changed_by_user_id"], ["users.user_id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "module_key", name="uq_company_module"),
    )
    op.create_index("ix_company_modules_company_id", "company_modules", ["company_id"])

    # Backfill: any company already using a field-sales artifact keeps the
    # module on after this paid gate is introduced — otherwise a deploy would
    # silently hide the feature from existing users. New companies default off.
    op.execute(
        """
        INSERT INTO company_modules
            (company_id, module_key, enabled, enabled_at, created_at, updated_at)
        SELECT DISTINCT company_id, 'field_sales', true, now(), now(), now()
        FROM (
            SELECT company_id FROM products
            UNION SELECT company_id FROM sales
            UNION SELECT company_id FROM commission_plans
            UNION SELECT company_id FROM commission_runs
            UNION SELECT company_id FROM outlets
        ) t
        WHERE company_id IS NOT NULL
        ON CONFLICT (company_id, module_key) DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_index("ix_company_modules_company_id", table_name="company_modules")
    op.drop_table("company_modules")
