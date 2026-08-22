"""Audit log: query indexes + WORM triggers

Revision ID: audit_log_indexes_20260512
Revises: sector_salary_void_20260512
Create Date: 2026-05-12

Implements plan Phase 7 follow-ups A (indexes) and the Postgres-suitability
caveat (WORM enforcement at the DB layer).

Indexes
-------
Three btree indexes covering the three highest-value audit queries:
  1. "what happened to target X?"  → (target_type, target_id, created_at DESC)
  2. "what did user Y do?"          → (actor_user_id, created_at DESC)
  3. "all foo.* actions recently"   → (action, created_at DESC)

WORM triggers
-------------
audit_logs is INSERT-only at the application layer. These triggers make
that contract enforceable at the DB layer too — a misbehaving migration,
ORM bug, or compromised app user cannot UPDATE/DELETE a row to cover
tracks. A legitimate retention/archive job must explicitly DISABLE the
triggers first (which is itself an auditable DDL event).
"""
from alembic import op


revision = 'audit_log_indexes_20260512'
down_revision = 'sector_salary_void_20260512'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Indexes — `IF NOT EXISTS` so re-running against a partially-applied
    # state is safe.
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_audit_logs_target "
        "ON audit_logs (target_type, target_id, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_time "
        "ON audit_logs (actor_user_id, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_audit_logs_action_time "
        "ON audit_logs (action, created_at DESC)"
    )

    # WORM triggers — reject any UPDATE or DELETE on audit_logs.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION reject_audit_log_mutation()
        RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION
            'audit_logs is append-only; % is forbidden on this table',
            TG_OP
            USING HINT =
              'Cite the audit row in a new row instead (e.g. action=audit.correction with meta linking the original). '
              'For legitimate retention/archive: ALTER TABLE audit_logs DISABLE TRIGGER ALL — that DDL is itself auditable.';
        END;
        $$ LANGUAGE plpgsql
        """
    )

    op.execute("DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs")
    op.execute(
        "CREATE TRIGGER audit_logs_no_update "
        "BEFORE UPDATE ON audit_logs "
        "FOR EACH ROW EXECUTE FUNCTION reject_audit_log_mutation()"
    )

    op.execute("DROP TRIGGER IF EXISTS audit_logs_no_delete ON audit_logs")
    op.execute(
        "CREATE TRIGGER audit_logs_no_delete "
        "BEFORE DELETE ON audit_logs "
        "FOR EACH ROW EXECUTE FUNCTION reject_audit_log_mutation()"
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS audit_logs_no_delete ON audit_logs")
    op.execute("DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs")
    op.execute("DROP FUNCTION IF EXISTS reject_audit_log_mutation()")
    op.execute("DROP INDEX IF EXISTS idx_audit_logs_action_time")
    op.execute("DROP INDEX IF EXISTS idx_audit_logs_actor_time")
    op.execute("DROP INDEX IF EXISTS idx_audit_logs_target")
