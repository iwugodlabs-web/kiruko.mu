"""Repair: ensure salaries.salary/revenue/allowance are NUMERIC(14,2)

Revision ID: salaries_numeric_repair_20260521
Revises: company_lifecycle_20260521
Create Date: 2026-05-21

Deployments built from the squash baseline (0001_squash_baseline.py) created
salaries.salary / revenue / allowance as VARCHAR and were stamped forward, so
the original conversion (salary_numeric_20260427) was recorded as applied but
never actually ran. The ORM maps these columns as Numeric(14,2), so any query
that loads a Salary row (e.g. login -> get_user_by_email) crashes with
"Unknown PG numeric type: 1043" (1043 = varchar OID).

This migration converts each column to NUMERIC(14,2) only if it's still a
character type, so it's a no-op on already-correct databases. The cast is
TOLERANT — non-numeric junk and blanks become NULL rather than hard-failing —
because this runs on auto-deploy and a hard cast that errors would wedge every
future migration. Values written by the app are plain numeric strings; the
only rows that null out are ones that were already unusable as money.
"""
from alembic import op


revision = 'salaries_numeric_repair_20260521'
down_revision = 'company_lifecycle_20260521'
branch_labels = None
depends_on = None

_COLUMNS = ('salary', 'revenue', 'allowance')


def upgrade() -> None:
    for col in _COLUMNS:
        op.execute(f"""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'salaries'
                  AND column_name = '{col}'
                  AND data_type IN ('character varying', 'character', 'text')
            ) THEN
                EXECUTE $cast$
                    ALTER TABLE salaries
                        ALTER COLUMN {col} TYPE NUMERIC(14, 2)
                        USING (
                            CASE
                                WHEN btrim({col}::text) ~ '^-?[0-9]+(\\.[0-9]+)?$'
                                    THEN btrim({col}::text)::NUMERIC(14, 2)
                                ELSE NULL
                            END
                        )
                $cast$;
            END IF;
        END $$;
        """)


def downgrade() -> None:
    for col in _COLUMNS:
        op.execute(f"""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'salaries'
                  AND column_name = '{col}'
                  AND data_type = 'numeric'
            ) THEN
                EXECUTE 'ALTER TABLE salaries ALTER COLUMN {col} TYPE VARCHAR USING {col}::VARCHAR';
            END IF;
        END $$;
        """)
