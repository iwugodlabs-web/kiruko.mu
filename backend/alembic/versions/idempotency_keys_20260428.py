"""Idempotency keys (M6)

Revision ID: idempotency_keys_20260428
Revises: statutory_bases_20260428
Create Date: 2026-04-28

Stores idempotency cache entries keyed by `Idempotency-Key` header. The
middleware in core/idempotency.py reads/writes this table; a daily cron
(jobs/idempotency_cleanup.py — TODO follow-up) purges entries older than
24 hours.

Schema:
  key             — the client-supplied Idempotency-Key value
  user_id         — auth context at time of original request (audit only)
  method          — HTTP verb of the original request
  path            — request path (so the same key can be reused on different
                    endpoints without conflict)
  request_hash    — SHA-256 of the original request body
  response_status — original response status
  response_body   — original response body, parsed JSON
  created_at      — for retention sweep

PRIMARY KEY is (key, method, path) so the same key may be reused across
different endpoints without conflict — matches Stripe's scoping model.
"""

from alembic import op


revision = 'idempotency_keys_20260428'
down_revision = 'statutory_bases_20260428'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS idempotency_keys (
            key             VARCHAR(80)    NOT NULL,
            method          VARCHAR(10)    NOT NULL,
            path            VARCHAR(500)   NOT NULL,
            user_id         INTEGER        REFERENCES users(user_id) ON DELETE SET NULL,
            request_hash    VARCHAR(64)    NOT NULL,
            response_status INTEGER,
            response_body   JSONB,
            created_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
            PRIMARY KEY (key, method, path)
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_idempotency_keys_created_at "
        "ON idempotency_keys (created_at)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_idempotency_keys_created_at")
    op.execute("DROP TABLE IF EXISTS idempotency_keys")
