"""Add voided_* columns + active partial unique index to sector_category_salaries

Revision ID: sector_salary_void_20260512
Revises: payslip_leave_summary_20260430
Create Date: 2026-05-12

Implements plan Phase 3.A + 3.B + C3:
- Three voided_* metadata columns on sector_category_salaries
- Partial unique index on the FULL natural key:
    (sector_category_id, sector_grade_id, effective_from,
     min_years_of_service, max_years_of_service)
  WHERE voided_at IS NULL AND effective_from IS NOT NULL.
  The min/max year-of-service columns participate because legitimate
  data has multiple rows per (category, grade, effective_from) — one
  per year-of-service band — each with a distinct rate. Excluding the
  year-band columns would reject the existing dataset entirely.
- NULLS NOT DISTINCT (Postgres 15+) so NULL sector_grade_id /
  NULL min_years / NULL max_years participate in uniqueness instead
  of being treated as distinct.
- Pre-flight guard: refuses to create the index if existing data already
  violates the constraint (would otherwise fail with a cryptic Postgres error).
"""
from alembic import op
import sqlalchemy as sa


revision = 'sector_salary_void_20260512'
down_revision = 'payslip_leave_summary_20260430'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Step 1: add the three voided_* columns first so the partial index
    # WHERE clause below is valid.
    op.add_column(
        'sector_category_salaries',
        sa.Column('voided_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        'sector_category_salaries',
        sa.Column('voided_by_user_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_sector_category_salaries_voided_by_user',
        'sector_category_salaries',
        'users',
        ['voided_by_user_id'],
        ['user_id'],
        ondelete='SET NULL',
    )
    op.add_column(
        'sector_category_salaries',
        sa.Column('voided_reason', sa.String(), nullable=True),
    )

    # Step 2: pre-flight guard. Refuse to add the index if existing data
    # would violate it. The natural key includes `unit` because legitimate
    # rows for the same (category, grade, date, year-band) can describe
    # different rate types — e.g. a monthly base salary alongside a
    # per-show piecework rate for the same employee class.
    conn = op.get_bind()
    dups = conn.execute(
        sa.text(
            """
            SELECT sector_category_id, sector_grade_id, effective_from,
                   min_years_of_service, max_years_of_service, unit,
                   COUNT(*) AS c
            FROM sector_category_salaries
            WHERE effective_from IS NOT NULL
            GROUP BY 1, 2, 3, 4, 5, 6
            HAVING COUNT(*) > 1
            """
        )
    ).fetchall()
    if dups:
        sample = ', '.join(
            f"(cat={r[0]}, grade={r[1]}, date={r[2]}, yrs={r[3]}-{r[4]}, unit={r[5]})"
            for r in dups[:5]
        )
        raise RuntimeError(
            f"Cannot create uq_sector_category_salaries_active — "
            f"{len(dups)} duplicate row(s) already exist on the natural "
            f"key (category, grade, effective_from, min_years, max_years, unit) "
            f"among non-voided rows. Resolve by voiding all-but-one of each "
            f"group before re-running. Example offenders: {sample}"
        )

    # Step 3: create the partial unique index. Postgres 15+ syntax with
    # NULLS NOT DISTINCT so NULL columns participate in uniqueness
    # instead of being treated as distinct (the legacy default).
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_sector_category_salaries_active
        ON sector_category_salaries (
            sector_category_id,
            sector_grade_id,
            effective_from,
            min_years_of_service,
            max_years_of_service,
            unit
        )
        NULLS NOT DISTINCT
        WHERE voided_at IS NULL AND effective_from IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_sector_category_salaries_active")
    op.drop_constraint(
        'fk_sector_category_salaries_voided_by_user',
        'sector_category_salaries',
        type_='foreignkey',
    )
    op.drop_column('sector_category_salaries', 'voided_reason')
    op.drop_column('sector_category_salaries', 'voided_by_user_id')
    op.drop_column('sector_category_salaries', 'voided_at')
