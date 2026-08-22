"""RLS: actually apply tenant isolation to April's sensitive tables.

rls_sensitive_tables_20260428 was supposed to denormalize company_id + enable RLS
on the 9 sensitive tables, but on a FRESH database its effects are absent — the
columns and policies don't exist (likely a later migration recreated the tables,
dropping them). Result: the MOST sensitive tables (payslips, salaries, PII in
private_users, documents) have NO row-level protection. This migration re-applies
it at HEAD (idempotent) so it can't be undone by anything earlier.

  * direct company_id (policy only): payroll_runs, private_users
  * denormalized (add company_id + backfill + BEFORE-INSERT trigger + policy):
    payslips, salaries, employee_salary_assignments, employee_salary_overrides,
    employee_one_off_allowances, document_vault, leave_quotas

Policy = April's convention (permissive when app.company_id unset, '*' bypass,
TEXT match). FORCE RLS so the table owner is subject too.

Revision ID: rls_april_tables_fix_20260624
Revises: rls_grant_kiruko_app_20260624
"""
from alembic import op


revision = "rls_april_tables_fix_20260624"
down_revision = "rls_grant_kiruko_app_20260624"
branch_labels = None
depends_on = None

# Indirect tables to denormalize. Order: assignments before overrides.
DENORMALIZE = [
    {"t": "payslips", "join": "FROM payroll_runs WHERE payroll_runs.id = NEW.payroll_run_id",
     "backfill": "UPDATE payslips x SET company_id = pr.company_id FROM payroll_runs pr WHERE x.payroll_run_id = pr.id AND x.company_id IS NULL"},
    {"t": "salaries", "join": "FROM jobs WHERE jobs.job_id = NEW.job_id",
     "backfill": "UPDATE salaries x SET company_id = j.company_id FROM jobs j WHERE x.job_id = j.job_id AND x.company_id IS NULL"},
    {"t": "employee_salary_assignments", "join": "FROM private_users WHERE private_users.private_user_id = NEW.private_user_id",
     "backfill": "UPDATE employee_salary_assignments x SET company_id = p.company_id FROM private_users p WHERE x.private_user_id = p.private_user_id AND x.company_id IS NULL"},
    {"t": "employee_salary_overrides", "join": "FROM employee_salary_assignments WHERE employee_salary_assignments.id = NEW.assignment_id",
     "backfill": "UPDATE employee_salary_overrides x SET company_id = a.company_id FROM employee_salary_assignments a WHERE x.assignment_id = a.id AND x.company_id IS NULL"},
    {"t": "employee_one_off_allowances", "join": "FROM private_users WHERE private_users.private_user_id = NEW.private_user_id",
     "backfill": "UPDATE employee_one_off_allowances x SET company_id = p.company_id FROM private_users p WHERE x.private_user_id = p.private_user_id AND x.company_id IS NULL"},
    {"t": "document_vault", "join": "FROM private_users WHERE private_users.private_user_id = NEW.private_user_id",
     "backfill": "UPDATE document_vault x SET company_id = p.company_id FROM private_users p WHERE x.private_user_id = p.private_user_id AND x.company_id IS NULL"},
    {"t": "leave_quotas", "join": "FROM private_users WHERE private_users.private_user_id = NEW.private_user_id",
     "backfill": "UPDATE leave_quotas x SET company_id = p.company_id FROM private_users p WHERE x.private_user_id = p.private_user_id AND x.company_id IS NULL"},
]
DIRECT = ["payroll_runs", "private_users"]
_ALL = [d["t"] for d in DENORMALIZE] + DIRECT

_POLICY_BODY = (
    "NULLIF(current_setting('app.company_id', true), '') IS NULL"
    " OR current_setting('app.company_id', true) = '*'"
    " OR company_id::text = current_setting('app.company_id', true)"
)


def _policy(tbl):
    op.execute(f"ALTER TABLE {tbl} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {tbl} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS tenant_isolation_{tbl} ON {tbl}")
    op.execute(f"CREATE POLICY tenant_isolation_{tbl} ON {tbl} "
               f"USING ({_POLICY_BODY}) WITH CHECK ({_POLICY_BODY})")


def upgrade() -> None:
    for d in DENORMALIZE:
        t = d["t"]
        op.execute(f"ALTER TABLE {t} ADD COLUMN IF NOT EXISTS company_id INTEGER "
                   f"REFERENCES companies(company_id) ON DELETE CASCADE")
        op.execute(d["backfill"])
        op.execute(f"CREATE INDEX IF NOT EXISTS ix_{t}_company_id ON {t} (company_id)")
        fn = f"_set_{t}_company_id"
        op.execute(f"""
            CREATE OR REPLACE FUNCTION {fn}() RETURNS TRIGGER AS $$
            BEGIN
                IF NEW.company_id IS NULL THEN
                    SELECT company_id INTO NEW.company_id {d['join']};
                END IF;
                RETURN NEW;
            END; $$ LANGUAGE plpgsql
        """)
        op.execute(f"DROP TRIGGER IF EXISTS trg_{t}_set_company_id ON {t}")
        op.execute(f"CREATE TRIGGER trg_{t}_set_company_id BEFORE INSERT ON {t} "
                   f"FOR EACH ROW EXECUTE FUNCTION {fn}()")
        _policy(t)
    for t in DIRECT:
        _policy(t)


def downgrade() -> None:
    for t in _ALL:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation_{t} ON {t}")
        op.execute(f"ALTER TABLE {t} DISABLE ROW LEVEL SECURITY")
    for d in reversed(DENORMALIZE):
        t = d["t"]
        op.execute(f"DROP TRIGGER IF EXISTS trg_{t}_set_company_id ON {t}")
        op.execute(f"DROP FUNCTION IF EXISTS _set_{t}_company_id()")
        op.execute(f"DROP INDEX IF EXISTS ix_{t}_company_id")
        op.execute(f"ALTER TABLE {t} DROP COLUMN IF EXISTS company_id")
