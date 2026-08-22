"""RLS (M5b Phase 1): non-owner role + tenant-isolation policies on direct tables.

Creates the non-login `kiruko_app` privilege role and enables Row-Level Security
with a company-scoped policy on the direct-`company_id` tenant tables.

INERT BY DEFAULT — every policy is gated behind a GUC kill-switch:

    current_setting('app.rls_enabled', true) IS DISTINCT FROM 'on'  -> allow all

So with `app.rls_enabled` unset (the default), the policies pass everything and
nothing changes for the running app, regardless of which DB role connects. RLS
only begins enforcing once BOTH are true:
  1. the app connects as a NON-superuser role that is a member of `kiruko_app`
     (superusers bypass RLS entirely), and
  2. `ALTER DATABASE <db> SET app.rls_enabled = 'on';` is run.
This two-stage flip lets us point the app at the new role and confirm it works
(still inert) BEFORE turning on enforcement. See doc/RLS-PLAN.md.

Policy convention (proven in tests/integration/test_rls_mechanism.py):
  * compare the tenant key as TEXT (never cast the GUC — '*' breaks an int cast);
  * '*' is the platform-admin bypass sentinel;
  * nullable-company_id tables also allow `company_id IS NULL` so unclaimed rows
    (e.g. a job awaiting employer verification) remain reachable.

`companies` and `private_users` are intentionally EXCLUDED here — they are
signup/auth-adjacent (anonymous signup INSERTs a company; auth self-fetches a
private_user) and need bespoke policies in a follow-up batch.

Revision ID: rls_direct_tables_20260624
Revises: payslip_adj_uq_20260621
"""
from alembic import op


revision = "rls_direct_tables_20260624"
down_revision = "payslip_adj_uq_20260621"
branch_labels = None
depends_on = None

# Direct-company_id tenant tables (curated DIRECT_MULTI_TENANT_TABLES minus the
# auth-adjacent companies/private_users). `nullable` flags the two whose
# company_id can be NULL (unclaimed rows must stay visible).
_TABLES = [
    ("jobs", True),
    ("job_history", True),
    ("departments", False),
    ("salary_components", False),
    ("salary_structures", False),
    ("leave_types", False),
    ("company_invites", False),
    ("company_holiday_rates", False),
    ("company_monthly_payrolls", False),
    ("company_roles", False),
    ("payroll_runs", False),
]

_POLICY = "rls_tenant_isolation"


def _predicate(nullable: bool) -> str:
    null_branch = " OR company_id IS NULL" if nullable else ""
    return (
        "current_setting('app.rls_enabled', true) IS DISTINCT FROM 'on'"
        " OR current_setting('app.company_id', true) = '*'"
        " OR company_id::text = current_setting('app.company_id', true)"
        f"{null_branch}"
    )


def upgrade() -> None:
    # Non-login privilege role. A real login role (created out-of-band on the DB
    # host) is granted membership in this one, so grants live in one place.
    #
    # RESILIENT: creating a role needs CREATEROLE/superuser, which the app's DB
    # user may lack on a managed host (e.g. DigitalOcean). If so, DON'T fail the
    # deploy — the RLS policies below are inert (kill-switch) and don't need the
    # role; an operator creates kiruko_app + grants out-of-band before the flip.
    op.execute(
        "DO $$ BEGIN "
        "  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kiruko_app') THEN "
        "    BEGIN "
        "      CREATE ROLE kiruko_app NOLOGIN; "
        "    EXCEPTION WHEN insufficient_privilege THEN "
        "      RAISE NOTICE 'kiruko_app not created (insufficient privilege) — create it out-of-band before enabling RLS'; "
        "    END; "
        "  END IF; "
        "END $$;"
    )
    # Grants only if the role exists (skipped cleanly when it couldn't be created).
    op.execute(
        "DO $$ BEGIN "
        "  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'kiruko_app') THEN "
        "    GRANT USAGE ON SCHEMA public TO kiruko_app; "
        "    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kiruko_app; "
        "  END IF; "
        "END $$;"
    )

    for table, nullable in _TABLES:
        pred = _predicate(nullable)
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY {_POLICY} ON {table} FOR ALL "
            f"USING ({pred}) WITH CHECK ({pred})"
        )
        op.execute(
            "DO $$ BEGIN "
            "  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'kiruko_app') THEN "
            f"    GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO kiruko_app; "
            "  END IF; "
            "END $$;"
        )


def downgrade() -> None:
    for table, _ in _TABLES:
        op.execute(f"DROP POLICY IF EXISTS {_POLICY} ON {table}")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
        op.execute(
            "DO $$ BEGIN "
            "  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'kiruko_app') THEN "
            f"    REVOKE ALL ON {table} FROM kiruko_app; "
            "  END IF; "
            "END $$;"
        )
    # Leave the kiruko_app role in place (it may hold other grants); drop only if
    # it owns nothing and is unused.
    op.execute(
        "DO $$ BEGIN "
        "  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'kiruko_app') THEN "
        "    REVOKE USAGE ON SCHEMA public FROM kiruko_app; "
        "  END IF; "
        "END $$;"
    )
