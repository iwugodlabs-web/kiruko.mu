"""Payroll calendars (M24)

Revision ID: payroll_calendars_20260429
Revises: bonus_provisions_20260429
Create Date: 2026-04-29

Country-level period configuration. Today the engine assumes monthly
periods aligned to calendar months, but this table makes that explicit
and gives us a place to record period-close + statutory-filing
deadlines per country.

The immediate use is M24 enforcement: create_draft_run rejects out-of-
order period creation. The deadline columns aren't enforced yet —
they're informational for now and will surface in the dashboard
later.

Like other rule tables, it's append-only with effective_from /
effective_to so an "as-of" lookup picks the right calendar even after
a country switches period type (e.g. moves from monthly to biweekly).

Mauritius gets a single seed row: monthly period_type, period closes
end of calendar month, statutory PAYE/CSG/NSF filing deadline = 20th
of the following month (typical MRA deadline; verify with consultant
before relying on it for warnings).
"""

from alembic import op


revision = 'payroll_calendars_20260429'
down_revision = 'bonus_provisions_20260429'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        -- M5b's ALTER DEFAULT PRIVILEGES didn't propagate to tables created by
        -- subsequent migrations on this DB, so grants for the kontokaz_app role
        -- need to be issued explicitly per new table. Idempotent if already granted.
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kontokaz_app') THEN
                GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE bonus_provisions TO kontokaz_app;
            END IF;
        END $$;
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS payroll_calendars (
            id                            SERIAL PRIMARY KEY,
            country_code                  VARCHAR(2) NOT NULL REFERENCES countries(code),
            period_type                   VARCHAR(20) NOT NULL DEFAULT 'monthly'
                CHECK (period_type IN ('monthly','biweekly','weekly')),
            period_close_day              INTEGER NOT NULL DEFAULT 31
                CHECK (period_close_day BETWEEN 1 AND 31),
            statutory_filing_deadline_day INTEGER NULL
                CHECK (statutory_filing_deadline_day IS NULL OR statutory_filing_deadline_day BETWEEN 1 AND 31),
            effective_from                DATE NOT NULL,
            effective_to                  DATE NULL,
            notes                         VARCHAR NULL,
            created_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS ix_payroll_calendars_country_effective
            ON payroll_calendars (country_code, effective_from);

        -- MU seed: monthly periods, end-of-month close, MRA filing deadline
        -- approximated to the 20th of the next month. Verify before relying
        -- on the deadline for any binding alerting.
        INSERT INTO payroll_calendars
            (country_code, period_type, period_close_day,
             statutory_filing_deadline_day, effective_from, notes)
        VALUES
            ('MU', 'monthly', 31, 20, '2024-01-01',
             'Seed — verify MRA filing deadline with HR consultant before relying on it.')
        ON CONFLICT DO NOTHING;
    """)

    # Grant the kontokaz_app role access to this new table (RLS bypass NOT
    # granted — this role still respects RLS policies).
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kontokaz_app') THEN
                GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE payroll_calendars TO kontokaz_app;
            END IF;
        END $$;
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS payroll_calendars CASCADE;")
