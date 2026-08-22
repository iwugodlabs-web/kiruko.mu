"""Bonus provisions table (M23)

Revision ID: bonus_provisions_20260429
Revises: employment_type_20260429
Create Date: 2026-04-29

Tracks the running monthly bonus liability per employee. Each row records
the cumulative accrued bonus through (year, month) for one employee, plus
a JSONB snapshot of the formula that produced it (so a rule supersede
later doesn't retroactively change the historical provision).

The cron `jobs/bonus_provisioning.py` upserts one row per active employee
per month-end. The CFO dashboard reads aggregate liability per company.

Idempotency: UNIQUE (company_id, private_user_id, year, month) so re-runs
of the cron for the same month update in place rather than duplicating.
"""

from alembic import op


revision = 'bonus_provisions_20260429'
down_revision = 'employment_type_20260429'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS bonus_provisions (
            id                 SERIAL PRIMARY KEY,
            company_id         INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
            private_user_id    INTEGER NOT NULL REFERENCES private_users(private_user_id) ON DELETE CASCADE,
            year               INTEGER NOT NULL,
            month              INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
            accrued_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
            formula_snapshot   JSONB NOT NULL DEFAULT '{}'::jsonb,
            bonus_rule_id      INTEGER NULL REFERENCES country_bonus_rules(id) ON DELETE SET NULL,
            ytd_earnings       NUMERIC(14,2) NOT NULL DEFAULT 0,
            created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_bonus_provisions_emp_period UNIQUE (company_id, private_user_id, year, month)
        );

        CREATE INDEX IF NOT EXISTS ix_bonus_provisions_company_year
            ON bonus_provisions (company_id, year);
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS bonus_provisions CASCADE;")
