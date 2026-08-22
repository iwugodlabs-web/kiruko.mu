"""activate Tanzania (TZ) in the countries table

Revision ID: tanzania_activate_20260718
Revises: timelog_overtime_reason_20260717
Create Date: 2026-07-18

Flips the TZ row (added by tanzania_country_scaffold_20260716) from
is_active=FALSE to TRUE, making it selectable in the admin Country Switcher
and, by extension, /admin/payroll-rules and /admin/sectors.

This is a deliberate, standalone flip — it does NOT mean TZ's payroll rules
are ready. Real tax brackets/NSSF/SDL/WCF rates are still gated on
doc/TANZANIA-ONBOARDING-PLAN.md's M2 (rate-sourcing). Run this migration
only when you're ready for TZ to be admin-visible; downgrade instantly
hides it again without touching any other data.
"""
from alembic import op


revision = "tanzania_activate_20260718"
down_revision = "timelog_overtime_reason_20260717"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE countries SET is_active = TRUE WHERE code = 'TZ'")


def downgrade() -> None:
    op.execute("UPDATE countries SET is_active = FALSE WHERE code = 'TZ'")
