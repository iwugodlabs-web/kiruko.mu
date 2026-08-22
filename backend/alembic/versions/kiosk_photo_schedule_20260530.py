"""Kiosk v1.7 — photo capture + schedule-aware flagging

Revision ID: kiosk_photo_schedule_20260530
Revises: kiosk_clockin_20260530
Create Date: 2026-05-30

Adds two columns to time_logs to support buddy-punching mitigation
without biometric hardware (which would be ~6 weeks of work + SDK
licensing + legal review). Both columns work together:

  * kiosk_photo_path — relative path under backend/uploads/ to the
    selfie captured by the kiosk's front camera at clock-in. NULL
    when the kiosk wasn't able to capture (no camera, denied
    permission, or this row isn't from a kiosk). The visual record
    is a deterrent: admins review periodically + use as evidence
    when disputes arise. Storage is filesystem (existing /uploads
    pattern); upgrade to S3 later if scale demands.

  * out_of_schedule — true when the clock-in's start_time fell
    outside the Job.work_start_time / work_end_time window (plus
    a small grace at both ends). Computed at insert time by the
    kiosk service against the company's local timezone, NOT a
    DB trigger — keeps the computation in one place + easy to
    iterate on the grace policy. Surfaces flagged entries to the
    admin so they only spend time investigating exceptions.

These two together cover ~80% of buddy-punching cases for ~3 days
of work. Real biometric (WebAuthn per-tablet or server-side
fingerprint via USB scanner) remains the long-term play if pilot
data shows demand.
"""

from alembic import op


revision = 'kiosk_photo_schedule_20260530'
down_revision = 'kiosk_clockin_20260530'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE time_logs
            ADD COLUMN IF NOT EXISTS kiosk_photo_path VARCHAR(255),
            ADD COLUMN IF NOT EXISTS out_of_schedule  BOOLEAN NOT NULL DEFAULT false
    """)
    # Hot path: admin review filter (out_of_schedule = true).
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_time_logs_out_of_schedule
            ON time_logs (job_id, start_time DESC)
         WHERE out_of_schedule = true
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_time_logs_out_of_schedule")
    op.execute("""
        ALTER TABLE time_logs
            DROP COLUMN IF EXISTS out_of_schedule,
            DROP COLUMN IF EXISTS kiosk_photo_path
    """)
