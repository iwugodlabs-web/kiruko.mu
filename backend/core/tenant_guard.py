"""Multi-tenant SQL guard (M5a).

A SQLAlchemy `before_execute` event listener inspects every SELECT/UPDATE/
DELETE statement and flags queries that touch multi-tenant tables without
a `company_id` filter. This is defense-in-depth at the application layer;
M5b will add Postgres Row-Level Security on top for the most sensitive
tables.

Modes (set via TENANT_GUARD_MODE env var):
    "off"   — listener does nothing (production rollback switch)
    "log"   — log a warning for any flagged query (default — rollout-safe)
    "raise" — raise TenantIsolationError, fail loud (used in CI / pytest M5a tests)

Tables grouped:
    DIRECT_MULTI_TENANT — have a `company_id` column directly. The guard
        verifies a filter on `<table>.company_id` is present in the query.
    REFERENCE — country/sector reference data, auth-only tables, etc. Never
        checked.

Tables that join through to company_id (salaries → jobs.company_id,
payslips → payroll_runs.company_id, etc.) are not in DIRECT_MULTI_TENANT.
M5b will denormalize `company_id` onto those tables for both the RLS layer
and to bring them under the guard's coverage.

Limitations:
    * Inserts are not checked (the company_id is in the row data, not WHERE).
    * Raw `text()` queries can't be inspected — the listener only sees
      compiled `Select`/`Update`/`Delete` statements.
    * The check is conservative: a query needs a filter on AT LEAST ONE
      multi-tenant table referenced. Joins that filter on one side and
      transitively isolate the others are accepted.
    * False positives are surfaced via 'log' mode; bumping to 'raise' is a
      deliberate test-mode choice.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Optional

from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.sql import Delete, Select, Update
from sqlalchemy.sql.elements import TextClause

from core.tenant_context import TenantIsolationError, get_current_tenant, is_bypass_active


logger = logging.getLogger("kontokaz.tenant_guard")


# Tables with a direct company_id column. Touching one of these in a
# SELECT/UPDATE/DELETE without a `company_id` filter is suspicious.
DIRECT_MULTI_TENANT_TABLES: frozenset[str] = frozenset({
    "companies",
    "private_users",
    "jobs",
    "job_history",
    "departments",
    "salary_components",
    "salary_structures",
    "leave_types",
    "company_invites",
    "company_holiday_rates",
    "company_monthly_payrolls",
    "company_roles",
    "payroll_runs",
})

# Tables that don't have a direct company_id (they join through to it).
# Out of scope for M5a — M5b denormalizes these and adds Postgres RLS.
INDIRECT_MULTI_TENANT_TABLES: frozenset[str] = frozenset({
    "salaries",                    # via jobs
    "time_logs",                   # via jobs
    "break_logs",                  # via time_logs → jobs
    "salary_structure_lines",      # via salary_structures
    "employee_salary_assignments", # via private_users
    "employee_salary_overrides",   # via assignments
    "employee_country_assignments",# via private_users
    "employee_one_off_allowances", # via private_users
    "payslips",                    # via payroll_runs
    "leaves",                      # via private_users
    "leave_quotas",                # via private_users
    "schedules",                   # via company_id but flexible
    "schedule_assignments",        # association
    "schedule_assignee_statuses",  # via schedules
    "company_user_roles",          # via company_id
    "user_rights",                 # via private_users
    "loans", "repayments", "transfers", "purchases", "subscriptions",
    "rents", "budget_goals",       # personal-finance via private_users
    "document_vault",              # via private_users
    "notifications",               # via users
})

# Reference / auth / cross-tenant-by-design tables. Never checked.
REFERENCE_TABLES: frozenset[str] = frozenset({
    "countries", "sectors", "sector_categories", "sector_grades",
    "sector_category_salaries", "public_holidays",
    "country_leave_defaults", "country_bonus_rules",
    "tax_brackets", "tax_bracket_sets", "statutory_deductions",
    "platform_roles", "user_platform_roles",
    "users",                # auth identities; tenant scope checked at API
    "audit_logs",           # cross-tenant by design (platform admin view)
    "request_logs",
    "verification_tokens",
    "platform_invites",
    "alembic_version",      # migration plumbing
})


def _strict_mode() -> str:
    """Return one of 'off' | 'log' | 'raise', from TENANT_GUARD_MODE env var."""
    return os.environ.get("TENANT_GUARD_MODE", "log").strip().lower()


def _statement_to_sql(stmt) -> Optional[str]:
    """Compile a SQLAlchemy statement to its rendered SQL text. Best-effort —
    returns None if compilation fails for any reason."""
    try:
        return str(stmt.compile())
    except Exception:
        return None


_FROM_OR_JOIN_RE = re.compile(
    r'\b(?:from|join|update|into|delete\s+from)\s+["\']?(\w+)["\']?',
    re.IGNORECASE,
)


def _scan(sql: str) -> tuple[set[str], set[str]]:
    """Inspect a rendered SQL string. Returns:
        (multi_tenant_tables_referenced, multi_tenant_tables_considered_filtered)

    Heuristic for "considered filtered":
        If any multi-tenant table is in FROM/JOIN AND the word `company_id`
        appears anywhere in the SQL, treat all referenced multi-tenant tables
        as filtered. This is intentionally coarse so it tolerates aliases
        (`j.company_id`) and joins that transitively isolate via one table.

    The trade-off: a query that references `company_id` in a non-WHERE
    context (e.g. SELECT clause) gets a free pass. False positives are
    worse than false negatives for an opt-in, advisory layer — M5b's RLS
    is the strict guarantee.
    """
    text_lower = sql.lower()

    referenced: set[str] = set()
    for match in _FROM_OR_JOIN_RE.finditer(text_lower):
        tbl = match.group(1)
        if tbl in DIRECT_MULTI_TENANT_TABLES:
            referenced.add(tbl)

    if not referenced:
        return set(), set()

    has_company_id = bool(re.search(r'\bcompany_id\b', text_lower))
    return (referenced, referenced if has_company_id else set())


def _evaluate(stmt) -> Optional[str]:
    """Return None if the statement passes; otherwise return a violation message."""
    if isinstance(stmt, TextClause):
        sql = str(stmt.text)
    elif isinstance(stmt, (Select, Update, Delete)):
        sql = _statement_to_sql(stmt)
        if sql is None:
            return None
    else:
        return None  # Insert, DDL, ORM bulk-insert, etc.

    referenced, filtered = _scan(sql)
    if not referenced:
        return None
    if filtered:
        return None
    return (
        f"tenant_guard: query touches multi-tenant tables {sorted(referenced)} "
        f"without any company_id filter (tenant={get_current_tenant()})"
    )


def install_listener(engine: Engine) -> None:
    """Attach the guard listener to a SQLAlchemy Engine. Idempotent — safe
    to call once at engine creation. Calling repeatedly attaches multiple
    listeners; guard against that by checking _has_listener flag."""
    if getattr(engine, "_kontokaz_tenant_guard_installed", False):
        return

    @event.listens_for(engine, "before_execute")
    def _on_before_execute(conn, clauseelement, multiparams, params, execution_options):
        mode = _strict_mode()
        if mode == "off":
            return
        if is_bypass_active():
            return

        violation = _evaluate(clauseelement)
        if violation is None:
            return

        if mode == "raise":
            raise TenantIsolationError(violation)
        # default: log
        logger.warning(violation)

    engine._kontokaz_tenant_guard_installed = True
