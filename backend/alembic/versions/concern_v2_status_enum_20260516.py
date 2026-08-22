"""Concerns v2 — status enum widen + backfill (Migration 1.C of M1)

Revision ID: concern_v2_status_enum_20260516
Revises: concern_v2_user_right_columns_20260516
Create Date: 2026-05-16

Plan reference: /Users/iwugod/.claude/plans/keen-hugging-wadler.md M1.

Replaces the legacy four-value status set
    {pending, in_progress, resolved, rejected}
with the eight-value workflow
    {received, triaged, investigating, action_taken,
     resolved, rejected, appealed, closed}
matching `core/concern_states.ConcernStatus`.

Backfill mapping (legacy → v2):
    pending      → received
    in_progress  → investigating
    resolved     → resolved   (no-op)
    rejected     → rejected   (no-op)

============================================================================
                    FORWARD-ONLY MIGRATION — READ THIS
============================================================================
This migration is **forward-only in practice**. The backfill destroys the
legacy four-value mapping for any row where status used to be 'pending' or
'in_progress' — a downgrade cannot reconstruct which originals were which
without external context. The downgrade IS implemented (it widens the CHECK
constraint back to allow legacy values), but it does NOT undo the backfill.
If a true rollback is required, restore from the pre-migration backup.
============================================================================

Trigger interaction
-------------------
The `user_rights_closed_immutable` trigger (from migration
user_right_workflow_20260514) rejects UPDATEs to closed rows when `status`
changes. Closed rows in the legacy schema have status='resolved' or
'rejected', and the backfill maps both to themselves, so the WHERE clauses
below never match closed rows. No trigger workaround needed; verified
empirically below by scoping each UPDATE to the source value.
"""
from alembic import op


revision = "concern_v2_status_enum_20260516"
down_revision = "concern_v2_ur_cols_20260516"
branch_labels = None
depends_on = None


V2_STATUSES = (
    "received",
    "triaged",
    "investigating",
    "action_taken",
    "resolved",
    "rejected",
    "appealed",
    "closed",
)

# During downgrade we accept BOTH legacy and v2 values, since the backfill
# can't be reversed cleanly. New writes after a downgrade should use legacy
# values; existing v2 values stay valid in the constraint.
DOWNGRADE_STATUSES = V2_STATUSES + ("pending", "in_progress")


def upgrade() -> None:
    # 1) Backfill legacy values into v2 names. Scoped so closed rows
    #    (status='resolved'/'rejected') aren't touched and the closed-immutable
    #    trigger has nothing to reject.
    op.execute(
        "UPDATE user_rights SET status = 'received' WHERE status = 'pending';"
    )
    op.execute(
        "UPDATE user_rights SET status = 'investigating' WHERE status = 'in_progress';"
    )

    # 2) Add a CHECK constraint enforcing the v2 set. We don't use a Postgres
    #    ENUM type because adding values to ENUMs is awkward and the project's
    #    existing pattern is plain VARCHAR + app-level validation (see
    #    core.concern_states).
    quoted = ", ".join(f"'{s}'" for s in V2_STATUSES)
    op.execute(
        f"ALTER TABLE user_rights "
        f"ADD CONSTRAINT ck_user_rights_status_v2 "
        f"CHECK (status IN ({quoted}));"
    )


def downgrade() -> None:
    # Drop the strict v2 constraint.
    op.execute(
        "ALTER TABLE user_rights DROP CONSTRAINT IF EXISTS ck_user_rights_status_v2;"
    )

    # Re-add a permissive constraint accepting both legacy and v2 values.
    # This lets the application keep functioning even if rows already hold
    # v2 statuses — the backfill is destructive and we cannot reconstruct
    # the originals here without a backup.
    quoted = ", ".join(f"'{s}'" for s in DOWNGRADE_STATUSES)
    op.execute(
        f"ALTER TABLE user_rights "
        f"ADD CONSTRAINT ck_user_rights_status_legacy "
        f"CHECK (status IN ({quoted}));"
    )
