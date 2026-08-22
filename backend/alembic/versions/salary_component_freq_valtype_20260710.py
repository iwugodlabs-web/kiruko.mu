"""Add salary_components.frequency + value_type — daily allowances/deductions
and percent-of-basic support (Module 8 extension).

Revision ID: salary_comp_freq_20260710
Revises: employee_code_20260710
Create Date: 2026-07-10

Both columns live on the component CATALOG only (not on structure lines or
overrides) — a component's frequency/value_type is a property of what it
IS ("Transport allowance is always daily"), not something that varies per
assignment. Structure lines and overrides just supply the number; the
component says how to interpret it.
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "salary_comp_freq_20260710"
down_revision = "employee_code_20260710"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "salary_components",
        sa.Column("frequency", sa.String(10), nullable=False, server_default="monthly"),
    )
    op.add_column(
        "salary_components",
        sa.Column("value_type", sa.String(20), nullable=False, server_default="amount"),
    )


def downgrade() -> None:
    op.drop_column("salary_components", "value_type")
    op.drop_column("salary_components", "frequency")
