"""Tests for M5a — multi-tenant SQL guard.

The guard is a SQLAlchemy event listener that flags SELECT/UPDATE/DELETE
queries touching multi-tenant tables without a `company_id` filter.

Modes (TENANT_GUARD_MODE env): off | log | raise.
- The default suite runs with `log` (no breakage).
- These tests temporarily flip the env to `raise` and assert that
  problematic queries actually fail.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from datetime import datetime
from decimal import Decimal as D

import pytest
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session


@contextmanager
def _strict_mode():
    """Flip TENANT_GUARD_MODE to 'raise' for the duration of a block."""
    prior = os.environ.get("TENANT_GUARD_MODE")
    os.environ["TENANT_GUARD_MODE"] = "raise"
    try:
        yield
    finally:
        if prior is None:
            del os.environ["TENANT_GUARD_MODE"]
        else:
            os.environ["TENANT_GUARD_MODE"] = prior


# ---------------------------------------------------------------------------
# tenant_context unit tests
# ---------------------------------------------------------------------------


class TestContextHelpers:
    def test_get_returns_none_when_not_set(self):
        from core.tenant_context import get_current_tenant

        assert get_current_tenant() is None

    def test_with_tenant_scopes_correctly(self):
        from core.tenant_context import get_current_tenant, with_tenant

        assert get_current_tenant() is None
        with with_tenant(42):
            assert get_current_tenant() == 42
        assert get_current_tenant() is None

    def test_nested_with_tenant_restores_outer(self):
        from core.tenant_context import get_current_tenant, with_tenant

        with with_tenant(1):
            assert get_current_tenant() == 1
            with with_tenant(2):
                assert get_current_tenant() == 2
            assert get_current_tenant() == 1
        assert get_current_tenant() is None

    def test_with_tenant_rejects_non_int(self):
        from core.tenant_context import with_tenant

        with pytest.raises(TypeError):
            with with_tenant("not-an-int"):  # type: ignore[arg-type]
                pass

    def test_bypass_requires_reason(self):
        from core.tenant_context import bypass_tenant_guard

        with pytest.raises(ValueError):
            with bypass_tenant_guard(""):
                pass
        with pytest.raises(ValueError):
            with bypass_tenant_guard("   "):
                pass

    def test_bypass_sets_flag(self):
        from core.tenant_context import bypass_tenant_guard, is_bypass_active

        assert is_bypass_active() is False
        with bypass_tenant_guard("smoke test"):
            assert is_bypass_active() is True
        assert is_bypass_active() is False


# ---------------------------------------------------------------------------
# SQL scan logic — pure-function tests on rendered SQL strings
# ---------------------------------------------------------------------------


class TestSqlScan:
    def test_scan_finds_multi_tenant_tables(self):
        from core.tenant_guard import _scan

        sql = "SELECT * FROM private_users WHERE id = 1"
        referenced, filtered = _scan(sql)
        assert referenced == {"private_users"}
        # bare `id = 1` reference but no `company_id` filter
        assert filtered == set()

    def test_scan_recognizes_qualified_company_id(self):
        from core.tenant_guard import _scan

        sql = (
            "SELECT private_users.id FROM private_users "
            "WHERE private_users.company_id = 1"
        )
        referenced, filtered = _scan(sql)
        assert referenced == {"private_users"}
        assert filtered == {"private_users"}

    def test_scan_recognizes_bare_company_id_in_single_table_query(self):
        from core.tenant_guard import _scan

        sql = "SELECT * FROM private_users WHERE company_id = 1"
        referenced, filtered = _scan(sql)
        assert filtered == {"private_users"}

    def test_scan_skips_reference_tables(self):
        from core.tenant_guard import _scan

        sql = "SELECT * FROM countries WHERE code = 'MU'"
        referenced, filtered = _scan(sql)
        assert referenced == set()  # countries is reference data
        assert filtered == set()

    def test_scan_skips_indirect_tables(self):
        from core.tenant_guard import _scan

        # salaries joins through to jobs.company_id but isn't in DIRECT.
        # The scan shouldn't flag it standalone — that's M5b's job.
        sql = "SELECT * FROM salaries WHERE salary_id = 1"
        referenced, _ = _scan(sql)
        assert referenced == set()

    def test_scan_join_with_one_company_filter_passes(self):
        from core.tenant_guard import _scan

        sql = (
            "SELECT j.*, p.* FROM jobs j "
            "JOIN private_users p ON p.private_user_id = j.private_user_id "
            "WHERE j.company_id = 1"
        )
        referenced, filtered = _scan(sql)
        assert referenced == {"jobs", "private_users"}
        # jobs has a company_id filter; private_users transitively isolated.
        assert "jobs" in filtered


# ---------------------------------------------------------------------------
# End-to-end via the live event listener
# ---------------------------------------------------------------------------


class TestListenerStrict:
    def test_unfiltered_query_raises_in_strict_mode(self, db: Session):
        from core.tenant_context import TenantIsolationError

        with _strict_mode():
            with pytest.raises(TenantIsolationError, match="multi-tenant"):
                # Raw query against `private_users` with no company_id filter.
                db.execute(sql_text("SELECT * FROM private_users LIMIT 1")).fetchone()

    def test_filtered_query_passes_in_strict_mode(self, db: Session, test_company_id: int):
        with _strict_mode():
            # Same query but with a company_id filter — guard allows it.
            row = db.execute(
                sql_text("SELECT private_user_id FROM private_users WHERE company_id = :cid LIMIT 1"),
                {"cid": test_company_id},
            ).fetchone()
            assert row is not None

    def test_reference_table_query_always_passes(self, db: Session):
        with _strict_mode():
            rows = db.execute(
                sql_text("SELECT code FROM countries WHERE code = 'MU'")
            ).fetchall()
            assert len(rows) >= 1

    def test_bypass_disables_guard(self, db: Session):
        from core.tenant_context import bypass_tenant_guard

        with _strict_mode():
            with bypass_tenant_guard("test bypass"):
                row = db.execute(
                    sql_text("SELECT * FROM private_users LIMIT 1")
                ).fetchone()
                assert row is not None  # No raise

    def test_orm_query_with_filter_passes_strict(self, db: Session, test_company_id: int):
        from core.model import Company

        with _strict_mode():
            company = (
                db.query(Company)
                .filter(Company.company_id == test_company_id)
                .one_or_none()
            )
            assert company is not None

    def test_off_mode_disables_listener_entirely(self, db: Session):
        prior = os.environ.get("TENANT_GUARD_MODE")
        os.environ["TENANT_GUARD_MODE"] = "off"
        try:
            # Even without filter, no warning/error.
            row = db.execute(sql_text("SELECT * FROM private_users LIMIT 1")).fetchone()
            assert row is not None
        finally:
            if prior is None:
                del os.environ["TENANT_GUARD_MODE"]
            else:
                os.environ["TENANT_GUARD_MODE"] = prior


class TestEvaluateFunction:
    def test_evaluate_passes_insert(self, db: Session):
        """Inserts into multi-tenant tables are not checked — the company_id
        is in the row data, not WHERE."""
        from sqlalchemy import insert

        from core.model import Department
        from core.tenant_guard import _evaluate

        # Build an INSERT statement (without executing it)
        stmt = insert(Department).values(company_id=1, name="Test")
        # _evaluate only checks Select/Update/Delete — Insert returns None
        assert _evaluate(stmt) is None
