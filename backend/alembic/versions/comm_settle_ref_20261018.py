"""commission_payables.settlement_reference — manual (off-payroll) payout ref

Adds a nullable `settlement_reference` to `commission_payables` so an admin can
record the external payout reference (bank transfer id, cash voucher no., …)
when settling a contractor's commission via the 'manual' channel, outside
payroll. Additive; no behaviour change until the settle-manual endpoint is used.

Revision ID: comm_settle_ref_20261018
Revises: sale_payment_method_20261018
Create Date: 2026-10-18
"""

from alembic import op
import sqlalchemy as sa


revision = "comm_settle_ref_20261018"
down_revision = "sale_payment_method_20261018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "commission_payables",
        sa.Column("settlement_reference", sa.String(length=160), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("commission_payables", "settlement_reference")
