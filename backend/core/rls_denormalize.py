"""Idempotently repair the denormalized `company_id` columns for the RLS tables.

Background — the "Complete Profile" 500:
    rls_april_tables_fix denormalized `company_id` onto seven tables (+ a
    BEFORE-INSERT trigger filling it from the parent), and rls_sensitive_tables
    then set it NOT NULL. Two problems for onboarding:
      * The NOT NULL is wrong — a private user who self-onboards (or names an
        employer that isn't a registered Company) has job.company_id = NULL, so
        their salary row is legitimately company-less. NOT NULL 500'd every such
        user.
      * On prod (schema create_all-bootstrapped, migrations no-op) the auto-fill
        triggers are MISSING, and none of these models map `company_id`, so a
        company employee's insert also wrote NULL.

This repairs both at boot for every table whose company_id column exists: DROP
NOT NULL (allow company-less rows) and (re)create the auto-fill trigger (populate
company_id for company rows on paths that don't set it). RLS policies are left
alone (dormant). Safe + idempotent: per-table transaction, skips tables without
the column.
"""
from sqlalchemy import text
from sqlalchemy.engine import Engine

# (table, join) — `join` is the SELECT source yielding the parent's company_id.
# Copied verbatim from alembic/versions/rls_april_tables_fix_20260624 (a frozen
# historical spec), so the trigger bodies match the migration exactly.
_DENORMALIZE: list[tuple[str, str]] = [
    ("payslips", "FROM payroll_runs WHERE payroll_runs.id = NEW.payroll_run_id"),
    ("salaries", "FROM jobs WHERE jobs.job_id = NEW.job_id"),
    ("employee_salary_assignments", "FROM private_users WHERE private_users.private_user_id = NEW.private_user_id"),
    ("employee_salary_overrides", "FROM employee_salary_assignments WHERE employee_salary_assignments.id = NEW.assignment_id"),
    ("employee_one_off_allowances", "FROM private_users WHERE private_users.private_user_id = NEW.private_user_id"),
    ("document_vault", "FROM private_users WHERE private_users.private_user_id = NEW.private_user_id"),
    ("leave_quotas", "FROM private_users WHERE private_users.private_user_id = NEW.private_user_id"),
]


def _column_exists(conn, table: str, column: str) -> bool:
    return conn.execute(
        text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = :t AND column_name = :c"
        ),
        {"t": table, "c": column},
    ).first() is not None


def repair_denormalized_company_id(engine: Engine) -> list[str]:
    """Repair the denormalized company_id columns on each table whose column
    exists. Two things, both idempotent:

    1. DROP NOT NULL — rls_sensitive_tables_20260428 set company_id NOT NULL,
       which assumed every row belongs to a company. It does NOT: a private user
       who self-onboards (or reports an employer that isn't a registered Company)
       has a job/private_user with company_id = NULL, so their salary/etc. row is
       legitimately company-less. The NOT NULL made "Complete Profile" 500 for
       every such user. RLS handles a NULL company_id fine (a company GUC simply
       never matches it), so the column must be nullable.
    2. (Re)create the BEFORE-INSERT auto-fill trigger so COMPANY rows still get
       company_id populated on insert paths that don't set it (missing on prod's
       create_all-bootstrapped schema).

    Returns the tables it touched. Each is isolated in its own transaction so a
    problem with one can't block the rest."""
    done: list[str] = []
    for t, join in _DENORMALIZE:
        try:
            with engine.begin() as conn:
                if not _column_exists(conn, t, "company_id"):
                    continue
                # Independent (company-less) rows must be allowed.
                conn.execute(text(f"ALTER TABLE {t} ALTER COLUMN company_id DROP NOT NULL"))
                fn = f"_set_{t}_company_id"
                conn.execute(text(f"""
                    CREATE OR REPLACE FUNCTION {fn}() RETURNS TRIGGER AS $$
                    BEGIN
                        IF NEW.company_id IS NULL THEN
                            SELECT company_id INTO NEW.company_id {join};
                        END IF;
                        RETURN NEW;
                    END; $$ LANGUAGE plpgsql
                """))
                conn.execute(text(f"DROP TRIGGER IF EXISTS trg_{t}_set_company_id ON {t}"))
                conn.execute(text(
                    f"CREATE TRIGGER trg_{t}_set_company_id BEFORE INSERT ON {t} "
                    f"FOR EACH ROW EXECUTE FUNCTION {fn}()"
                ))
                done.append(t)
        except Exception as e:  # never let a boot-repair hiccup block a deploy
            print(f"[rls_denormalize] skipped {t}: {e}")
    return done
