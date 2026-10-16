"""payroll maker-checker flag on companies

Revision ID: payroll_mkck_20260923
Revises: payroll_gate_20260922
Create Date: 2026-09-23

Phase 4 of payroll completeness. Opt-in segregation of duties: when
companies.payroll_maker_checker is true, the admin finalizing a run must not be
the one who acknowledged its exclusions.

Additive, default false — single-admin companies are unaffected.
"""
from alembic import op
import sqlalchemy as sa


revision = "payroll_mkck_20260923"
down_revision = "payroll_gate_20260922"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "companies",
        sa.Column("payroll_maker_checker", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("companies", "payroll_maker_checker")
