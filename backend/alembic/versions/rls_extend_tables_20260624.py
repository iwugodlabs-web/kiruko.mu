"""RLS extension: apply April's rls_sensitive pattern to the remaining company tables.

Extends rls_sensitive_tables_20260428 (same conventions: denormalize company_id +
BEFORE-INSERT trigger for indirect tables, tenant_isolation_<tbl> policy that is
permissive when app.company_id is unset, '*' bypass, TEXT comparison, FORCE RLS)
to the company-scoped tables April did not cover.

COVERED HERE:
  * denormalized (indirect): time_logs, break_logs, leaves, schedule_assignments,
    schedule_assignee_statuses, salary_structure_lines, user_rights
  * policy-only (already have company_id): jobs, job_history, departments,
    salary_components, salary_structures, leave_types, company_invites,
    company_holiday_rates, company_monthly_payrolls, company_roles, notifications,
    company_user_roles, schedules, kiosk_devices, bonus_provisions

NULL branch (OR company_id IS NULL) added for jobs/job_history/notifications: a
job awaiting employer verification has NULL company_id and MUST stay visible to
the verify-by-BRN flow; system notifications are company-less. (April's denorm
tables become NOT NULL so they don't need it.)

DELIBERATELY NOT COVERED:
  * companies — anonymous signup INSERTs it; needs a bespoke policy (follow-up).
  * loans, repayments, transfers, purchases, subscriptions, rents, budget_goals —
    the worker's PERSONAL finances. Company-scoped RLS would expose them to the
    employer (privacy bug); they need PERSON-scoped RLS (separate follow-up).

private_users + the 9 sensitive tables are already covered by April.

Revision ID: rls_extend_tables_20260624
Revises: rls_revert_parallel_20260624
"""
from alembic import op


revision = "rls_extend_tables_20260624"
down_revision = "rls_revert_parallel_20260624"
branch_labels = None
depends_on = None

# Indirect tables to denormalize. ORDER MATTERS: time_logs before break_logs
# (break_logs derives company_id from the now-denormalized time_logs).
DENORMALIZE = [
    {"table": "time_logs",
     "fk_join": "FROM jobs WHERE jobs.job_id = NEW.job_id",
     "backfill": "UPDATE time_logs t SET company_id = j.company_id FROM jobs j "
                 "WHERE t.job_id = j.job_id AND t.company_id IS NULL"},
    {"table": "break_logs",
     "fk_join": "FROM time_logs WHERE time_logs.timelog_id = NEW.timelog_id",
     "backfill": "UPDATE break_logs b SET company_id = tl.company_id FROM time_logs tl "
                 "WHERE b.timelog_id = tl.timelog_id AND b.company_id IS NULL"},
    {"table": "leaves",
     "fk_join": "FROM private_users WHERE private_users.private_user_id = NEW.private_user_id",
     "backfill": "UPDATE leaves l SET company_id = p.company_id FROM private_users p "
                 "WHERE l.private_user_id = p.private_user_id AND l.company_id IS NULL"},
    {"table": "schedule_assignments",
     "fk_join": "FROM schedules WHERE schedules.schedule_id = NEW.schedule_id",
     "backfill": "UPDATE schedule_assignments s SET company_id = sc.company_id FROM schedules sc "
                 "WHERE s.schedule_id = sc.schedule_id AND s.company_id IS NULL"},
    {"table": "schedule_assignee_statuses",
     "fk_join": "FROM schedules WHERE schedules.schedule_id = NEW.schedule_id",
     "backfill": "UPDATE schedule_assignee_statuses s SET company_id = sc.company_id FROM schedules sc "
                 "WHERE s.schedule_id = sc.schedule_id AND s.company_id IS NULL"},
    {"table": "salary_structure_lines",
     "fk_join": "FROM salary_structures WHERE salary_structures.id = NEW.structure_id",
     "backfill": "UPDATE salary_structure_lines l SET company_id = ss.company_id FROM salary_structures ss "
                 "WHERE l.structure_id = ss.id AND l.company_id IS NULL"},
    {"table": "user_rights",
     "fk_join": "FROM private_users WHERE private_users.private_user_id = NEW.private_user_id",
     "backfill": "UPDATE user_rights u SET company_id = p.company_id FROM private_users p "
                 "WHERE u.private_user_id = p.private_user_id AND u.company_id IS NULL"},
]

# (table, has_nullable_company_id) — tables that already carry company_id.
_POLICY_ONLY = [
    ("jobs", True), ("job_history", True), ("departments", False),
    ("salary_components", False), ("salary_structures", False), ("leave_types", False),
    ("company_invites", False), ("company_holiday_rates", False),
    ("company_monthly_payrolls", False), ("company_roles", False),
    ("notifications", True), ("company_user_roles", False), ("schedules", False),
    ("kiosk_devices", False), ("bonus_provisions", False),
]

# Denormalized tables are NOT NULL after backfill -> no NULL branch.
_RLS_TABLES = [(d["table"], False) for d in DENORMALIZE] + _POLICY_ONLY


def _policy_body(table, nullable):
    null_branch = f" OR {table}.company_id IS NULL" if nullable else ""
    return (
        "NULLIF(current_setting('app.company_id', true), '') IS NULL"
        " OR current_setting('app.company_id', true) = '*'"
        f" OR {table}.company_id::text = current_setting('app.company_id', true)"
        f"{null_branch}"
    )


def upgrade() -> None:
    # Phase 1: denormalize company_id on indirect tables (April's pattern).
    for spec in DENORMALIZE:
        tbl = spec["table"]
        op.execute(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS company_id INTEGER "
                   f"REFERENCES companies(company_id) ON DELETE CASCADE")
        op.execute(spec["backfill"])
        op.execute(f"CREATE INDEX IF NOT EXISTS ix_{tbl}_company_id ON {tbl} (company_id)")
        fn = f"_set_{tbl}_company_id"
        op.execute(f"""
            CREATE OR REPLACE FUNCTION {fn}() RETURNS TRIGGER AS $$
            BEGIN
                IF NEW.company_id IS NULL THEN
                    SELECT company_id INTO NEW.company_id {spec['fk_join']};
                END IF;
                RETURN NEW;
            END; $$ LANGUAGE plpgsql
        """)
        op.execute(f"DROP TRIGGER IF EXISTS trg_{tbl}_set_company_id ON {tbl}")
        op.execute(f"CREATE TRIGGER trg_{tbl}_set_company_id BEFORE INSERT ON {tbl} "
                   f"FOR EACH ROW EXECUTE FUNCTION {fn}()")

    # Phase 2: enable RLS + tenant_isolation policy on each table.
    for tbl, nullable in _RLS_TABLES:
        body = _policy_body(tbl, nullable)
        op.execute(f"ALTER TABLE {tbl} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {tbl} FORCE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation_{tbl} ON {tbl}")
        op.execute(f"CREATE POLICY tenant_isolation_{tbl} ON {tbl} "
                   f"USING ({body}) WITH CHECK ({body})")


def downgrade() -> None:
    for tbl, _ in _RLS_TABLES:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation_{tbl} ON {tbl}")
        op.execute(f"ALTER TABLE {tbl} DISABLE ROW LEVEL SECURITY")
    for spec in reversed(DENORMALIZE):
        tbl = spec["table"]
        op.execute(f"DROP TRIGGER IF EXISTS trg_{tbl}_set_company_id ON {tbl}")
        op.execute(f"DROP FUNCTION IF EXISTS _set_{tbl}_company_id()")
        op.execute(f"DROP INDEX IF EXISTS ix_{tbl}_company_id")
        op.execute(f"ALTER TABLE {tbl} DROP COLUMN IF EXISTS company_id")
