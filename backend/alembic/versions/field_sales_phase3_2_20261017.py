"""field sales & commissions — Phase 3.2 (target accelerators)

Adds `sales_targets.accelerators` (JSONB): attainment bands that raise the
payout percent for a `target` rule. Mid-period pro-rating is computed in the
engine from the rule's effective window — no column needed.

Revision ID: field_sales_phase3_2_20261017
Revises: field_sales_phase3_1_20261017
Create Date: 2026-10-17
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "field_sales_phase3_2_20261017"
down_revision = "field_sales_phase3_1_20261017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sales_targets", sa.Column("accelerators", postgresql.JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column("sales_targets", "accelerators")
