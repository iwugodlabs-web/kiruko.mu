"""Step-up auth tokens for high-stakes operations (M7)

Revision ID: step_up_tokens_20260428
Revises: idempotency_keys_20260428
Create Date: 2026-04-28

Stores 5-minute single-use tokens issued after a successful OTP step-up
challenge. Required for the riskiest endpoint (payroll finalize) so a
fresh re-auth is needed before money is disbursed — same flow most
banking and SOC2-conscious SaaS use.

Lifecycle:
  1. Client POSTs /auth/step-up/request with purpose ('payroll_finalize')
  2. Server emails OTP via VerificationToken (existing infra)
  3. Client POSTs /auth/step-up with otp_code → server inserts a row here
     and returns the opaque `token`
  4. Client POSTs the protected endpoint with X-Step-Up-Token: <token>
  5. Dependency validates + sets consumed_at = now (single-use)

A daily cleanup job (TODO follow-up) purges expired/consumed rows older
than 24h.
"""

from alembic import op


revision = 'step_up_tokens_20260428'
down_revision = 'idempotency_keys_20260428'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS step_up_tokens (
            token        VARCHAR(80)   PRIMARY KEY,
            user_id      INTEGER       NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
            purpose      VARCHAR(60)   NOT NULL,
            issued_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
            expires_at   TIMESTAMPTZ   NOT NULL,
            consumed_at  TIMESTAMPTZ
        )
    """)
    # Hot path: validate token by (user_id, purpose) where unconsumed.
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_step_up_tokens_active
        ON step_up_tokens (user_id, purpose) WHERE consumed_at IS NULL
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_step_up_tokens_expires
        ON step_up_tokens (expires_at)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_step_up_tokens_active")
    op.execute("DROP INDEX IF EXISTS ix_step_up_tokens_expires")
    op.execute("DROP TABLE IF EXISTS step_up_tokens")
