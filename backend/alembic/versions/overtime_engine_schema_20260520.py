"""Overtime engine schema (M1): country rules + tiers, holiday observed_date,
job overtime fields, payroll_run compute_version, company timezone.

Revision ID: overtime_engine_schema_20260520
Revises: purchase_receipt_image_20260520
Create Date: 2026-05-20

Foundation for the bucketed-overtime + premium-pay engine described in
backend/OVERTIME.md (M1 milestone).

Adds:
  * `country_overtime_rules` + `country_overtime_weekday_tiers` (temporal,
    append-only, same `forbid_rule_mutation` trigger as the rest of the
    rules engine).
  * `jobs.overtime_eligibility` (`HOURLY` | `MONTHLY_ELIGIBLE` | `EXEMPT`),
    `jobs.weekly_rest_day_dow` (ISO 1–7), `jobs.contracted_hours_per_week`.
  * `public_holidays.observed_date` (NULL → `date`) for the MU
    Sun-to-Mon substitution custom.
  * `payroll_runs.compute_version` (1 = legacy, 2 = bucketed engine),
    `company_overrides_snapshot` JSONB, `compliance_flags` JSONB.
  * `companies.timezone` (IANA name, default Indian/Mauritius).

No behavior change in this migration — schema only. M2 wires the
resolver; M3 + M4 wire compute.
"""

from alembic import op


revision = 'overtime_engine_schema_20260520'
down_revision = 'purchase_receipt_image_20260520'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. country_overtime_rules — temporal, append-only.
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS country_overtime_rules (
            id                                      SERIAL PRIMARY KEY,
            country_code                            VARCHAR(2) NOT NULL REFERENCES countries(code),

            -- Temporal
            effective_from                          DATE NOT NULL,
            effective_to                            DATE,
            version                                 INTEGER NOT NULL DEFAULT 1,
            superseded_by_id                        INTEGER REFERENCES country_overtime_rules(id),
            created_by_user_id                      INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
            created_at                              TIMESTAMPTZ DEFAULT now(),
            source_reference                        VARCHAR,
            change_reason                           VARCHAR,
            notes                                   TEXT,

            -- Thresholds
            weekly_threshold_h                      NUMERIC(5, 2) NOT NULL,
            daily_threshold_h                       NUMERIC(5, 2),

            -- Rest-day multiplier (replaces base rate on worker's weekly rest day)
            rest_day_multiplier                     NUMERIC(3, 2) NOT NULL,

            -- Public-holiday multipliers (MU splits during/after normal hours)
            public_holiday_normal_hours_multiplier  NUMERIC(3, 2) NOT NULL,
            public_holiday_after_hours_multiplier   NUMERIC(3, 2) NOT NULL,

            -- Night window + multiplier (NULL when not statutory at country level)
            night_start                             TIME,
            night_end                               TIME,
            night_multiplier_habitual               NUMERIC(3, 2),
            night_multiplier_occasional             NUMERIC(3, 2),
            night_mode                              VARCHAR(10),   -- 'ADDITIVE' | 'REPLACE' | NULL

            -- Caps — emit compliance_flags when exceeded
            weekly_ot_soft_cap_h                    NUMERIC(5, 2),
            weekly_total_max_h                      NUMERIC(5, 2),

            -- Above this monthly basic, OT is not owed (MU WRR salary cap)
            monthly_basic_ot_cap                    NUMERIC(12, 2),

            -- Stacking rules
            stack_holiday_on_rest_day               VARCHAR(10) NOT NULL DEFAULT 'MAX',
            stack_night_on_premium                  VARCHAR(10) NOT NULL DEFAULT 'NO_STACK',

            -- Week start (ISO Mon=1)
            week_start_dow                          SMALLINT NOT NULL DEFAULT 1,

            CONSTRAINT chk_ot_rule_night_mode CHECK (night_mode IS NULL OR night_mode IN ('ADDITIVE', 'REPLACE')),
            CONSTRAINT chk_ot_rule_stack_holiday CHECK (stack_holiday_on_rest_day IN ('MAX', 'ADD')),
            CONSTRAINT chk_ot_rule_stack_night CHECK (stack_night_on_premium IN ('NO_STACK', 'STACK')),
            CONSTRAINT chk_ot_rule_multipliers CHECK (
                rest_day_multiplier >= 1.00
                AND public_holiday_normal_hours_multiplier >= 1.00
                AND public_holiday_after_hours_multiplier >= 1.00
            )
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_country_overtime_rules_country_effective
        ON country_overtime_rules (country_code, effective_from DESC)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_country_overtime_rules_active
        ON country_overtime_rules (country_code) WHERE effective_to IS NULL
    """)

    # ------------------------------------------------------------------
    # 2. country_overtime_weekday_tiers — child of country_overtime_rules.
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS country_overtime_weekday_tiers (
            id                  SERIAL PRIMARY KEY,
            overtime_rule_id    INTEGER NOT NULL REFERENCES country_overtime_rules(id) ON DELETE CASCADE,
            tier_order          SMALLINT NOT NULL,
            up_to_hours         NUMERIC(5, 2),                       -- NULL = "and beyond"
            multiplier          NUMERIC(3, 2) NOT NULL,
            CONSTRAINT chk_tier_multiplier CHECK (multiplier >= 1.00),
            CONSTRAINT chk_tier_order CHECK (tier_order >= 1),
            UNIQUE (overtime_rule_id, tier_order)
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_overtime_tiers_rule
        ON country_overtime_weekday_tiers (overtime_rule_id, tier_order)
    """)

    # ------------------------------------------------------------------
    # 3. Append-only enforcement on both new rule tables.
    #
    # forbid_rule_mutation() originated in country_payroll_rules_engine_20260427.
    # Recreate defensively with CREATE OR REPLACE so this migration is idempotent
    # against DBs where the function was dropped or where that migration never
    # applied cleanly (caught in dev where the function was missing).
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

    for table in ("country_overtime_rules", "country_overtime_weekday_tiers"):
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_forbid_mutation ON {table}")
        op.execute(f"""
            CREATE TRIGGER trg_{table}_forbid_mutation
            BEFORE UPDATE ON {table}
            FOR EACH ROW EXECUTE FUNCTION forbid_rule_mutation()
        """)

    # ------------------------------------------------------------------
    # 4. jobs — overtime_eligibility, weekly_rest_day_dow, contracted_hours_per_week.
    # ------------------------------------------------------------------
    op.execute("""
        ALTER TABLE jobs
            ADD COLUMN IF NOT EXISTS overtime_eligibility VARCHAR(20) NOT NULL DEFAULT 'HOURLY',
            ADD COLUMN IF NOT EXISTS weekly_rest_day_dow SMALLINT NOT NULL DEFAULT 7,
            ADD COLUMN IF NOT EXISTS contracted_hours_per_week NUMERIC(5, 2)
    """)
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_jobs_overtime_eligibility') THEN
                ALTER TABLE jobs ADD CONSTRAINT chk_jobs_overtime_eligibility
                CHECK (overtime_eligibility IN ('HOURLY', 'MONTHLY_ELIGIBLE', 'EXEMPT'));
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_jobs_rest_day_dow') THEN
                ALTER TABLE jobs ADD CONSTRAINT chk_jobs_rest_day_dow
                CHECK (weekly_rest_day_dow BETWEEN 1 AND 7);
            END IF;
        END $$
    """)

    # ------------------------------------------------------------------
    # 5. public_holidays.observed_date — for MU Sunday→Monday substitution.
    # ------------------------------------------------------------------
    op.execute("""
        ALTER TABLE public_holidays
            ADD COLUMN IF NOT EXISTS observed_date DATE
    """)
    # Backfill so existing rows have observed_date = date
    op.execute("""
        UPDATE public_holidays SET observed_date = date WHERE observed_date IS NULL
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_public_holidays_country_observed
        ON public_holidays (country_code, observed_date)
    """)

    # ------------------------------------------------------------------
    # 6. payroll_runs — compute_version, company_overrides_snapshot, compliance_flags.
    # ------------------------------------------------------------------
    op.execute("""
        ALTER TABLE payroll_runs
            ADD COLUMN IF NOT EXISTS compute_version SMALLINT NOT NULL DEFAULT 1,
            ADD COLUMN IF NOT EXISTS company_overrides_snapshot JSONB,
            ADD COLUMN IF NOT EXISTS compliance_flags JSONB NOT NULL DEFAULT '[]'::jsonb
    """)

    # ------------------------------------------------------------------
    # 7. companies.timezone — IANA name; default Indian/Mauritius for MU launch.
    # ------------------------------------------------------------------
    op.execute("""
        ALTER TABLE companies
            ADD COLUMN IF NOT EXISTS timezone VARCHAR(60) NOT NULL DEFAULT 'Indian/Mauritius'
    """)


def downgrade() -> None:
    # Drop triggers + child table first
    for table in ("country_overtime_weekday_tiers", "country_overtime_rules"):
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_forbid_mutation ON {table}")

    op.execute("DROP TABLE IF EXISTS country_overtime_weekday_tiers")
    op.execute("DROP TABLE IF EXISTS country_overtime_rules")

    # Drop columns on existing tables
    op.execute("ALTER TABLE jobs DROP CONSTRAINT IF EXISTS chk_jobs_overtime_eligibility")
    op.execute("ALTER TABLE jobs DROP CONSTRAINT IF EXISTS chk_jobs_rest_day_dow")
    op.execute("""
        ALTER TABLE jobs
            DROP COLUMN IF EXISTS overtime_eligibility,
            DROP COLUMN IF EXISTS weekly_rest_day_dow,
            DROP COLUMN IF EXISTS contracted_hours_per_week
    """)

    op.execute("ALTER TABLE public_holidays DROP COLUMN IF EXISTS observed_date")

    op.execute("""
        ALTER TABLE payroll_runs
            DROP COLUMN IF EXISTS compute_version,
            DROP COLUMN IF EXISTS company_overrides_snapshot,
            DROP COLUMN IF EXISTS compliance_flags
    """)

    op.execute("ALTER TABLE companies DROP COLUMN IF EXISTS timezone")
