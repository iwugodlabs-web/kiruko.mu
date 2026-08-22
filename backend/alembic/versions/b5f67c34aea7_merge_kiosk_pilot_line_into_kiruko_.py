"""merge kiosk-pilot line into kiruko-rebrand

Revision ID: b5f67c34aea7
Revises: trusted_devices_20260531, task_proof_image_20260611
Create Date: 2026-06-11 20:35:57.887871

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b5f67c34aea7'
down_revision = ('trusted_devices_20260531', 'task_proof_image_20260611')
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
