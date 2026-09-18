"""add country_code to company_holiday_rates (holiday country scoping)

Revision ID: company_holiday_country_20260918
Revises: company_auto_approve_20260917
Create Date: 2026-09-18

company_holiday_rates had no country column, so a company that imported one
country's public holidays and later another's ended up with a mixed calendar
(e.g. Mauritius holidays showing for a Tanzania company). This adds
country_code and backfills every existing row to its owning company's
country_code. Going forward the list is filtered by country and imports replace
per country+year, so the mix can't recur. The backfill assumes existing rows
belong to the company's current country — pre-existing mixed rows are cleaned
when the admin re-imports (replace-on-import) for the correct country.
"""
from alembic import op
import sqlalchemy as sa


revision = "company_holiday_country_20260918"
down_revision = "company_auto_approve_20260917"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "company_holiday_rates",
        sa.Column("country_code", sa.String(length=2), nullable=True),
    )
    # Backfill each row to its owning company's country.
    op.execute(
        """
        UPDATE company_holiday_rates chr
        SET country_code = c.country_code
        FROM companies c
        WHERE chr.company_id = c.company_id
          AND chr.country_code IS NULL
        """
    )
    op.create_index(
        "ix_company_holiday_rates_country_code",
        "company_holiday_rates",
        ["country_code"],
    )
    op.create_foreign_key(
        "fk_company_holiday_rates_country_code",
        "company_holiday_rates",
        "countries",
        ["country_code"],
        ["code"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_company_holiday_rates_country_code",
        "company_holiday_rates",
        type_="foreignkey",
    )
    op.drop_index(
        "ix_company_holiday_rates_country_code",
        table_name="company_holiday_rates",
    )
    op.drop_column("company_holiday_rates", "country_code")
