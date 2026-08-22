"""Drop the UNIQUE constraint on jobs.employer_email (keep a plain index).

Revision ID: drop_jobs_employer_email_unique_20260703
Revises: backfill_salary_revenue_20260702
Create Date: 2026-07-03

Why this migration exists
-------------------------
`jobs.employer_email` was declared `unique=True`, but the employer email is a
per-company denormalized value shared by EVERY employee's job at that company.
So creating the 2nd employee at a company failed with:

    duplicate key value violates unique constraint "jobs_employer_email_key"

i.e. the unique constraint blocked employee onboarding — a core pilot flow.

Fix: drop the unique object and replace it with a plain (non-unique) btree
index for lookup performance. The object's name differs by environment
(`jobs_employer_email_key` table constraint in prod, `ix_jobs_employer_email`
unique index locally), so we drop both defensively, then (re)create a
non-unique index. Idempotent.
"""

from alembic import op


# revision identifiers, used by Alembic.
# NB: alembic_version.version_num is varchar(32) — keep this id <= 32 chars.
revision = "drop_job_empemail_uniq_20260703"
down_revision = "backfill_salary_revenue_20260702"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop whichever unique object exists (constraint in prod, unique index locally).
    op.execute("ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_employer_email_key")
    op.execute("DROP INDEX IF EXISTS ix_jobs_employer_email")
    # Recreate a plain, non-unique lookup index (matches the model's index=True).
    op.execute("CREATE INDEX IF NOT EXISTS ix_jobs_employer_email ON jobs (employer_email)")


def downgrade() -> None:
    # Intentionally NOT restoring the unique constraint — it was the bug and a
    # unique inverse could fail on now-legitimately-duplicated emails.
    pass
