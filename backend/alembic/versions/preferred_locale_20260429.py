"""User preferred_locale (M18a)

Revision ID: preferred_locale_20260429
Revises: doc_vault_hardening_20260429
Create Date: 2026-04-29

Adds users.preferred_locale (BCP-47-ish: 'en' | 'fr' | 'mg'), nullable
because legacy users haven't picked one yet. Resolution priority at
read time:
    explicit request param  >
    users.preferred_locale  >
    Accept-Language header  >
    country.locale          >
    'en'

next-intl on the web reads this on login and persists changes back via
PATCH /user/me. Mobile reads it the same way.
"""

from alembic import op


revision = 'preferred_locale_20260429'
down_revision = 'doc_vault_hardening_20260429'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE users
            ADD COLUMN IF NOT EXISTS preferred_locale VARCHAR(10) NULL;

        ALTER TABLE users
            ADD CONSTRAINT ck_users_preferred_locale
                CHECK (preferred_locale IS NULL
                       OR preferred_locale ~ '^[a-z]{2}(-[A-Z]{2})?$');
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE users
            DROP CONSTRAINT IF EXISTS ck_users_preferred_locale;
        ALTER TABLE users
            DROP COLUMN IF EXISTS preferred_locale;
    """)
