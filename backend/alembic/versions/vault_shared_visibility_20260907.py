"""Vault: explicit `shared` visibility (employer + employee).

`employer_only` was a legacy misnomer for "shared with the employee" — the
web dropdown label says "Shared with employee" but the stored value reads
as employer-only, which is indistinguishable in the DB from a value that
hides the doc. This revision:

  * extends ck_document_vault_visibility with 'shared' (same access as the
    old shared meaning: owner + admin + view_documents roles),
  * backfills existing 'employer_only' rows to 'shared' (no such row could
    have meant "hidden from the employee" — the owner could always see it),
  * leaves 'employer_only' ACCEPTED (mobile clients and old rows) with
    identical access semantics.

Revises: job_onboarding_draft_20260906 (head at time of writing).
"""
from alembic import op

revision = "vault_shared_visibility_20260907"
down_revision = "job_onboarding_draft_20260906"
branch_labels = None
depends_on = None

_VALUES = "('private','employee_only','employer_only','shared','company_admin')"
_OLD_VALUES = "('private','employee_only','employer_only','company_admin')"


def upgrade() -> None:
    op.execute("ALTER TABLE document_vault DROP CONSTRAINT IF EXISTS ck_document_vault_visibility")
    op.execute(
        "ALTER TABLE document_vault ADD CONSTRAINT ck_document_vault_visibility "
        f"CHECK (visibility IN {_VALUES})"
    )
    op.execute("UPDATE document_vault SET visibility = 'shared' WHERE visibility = 'employer_only'")


def downgrade() -> None:
    op.execute("UPDATE document_vault SET visibility = 'employer_only' WHERE visibility = 'shared'")
    op.execute("ALTER TABLE document_vault DROP CONSTRAINT IF EXISTS ck_document_vault_visibility")
    op.execute(
        "ALTER TABLE document_vault ADD CONSTRAINT ck_document_vault_visibility "
        f"CHECK (visibility IN {_OLD_VALUES})"
    )
