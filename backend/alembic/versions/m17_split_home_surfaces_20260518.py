"""Sponsored content M17 — split `home` surface into `home_banner` + `home_card`

Revision ID: m17_split_home_surfaces_20260518
Revises: phase2_ads_columns_20260517
Create Date: 2026-05-18

Plan reference: surface separation discussion 2026-05-18.

The home screen previously had ONE slot (`surface='home'`) for all
sponsored content. Employer announcements (`kind='employer'`, base
priority 100), paid third-party ads (`kind='ad'`, base 50 + paid/1000),
and Kontokaz house cards (`kind='house'`, base 25) all competed in the
same ranked auction. In practice this meant:

  - employer announcements crowded out paid ads unless the ad paid
    a very large amount (~500 MUR threshold);
  - house cards almost never won when an employer announcement was
    active in the same window, even though house is now the
    contextual-ad inventory we sell to advertisers who can't (or
    won't) target consented users specifically.

This migration splits the single `home` surface into two:

  - `home_banner` — strip at the top of the home screen for
    employer comms (HR notices, payroll alerts).
  - `home_card`   — hero card below for `ad` + `house` campaigns.

The mobile client makes two `/serve` calls per home-screen load, one
per surface. The serve cache key already includes `surface`, so this
just becomes two cache entries per user. Ranking is unchanged
per-slot.

Backfill rule:
  surfaces = ['home'] AND kind = 'employer'         → ['home_banner']
  surfaces = ['home'] AND kind IN ('ad', 'house')   → ['home_card']

Any row whose surfaces array contains 'home' AND something else, or
'home' alongside the new surfaces, is left untouched — an admin already
customized it and we shouldn't second-guess them. The /serve route
keeps accepting the legacy `home` surface for the rollout window so
old mobile builds don't break before they update.

Downgrade reverses the swap (home_banner/home_card → home) so the
table can be rolled back if something goes wrong before the mobile
ships.
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = "m17_split_home_surfaces_20260518"
down_revision = "phase2_ads_columns_20260517"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # JSONB equality on a literal array — only rewrite rows whose surfaces
    # array is EXACTLY ['home'] (the default we shipped originally). Any row
    # with multiple surfaces is admin-customized; leave it alone.
    op.execute(
        """
        UPDATE sponsored_content
        SET surfaces = '["home_banner"]'::jsonb
        WHERE kind = 'employer'
          AND surfaces::text = '["home"]'
        """
    )
    op.execute(
        """
        UPDATE sponsored_content
        SET surfaces = '["home_card"]'::jsonb
        WHERE kind IN ('ad', 'house')
          AND surfaces::text = '["home"]'
        """
    )


def downgrade() -> None:
    # Reverse the swap. Only touches rows whose surfaces array is exactly
    # the new single value; admin-customized rows are left alone.
    op.execute(
        """
        UPDATE sponsored_content
        SET surfaces = '["home"]'::jsonb
        WHERE kind = 'employer'
          AND surfaces::text = '["home_banner"]'
        """
    )
    op.execute(
        """
        UPDATE sponsored_content
        SET surfaces = '["home"]'::jsonb
        WHERE kind IN ('ad', 'house')
          AND surfaces::text = '["home_card"]'
        """
    )
