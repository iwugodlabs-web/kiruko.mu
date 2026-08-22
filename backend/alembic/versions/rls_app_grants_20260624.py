"""RLS (M5b): grant the kiruko_app role broad access automatically.

The runtime login role (kiruko_web, a member of kiruko_app) must be able to read/
write EVERY table the app uses — not just the 11 RLS-policied ones — or it gets
"permission denied". Rather than hand-running those GRANTs in the DO console,
apply them here (idempotent) so a deploy wires them up, including DEFAULT
PRIVILEGES for tables future migrations create.

RLS still restricts only the policied tables; everything else is simply
accessible (no policy = no restriction). Inert on its own — access means nothing
until the app actually connects as a kiruko_app member AND app.rls_enabled='on'.

Guarded on the role's existence, so it's a clean no-op if kiruko_app was not
created (e.g. the managed host blocked role creation and an operator will set it
up out-of-band). Runs as the migration owner (doadmin), which is what
ALTER DEFAULT PRIVILEGES needs.

Revision ID: rls_app_grants_20260624
Revises: rls_direct_tables_20260624
"""
from alembic import op


revision = "rls_app_grants_20260624"
down_revision = "rls_direct_tables_20260624"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "DO $$ BEGIN "
        "  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'kiruko_app') THEN "
        "    GRANT USAGE ON SCHEMA public TO kiruko_app; "
        "    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kiruko_app; "
        "    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kiruko_app; "
        "    ALTER DEFAULT PRIVILEGES IN SCHEMA public "
        "      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kiruko_app; "
        "    ALTER DEFAULT PRIVILEGES IN SCHEMA public "
        "      GRANT USAGE, SELECT ON SEQUENCES TO kiruko_app; "
        "  END IF; "
        "END $$;"
    )


def downgrade() -> None:
    op.execute(
        "DO $$ BEGIN "
        "  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'kiruko_app') THEN "
        "    ALTER DEFAULT PRIVILEGES IN SCHEMA public "
        "      REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM kiruko_app; "
        "    ALTER DEFAULT PRIVILEGES IN SCHEMA public "
        "      REVOKE USAGE, SELECT ON SEQUENCES FROM kiruko_app; "
        "    REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM kiruko_app; "
        "    REVOKE USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public FROM kiruko_app; "
        "  END IF; "
        "END $$;"
    )
