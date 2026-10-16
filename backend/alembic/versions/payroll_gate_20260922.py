"""payroll completeness gate: per-company flag + finalize snapshot/attestation

Revision ID: payroll_gate_20260922
Revises: pu_off_payroll_20260921
Create Date: 2026-09-22

Phase 3 of payroll completeness. Adds:
  * companies.payroll_completeness_gate (off | warn | enforce; NULL = env
    default) so the finalize gate can be rolled out per company before global.
  * payroll_runs.member_ledger_snapshot + completeness_attestation — the
    completeness record frozen at finalize (immutable, like
    country_rules_snapshot).

Additive, all nullable — existing companies fall back to the env default and
existing runs carry no snapshot until re-finalized.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "payroll_gate_20260922"
down_revision = "pu_off_payroll_20260921"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("companies", sa.Column("payroll_completeness_gate", sa.String(length=8), nullable=True))
    op.add_column("payroll_runs", sa.Column("member_ledger_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("payroll_runs", sa.Column("completeness_attestation", postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column("payroll_runs", "completeness_attestation")
    op.drop_column("payroll_runs", "member_ledger_snapshot")
    op.drop_column("companies", "payroll_completeness_gate")
