"""Salary configuration redesign: components catalog + structures + assignments

Revision ID: salary_structures_20260427
Revises: profile_lock_20260427
Create Date: 2026-04-27

Replaces the legacy `salaries` row-per-job model. Five tables form a
components-and-structures architecture:

  * salary_components — per-company catalog (earnings/deductions),
                        categorized for Module 8 allowance plugins.
  * salary_structures — named templates per company.
  * salary_structure_lines — components in a structure, default amounts.
  * employee_salary_assignments — employee on which structure, effective-dated.
  * employee_salary_overrides — per-component overrides on an assignment.

The legacy `salaries` table is intentionally retained for backfill and
read-only access during transition; downstream payroll work (Modules 2-3-4-8)
will read exclusively from the new tables via services/salary_resolver.
"""

from alembic import op


revision = 'salary_structures_20260427'
down_revision = 'profile_lock_20260427'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS salary_components (
            id                          SERIAL PRIMARY KEY,
            company_id                  INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
            code                        VARCHAR(40) NOT NULL,
            label                       VARCHAR(100) NOT NULL,
            kind                        VARCHAR(20) NOT NULL,
            category                    VARCHAR(60) NOT NULL DEFAULT 'earning.other',
            is_basic                    BOOLEAN NOT NULL DEFAULT false,
            is_taxable                  BOOLEAN NOT NULL DEFAULT true,
            is_recurring                BOOLEAN NOT NULL DEFAULT true,
            is_one_off                  BOOLEAN NOT NULL DEFAULT false,
            prorate_on_partial_month    BOOLEAN NOT NULL DEFAULT true,
            country_default_code        VARCHAR(2) REFERENCES countries(code),
            created_at                  TIMESTAMPTZ DEFAULT now(),
            updated_at                  TIMESTAMPTZ DEFAULT now(),
            CONSTRAINT uq_salary_component_company_code UNIQUE (company_id, code),
            CONSTRAINT chk_salary_component_kind CHECK (kind IN ('earning','deduction'))
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_salary_components_company ON salary_components (company_id)")

    # At most one is_basic=true per company.
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_salary_component_one_basic
        ON salary_components (company_id) WHERE is_basic = true
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS salary_structures (
            id           SERIAL PRIMARY KEY,
            company_id   INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
            name         VARCHAR(100) NOT NULL,
            description  VARCHAR,
            is_default   BOOLEAN NOT NULL DEFAULT false,
            created_at   TIMESTAMPTZ DEFAULT now(),
            updated_at   TIMESTAMPTZ DEFAULT now(),
            CONSTRAINT uq_salary_structure_company_name UNIQUE (company_id, name)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_salary_structures_company ON salary_structures (company_id)")

    # At most one is_default=true per company.
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_salary_structure_one_default
        ON salary_structures (company_id) WHERE is_default = true
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS salary_structure_lines (
            id                   SERIAL PRIMARY KEY,
            structure_id         INTEGER NOT NULL REFERENCES salary_structures(id) ON DELETE CASCADE,
            component_id         INTEGER NOT NULL REFERENCES salary_components(id) ON DELETE RESTRICT,
            amount               NUMERIC(14, 2),
            formula_expression   VARCHAR,
            order_index          INTEGER NOT NULL DEFAULT 0,
            created_at           TIMESTAMPTZ DEFAULT now(),
            CONSTRAINT uq_structure_line_unique UNIQUE (structure_id, component_id)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS employee_salary_assignments (
            id                   SERIAL PRIMARY KEY,
            private_user_id      INTEGER NOT NULL REFERENCES private_users(private_user_id) ON DELETE CASCADE,
            structure_id         INTEGER REFERENCES salary_structures(id) ON DELETE RESTRICT,
            currency             VARCHAR(3) NOT NULL DEFAULT 'MUR',
            effective_from       DATE NOT NULL,
            effective_to         DATE,
            notes                VARCHAR,
            created_by_user_id   INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
            created_at           TIMESTAMPTZ DEFAULT now()
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_employee_salary_assignments_user_effective
        ON employee_salary_assignments (private_user_id, effective_from DESC)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_employee_salary_assignments_active
        ON employee_salary_assignments (private_user_id) WHERE effective_to IS NULL
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS employee_salary_overrides (
            id                  SERIAL PRIMARY KEY,
            assignment_id       INTEGER NOT NULL REFERENCES employee_salary_assignments(id) ON DELETE CASCADE,
            component_id        INTEGER NOT NULL REFERENCES salary_components(id) ON DELETE RESTRICT,
            amount              NUMERIC(14, 2),
            formula_expression  VARCHAR,
            notes               VARCHAR,
            created_at          TIMESTAMPTZ DEFAULT now(),
            CONSTRAINT uq_assignment_override_unique UNIQUE (assignment_id, component_id)
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS employee_salary_overrides")
    op.execute("DROP TABLE IF EXISTS employee_salary_assignments")
    op.execute("DROP TABLE IF EXISTS salary_structure_lines")
    op.execute("DROP TABLE IF EXISTS salary_structures")
    op.execute("DROP TABLE IF EXISTS salary_components")
