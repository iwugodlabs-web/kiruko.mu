"""field sales & commissions — Phase 1 (outlets)

Adds the `outlets` table (geo + geofence + commercial context) and wires
`sales.outlet_id` to it. Purely additive.

Revision ID: field_sales_phase1_20261017
Revises: field_sales_phase0_20261017
Create Date: 2026-10-17
"""

from alembic import op
import sqlalchemy as sa


revision = "field_sales_phase1_20261017"
down_revision = "field_sales_phase0_20261017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "outlets",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("company_id", sa.Integer, sa.ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("code", sa.String(40), nullable=True),
        sa.Column("address", sa.String(300), nullable=True),
        sa.Column("contact_name", sa.String(120), nullable=True),
        sa.Column("phone", sa.String(40), nullable=True),
        sa.Column("latitude", sa.Float, nullable=True),
        sa.Column("longitude", sa.Float, nullable=True),
        sa.Column("radius_meters", sa.Integer, nullable=False, server_default="150"),
        sa.Column("assigned_rep_private_user_id", sa.Integer,
                  sa.ForeignKey("private_users.private_user_id", ondelete="SET NULL"), nullable=True),
        sa.Column("visit_cadence", sa.String(20), nullable=True),
        sa.Column("credit_terms_days", sa.Integer, nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("company_id", "name", name="uq_outlet_company_name"),
    )
    op.create_index("ix_outlets_company_id", "outlets", ["company_id"])
    op.create_index("ix_outlets_assigned_rep", "outlets", ["assigned_rep_private_user_id"])

    op.create_foreign_key(
        "fk_sales_outlet_id", "sales", "outlets", ["outlet_id"], ["id"], ondelete="SET NULL",
    )
    op.create_index("ix_sales_outlet_id", "sales", ["outlet_id"])

    op.add_column("sales", sa.Column("visit_verified", sa.Boolean, nullable=True))
    op.add_column("sales", sa.Column("visit_distance_m", sa.Float, nullable=True))
    op.add_column("sales", sa.Column("reviewed_by_user_id", sa.Integer,
                                     sa.ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True))
    op.add_column("sales", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("sales", "reviewed_at")
    op.drop_column("sales", "reviewed_by_user_id")
    op.drop_column("sales", "visit_distance_m")
    op.drop_column("sales", "visit_verified")
    op.drop_index("ix_sales_outlet_id", table_name="sales")
    op.drop_constraint("fk_sales_outlet_id", "sales", type_="foreignkey")
    op.drop_index("ix_outlets_assigned_rep", table_name="outlets")
    op.drop_index("ix_outlets_company_id", table_name="outlets")
    op.drop_table("outlets")
