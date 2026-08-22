"""Add Department + Role + Grade scoping to salary_structures (M2)

Revision ID: salary_scoping_20260428
Revises: one_off_allowances_20260427
Create Date: 2026-04-28

Adds three optional default-target columns to salary_structures so the
onboarding UI can auto-suggest a structure when adding a new employee
based on their dept / role / grade. Resolution priority is implemented in
services/salary_resolver.suggest_structure_for() (9-priority match table).
"""

from alembic import op


revision = 'salary_scoping_20260428'
down_revision = 'one_off_allowances_20260427'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE salary_structures
            ADD COLUMN IF NOT EXISTS default_for_department_id INTEGER
                REFERENCES departments(department_id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS default_for_role          VARCHAR(40),
            ADD COLUMN IF NOT EXISTS default_for_sector_grade_id INTEGER
                REFERENCES sector_grades(id) ON DELETE SET NULL
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_salary_structures_defaults
        ON salary_structures (
            company_id,
            default_for_department_id,
            default_for_role,
            default_for_sector_grade_id
        )
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_salary_structures_defaults")
    op.execute("""
        ALTER TABLE salary_structures
            DROP COLUMN IF EXISTS default_for_sector_grade_id,
            DROP COLUMN IF EXISTS default_for_role,
            DROP COLUMN IF EXISTS default_for_department_id
    """)
