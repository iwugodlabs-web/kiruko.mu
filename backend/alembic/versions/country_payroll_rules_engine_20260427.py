"""Country payroll rules engine: companies.country_code + temporal rule tables

Revision ID: country_payroll_rules_20260427
Revises: add_allowance_20260416
Create Date: 2026-04-27

Foundation for the country-configurable payroll rules engine.

Adds:
  * companies.country_code (FK -> countries.code, NOT NULL, default 'MU')
  * tax_bracket_sets + tax_brackets (versioned PAYE bracket sets)
  * statutory_deductions (versioned CSG/NSF/etc. rates)
  * country_leave_defaults (versioned statutory leave entitlements)
  * country_bonus_rules (versioned 13th-month / EOY gratuity rules)
  * Postgres trigger forbidding UPDATE on rule rows except for
    effective_to and superseded_by_id (closing a row to insert its successor).

The four rule tables follow an append-only temporal pattern: rule changes
insert a new row + close the prior row in one transaction. Resolving rules
for a payroll period uses effective_from/effective_to range queries.
"""

from alembic import op
import sqlalchemy as sa


revision = 'country_payroll_rules_20260427'
down_revision = 'add_allowance_20260416'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 0. Ensure the base MU country row exists.
    #
    # Every table introduced below FKs to countries(code), and the later
    # payroll_calendars migration INSERTs a row for 'MU'. On a fresh DB
    # (e.g. a first DO deploy) `alembic upgrade head` runs before any
    # runtime seeder, so without this the payroll_calendars seed hits a
    # foreign-key violation and aborts the whole upgrade. Idempotent.
    # ------------------------------------------------------------------
    op.execute("""
        INSERT INTO countries (code, name, currency, locale, fiscal_year_start, date_format, is_active)
        VALUES ('MU', 'Mauritius', 'MUR', 'en-MU', '07-01', 'DD/MM/YYYY', TRUE)
        ON CONFLICT (code) DO NOTHING
    """)

    # ------------------------------------------------------------------
    # 1. Bind companies to countries explicitly.
    # ------------------------------------------------------------------
    op.execute("""
        ALTER TABLE companies
        ADD COLUMN IF NOT EXISTS country_code VARCHAR(2)
    """)
    op.execute("UPDATE companies SET country_code = 'MU' WHERE country_code IS NULL")
    op.execute("ALTER TABLE companies ALTER COLUMN country_code SET NOT NULL")
    op.execute("ALTER TABLE companies ALTER COLUMN country_code SET DEFAULT 'MU'")
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'fk_companies_country_code'
            ) THEN
                ALTER TABLE companies
                ADD CONSTRAINT fk_companies_country_code
                FOREIGN KEY (country_code) REFERENCES countries(code);
            END IF;
        END $$
    """)

    # ------------------------------------------------------------------
    # 2. Tax bracket sets (versioned parent) + bracket lines (children).
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS tax_bracket_sets (
            id                  SERIAL PRIMARY KEY,
            country_code        VARCHAR(2) NOT NULL REFERENCES countries(code),
            fiscal_year         INTEGER NOT NULL,
            label               VARCHAR(100),
            effective_from      DATE NOT NULL,
            effective_to        DATE,
            superseded_by_id    INTEGER REFERENCES tax_bracket_sets(id),
            version             INTEGER NOT NULL DEFAULT 1,
            source_reference    VARCHAR,
            change_reason       VARCHAR,
            created_by_user_id  INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
            created_at          TIMESTAMPTZ DEFAULT now()
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_tax_bracket_sets_country_effective
        ON tax_bracket_sets (country_code, effective_from DESC)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_tax_bracket_sets_active
        ON tax_bracket_sets (country_code) WHERE effective_to IS NULL
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS tax_brackets (
            id              SERIAL PRIMARY KEY,
            bracket_set_id  INTEGER NOT NULL REFERENCES tax_bracket_sets(id) ON DELETE CASCADE,
            order_index     INTEGER NOT NULL,
            lower_bound     NUMERIC(14, 2) NOT NULL,
            upper_bound     NUMERIC(14, 2),
            rate            NUMERIC(7, 5) NOT NULL,
            description     VARCHAR
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_tax_brackets_set
        ON tax_brackets (bracket_set_id, order_index)
    """)

    # ------------------------------------------------------------------
    # 3. Statutory deductions (CSG, NSF, NPF, etc.).
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS statutory_deductions (
            id                    SERIAL PRIMARY KEY,
            country_code          VARCHAR(2) NOT NULL REFERENCES countries(code),
            code                  VARCHAR(40) NOT NULL,
            label                 VARCHAR(100) NOT NULL,
            rate                  NUMERIC(7, 5) NOT NULL,
            threshold_low         NUMERIC(14, 2),
            threshold_high        NUMERIC(14, 2),
            taxable_base          VARCHAR(20) NOT NULL DEFAULT 'gross',
            employer_or_employee  VARCHAR(20) NOT NULL,
            effective_from        DATE NOT NULL,
            effective_to          DATE,
            superseded_by_id      INTEGER REFERENCES statutory_deductions(id),
            version               INTEGER NOT NULL DEFAULT 1,
            source_reference      VARCHAR,
            change_reason         VARCHAR,
            created_by_user_id    INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
            created_at            TIMESTAMPTZ DEFAULT now()
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_statutory_deductions_country_code_effective
        ON statutory_deductions (country_code, code, effective_from DESC)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_statutory_deductions_active
        ON statutory_deductions (country_code, code) WHERE effective_to IS NULL
    """)

    # ------------------------------------------------------------------
    # 4. Country leave defaults.
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS country_leave_defaults (
            id                    SERIAL PRIMARY KEY,
            country_code          VARCHAR(2) NOT NULL REFERENCES countries(code),
            leave_type_code       VARCHAR(40) NOT NULL,
            label                 VARCHAR(100) NOT NULL,
            days_per_year         INTEGER NOT NULL,
            accrual_method        VARCHAR(20) NOT NULL DEFAULT 'annual',
            carry_forward_max     INTEGER,
            encashable            BOOLEAN NOT NULL DEFAULT false,
            min_service_months    INTEGER NOT NULL DEFAULT 0,
            effective_from        DATE NOT NULL,
            effective_to          DATE,
            superseded_by_id      INTEGER REFERENCES country_leave_defaults(id),
            version               INTEGER NOT NULL DEFAULT 1,
            source_reference      VARCHAR,
            change_reason         VARCHAR,
            created_by_user_id    INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
            created_at            TIMESTAMPTZ DEFAULT now()
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_country_leave_defaults_country_type_effective
        ON country_leave_defaults (country_code, leave_type_code, effective_from DESC)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_country_leave_defaults_active
        ON country_leave_defaults (country_code, leave_type_code) WHERE effective_to IS NULL
    """)

    # ------------------------------------------------------------------
    # 5. Country bonus rules.
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS country_bonus_rules (
            id                              SERIAL PRIMARY KEY,
            country_code                    VARCHAR(2) NOT NULL REFERENCES countries(code),
            bonus_code                      VARCHAR(40) NOT NULL,
            label                           VARCHAR(100) NOT NULL,
            formula                         VARCHAR(40) NOT NULL,
            eligibility_min_service_months  INTEGER NOT NULL DEFAULT 0,
            payable_month                   INTEGER NOT NULL,
            prorate_on_partial_year         BOOLEAN NOT NULL DEFAULT true,
            taxable                         BOOLEAN NOT NULL DEFAULT true,
            fixed_amount                    NUMERIC(14, 2),
            rate                            NUMERIC(7, 5),
            effective_from                  DATE NOT NULL,
            effective_to                    DATE,
            superseded_by_id                INTEGER REFERENCES country_bonus_rules(id),
            version                         INTEGER NOT NULL DEFAULT 1,
            source_reference                VARCHAR,
            change_reason                   VARCHAR,
            created_by_user_id              INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
            created_at                      TIMESTAMPTZ DEFAULT now()
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_country_bonus_rules_country_code_effective
        ON country_bonus_rules (country_code, bonus_code, effective_from DESC)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_country_bonus_rules_active
        ON country_bonus_rules (country_code, bonus_code) WHERE effective_to IS NULL
    """)

    # ------------------------------------------------------------------
    # 6. Append-only enforcement.
    #
    # The supersede() service is the only legitimate writer; it does:
    #   1. INSERT new row
    #   2. UPDATE prior row SET effective_to = X, superseded_by_id = new.id
    # This trigger lets (2) through and rejects everything else.
    # ------------------------------------------------------------------
    op.execute("""
        CREATE OR REPLACE FUNCTION forbid_rule_mutation()
        RETURNS TRIGGER AS $$
        DECLARE
            old_masked JSONB;
            new_masked JSONB;
        BEGIN
            old_masked := to_jsonb(OLD) - 'effective_to' - 'superseded_by_id';
            new_masked := to_jsonb(NEW) - 'effective_to' - 'superseded_by_id';
            IF old_masked IS DISTINCT FROM new_masked THEN
                RAISE EXCEPTION 'Rule rows are append-only: only effective_to and superseded_by_id may be updated on table %', TG_TABLE_NAME
                USING ERRCODE = 'check_violation';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    """)

    for table in (
        "tax_bracket_sets",
        "statutory_deductions",
        "country_leave_defaults",
        "country_bonus_rules",
    ):
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_forbid_mutation ON {table}")
        op.execute(f"""
            CREATE TRIGGER trg_{table}_forbid_mutation
            BEFORE UPDATE ON {table}
            FOR EACH ROW EXECUTE FUNCTION forbid_rule_mutation()
        """)


def downgrade() -> None:
    for table in (
        "tax_bracket_sets",
        "statutory_deductions",
        "country_leave_defaults",
        "country_bonus_rules",
    ):
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_forbid_mutation ON {table}")

    op.execute("DROP FUNCTION IF EXISTS forbid_rule_mutation()")

    op.execute("DROP TABLE IF EXISTS country_bonus_rules")
    op.execute("DROP TABLE IF EXISTS country_leave_defaults")
    op.execute("DROP TABLE IF EXISTS statutory_deductions")
    op.execute("DROP TABLE IF EXISTS tax_brackets")
    op.execute("DROP TABLE IF EXISTS tax_bracket_sets")

    op.execute("ALTER TABLE companies DROP CONSTRAINT IF EXISTS fk_companies_country_code")
    op.execute("ALTER TABLE companies DROP COLUMN IF EXISTS country_code")
