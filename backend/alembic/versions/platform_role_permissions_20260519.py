"""Platform role permissions JSONB (Phase 2 role/permission overhaul)

Revision ID: platform_role_perms_20260519
Revises: m18_ext_advertiser_20260518
Create Date: 2026-05-19

Adds platform_roles.permissions (JSONB, default '[]'). Mirrors the
company_roles.permissions shape so the new require_platform_permission
guard can read from a consistent place across both tiers.

Until Phase 2.2 lands the seed updates, every existing platform_roles
row keeps an empty array. The seeded platform_admin role is still
treated as a named bypass by require_platform_permission, so existing
deployments are unaffected by this column add alone.
"""

from alembic import op


revision = 'platform_role_perms_20260519'
down_revision = 'm18_ext_advertiser_20260518'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE platform_roles
            ADD COLUMN IF NOT EXISTS permissions JSONB
                NOT NULL DEFAULT '[]'::jsonb
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE platform_roles
            DROP COLUMN IF EXISTS permissions
    """)
