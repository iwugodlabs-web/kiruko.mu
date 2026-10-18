"""sales.payment_method — how a field sale was settled

Adds a nullable `payment_method` to `sales` so reps can record *how* they were
paid (cash, card, bank transfer, mobile money, cheque, credit) alongside the
existing `payment_status` collection axis (paid/pending/partial). Kept as a
short string rather than an enum so a country-specific method (M-Pesa, Orange
Money, ...) needs no migration — it is stored as `mobile_money` with the
freeform detail in `notes`.

Revision ID: sale_payment_method_20261018
Revises: company_modules_20261018
Create Date: 2026-10-18
"""

from alembic import op
import sqlalchemy as sa


revision = "sale_payment_method_20261018"
down_revision = "company_modules_20261018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sales", sa.Column("payment_method", sa.String(length=30), nullable=True))


def downgrade() -> None:
    op.drop_column("sales", "payment_method")
