"""Sponsored content M18 — external_advertiser_name column for house attribution

Revision ID: m18_ext_advertiser_20260518
Revises: m17_split_home_surfaces_20260518
Create Date: 2026-05-18

When Kontokaz starts selling `kind='house'` slots to external
advertisers (Spar, MCB Juice, etc. — brands not on the platform as
Companies), the SponsoredCard needs to display "from {advertiser
name}" instead of the hardcoded "from Kontokaz" fallback.

The data point doesn't fit any existing column:
  - funding_company_id  → references a Kontokaz Company row, used for
                          kind='ad'/'employer' targeting. External
                          advertisers aren't on the platform.
  - payment_notes       → free-text ops note, not user-facing.
  - title/body          → ad copy, not attribution.

Add one nullable string column. Null = Kontokaz first-party
(existing behavior preserved). Set = render that string on the card.

No backfill needed — existing rows stay null and render unchanged.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "m18_ext_advertiser_20260518"
down_revision = "m17_split_home_surfaces_20260518"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sponsored_content",
        sa.Column("external_advertiser_name", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("sponsored_content", "external_advertiser_name")
