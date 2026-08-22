"""Add receipt_image_url to purchases

Revision ID: purchase_receipt_image_20260520
Revises: platform_role_perms_20260519
Create Date: 2026-05-20

Adds purchases.receipt_image_url (nullable VARCHAR). Stores the URL of
the originally-scanned receipt image (LocalStorage path like
'/uploads/receipts/{private_user_id}/{uuid}.jpg' in dev; absolute https
URL once STORAGE_TYPE flips to s3/gcs in production). Allows users to
view the source receipt next to the parsed purchase fields.
"""

from alembic import op


revision = 'purchase_receipt_image_20260520'
down_revision = 'platform_role_perms_20260519'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE purchases
            ADD COLUMN IF NOT EXISTS receipt_image_url VARCHAR;
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE purchases
            DROP COLUMN IF EXISTS receipt_image_url;
    """)
