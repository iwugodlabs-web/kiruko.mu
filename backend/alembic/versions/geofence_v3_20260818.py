"""geofencing v3 — per-site fences + punch integrity layer

Revision ID: geofence_v3_20260818
Revises: task_assignee_notes_20260807
Create Date: 2026-08-18

Adds the database surface for location-based clock-in/out enforcement
(see the geofencing plan: block/flag modes, GPS accuracy gate, mock
detection, QR/Wi-Fi anchors, per-punch audit pack).

  1. `company_geofences` — one or more virtual perimeters per company
     (multi-branch support). Each fence has a centre + radius, an
     enforcement mode ('block' | 'flag'), and optional anchors:
       * `anchor_qr_token`  — a printable QR token that verifies presence
         without GPS (Kronos-style Known-Place anchor).
       * `anchor_wifi_bssids` — accepted Wi-Fi BSSIDs (best-effort; iOS
         needs the location entitlement to read them).
       * `ip_country_required` — optional IP cross-check flag (multi-signal
         convergence; a flaky IP geo lookup must never block a punch).
     Follows kiosk_devices' convention: no RLS (app-layer company scoping
     isolates these config rows).

  2. `companies.geofence_default_mode` — master switch for the whole
     feature: 'off' (record only, no enforcement — existing behaviour),
     'block' (reject punches outside every fence), 'flag' (allow but
     mark for admin review). Per-fence `mode` overrides for a specific site.

  3. `kiosk_devices.latitude/longitude/location_verified_at` — the
     tablet's registered physical position, bound at setup. Kiosk punches
     are trusted (the device IS the fence, Brikly model), so weak tablet
     GPS can never lock out employees.

  4. `time_logs.out_of_geofence` + `time_logs.geofence_check_json` — the
     enforcement result and the per-punch audit pack (fence, distance,
     accuracy, mock flag, provider, device/OS/app/IP) so admins can review
     and auditors can verify.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "geofence_v3_20260818"
down_revision = "task_assignee_notes_20260807"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "company_geofences",
        sa.Column("geofence_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "company_id",
            sa.Integer(),
            sa.ForeignKey("companies.company_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("address", sa.String(255), nullable=True),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("radius_meters", sa.Integer(), nullable=False, server_default="200"),
        # 'block' rejects punches outside this fence; 'flag' allows but flags.
        sa.Column("mode", sa.String(16), nullable=False, server_default="block"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("ip_country_required", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("anchor_qr_token", sa.String(64), nullable=True, unique=True),
        sa.Column("anchor_wifi_bssids", JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index("ix_company_geofences_company_id", "company_geofences", ["company_id"])

    op.add_column(
        "companies",
        sa.Column("geofence_default_mode", sa.String(16), nullable=False, server_default="off"),
    )

    op.add_column("kiosk_devices", sa.Column("latitude", sa.Float(), nullable=True))
    op.add_column("kiosk_devices", sa.Column("longitude", sa.Float(), nullable=True))
    op.add_column("kiosk_devices", sa.Column("location_verified_at", sa.DateTime(timezone=True), nullable=True))

    op.add_column(
        "time_logs",
        sa.Column("out_of_geofence", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("time_logs", sa.Column("geofence_check_json", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("time_logs", "geofence_check_json")
    op.drop_column("time_logs", "out_of_geofence")
    op.drop_column("kiosk_devices", "location_verified_at")
    op.drop_column("kiosk_devices", "longitude")
    op.drop_column("kiosk_devices", "latitude")
    op.drop_column("companies", "geofence_default_mode")
    op.drop_index("ix_company_geofences_company_id", table_name="company_geofences")
    op.drop_table("company_geofences")