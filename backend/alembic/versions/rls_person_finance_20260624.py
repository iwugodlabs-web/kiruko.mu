"""RLS: PERSON-scoped policies on the personal-finance tables.

These tables hold the worker's OWN money data, keyed on private_user_id. Company-
scoped RLS would expose them to the employer — a privacy bug. Instead they are
PERSON-scoped via a new app.private_user_id GUC (set per request by
bind_tenant_context from the JWT, '*' for platform admins).

Unlike April's company policy, these have NO permissive-when-unset branch: a
company OWNER has no private_user_id, so a permissive-unset branch would let an
owner read every employee's personal finances. With no such branch, an unset
context simply sees nothing (owners/background), workers see their own, admins
bypass with '*'.

All seven are PURE person-scope: visible only to the owning worker (or a platform
admin via '*'). Loans today are personal/self-tracked and must NOT be visible to
the employer. Company/employer-loan visibility is a SEPARATE, later feature — when
it lands it will add an admin-gated branch (and an app.company_admin signal); it's
deliberately NOT built here so personal loans stay private.

  * person-scope: transfers, purchases, subscriptions, rents, budget_goals, loans
  * repayments reach their owner through the loan (loan_id -> loans.private_user_id)

Revision ID: rls_person_finance_20260624
Revises: rls_companies_rename_20260624
"""
from alembic import op


revision = "rls_person_finance_20260624"
down_revision = "rls_companies_rename_20260624"
branch_labels = None
depends_on = None

PERSONAL = ["transfers", "purchases", "subscriptions", "rents", "budget_goals", "loans"]

_PID = "current_setting('app.private_user_id', true)"

# owner OR admin-bypass. No permissive-when-unset branch: a company owner has no
# private_user_id, and a permissive-unset branch would let them read everyone's
# personal finances.
_PERSON = f"{_PID} = '*' OR private_user_id::text = {_PID}"

# repayments have no private_user_id — reach the owner through their loan.
_REPAY = (
    f"{_PID} = '*'"
    f" OR EXISTS (SELECT 1 FROM loans l WHERE l.loan_id = repayments.loan_id"
    f"   AND l.private_user_id::text = {_PID})"
)

# (table, policy_body)
_SPECS = [(t, _PERSON) for t in PERSONAL] + [("repayments", _REPAY)]


def upgrade() -> None:
    for table, body in _SPECS:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS person_isolation_{table} ON {table}")
        op.execute(f"CREATE POLICY person_isolation_{table} ON {table} "
                   f"USING ({body}) WITH CHECK ({body})")


def downgrade() -> None:
    for table, _ in _SPECS:
        op.execute(f"DROP POLICY IF EXISTS person_isolation_{table} ON {table}")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
