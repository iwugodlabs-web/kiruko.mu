"""Concerns v2 audit close-out — `triage_dismissed_at` + `concern_retention_years`

Revision ID: concern_v2_audit_close_20260516
Revises: concern_v2_status_enum_20260516
Create Date: 2026-05-16

Closes two gaps from the M8 audit (see plan §Plan-vs-shipped reconciliation):

  Gap #2  user_rights.triage_dismissed_at      — dedicated stamp for
                                                  Kontokaz triage-dismissal
                                                  events, originally scoped
                                                  in plan PR 3 §Backend.
  Gap #11 companies.concern_retention_years    — per-company retention
                                                  override for the retention
                                                  purge cron. Default 7 years
                                                  matches the global default.

Both columns are nullable / defaulted; the migration is fully reversible.
"""
from alembic import op
import sqlalchemy as sa


revision = "concern_v2_audit_close_20260516"
down_revision = "concern_v2_status_enum_20260516"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_rights",
        sa.Column("triage_dismissed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "companies",
        sa.Column(
            "concern_retention_years",
            sa.Integer(),
            nullable=False,
            server_default="7",
        ),
    )


def downgrade() -> None:
    op.drop_column("companies", "concern_retention_years")
    op.drop_column("user_rights", "triage_dismissed_at")
