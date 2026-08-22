"""Your Right: anonymity column + append-only on closed reports

Revision ID: user_right_workflow_20260514
Revises: audit_log_indexes_20260512
Create Date: 2026-05-14

Implements plan Phase 11:
- Step 6: `is_anonymous` boolean on user_rights so employees can file
  reports the company admin cannot link to them.
- Step 3: Append-only enforcement on closed reports. Once `closed_at`
  is set (i.e. status moved to 'resolved' or 'rejected'), no further
  UPDATEs are permitted via a BEFORE UPDATE trigger. The trigger ALLOWS
  changes only on a small allow-list (internal_notes — operational
  follow-up notes) to keep the door open for legitimate post-resolution
  context without re-opening the rate/status fields. A legitimate
  reopen flow files a NEW report linked via category/description, NOT
  an UPDATE to the closed row.
"""
from alembic import op
import sqlalchemy as sa


revision = 'user_right_workflow_20260514'
down_revision = 'audit_log_indexes_20260512'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) Anonymity column.
    op.add_column(
        'user_rights',
        sa.Column(
            'is_anonymous',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('false'),
        ),
    )

    # 2) WORM-ish trigger: once a Your Right report is closed (closed_at
    # IS NOT NULL), UPDATEs are rejected EXCEPT for `internal_notes`
    # (operational follow-up commentary, not legal-record content).
    op.execute(
        """
        CREATE OR REPLACE FUNCTION reject_closed_user_right_mutation()
        RETURNS trigger AS $$
        BEGIN
          IF OLD.closed_at IS NULL THEN
            RETURN NEW;
          END IF;

          -- Allow updates that only touch internal_notes / updated_at.
          IF NEW.title              IS DISTINCT FROM OLD.title              OR
             NEW.category           IS DISTINCT FROM OLD.category           OR
             NEW.issue_description  IS DISTINCT FROM OLD.issue_description  OR
             NEW.urgency_level      IS DISTINCT FROM OLD.urgency_level      OR
             NEW.status             IS DISTINCT FROM OLD.status             OR
             NEW.resolution         IS DISTINCT FROM OLD.resolution         OR
             NEW.resolution_method  IS DISTINCT FROM OLD.resolution_method  OR
             NEW.expected_outcome   IS DISTINCT FROM OLD.expected_outcome   OR
             NEW.attachment_url     IS DISTINCT FROM OLD.attachment_url     OR
             NEW.channel            IS DISTINCT FROM OLD.channel            OR
             NEW.is_anonymous       IS DISTINCT FROM OLD.is_anonymous       OR
             NEW.private_user_id    IS DISTINCT FROM OLD.private_user_id    OR
             NEW.assigned_to        IS DISTINCT FROM OLD.assigned_to        OR
             NEW.closed_at          IS DISTINCT FROM OLD.closed_at          OR
             NEW.closed_by          IS DISTINCT FROM OLD.closed_by
          THEN
            RAISE EXCEPTION
              'user_rights row % is closed (closed_at=%); only internal_notes may be appended',
              OLD.right_id, OLD.closed_at
              USING HINT =
                'To revise the resolution, file a new linked Your Right report. '
                'Closed reports are legal records and cannot be mutated.';
          END IF;

          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
        """
    )

    op.execute("DROP TRIGGER IF EXISTS user_rights_closed_immutable ON user_rights")
    op.execute(
        "CREATE TRIGGER user_rights_closed_immutable "
        "BEFORE UPDATE ON user_rights "
        "FOR EACH ROW EXECUTE FUNCTION reject_closed_user_right_mutation()"
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS user_rights_closed_immutable ON user_rights")
    op.execute("DROP FUNCTION IF EXISTS reject_closed_user_right_mutation()")
    op.drop_column('user_rights', 'is_anonymous')
