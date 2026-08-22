"""shadow_payroll

Revision ID: shadow_payroll_20260730
Revises: country_assignments_20260720
Create Date: 2026-07-30

Adds Phase 2 shadow-payroll columns:
  * payroll_runs.fx_snapshot / fx_source / fx_as_of — frozen BOM FX snapshot
  * payslips.shadow_country_code / shadow_currency / shadow_gross /
    shadow_taxable_income / shadow_tax / shadow_ss / shadow_equalization_due
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "shadow_payroll_20260730"
down_revision = "country_assignments_20260720"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("payroll_runs", sa.Column("fx_snapshot", JSONB(), nullable=True))
    op.add_column("payroll_runs", sa.Column("fx_source", sa.String(length=16), nullable=True))
    op.add_column("payroll_runs", sa.Column("fx_as_of", sa.Date(), nullable=True))

    op.add_column("payslips", sa.Column("shadow_country_code", sa.String(length=3), nullable=True))
    op.add_column("payslips", sa.Column("shadow_currency", sa.String(length=3), nullable=True))
    op.add_column("payslips", sa.Column("shadow_gross", sa.Numeric(14, 2), nullable=True))
    op.add_column("payslips", sa.Column("shadow_taxable_income", sa.Numeric(14, 2), nullable=True))
    op.add_column("payslips", sa.Column("shadow_tax", sa.Numeric(14, 2), nullable=True))
    op.add_column("payslips", sa.Column("shadow_ss", sa.Numeric(14, 2), nullable=True))
    op.add_column(
        "payslips",
        sa.Column(
            "shadow_equalization_due",
            sa.Numeric(14, 2),
            nullable=True,
            comment="Tax equalization: host tax minus home hypothetical tax, in home currency, floored at 0",
        ),
    )


def downgrade() -> None:
    op.drop_column("payslips", "shadow_equalization_due")
    op.drop_column("payslips", "shadow_ss")
    op.drop_column("payslips", "shadow_tax")
    op.drop_column("payslips", "shadow_taxable_income")
    op.drop_column("payslips", "shadow_gross")
    op.drop_column("payslips", "shadow_currency")
    op.drop_column("payslips", "shadow_country_code")

    op.drop_column("payroll_runs", "fx_as_of")
    op.drop_column("payroll_runs", "fx_source")
    op.drop_column("payroll_runs", "fx_snapshot")