"""RLS: (re)grant kiruko_app broad table access.

The consolidated kiruko_app role ended up WITHOUT table grants (the duplicate's
grants were dropped during the rename, and April's original grant to kontokaz_app
is not present in this database). Without grants the app — once it connects as a
kiruko_app member — gets "permission denied" on every table, before RLS even
applies. Grant it DML on all current + future tables (RLS still restricts which
ROWS it sees; grants govern table access, policies govern row visibility).

Idempotent, guarded on the role's existence.

Revision ID: rls_grant_kiruko_app_20260624
Revises: rls_person_finance_20260624
"""
from alembic import op


revision = "rls_grant_kiruko_app_20260624"
down_revision = "rls_person_finance_20260624"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kiruko_app') THEN
            GRANT USAGE ON SCHEMA public TO kiruko_app;
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kiruko_app;
            GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kiruko_app;
            EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kiruko_app';
            EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO kiruko_app';
          END IF;
        END $$
    """)


def downgrade() -> None:
    op.execute("""
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kiruko_app') THEN
            EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM kiruko_app';
            EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM kiruko_app';
            REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM kiruko_app;
            REVOKE USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public FROM kiruko_app;
          END IF;
        END $$
    """)
