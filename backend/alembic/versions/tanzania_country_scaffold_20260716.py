"""Tanzania (TZ) country scaffolding — M0 of TZ onboarding

Revision ID: tanzania_scaffold_20260716
Revises: salary_comp_freq_20260710
Create Date: 2026-07-16

Adds the plumbing needed to create a TZ-country company WITHOUT seeding any
real statutory rate — that's M2 of doc/TANZANIA-ONBOARDING-PLAN.md, gated on
sourcing authoritative Tanzanian PAYE/NSSF/SDL/WCF figures. This migration
only adds:

  * countries.default_timezone — so a company's timezone can be derived from
    its country at creation time instead of every company silently getting
    'Indian/Mauritius' regardless of country_code (companies.timezone's DB
    default). Backfills MU's own default_timezone for consistency.
  * A TZ row in countries, with is_active=FALSE and fiscal_year_start/
    min_wage left NULL — those are compliance-sensitive facts (PAYE
    cumulative-year math reads fiscal_year_start; the compliance dashboard
    reads min_wage) that must come from a sourced authority, not a guess.
    is_active=FALSE is a documentation signal for now (nothing reads it
    yet) marking TZ as "exists, not yet ready for real customers".
"""

from alembic import op
import sqlalchemy as sa


revision = 'tanzania_scaffold_20260716'
down_revision = 'salary_comp_freq_20260710'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE countries
        ADD COLUMN IF NOT EXISTS default_timezone VARCHAR(60)
    """)
    op.execute("""
        UPDATE countries SET default_timezone = 'Indian/Mauritius'
        WHERE code = 'MU' AND default_timezone IS NULL
    """)
    op.execute("""
        INSERT INTO countries (code, name, currency, locale, date_format, default_timezone, is_active)
        VALUES ('TZ', 'Tanzania', 'TZS', 'sw-TZ', 'DD/MM/YYYY', 'Africa/Dar_es_Salaam', FALSE)
        ON CONFLICT (code) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("DELETE FROM countries WHERE code = 'TZ'")
    op.execute("ALTER TABLE countries DROP COLUMN IF EXISTS default_timezone")
