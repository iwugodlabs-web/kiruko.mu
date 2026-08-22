"""Revert the parallel RLS policies (Phase 1) — keep April's rls_sensitive as canonical.

This session built a second RLS system (rls_direct_tables / rls_app_grants) before
discovering the existing April implementation (rls_sensitive_tables_20260428:
kontokaz_app, denormalized company_id, policies named tenant_isolation_<tbl> on the
9 sensitive tables). The two coexisted badly: my kill-switch policy
(rls_tenant_isolation) on payroll_runs OR'd with April's and weakened it.

This migration converges back to "April is canonical":
  * tables April never covered (jobs, departments, …): drop my policy AND disable
    RLS (back to no RLS, as before my work);
  * payroll_runs (April DOES cover it): drop ONLY my policy, leaving RLS enabled
    and April's tenant_isolation_payroll_runs policy as the sole one.

The kiruko_app role + its grants are left in place (harmless, and the likely
rename target for kontokaz_app when April's design is extended). Phase 0 (the
per-request tenant binding) is unaffected and retained — it fixes a real gap in
April's design (app.company_id was never reliably set per request).

Revision ID: rls_revert_parallel_20260624
Revises: rls_app_grants_20260624
"""
from alembic import op


revision = "rls_revert_parallel_20260624"
down_revision = "rls_app_grants_20260624"
branch_labels = None
depends_on = None

_POLICY = "rls_tenant_isolation"

# Phase-1 tables April never covered → remove RLS entirely.
_DISABLE = [
    "jobs", "job_history", "departments", "salary_components", "salary_structures",
    "leave_types", "company_invites", "company_holiday_rates",
    "company_monthly_payrolls", "company_roles",
]
# Overlap with April → drop only MY policy; keep RLS + April's policy.
_POLICY_ONLY = ["payroll_runs"]


def upgrade() -> None:
    for t in _DISABLE:
        op.execute(f"DROP POLICY IF EXISTS {_POLICY} ON {t}")
        op.execute(f"ALTER TABLE {t} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {t} DISABLE ROW LEVEL SECURITY")
    for t in _POLICY_ONLY:
        op.execute(f"DROP POLICY IF EXISTS {_POLICY} ON {t}")


def downgrade() -> None:
    # Intentionally a no-op: re-introducing the parallel policies would recreate
    # the conflict this migration exists to remove. Re-do via an April-aligned
    # extension instead.
    pass
