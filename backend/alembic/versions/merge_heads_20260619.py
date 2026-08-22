"""Merge three divergent alembic heads into one.

The migration graph had branched into three leaf heads, which makes
``alembic upgrade head`` ambiguous ("Multiple head revisions are present").
This is a no-op merge that gives the graph a single head again so further
migrations (and a plain ``upgrade head``) work.

Merges:
  * trusted_devices_20260531
  * task_remuneration_20260615
  * task_proof_image_20260611

Revision ID: merge_heads_20260619
"""
from alembic import op  # noqa: F401
import sqlalchemy as sa  # noqa: F401


revision = "merge_heads_20260619"
down_revision = (
    "trusted_devices_20260531",
    "task_remuneration_20260615",
    "task_proof_image_20260611",
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
