"""Kiosk admin PIN — web-managed device admin PIN.

Adds ``kiosk_devices.admin_pin_hash``: a bcrypt-hashed 4-digit admin PIN
generated at registration. Gates the tablet's admin surfaces (exit kiosk /
re-onboard). Shown once on the web alongside the device token; the tablet
caches it locally for offline / dead-token validation.

Nullable so devices registered before this feature keep working (the tablet
falls back to its locally-set PIN for those).

Revision ID: kiosk_admin_pin_20260614
Revises: b5f67c34aea7
Create Date: 2026-06-14
"""
from alembic import op
import sqlalchemy as sa


revision = 'kiosk_admin_pin_20260614'
down_revision = 'b5f67c34aea7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'kiosk_devices',
        sa.Column('admin_pin_hash', sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('kiosk_devices', 'admin_pin_hash')
