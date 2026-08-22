"""Sponsored content (M1) — tables for employer announcements + in-app ads

Revision ID: sponsored_tables_20260516
Revises: concern_v2_audit_close_20260516
Create Date: 2026-05-16

Plan reference: SPONSORED_CONTENT_PLAN.md M1.

Creates five tables for the unified Sponsored Content subsystem. One table
backs both user-facing concepts (Employer Announcements and In-App Ads), with
a `kind` discriminator and per-kind validation. Phase 1 enables kind in
('employer', 'house'); Phase 2 enables 'ad' without further schema work here.

  1. sponsored_content              — campaign/announcement, kind-discriminated
  2. sponsored_content_versions     — creative version history (clean attribution
                                      across edits)
  3. sponsored_content_views        — impression log with idempotency token
  4. sponsored_content_clicks       — click log with idempotency token + the
                                      version_id the user actually saw, so
                                      attribution doesn't drift on edit
  5. sponsored_content_dismissals   — dismiss-rate signal

All additive — no existing code path reads or writes these tables yet, so the
migration is fully reversible.

CHECK constraints encode the per-kind invariants:
  - kind='ad'       requires funding_company_id, paid_amount_cents, paid_currency
  - kind='employer' requires funding_company_id
  - kind='house'    requires both funding_company_id and paid_amount_cents to be null
This lets the DB reject malformed inserts before they reach the ORM layer.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "sponsored_tables_20260516"
down_revision = "concern_v2_audit_close_20260516"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── sponsored_content ────────────────────────────────────────────────
    op.create_table(
        "sponsored_content",
        sa.Column("sponsored_content_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column(
            "funding_company_id",
            sa.Integer(),
            sa.ForeignKey("companies.company_id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("image_url", sa.String(), nullable=True),
        sa.Column("cta_label", sa.String(length=100), nullable=True),
        sa.Column("cta_url", sa.String(), nullable=True),
        # current_version_id FK added after sponsored_content_versions exists.
        sa.Column("current_version_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default=sa.text("'draft'")),
        sa.Column(
            "surfaces",
            JSONB(),
            nullable=False,
            server_default=sa.text("'[\"home\"]'::jsonb"),
        ),
        sa.Column(
            "targeting",
            JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "start_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("base_priority", sa.Integer(), nullable=False, server_default=sa.text("50")),
        sa.Column("paid_amount_cents", sa.Integer(), nullable=True),
        sa.Column("paid_currency", sa.String(length=3), nullable=True),
        sa.Column("payment_notes", sa.Text(), nullable=True),
        sa.Column("variant_group", sa.String(length=36), nullable=True),
        sa.Column("variant_label", sa.String(length=10), nullable=True),
        sa.Column("view_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("click_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "created_by_user_id",
            sa.Integer(),
            sa.ForeignKey("users.user_id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "updated_by_user_id",
            sa.Integer(),
            sa.ForeignKey("users.user_id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "kind IN ('employer', 'ad', 'house')",
            name="ck_sponsored_content_kind",
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'active', 'paused', 'ended')",
            name="ck_sponsored_content_status",
        ),
        # Per-kind field invariants. Compound but encoded as one CHECK so the
        # truth table is in one place.
        sa.CheckConstraint(
            "("
            " kind = 'ad' AND funding_company_id IS NOT NULL "
            "          AND paid_amount_cents IS NOT NULL "
            "          AND paid_currency IS NOT NULL"
            ") OR ("
            " kind = 'employer' AND funding_company_id IS NOT NULL"
            ") OR ("
            " kind = 'house' AND funding_company_id IS NULL "
            "                AND paid_amount_cents IS NULL"
            ")",
            name="ck_sponsored_content_kind_fields",
        ),
    )

    op.create_index(
        "ix_sponsored_content_kind_status_dates",
        "sponsored_content",
        ["kind", "status", "start_at", "end_at"],
    )
    op.create_index(
        "ix_sponsored_content_funding_company_kind_status",
        "sponsored_content",
        ["funding_company_id", "kind", "status"],
    )
    op.create_index(
        "ix_sponsored_content_variant_group",
        "sponsored_content",
        ["variant_group"],
    )

    # ── sponsored_content_versions ───────────────────────────────────────
    op.create_table(
        "sponsored_content_versions",
        sa.Column("version_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "sponsored_content_id",
            sa.Integer(),
            sa.ForeignKey("sponsored_content.sponsored_content_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("image_url", sa.String(), nullable=True),
        sa.Column("cta_label", sa.String(length=100), nullable=True),
        sa.Column("cta_url", sa.String(), nullable=True),
        sa.Column(
            "created_by_user_id",
            sa.Integer(),
            sa.ForeignKey("users.user_id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "sponsored_content_id",
            "version_number",
            name="uq_sponsored_content_versions_content_number",
        ),
    )

    # Now we can add the FK on sponsored_content.current_version_id.
    op.create_foreign_key(
        "fk_sponsored_content_current_version",
        "sponsored_content",
        "sponsored_content_versions",
        ["current_version_id"],
        ["version_id"],
        ondelete="SET NULL",
    )

    # ── sponsored_content_views ──────────────────────────────────────────
    op.create_table(
        "sponsored_content_views",
        sa.Column("view_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "sponsored_content_id",
            sa.Integer(),
            sa.ForeignKey("sponsored_content.sponsored_content_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "version_id",
            sa.Integer(),
            sa.ForeignKey("sponsored_content_versions.version_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "private_user_id",
            sa.Integer(),
            sa.ForeignKey("private_users.private_user_id", ondelete="CASCADE"),
            nullable=False,
        ),
        # `kind` is denormalized so per-kind frequency-cap queries don't need to
        # join sponsored_content. Trade a few bytes per row for a cheap index.
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("surface", sa.String(length=32), nullable=False),
        sa.Column("view_token", sa.String(length=36), nullable=False),
        sa.Column(
            "viewed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "sponsored_content_id",
            "private_user_id",
            "view_token",
            name="uq_sponsored_content_views_idempotency",
        ),
    )
    op.create_index(
        "ix_sponsored_content_views_user_kind_viewed_at",
        "sponsored_content_views",
        ["private_user_id", "kind", sa.text("viewed_at DESC")],
    )

    # ── sponsored_content_clicks ─────────────────────────────────────────
    op.create_table(
        "sponsored_content_clicks",
        sa.Column("click_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "sponsored_content_id",
            sa.Integer(),
            sa.ForeignKey("sponsored_content.sponsored_content_id", ondelete="CASCADE"),
            nullable=False,
        ),
        # version_id is the creative the user actually clicked from, so
        # attribution stays correct even if the campaign was edited (new version)
        # between view and click.
        sa.Column(
            "version_id",
            sa.Integer(),
            sa.ForeignKey("sponsored_content_versions.version_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "private_user_id",
            sa.Integer(),
            sa.ForeignKey("private_users.private_user_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("click_token", sa.String(length=36), nullable=False),
        sa.Column(
            "clicked_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "sponsored_content_id",
            "private_user_id",
            "click_token",
            name="uq_sponsored_content_clicks_idempotency",
        ),
    )

    # ── sponsored_content_dismissals ─────────────────────────────────────
    op.create_table(
        "sponsored_content_dismissals",
        sa.Column("dismissal_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "sponsored_content_id",
            sa.Integer(),
            sa.ForeignKey("sponsored_content.sponsored_content_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "private_user_id",
            sa.Integer(),
            sa.ForeignKey("private_users.private_user_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("surface", sa.String(length=32), nullable=False),
        sa.Column(
            "dismissed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )


def downgrade() -> None:
    # Drop in reverse dependency order. The current_version FK on
    # sponsored_content has to come down before sponsored_content_versions.
    op.drop_table("sponsored_content_dismissals")

    op.drop_table("sponsored_content_clicks")

    op.drop_index(
        "ix_sponsored_content_views_user_kind_viewed_at",
        table_name="sponsored_content_views",
    )
    op.drop_table("sponsored_content_views")

    op.drop_constraint(
        "fk_sponsored_content_current_version",
        "sponsored_content",
        type_="foreignkey",
    )
    op.drop_table("sponsored_content_versions")

    op.drop_index(
        "ix_sponsored_content_variant_group",
        table_name="sponsored_content",
    )
    op.drop_index(
        "ix_sponsored_content_funding_company_kind_status",
        table_name="sponsored_content",
    )
    op.drop_index(
        "ix_sponsored_content_kind_status_dates",
        table_name="sponsored_content",
    )
    op.drop_table("sponsored_content")
