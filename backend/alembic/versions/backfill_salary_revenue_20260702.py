"""Backfill salaries.revenue from salary + allowance where NULL.

Revision ID: backfill_salary_revenue_20260702
Revises: timelog_late_fields_20260629
Create Date: 2026-07-02

Why this migration exists
-------------------------
`salaries.revenue` is a legacy DERIVED mirror of the money invariant
``revenue = salary + allowance`` (see db_models/crud/job.py::_enforce_salary_money).
Every application write path runs that invariant, but two paths historically
constructed the ORM row directly and skipped it, leaving `revenue` NULL:

  * services/employee_import_service.py  (the bulk-import / pilot onboarding path)
  * scripts/seed_demo_payroll.py         (local seed)

Consumers that read `revenue` as the compensation figure (the mobile company
Salaries screen) then rendered Rs 0 for those rows. The write paths are now
fixed to enforce the invariant on create; this migration repairs the rows that
were already written with a NULL `revenue`.

Idempotent: only touches rows where `revenue IS NULL`, and recomputes from the
authoritative `salary` + `allowance` columns. Safe to run on any environment.
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "backfill_salary_revenue_20260702"
down_revision = "timelog_late_fields_20260629"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE salaries
        SET revenue = ROUND(COALESCE(salary, 0) + COALESCE(allowance, 0), 2)
        WHERE revenue IS NULL
        """
    )


def downgrade() -> None:
    # Data backfill of a derived column — no meaningful, safe inverse.
    # (Reverting to NULL would reintroduce the bug and lose no real information.)
    pass
