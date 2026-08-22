"""Add company_geofences.deleted_at for soft delete (keep home-site + payslip refs).

Revision ID: geofence_soft_delete_20260818
Revises: employee_home_site_20260818
Create Date: 2026-08-18
"""

from alembic import op
import sqlalchemy as sa

revision = "geofence_soft_delete_20260818"
down_revision = "employee_home_site_20260818"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "company_geofences",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("company_geofences", "deleted_at")