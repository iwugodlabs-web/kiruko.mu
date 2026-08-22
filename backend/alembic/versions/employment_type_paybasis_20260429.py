"""Employment type, FTE, and pay basis (M20)

Revision ID: employment_type_20260429
Revises: rls_sensitive_20260428
Create Date: 2026-04-29

Adds part-time / hourly / contract support to the payroll engine:

* `private_users.employment_type` — VARCHAR(20), default 'full_time'.
  Allowed values: full_time, part_time, hourly, contract, intern, temp.
  Driven by an application-side check rather than a Postgres ENUM so we
  can grow the list without DDL.
* `private_users.fte` — NUMERIC(4,3), default 1.000. Multiplies monthly
  basis components for part-timers (0.500 = half-time).
* `salaries.pay_basis` — VARCHAR(10), default 'monthly'. Controls how the
  payroll engine computes basic pay:
    monthly  → use resolved structure components × FTE × proration factor
    hourly   → sum(time_logs.hours_worked in period) × hourly_rate
    daily    → working_days × daily_rate (Phase 2 — engine accepts the
               column today but currently treats daily the same as monthly)
* `salaries.hourly_rate` — NUMERIC(10,2) NULL. Required when pay_basis='hourly'.
* `salaries.daily_rate`  — NUMERIC(10,2) NULL. Required when pay_basis='daily'.
* `jobs.end_date` — DATE NULL. Termination date for joiner/leaver pro-rata.
* `jobs.termination_reason` — VARCHAR NULL.

Backfill: existing rows get sensible defaults (full_time, fte=1.000,
pay_basis='monthly'). No data interpretation is required because all
payroll computations through M19 implicitly assumed full-time monthly.
"""

from alembic import op


revision = 'employment_type_20260429'
down_revision = 'rls_sensitive_20260428'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE private_users
            ADD COLUMN IF NOT EXISTS employment_type VARCHAR(20) NOT NULL DEFAULT 'full_time',
            ADD COLUMN IF NOT EXISTS fte             NUMERIC(4,3) NOT NULL DEFAULT 1.000;

        ALTER TABLE salaries
            ADD COLUMN IF NOT EXISTS pay_basis  VARCHAR(10)  NOT NULL DEFAULT 'monthly',
            ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(10,2) NULL,
            ADD COLUMN IF NOT EXISTS daily_rate  NUMERIC(10,2) NULL;

        ALTER TABLE jobs
            ADD COLUMN IF NOT EXISTS end_date          DATE        NULL,
            ADD COLUMN IF NOT EXISTS termination_reason VARCHAR     NULL;

        -- Application-level CHECK to guard the enumerated values without
        -- locking us into a Postgres ENUM type for future additions.
        ALTER TABLE private_users
            ADD CONSTRAINT ck_private_users_employment_type
                CHECK (employment_type IN ('full_time','part_time','hourly','contract','intern','temp'));

        ALTER TABLE private_users
            ADD CONSTRAINT ck_private_users_fte_range
                CHECK (fte > 0 AND fte <= 1.000);

        ALTER TABLE salaries
            ADD CONSTRAINT ck_salaries_pay_basis
                CHECK (pay_basis IN ('monthly','daily','hourly'));

        -- Hourly basis requires hourly_rate; daily requires daily_rate.
        ALTER TABLE salaries
            ADD CONSTRAINT ck_salaries_hourly_rate_present
                CHECK (pay_basis <> 'hourly' OR hourly_rate IS NOT NULL);

        ALTER TABLE salaries
            ADD CONSTRAINT ck_salaries_daily_rate_present
                CHECK (pay_basis <> 'daily' OR daily_rate IS NOT NULL);
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE salaries
            DROP CONSTRAINT IF EXISTS ck_salaries_daily_rate_present,
            DROP CONSTRAINT IF EXISTS ck_salaries_hourly_rate_present,
            DROP CONSTRAINT IF EXISTS ck_salaries_pay_basis;

        ALTER TABLE private_users
            DROP CONSTRAINT IF EXISTS ck_private_users_fte_range,
            DROP CONSTRAINT IF EXISTS ck_private_users_employment_type;

        ALTER TABLE jobs
            DROP COLUMN IF EXISTS termination_reason,
            DROP COLUMN IF EXISTS end_date;

        ALTER TABLE salaries
            DROP COLUMN IF EXISTS daily_rate,
            DROP COLUMN IF EXISTS hourly_rate,
            DROP COLUMN IF EXISTS pay_basis;

        ALTER TABLE private_users
            DROP COLUMN IF EXISTS fte,
            DROP COLUMN IF EXISTS employment_type;
    """)
