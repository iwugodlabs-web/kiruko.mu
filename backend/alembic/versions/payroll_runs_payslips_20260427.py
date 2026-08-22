"""Payroll runs + payslips tables

Revision ID: payroll_runs_20260427
Revises: salary_structures_20260427
Create Date: 2026-04-27

A PayrollRun goes draft → finalized. On finalize, country rules are
snapshot into country_rules_snapshot JSONB so historical re-renders of
any payslip reproduce byte-for-byte regardless of later rule supersedes.
"""

from alembic import op


revision = 'payroll_runs_20260427'
down_revision = 'salary_structures_20260427'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS payroll_runs (
            id                       SERIAL PRIMARY KEY,
            company_id               INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
            period_start             DATE NOT NULL,
            period_end               DATE NOT NULL,
            status                   VARCHAR(20) NOT NULL DEFAULT 'draft',
            currency                 VARCHAR(3) NOT NULL DEFAULT 'MUR',
            notes                    VARCHAR,
            country_rules_snapshot   JSONB,
            created_by_user_id       INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
            finalized_at             TIMESTAMPTZ,
            finalized_by_user_id     INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
            created_at               TIMESTAMPTZ DEFAULT now(),
            updated_at               TIMESTAMPTZ DEFAULT now(),
            CONSTRAINT uq_payroll_run_company_period UNIQUE (company_id, period_start, period_end),
            CONSTRAINT chk_payroll_run_status CHECK (status IN ('draft','finalized','cancelled'))
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_payroll_runs_company ON payroll_runs (company_id, period_start DESC)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS payslips (
            id                  SERIAL PRIMARY KEY,
            payroll_run_id      INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
            private_user_id     INTEGER NOT NULL REFERENCES private_users(private_user_id) ON DELETE RESTRICT,
            job_id              INTEGER REFERENCES jobs(job_id) ON DELETE SET NULL,
            gross               NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
            taxable_income      NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
            paye                NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
            bonus               NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
            allowances_total    NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
            deductions_total    NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
            loan_repayments     NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
            leave_impact        NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
            net_pay             NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
            statutory_employee  JSONB,
            statutory_employer  JSONB,
            currency            VARCHAR(3) NOT NULL DEFAULT 'MUR',
            locale              VARCHAR(10),
            components          JSONB,
            pdf_url             VARCHAR,
            hash_sha256         VARCHAR(64),
            created_at          TIMESTAMPTZ DEFAULT now(),
            updated_at          TIMESTAMPTZ DEFAULT now(),
            CONSTRAINT uq_payslip_run_user UNIQUE (payroll_run_id, private_user_id)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_payslips_run ON payslips (payroll_run_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_payslips_user ON payslips (private_user_id, created_at DESC)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS payslips")
    op.execute("DROP TABLE IF EXISTS payroll_runs")
