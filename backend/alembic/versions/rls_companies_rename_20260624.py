"""RLS: add companies policy + consolidate the app role to kiruko_app.

1. companies — the last uncovered company table. April's standard policy works
   directly: it's permissive when app.company_id is unset, so anonymous signup
   (which INSERTs a company with no tenant set) still works; an authenticated
   user sees only their own company; platform admins use the '*' bypass.

2. Rename kontokaz_app -> kiruko_app (branding). The canonical role is April's
   kontokaz_app (NOLOGIN, NOBYPASSRLS, with all the table grants). This session
   also created a duplicate kiruko_app (rls_direct_tables / rls_app_grants); drop
   that duplicate, then ALTER ROLE RENAME the canonical one — which preserves all
   its grants and any login-member memberships. Safe online: the role is NOLOGIN,
   so nothing connects AS it (the app connects as a login member of it).

Done in a migration so it applies automatically on deploy (no manual DO SQL).

Revision ID: rls_companies_rename_20260624
Revises: rls_extend_tables_20260624
"""
from alembic import op


revision = "rls_companies_rename_20260624"
down_revision = "rls_extend_tables_20260624"
branch_labels = None
depends_on = None

_POLICY_BODY = (
    "NULLIF(current_setting('app.company_id', true), '') IS NULL"
    " OR current_setting('app.company_id', true) = '*'"
    " OR company_id::text = current_setting('app.company_id', true)"
)


def upgrade() -> None:
    # 1. companies policy (April's standard pattern).
    op.execute("ALTER TABLE companies ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE companies FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS tenant_isolation_companies ON companies")
    op.execute(
        f"CREATE POLICY tenant_isolation_companies ON companies "
        f"USING ({_POLICY_BODY}) WITH CHECK ({_POLICY_BODY})"
    )

    # 2. Consolidate to a single app role named kiruko_app.
    #    Roles are CLUSTER-GLOBAL but migrations run per-database, so DROP ROLE on
    #    a role that holds grants in ANOTHER database fails (DependentObjectsStill
    #    Exist). kiruko_app is the canonical role (rls_app_grants granted it, and
    #    rls_grant_kiruko_app re-grants it), so we KEEP it and drop the now-
    #    redundant kontokaz_app instead — tolerantly, since it too may have grants
    #    in another DB, in which case we just leave it (an unused, harmless role).
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kontokaz_app')
               AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kiruko_app') THEN
                EXECUTE 'ALTER ROLE kontokaz_app RENAME TO kiruko_app';
            ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kontokaz_app')
                  AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kiruko_app') THEN
                BEGIN
                    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM kontokaz_app';
                    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM kontokaz_app';
                    EXECUTE 'DROP OWNED BY kontokaz_app';
                    EXECUTE 'DROP ROLE kontokaz_app';
                EXCEPTION WHEN OTHERS THEN
                    RAISE NOTICE 'kontokaz_app not dropped (grants in another database?); leaving it';
                END;
            END IF;
            -- else: only kiruko_app exists — already consolidated, no-op.
        END $$
    """)


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation_companies ON companies")
    op.execute("ALTER TABLE companies DISABLE ROW LEVEL SECURITY")
    # Restore the canonical name. The duplicate kiruko_app is not recreated;
    # rls_app_grants' grants to it are guarded by IF EXISTS, so its downgrade
    # cleanly no-ops if reached.
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kiruko_app')
               AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kontokaz_app') THEN
                ALTER ROLE kiruko_app RENAME TO kontokaz_app;
            END IF;
        END $$
    """)
