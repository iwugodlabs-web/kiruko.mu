"""commission plan versioning + effective dating (field-sales Step A)

Revision ID: commission_plan_ver_20261019
Revises: comm_settle_ref_20261018
Create Date: 2026-10-19

Four-eyes foundation for commission plans: a plan is now a *family* of
versioned, effective-dated rows. A used version is never edited in place —
`revise_plan` clones a new `draft` version and `activate_plan` supersedes the
prior one. `family_id` groups the versions (root row's family_id == its id);
assignments keep pointing at the root and the engine selects the version
effective for the run period.

Additive and behaviour-preserving: existing plans become version 1, `active`,
open-ended (effective_from/effective_to NULL == effective since forever), so
every existing run computes exactly as before.
"""
from alembic import op
import sqlalchemy as sa


revision = "commission_plan_ver_20261019"
down_revision = "comm_settle_ref_20261018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "commission_plans",
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
    )
    op.add_column("commission_plans", sa.Column("family_id", sa.Integer(), nullable=True))
    op.add_column("commission_plans", sa.Column("effective_from", sa.Date(), nullable=True))
    op.add_column("commission_plans", sa.Column("effective_to", sa.Date(), nullable=True))
    op.add_column(
        "commission_plans",
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.user_id"), nullable=True),
    )
    op.add_column(
        "commission_plans",
        sa.Column("approved_by_user_id", sa.Integer(), sa.ForeignKey("users.user_id"), nullable=True),
    )
    op.add_column("commission_plans", sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True))

    # Each existing plan is its own family root; versions are open-ended so
    # every historical period still resolves to them.
    op.execute("UPDATE commission_plans SET family_id = id")
    op.create_index("ix_commission_plans_family_id", "commission_plans", ["family_id"])

    # Unique plan name per company becomes unique per (name, version) so a
    # revision can reuse the family name.
    op.drop_constraint("uq_commission_plan_company_name", "commission_plans", type_="unique")
    op.create_unique_constraint(
        "uq_commission_plan_company_name_version",
        "commission_plans",
        ["company_id", "name", "version"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_commission_plan_company_name_version", "commission_plans", type_="unique")
    op.create_unique_constraint(
        "uq_commission_plan_company_name", "commission_plans", ["company_id", "name"]
    )
    op.drop_index("ix_commission_plans_family_id", table_name="commission_plans")
    op.drop_column("commission_plans", "approved_at")
    op.drop_column("commission_plans", "approved_by_user_id")
    op.drop_column("commission_plans", "created_by_user_id")
    op.drop_column("commission_plans", "effective_to")
    op.drop_column("commission_plans", "effective_from")
    op.drop_column("commission_plans", "family_id")
    op.drop_column("commission_plans", "version")
