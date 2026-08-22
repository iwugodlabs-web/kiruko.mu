"""Convert salaries.salary, revenue, allowance from String to Numeric(14,2)

Revision ID: salary_numeric_20260427
Revises: country_payroll_rules_20260427
Create Date: 2026-04-27

The original schema stored salary amounts as VARCHAR — surprising given
they're decimal money values. Every payroll calculation downstream parses
them back to Decimal at read time. This migration moves the columns to
NUMERIC(14, 2) so:

  * Writes coerce strings/numbers to Decimal at the column level.
  * Reads return Decimal directly (no per-call _parse_decimal).
  * Bad data fails loudly at write time instead of silently rounding later.

Cast strategy:
  NULLIF(TRIM(value), '')::numeric(14,2)
The cast will hard-fail on any non-numeric value — intentional, since dirty
data here would corrupt every payslip downstream. A pre-flight check in
production should `SELECT ... WHERE value !~ '^-?[0-9]+(\\.[0-9]+)?$'` first.
"""

from alembic import op


revision = 'salary_numeric_20260427'
down_revision = 'country_payroll_rules_20260427'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE salaries
            ALTER COLUMN salary    TYPE NUMERIC(14, 2)
                USING NULLIF(TRIM(salary), '')::NUMERIC(14, 2),
            ALTER COLUMN revenue   TYPE NUMERIC(14, 2)
                USING NULLIF(TRIM(revenue), '')::NUMERIC(14, 2),
            ALTER COLUMN allowance TYPE NUMERIC(14, 2)
                USING NULLIF(TRIM(allowance), '')::NUMERIC(14, 2)
    """)


def downgrade() -> None:
    # Round-trip back to text. Existing data preserved as decimal strings.
    op.execute("""
        ALTER TABLE salaries
            ALTER COLUMN salary    TYPE VARCHAR USING salary::VARCHAR,
            ALTER COLUMN revenue   TYPE VARCHAR USING revenue::VARCHAR,
            ALTER COLUMN allowance TYPE VARCHAR USING allowance::VARCHAR
    """)
