"""Document vault hardening (M22)

Revision ID: doc_vault_hardening_20260429
Revises: payroll_calendars_20260429
Create Date: 2026-04-29

Closes three audit/compliance gaps in the existing document_vault flow:

1. uploaded_by_user_id — every upload now records who put the document
   there. NULLABLE for now because existing rows have no provenance to
   backfill; new rows will always have it. Tighten to NOT NULL once
   legacy rows have been audited or expired.

2. visibility — enum-via-CHECK that controls who can read the doc:
     private        — only the subject (private_user) can see it
     employee_only  — subject only (alias for private; explicit)
     employer_only  — company admins only (default; matches today's behavior)
     company_admin  — same as employer_only, kept distinct for future
                      department-scoped acls without renaming the column
   The MVP routers enforce employer_only; extending later doesn't need
   another migration.

3. document_access_logs — every read/download/delete leaves a row.
   Used by the audit log review screen + by the daily expiry-reminder
   cron to dedupe sends.

4. document_expiry_reminders — produced by jobs/document_expiry.py when
   a doc is within 30 days of expiry. UNIQUE (doc_id, reminder_at::date)
   so the daily cron is idempotent.
"""

from alembic import op


revision = 'doc_vault_hardening_20260429'
down_revision = 'payroll_calendars_20260429'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE document_vault
            ADD COLUMN IF NOT EXISTS uploaded_by_user_id INTEGER NULL
                REFERENCES users(user_id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'employer_only';

        ALTER TABLE document_vault
            ADD CONSTRAINT ck_document_vault_visibility
                CHECK (visibility IN ('private','employee_only','employer_only','company_admin'));

        CREATE TABLE IF NOT EXISTS document_access_logs (
            id              SERIAL PRIMARY KEY,
            -- ON DELETE SET NULL (not CASCADE) so the audit row outlives the
            -- doc itself. After a delete, doc_id goes NULL but the action
            -- record persists as proof the operation happened.
            doc_id          INTEGER NULL REFERENCES document_vault(doc_id) ON DELETE SET NULL,
            actor_user_id   INTEGER NULL REFERENCES users(user_id) ON DELETE SET NULL,
            action          VARCHAR(20) NOT NULL
                CHECK (action IN ('view','list','download','delete','update')),
            ip              VARCHAR(45) NULL,
            user_agent      VARCHAR(255) NULL,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS ix_document_access_logs_doc_created
            ON document_access_logs (doc_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS document_expiry_reminders (
            id              SERIAL PRIMARY KEY,
            doc_id          INTEGER NOT NULL REFERENCES document_vault(doc_id) ON DELETE CASCADE,
            reminder_at     DATE NOT NULL,
            sent            BOOLEAN NOT NULL DEFAULT FALSE,
            channel         VARCHAR(20) NOT NULL DEFAULT 'in_app',
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            sent_at         TIMESTAMPTZ NULL,
            CONSTRAINT uq_doc_reminder UNIQUE (doc_id, reminder_at)
        );

        CREATE INDEX IF NOT EXISTS ix_doc_reminders_pending
            ON document_expiry_reminders (sent, reminder_at)
            WHERE sent = FALSE;
    """)

    # M5b's ALTER DEFAULT PRIVILEGES didn't propagate; grant explicitly.
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kontokaz_app') THEN
                GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE document_access_logs       TO kontokaz_app;
                GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE document_expiry_reminders TO kontokaz_app;
            END IF;
        END $$;
    """)


def downgrade() -> None:
    op.execute("""
        DROP TABLE IF EXISTS document_expiry_reminders CASCADE;
        DROP TABLE IF EXISTS document_access_logs CASCADE;

        ALTER TABLE document_vault
            DROP CONSTRAINT IF EXISTS ck_document_vault_visibility;
        ALTER TABLE document_vault
            DROP COLUMN IF EXISTS visibility,
            DROP COLUMN IF EXISTS uploaded_by_user_id;
    """)
