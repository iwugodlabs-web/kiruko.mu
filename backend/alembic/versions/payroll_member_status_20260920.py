"""payroll run member-status ledger + run scope

Revision ID: payroll_member_status_20260920
Revises: company_holiday_country_20260918
Create Date: 2026-09-20

Closes the silent-exclusion gap in payroll runs. Every in-scope company member
is now accounted for on a run in exactly one bucket (paid / nil_paid /
excluded) via `payroll_run_member_statuses`, and `finalize_run` refuses to
finalize while any `excluded` member is unacknowledged.

Two additive changes:
  1. payroll_runs.scope_user_ids (JSONB, NULL) — NULL means the run covers
     every company member; a list means it was built with an explicit
     allowlist (a partial run). The ledger + finalize gate honour it.
  2. payroll_run_member_statuses — the ledger table. Computed columns are
     rebuilt each draft/recompute; acknowledgement columns persist across
     recompute (keyed on run+member).

Additive only — existing runs get scope_user_ids=NULL (= whole company) and no
ledger rows until their next draft/recompute, so nothing historical changes.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "payroll_member_status_20260920"
down_revision = "company_holiday_country_20260918"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "payroll_runs",
        sa.Column("scope_user_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )

    op.create_table(
        "payroll_run_member_statuses",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("payroll_run_id", sa.Integer(), nullable=False),
        sa.Column("private_user_id", sa.Integer(), nullable=False),
        sa.Column("bucket", sa.String(length=16), nullable=False),
        sa.Column("reason_code", sa.String(length=48), nullable=True),
        sa.Column("detail", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("blocks_finalize", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("acknowledged_by_user_id", sa.Integer(), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acknowledged_reason_code", sa.String(length=48), nullable=True),
        sa.Column("ack_note", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["payroll_run_id"], ["payroll_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["private_user_id"], ["private_users.private_user_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["acknowledged_by_user_id"], ["users.user_id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("payroll_run_id", "private_user_id", name="uq_run_member_status"),
    )
    op.create_index(
        "ix_payroll_run_member_statuses_payroll_run_id",
        "payroll_run_member_statuses", ["payroll_run_id"],
    )
    op.create_index(
        "ix_payroll_run_member_statuses_private_user_id",
        "payroll_run_member_statuses", ["private_user_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_payroll_run_member_statuses_private_user_id", table_name="payroll_run_member_statuses")
    op.drop_index("ix_payroll_run_member_statuses_payroll_run_id", table_name="payroll_run_member_statuses")
    op.drop_table("payroll_run_member_statuses")
    op.drop_column("payroll_runs", "scope_user_ids")
