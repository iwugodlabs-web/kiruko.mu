"""Concerns v2 — additive nullable columns on user_rights (Migration 1.B of M1)

Revision ID: concern_v2_user_right_columns_20260516
Revises: concern_v2_tables_20260516
Create Date: 2026-05-16

Plan reference: /Users/iwugod/.claude/plans/keen-hugging-wadler.md M1.

Adds 11 nullable columns to `user_rights`. All NULL-defaulted so existing
rows + existing inserts continue to function unchanged. Reversible.

Columns and rationale:

  case_pin_hash               — bcrypt hash of the PIN issued at submission
                                (PR 2 reporter portal). Plaintext returned to
                                the reporter once and never stored.
  named_parties               — JSON list of {user_id, label} for admins/
                                employees implicated in the report. Drives
                                conflict-of-interest gating + auto-escalation.
  escalated_to_external_at    — Stamped when an internal case auto-escalates
                                to Kontokaz Compliance.
  escalated_reason            — Human-readable reason for the auto-escalation.
  acknowledged_at             — First handler view (EU directive: 7-day ack).
  last_sla_notified_at        — Most-recent SLA-nag timestamp; cron uses this
                                to enforce idempotency.
  retention_purge_at          — Computed `closed_at + retention_years`; cron
                                purges rows past this.
  retaliation_check_30d_at    \
  retaliation_check_60d_at    | Stamps when each retaliation survey fired
  retaliation_check_90d_at    / (PR 4 cron); prevents double-sending.
  attachment_scanned_at       — When ClamAV / magic-byte sniffing completed.
  attachment_scan_result      — 'clean' | 'skipped' | 'rejected:<reason>'.

NOTE on the closed-immutable trigger
------------------------------------
The `user_rights_closed_immutable` trigger (from migration
user_right_workflow_20260514) rejects UPDATEs to closed rows on a hardcoded
column blocklist (title/category/issue_description/...). New columns added
here are NOT in that blocklist, so they remain writeable on closed rows.
This is intentional: `acknowledged_at`, `last_sla_notified_at`,
`retention_purge_at`, `retaliation_check_*`, `attachment_scanned_at`, and
`attachment_scan_result` are operational stamps that legitimately fire
post-close (the retaliation surveys are the killer use case — they fire
30/60/90 days AFTER closure by design).
"""
from alembic import op
import sqlalchemy as sa


revision = "concern_v2_ur_cols_20260516"
down_revision = "concern_v2_tables_20260516"
branch_labels = None
depends_on = None


NEW_COLUMNS = (
    ("case_pin_hash", sa.String(length=255), True),
    ("named_parties", sa.JSON(), True),
    ("escalated_to_external_at", sa.DateTime(timezone=True), True),
    ("escalated_reason", sa.String(length=255), True),
    ("acknowledged_at", sa.DateTime(timezone=True), True),
    ("last_sla_notified_at", sa.DateTime(timezone=True), True),
    ("retention_purge_at", sa.DateTime(timezone=True), True),
    ("retaliation_check_30d_at", sa.DateTime(timezone=True), True),
    ("retaliation_check_60d_at", sa.DateTime(timezone=True), True),
    ("retaliation_check_90d_at", sa.DateTime(timezone=True), True),
    ("attachment_scanned_at", sa.DateTime(timezone=True), True),
    ("attachment_scan_result", sa.String(length=64), True),
)


def upgrade() -> None:
    for col_name, col_type, nullable in NEW_COLUMNS:
        op.add_column(
            "user_rights",
            sa.Column(col_name, col_type, nullable=nullable),
        )


def downgrade() -> None:
    for col_name, _col_type, _nullable in reversed(NEW_COLUMNS):
        op.drop_column("user_rights", col_name)
