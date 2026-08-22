"""employee home site (branch) assignment

Revision ID: employee_home_site_20260818
Revises: geofence_v3_20260818
Create Date: 2026-08-18

An employee's home site/branch — the company_geofences row they are based
at. Shown on payslips (snapshotted per run) so each payslip says which
branch it belongs to.

  1. `private_users.home_geofence_id` — the employee's current home site.
     Administrative metadata only: clock-in enforcement still verifies
     against EVERY active fence, never just this one.

  2. `payslips.home_geofence_id` — frozen at payroll-run time. A payslip is
     a historical record, so a mid-period transfer must not rewrite past
     payslips. The display name is resolved read-time from the geofence.

Both FKs are ondelete=SET NULL: deleting a site keeps employees and
historical payslips intact instead of blocking or cascading.
"""
from alembic import op
import sqlalchemy as sa


revision = "employee_home_site_20260818"
down_revision = "geofence_v3_20260818"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "private_users",
        sa.Column(
            "home_geofence_id",
            sa.Integer(),
            sa.ForeignKey("company_geofences.geofence_id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "payslips",
        sa.Column(
            "home_geofence_id",
            sa.Integer(),
            sa.ForeignKey("company_geofences.geofence_id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_private_users_home_geofence_id", "private_users", ["home_geofence_id"])
    op.create_index("ix_payslips_home_geofence_id", "payslips", ["home_geofence_id"])


def downgrade() -> None:
    op.drop_index("ix_payslips_home_geofence_id", table_name="payslips")
    op.drop_index("ix_private_users_home_geofence_id", table_name="private_users")
    op.drop_column("payslips", "home_geofence_id")
    op.drop_column("private_users", "home_geofence_id")