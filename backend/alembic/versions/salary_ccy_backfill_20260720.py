"""Backfill salaries.currency from each employee's effective country.

Historically create_salary never set currency (fell to the model default 'MUR')
and the mobile client hardcoded 'MUR', so every salary was stored MUR regardless
of country — a Tanzania company's salaries showed MUR on payslips. Forward writes
are now server-authoritative (crud/job.resolve_salary_currency); this migration
corrects the rows already in the table.

Effective country mirrors PrivateUser.effective_country_code for the cases that
exist in data: company employees inherit the company's country_code; independents
use their own country_code; fall back to 'MU'. (The phone-calling-code inference
in the Python property isn't reproduced in SQL — it only matters for independents
with no country_code, who don't have payroll salaries.)

Idempotent: only rewrites rows whose stored currency differs from the resolved one.

Revision ID: salary_ccy_backfill_20260720
Revises: tanzania_holidays_2026_20260718
Create Date: 2026-07-20
"""
from alembic import op


revision = "salary_ccy_backfill_20260720"
down_revision = "tanzania_holidays_2026_20260718"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE salaries s
        SET currency = c.currency,
            updated_at = now()
        FROM jobs j
        JOIN private_users pu ON pu.private_user_id = j.private_user_id
        JOIN countries c ON c.code = COALESCE(
            (SELECT co.country_code FROM companies co WHERE co.company_id = pu.company_id),
            pu.country_code,
            'MU'
        )
        WHERE s.job_id = j.job_id
          AND s.currency IS DISTINCT FROM c.currency
        """
    )


def downgrade() -> None:
    # No-op: the previous per-row values were an incorrect default ('MUR') and
    # can't be meaningfully restored. Leaving the corrected currencies in place.
    pass
