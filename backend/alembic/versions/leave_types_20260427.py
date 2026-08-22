"""leave_types catalog + nullable leave_type_id FKs on leaves and leave_quotas

Revision ID: leave_types_20260427
Revises: payroll_runs_20260427
Create Date: 2026-04-27

The legacy `leaves.leave_type` and `leave_quotas.leave_type` string columns
are intentionally retained — the new FK columns are nullable and coexist
during transition. New leave applications should populate leave_type_id;
legacy rows continue to use the string column.
"""

from alembic import op


revision = 'leave_types_20260427'
down_revision = 'payroll_runs_20260427'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS leave_types (
            id                              SERIAL PRIMARY KEY,
            company_id                      INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
            code                            VARCHAR(40) NOT NULL,
            label                           VARCHAR(100) NOT NULL,
            is_paid                         BOOLEAN NOT NULL DEFAULT true,
            is_statutory                    BOOLEAN NOT NULL DEFAULT false,
            accrual_method                  VARCHAR(20) NOT NULL DEFAULT 'annual',
            accrual_rate_days_per_month     NUMERIC(5, 3),
            days_per_year                   INTEGER,
            max_balance                     INTEGER,
            carry_forward_max               INTEGER,
            encashable                      BOOLEAN NOT NULL DEFAULT false,
            min_service_months              INTEGER NOT NULL DEFAULT 0,
            requires_doc                    BOOLEAN NOT NULL DEFAULT false,
            country_default_id              INTEGER REFERENCES country_leave_defaults(id) ON DELETE SET NULL,
            is_active                       BOOLEAN NOT NULL DEFAULT true,
            created_at                      TIMESTAMPTZ DEFAULT now(),
            updated_at                      TIMESTAMPTZ DEFAULT now(),
            CONSTRAINT uq_leave_type_company_code UNIQUE (company_id, code),
            CONSTRAINT chk_leave_type_accrual_method CHECK (accrual_method IN ('monthly','annual','tenure_based'))
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_leave_types_company ON leave_types (company_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_leave_types_active ON leave_types (company_id) WHERE is_active = true")

    op.execute("""
        ALTER TABLE leaves
            ADD COLUMN IF NOT EXISTS leave_type_id INTEGER REFERENCES leave_types(id) ON DELETE SET NULL
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_leaves_leave_type_id ON leaves (leave_type_id)")

    op.execute("""
        ALTER TABLE leave_quotas
            ADD COLUMN IF NOT EXISTS leave_type_id INTEGER REFERENCES leave_types(id) ON DELETE SET NULL
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_leave_quotas_leave_type_id ON leave_quotas (leave_type_id)")


def downgrade() -> None:
    op.execute("ALTER TABLE leave_quotas DROP COLUMN IF EXISTS leave_type_id")
    op.execute("ALTER TABLE leaves DROP COLUMN IF EXISTS leave_type_id")
    op.execute("DROP TABLE IF EXISTS leave_types")
