"""Concerns v2 — additive tables (Migration 1.A of M1)

Revision ID: concern_v2_tables_20260516
Revises: user_right_workflow_20260514
Create Date: 2026-05-16

Plan reference: /Users/iwugod/.claude/plans/keen-hugging-wadler.md M1.

Creates three tables for the Concerns v2 subsystem. All additive — nothing
existing reads or writes them yet, so this migration is fully reversible.

  1. concern_messages              — two-way thread between reporter + handler
  2. concern_audit_log             — append-only forensic log, partitioned by
                                     month (PostgreSQL native PARTITION BY
                                     RANGE on created_at). 24 monthly
                                     partitions seeded covering 2026-05 through
                                     2028-04. The partition-roll cron in PR 4
                                     creates each subsequent month and
                                     archives partitions past the audit
                                     retention window.
  3. concern_retaliation_responses — captures 30/60/90-day post-closure
                                     retaliation-survey answers.

This is Migration 1.A of three (1.A: tables, 1.B: nullable columns on
user_rights, 1.C: status enum widening + backfill). Sequencing them
separately limits blast radius — if 1.B or 1.C surfaces a problem, 1.A can
stay shipped harmlessly.
"""
from alembic import op
import sqlalchemy as sa


revision = "concern_v2_tables_20260516"
down_revision = "user_onboarding_ack_20260514"
branch_labels = None
depends_on = None


# Months to seed as partitions on initial deploy. Covers ~24 months ahead so
# the partition-roll cron has a generous safety margin while it's being built.
INITIAL_PARTITIONS_FROM = (2026, 5)
INITIAL_PARTITIONS_COUNT = 24


def _month_iter(start_year: int, start_month: int, count: int):
    y, m = start_year, start_month
    for _ in range(count):
        yield y, m
        m += 1
        if m == 13:
            m = 1
            y += 1


def upgrade() -> None:
    # ── concern_messages ────────────────────────────────────────────────────
    op.create_table(
        "concern_messages",
        sa.Column("message_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "right_id",
            sa.Integer(),
            sa.ForeignKey("user_rights.right_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("author_kind", sa.String(length=20), nullable=False),
        sa.Column(
            "author_user_id",
            sa.Integer(),
            sa.ForeignKey("users.user_id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("attachment_url", sa.String(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_concern_messages_right_id_created_at",
        "concern_messages",
        ["right_id", sa.text("created_at DESC")],
    )

    # ── concern_audit_log (partitioned by month on created_at) ──────────────
    # Alembic's op.create_table doesn't natively express PARTITION BY, so we
    # drop to raw SQL. Index lives PER PARTITION (PG inherits-from-parent for
    # range partitions only on PG ≥ 11; we declare on parent for safety).
    op.execute(
        """
        CREATE TABLE concern_audit_log (
            audit_id        BIGSERIAL,
            right_id        INTEGER NOT NULL REFERENCES user_rights(right_id) ON DELETE CASCADE,
            actor_user_id   INTEGER          REFERENCES users(user_id)        ON DELETE SET NULL,
            actor_kind      VARCHAR(20) NOT NULL,
            action          VARCHAR(64) NOT NULL,
            details         JSON,
            ip              VARCHAR(45),
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (audit_id, created_at)
        ) PARTITION BY RANGE (created_at);
        """
    )
    op.execute(
        """
        CREATE INDEX ix_concern_audit_log_right_id_created_at
            ON concern_audit_log (right_id, created_at DESC);
        """
    )

    # Seed 24 monthly partitions starting INITIAL_PARTITIONS_FROM. Each
    # partition is named `concern_audit_log_YYYY_MM`. The partition-roll cron
    # (PR 4, scripts/concern_audit_partition_roll.py) creates each subsequent
    # month on the 25th.
    for year, month in _month_iter(*INITIAL_PARTITIONS_FROM, INITIAL_PARTITIONS_COUNT):
        next_month = month + 1
        next_year = year
        if next_month == 13:
            next_month = 1
            next_year += 1
        op.execute(
            f"""
            CREATE TABLE concern_audit_log_{year:04d}_{month:02d}
                PARTITION OF concern_audit_log
                FOR VALUES FROM ('{year:04d}-{month:02d}-01')
                          TO   ('{next_year:04d}-{next_month:02d}-01');
            """
        )

    # ── concern_retaliation_responses ───────────────────────────────────────
    op.create_table(
        "concern_retaliation_responses",
        sa.Column("response_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "right_id",
            sa.Integer(),
            sa.ForeignKey("user_rights.right_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("survey_window", sa.String(length=8), nullable=False),
        sa.Column("experienced_retaliation", sa.Boolean(), nullable=False),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column(
            "submitted_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "survey_window IN ('30d', '60d', '90d')",
            name="ck_concern_retaliation_window",
        ),
    )
    op.create_index(
        "ix_concern_retaliation_responses_right_id",
        "concern_retaliation_responses",
        ["right_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_concern_retaliation_responses_right_id",
        table_name="concern_retaliation_responses",
    )
    op.drop_table("concern_retaliation_responses")

    # Drop partitions explicitly first, then the parent. CASCADE would also
    # work but being explicit keeps the downgrade auditable.
    for year, month in _month_iter(*INITIAL_PARTITIONS_FROM, INITIAL_PARTITIONS_COUNT):
        op.execute(
            f"DROP TABLE IF EXISTS concern_audit_log_{year:04d}_{month:02d};"
        )
    op.execute("DROP INDEX IF EXISTS ix_concern_audit_log_right_id_created_at;")
    op.execute("DROP TABLE IF EXISTS concern_audit_log;")

    op.drop_index(
        "ix_concern_messages_right_id_created_at",
        table_name="concern_messages",
    )
    op.drop_table("concern_messages")
