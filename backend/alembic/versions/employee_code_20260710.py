"""Add private_users.employee_code — short human-readable ID for the
Clock-in review + Employees list screens.

Revision ID: employee_code_20260710
Revises: drop_job_empemail_uniq_20260703
Create Date: 2026-07-10

Nullable — existing rows are backfilled by
scripts/backfill_employee_codes.py, not by this migration, since generating
collision-free codes needs the same Python logic used at creation time
(services/employee_code_service.py), not raw SQL.
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "employee_code_20260710"
down_revision = "drop_job_empemail_uniq_20260703"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("private_users", sa.Column("employee_code", sa.String(10), nullable=True))
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_private_user_company_employee_code "
        "ON private_users (company_id, employee_code) "
        "WHERE employee_code IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_private_user_company_employee_code")
    op.drop_column("private_users", "employee_code")
