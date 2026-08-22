"""Sponsored content Phase 2 (M9) — ads opt-in/opt-out columns

Revision ID: phase2_ads_columns_20260517
Revises: sponsored_tables_20260516
Create Date: 2026-05-17

Plan reference: SPONSORED_CONTENT_PLAN.md M9.

Adds three columns to enable kind='ad' serving without affecting Phase 1
(employer + house) traffic:

  - companies.ads_enabled            BOOL  NOT NULL
    Existing rows are backfilled to FALSE (grandfather — companies signed
    contracts before ads were a thing, so we cannot start serving ads to
    their employees without sales re-touching the contract). The column
    server_default flips to TRUE after the backfill so NEW companies
    signing up post-launch get ads-on by default (disclosed in the new ToS
    clause — see Phase 2 release blockers in SPONSORED_CONTENT_PLAN.md).

  - private_users.is_ad_free          BOOL  NOT NULL DEFAULT FALSE
    Set TRUE when (a) the employer has paid the B2B ad-free perk for the
    seat, OR (b) the employee withdraws consent (DPA Article 7-style
    withdrawal mechanism — see /sponsored/consent DELETE in M10). Either
    way, /serve's ad-eligibility check rejects ads for this user.

  - private_users.ads_consent_at      TIMESTAMPTZ NULL
    Set on POST /sponsored/consent {accepted: true}. Cleared (back to
    NULL) on DELETE /sponsored/consent. /serve only considers an employee
    eligible for kind='ad' when this is NOT NULL.

All three columns are additive and have safe defaults; nothing in the
existing code path reads them yet. The change is fully reversible.
"""
from alembic import op
import sqlalchemy as sa


revision = "phase2_ads_columns_20260517"
down_revision = "sponsored_tables_20260516"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── companies.ads_enabled ────────────────────────────────────────────
    # Two-step add so existing rows can be backfilled to FALSE while the
    # column's server_default for FUTURE rows is TRUE.
    op.add_column(
        "companies",
        sa.Column("ads_enabled", sa.Boolean(), nullable=True),
    )
    # Grandfather every existing company to ads_enabled=false. Sales has
    # to flip this manually (via POST /admin/companies/{id}/ads-enabled in
    # M10) when a customer re-signs with the ads clause.
    op.execute("UPDATE companies SET ads_enabled = false WHERE ads_enabled IS NULL")
    # Lock it down: now NOT NULL, and future INSERTs default to TRUE.
    op.alter_column(
        "companies",
        "ads_enabled",
        existing_type=sa.Boolean(),
        nullable=False,
        server_default=sa.text("true"),
    )

    # ── private_users.is_ad_free ─────────────────────────────────────────
    op.add_column(
        "private_users",
        sa.Column(
            "is_ad_free",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )

    # ── private_users.ads_consent_at ─────────────────────────────────────
    op.add_column(
        "private_users",
        sa.Column(
            "ads_consent_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("private_users", "ads_consent_at")
    op.drop_column("private_users", "is_ad_free")
    op.drop_column("companies", "ads_enabled")
