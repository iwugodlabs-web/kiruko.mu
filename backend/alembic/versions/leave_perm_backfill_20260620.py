"""Backfill the new Leave permissions onto existing system roles.

Phase 0 of the notification fan-out work adds a dedicated "Leave" permission
group (`view_leave`, `approve_leave`) to the company permission catalogue.
Newly-seeded companies pick these up automatically (the seeded Owner /
Company Admin role definitions are computed from PERMISSION_GROUPS). This
migration backfills the two perms onto the **existing** companies' system
``Owner`` and ``Company Admin`` roles so their permission sets match the seed.

Idempotent and additive: only appends a perm where the JSONB array does not
already contain it; never touches custom roles or the bare-by-default
HR Manager / Department Manager / Supervisor roles.

Revision ID: leave_perm_backfill_20260620
Revises: loan_type_20260619
"""
from alembic import op


revision = "leave_perm_backfill_20260620"
down_revision = "loan_type_20260619"
branch_labels = None
depends_on = None


_PERMS = ("view_leave", "approve_leave")


def upgrade() -> None:
    for perm in _PERMS:
        op.execute(
            f"""
            UPDATE company_roles
               SET permissions = permissions || '["{perm}"]'::jsonb
             WHERE is_system = true
               AND name IN ('Owner', 'Company Admin')
               AND NOT (permissions @> '["{perm}"]'::jsonb)
            """
        )


def downgrade() -> None:
    for perm in _PERMS:
        op.execute(
            f"""
            UPDATE company_roles
               SET permissions = permissions - '{perm}'
             WHERE is_system = true
               AND name IN ('Owner', 'Company Admin')
            """
        )
