"""Trusted devices for OTP login — phone-number-recycling mitigation.

Revision ID: trusted_devices_20260531
Revises: kiosk_photo_schedule_20260530
Create Date: 2026-05-31

Why this table exists
---------------------
A Mauritian mobile number can be recycled by the carrier after non-use.
Without device binding, a new owner of a previously-assigned number could
request an OTP and silently take over the original user's passwordless
account. This table is the binding ledger:

  * First-ever OTP login for a passwordless user → trust-on-first-use:
    the verifying client's `X-Device-Id` is recorded. Subsequent OTP
    logins from the same device proceed normally.
  * OTP login from a NEW device for a user who already has ≥1 active
    trusted device AND no password set → rejected with
    `new_device_requires_approval`. The user must either log in from a
    known device, set a password from one, or have an admin revoke
    existing devices and re-enroll.
  * Users with a password set bypass this check — the password is the
    fallback channel and adding their new device is acceptable.

PK is composite (device_id, user_id) so the same physical device can
legitimately bind to multiple accounts (e.g. a household tablet) without
conflicting on the bare `device_id`.

`revoked_at` is a soft-delete so an admin can show a forensic history
in support cases. The hot-path index excludes revoked rows so the
"active devices for this user" lookup stays cheap.
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "trusted_devices_20260531"
down_revision = "kiosk_photo_schedule_20260530"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS trusted_devices (
            device_id      VARCHAR(80)  NOT NULL,
            user_id        INTEGER      NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
            device_name    VARCHAR(120),
            first_seen_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
            last_seen_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
            revoked_at     TIMESTAMPTZ,
            PRIMARY KEY (device_id, user_id)
        )
        """
    )
    # Hot path: "active trusted devices for this user". Excluding revoked
    # rows from the index keeps it tight even as the audit log grows.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_trusted_devices_active_per_user
        ON trusted_devices (user_id)
        WHERE revoked_at IS NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_trusted_devices_active_per_user")
    op.execute("DROP TABLE IF EXISTS trusted_devices")
