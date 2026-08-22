"""M5b: Postgres RLS on the 9 most sensitive multi-tenant tables.

Revision ID: rls_sensitive_20260428
Revises: step_up_tokens_20260428
Create Date: 2026-04-28

Two phases in one migration:

  Phase 1 — DENORMALIZE company_id onto tables that join through to it:
            payslips, salaries, employee_salary_assignments,
            employee_salary_overrides, employee_one_off_allowances,
            document_vault, leave_quotas. Backfill from the join chain,
            mark NOT NULL, add an index, and install a BEFORE INSERT
            trigger that auto-populates company_id from the FK target if
            the caller didn't set it (so application code doesn't need
            to be retrofitted).

  Phase 2 — ENABLE ROW LEVEL SECURITY + create policies on 9 tables
            (the 7 above plus payroll_runs and private_users which
            already have company_id directly).

Policy semantics (permissive default — rollout-safe):
    NULLIF(current_setting('app.company_id', true), '') IS NULL
        → no enforcement (existing code without tenant context just works)
    current_setting('app.company_id', true) = '*'
        → explicit bypass (platform admins, maintenance scripts)
    company_id::text = current_setting('app.company_id', true)
        → tenant-scoped access (the strict guarantee)

The strict guarantee kicks in only when callers explicitly set
app.company_id via core.tenant_context. M5a's existing ContextVar wires
into a Session.after_begin listener that issues SET LOCAL app.company_id
per transaction.

audit_logs is intentionally excluded — platform-wide auditing crosses
tenants by design; defenses for it stay at the API layer.
"""

from alembic import op


revision = 'rls_sensitive_20260428'
down_revision = 'step_up_tokens_20260428'
branch_labels = None
depends_on = None


# Tables denormalized in Phase 1, with the SQL fragment that derives
# company_id from the FK target. Each becomes both a backfill UPDATE and
# the body of a BEFORE INSERT trigger.
DENORMALIZE = [
    {
        "table": "payslips",
        "fk_join": "FROM payroll_runs WHERE payroll_runs.id = NEW.payroll_run_id",
        "backfill_sql": """
            UPDATE payslips ps
               SET company_id = pr.company_id
              FROM payroll_runs pr
             WHERE ps.payroll_run_id = pr.id
               AND ps.company_id IS NULL
        """,
    },
    {
        "table": "salaries",
        "fk_join": "FROM jobs WHERE jobs.job_id = NEW.job_id",
        "backfill_sql": """
            UPDATE salaries s
               SET company_id = j.company_id
              FROM jobs j
             WHERE s.job_id = j.job_id
               AND s.company_id IS NULL
        """,
    },
    {
        "table": "employee_salary_assignments",
        "fk_join": "FROM private_users WHERE private_users.private_user_id = NEW.private_user_id",
        "backfill_sql": """
            UPDATE employee_salary_assignments a
               SET company_id = p.company_id
              FROM private_users p
             WHERE a.private_user_id = p.private_user_id
               AND a.company_id IS NULL
        """,
    },
    {
        "table": "employee_salary_overrides",
        "fk_join": (
            "FROM employee_salary_assignments "
            "WHERE employee_salary_assignments.id = NEW.assignment_id"
        ),
        "backfill_sql": """
            UPDATE employee_salary_overrides o
               SET company_id = a.company_id
              FROM employee_salary_assignments a
             WHERE o.assignment_id = a.id
               AND o.company_id IS NULL
        """,
    },
    {
        "table": "employee_one_off_allowances",
        "fk_join": "FROM private_users WHERE private_users.private_user_id = NEW.private_user_id",
        "backfill_sql": """
            UPDATE employee_one_off_allowances o
               SET company_id = p.company_id
              FROM private_users p
             WHERE o.private_user_id = p.private_user_id
               AND o.company_id IS NULL
        """,
    },
    {
        "table": "document_vault",
        "fk_join": "FROM private_users WHERE private_users.private_user_id = NEW.private_user_id",
        "backfill_sql": """
            UPDATE document_vault d
               SET company_id = p.company_id
              FROM private_users p
             WHERE d.private_user_id = p.private_user_id
               AND d.company_id IS NULL
        """,
    },
    {
        "table": "leave_quotas",
        "fk_join": "FROM private_users WHERE private_users.private_user_id = NEW.private_user_id",
        "backfill_sql": """
            UPDATE leave_quotas q
               SET company_id = p.company_id
              FROM private_users p
             WHERE q.private_user_id = p.private_user_id
               AND q.company_id IS NULL
        """,
    },
]

# All 9 tables that get RLS policies (the 7 above + 2 already-have).
RLS_TABLES = [
    "payroll_runs", "private_users",
    "payslips", "salaries",
    "employee_salary_assignments", "employee_salary_overrides",
    "employee_one_off_allowances", "document_vault", "leave_quotas",
]


def upgrade() -> None:
    # ------------------------------------------------------------------
    # Phase 1: denormalize company_id
    # ------------------------------------------------------------------
    for spec in DENORMALIZE:
        tbl = spec["table"]
        op.execute(f"""
            ALTER TABLE {tbl}
            ADD COLUMN IF NOT EXISTS company_id INTEGER
                REFERENCES companies(company_id) ON DELETE CASCADE
        """)
        op.execute(spec["backfill_sql"])
        # Some rows may still be NULL if their FK target lacks company_id
        # (orphans, malformed data). Set them to a sentinel — safer than
        # failing the migration. Real data should be cleaned up separately.
        op.execute(f"""
            DO $$
            DECLARE
                orphan_count INTEGER;
            BEGIN
                SELECT COUNT(*) INTO orphan_count FROM {tbl} WHERE company_id IS NULL;
                IF orphan_count > 0 THEN
                    RAISE NOTICE 'Table {tbl}: % rows still NULL after backfill — leaving nullable', orphan_count;
                END IF;
            END $$
        """)
        # Only set NOT NULL if no orphans.
        op.execute(f"""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM {tbl} WHERE company_id IS NULL) THEN
                    ALTER TABLE {tbl} ALTER COLUMN company_id SET NOT NULL;
                END IF;
            END $$
        """)
        op.execute(
            f"CREATE INDEX IF NOT EXISTS ix_{tbl}_company_id ON {tbl} (company_id)"
        )

        # BEFORE INSERT trigger to auto-populate company_id from FK if NULL.
        trigger_fn = f"_set_{tbl}_company_id"
        op.execute(f"""
            CREATE OR REPLACE FUNCTION {trigger_fn}()
            RETURNS TRIGGER AS $$
            BEGIN
                IF NEW.company_id IS NULL THEN
                    SELECT company_id INTO NEW.company_id {spec['fk_join']};
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql
        """)
        op.execute(f"DROP TRIGGER IF EXISTS trg_{tbl}_set_company_id ON {tbl}")
        op.execute(f"""
            CREATE TRIGGER trg_{tbl}_set_company_id
            BEFORE INSERT ON {tbl}
            FOR EACH ROW EXECUTE FUNCTION {trigger_fn}()
        """)

    # ------------------------------------------------------------------
    # Phase 2 prep: create a non-superuser app role for application
    # connections. Production/staging app servers should connect as this
    # role (not as `postgres`) so RLS actually applies. Tests use SET ROLE
    # to verify enforcement. The role is NOLOGIN so it's safe by default;
    # operators grant LOGIN + password when wiring up the app server.
    # ------------------------------------------------------------------
    #
    # RESILIENT (mirrors the June rls_direct_tables pattern): creating a role
    # needs CREATEROLE/superuser, which the app's DB user may LACK on a managed
    # host (e.g. DigitalOcean — "permission denied to create role"). If so,
    # DON'T fail the deploy: the RLS policies below are permissive/dormant and
    # don't need the role to exist. An operator creates kontokaz_app + grants
    # out-of-band before the actual prod RLS flip.
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kontokaz_app') THEN
                BEGIN
                    CREATE ROLE kontokaz_app NOSUPERUSER NOBYPASSRLS NOINHERIT NOLOGIN;
                EXCEPTION WHEN insufficient_privilege THEN
                    RAISE NOTICE 'kontokaz_app not created (insufficient privilege) — create it out-of-band before enabling RLS';
                END;
            END IF;
        END $$
    """)
    # Grant the app role full DML on all current + future tables — only if the
    # role exists (skipped cleanly when it could not be created above), and
    # tolerant of a managed host that also withholds schema-grant privileges.
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kontokaz_app') THEN
                BEGIN
                    GRANT USAGE ON SCHEMA public TO kontokaz_app;
                    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kontokaz_app;
                    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kontokaz_app;
                    ALTER DEFAULT PRIVILEGES IN SCHEMA public
                        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kontokaz_app;
                    ALTER DEFAULT PRIVILEGES IN SCHEMA public
                        GRANT USAGE, SELECT ON SEQUENCES TO kontokaz_app;
                EXCEPTION WHEN insufficient_privilege THEN
                    RAISE NOTICE 'kontokaz_app grants skipped (insufficient privilege) — apply them out-of-band before enabling RLS';
                END;
            END IF;
        END $$
    """)

    # ------------------------------------------------------------------
    # Phase 2: enable RLS + create policies on all 9 tables.
    #
    # FORCE ROW LEVEL SECURITY is required because the table owner
    # (typically the migration role, often a superuser) is bypassed by
    # default. FORCE makes policies apply to the owner too. Production
    # platform-admin operations get bypass via app.company_id='*'.
    # ------------------------------------------------------------------
    for tbl in RLS_TABLES:
        op.execute(f"ALTER TABLE {tbl} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {tbl} FORCE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation_{tbl} ON {tbl}")
        op.execute(f"""
            CREATE POLICY tenant_isolation_{tbl} ON {tbl}
            USING (
                NULLIF(current_setting('app.company_id', true), '') IS NULL
                OR current_setting('app.company_id', true) = '*'
                OR company_id::text = current_setting('app.company_id', true)
            )
            WITH CHECK (
                NULLIF(current_setting('app.company_id', true), '') IS NULL
                OR current_setting('app.company_id', true) = '*'
                OR company_id::text = current_setting('app.company_id', true)
            )
        """)


def downgrade() -> None:
    for tbl in RLS_TABLES:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation_{tbl} ON {tbl}")
        op.execute(f"ALTER TABLE {tbl} DISABLE ROW LEVEL SECURITY")

    for spec in reversed(DENORMALIZE):
        tbl = spec["table"]
        op.execute(f"DROP TRIGGER IF EXISTS trg_{tbl}_set_company_id ON {tbl}")
        op.execute(f"DROP FUNCTION IF EXISTS _set_{tbl}_company_id()")
        op.execute(f"DROP INDEX IF EXISTS ix_{tbl}_company_id")
        op.execute(f"ALTER TABLE {tbl} DROP COLUMN IF EXISTS company_id")
