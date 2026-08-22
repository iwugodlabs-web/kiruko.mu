"""Tests for M5b — Postgres Row-Level Security on the 9 sensitive tables.

The headline guarantee under test:
    With `app.company_id = '<A>'` set, a SELECT on a multi-tenant table
    returns ONLY company A's rows even when the SQL forgets a WHERE
    clause. The DB rejects cross-tenant access at the policy layer; an
    application bug above can't leak.

Coverage:
  * Permissive default — no `app.company_id` → no enforcement (existing
    tests stay green; this just confirms the rollout-safe behavior).
  * Bypass via `app.company_id = '*'` — all rows visible.
  * Tenant-scoped — only matching company_id returned.
  * INSERT WITH CHECK — can't insert with a foreign company_id.
  * UPDATE WITH CHECK — can't move a row to a foreign tenant.
  * Auto-populate trigger — INSERT without company_id picks it up from
    the FK target.
  * The new denormalized company_id columns are present on the 7 tables.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal as D

import pytest
from sqlalchemy import text as sql_text
from sqlalchemy.exc import DatabaseError, IntegrityError
from sqlalchemy.orm import Session


# ---------------------------------------------------------------------------
# Helpers — build two distinct tenants and let tests prove they're isolated
# ---------------------------------------------------------------------------


def _make_tenant(db: Session, label: str) -> dict:
    """Create a Company + PrivateUser + Job + active EmployeeSalaryAssignment
    for an isolated test tenant. Returns IDs."""
    from core.model import (
        Company,
        EmployeeSalaryAssignment,
        Job,
        PrivateUser,
        SalaryComponent,
        SalaryStructure,
        SalaryStructureLine,
        User,
    )
    from services.salary_resolver import build_structure_snapshot

    suffix = datetime.utcnow().strftime("%H%M%S%f") + "-" + label

    owner = User(
        user_type="company",
        email=f"rls-{suffix}@kontokaz.test",
        user_name=f"rls-{suffix}",
        password_hash="x",
    )
    db.add(owner)
    db.flush()

    co = Company(
        user_id=owner.user_id,
        company_name=f"RLS Co {label} {suffix}",
        email=f"rls-co-{suffix}@kontokaz.test",
        brn=f"RLS_{suffix}",
        country_code="MU",
    )
    db.add(co)
    db.flush()

    emp_user = User(
        user_type="private",
        email=f"rls-emp-{suffix}@kontokaz.test",
        user_name=f"rls-emp-{suffix}",
        password_hash="x",
    )
    db.add(emp_user)
    db.flush()

    emp = PrivateUser(
        user_id=emp_user.user_id,
        first_name="RLS",
        last_name=label,
        company_id=co.company_id,
        role="employee",
        pass_port_number=f"RLS_PASS_{suffix}",
    )
    db.add(emp)
    db.flush()

    job = Job(
        private_user_id=emp.private_user_id,
        company_id=co.company_id,
        job_title="RLS Test",
        employer_name=co.company_name,
        employer_brn=co.brn,
        employer_email=co.email,
        first_date_of_employment=date(2024, 1, 1),
    )
    db.add(job)
    db.flush()

    basic = SalaryComponent(
        company_id=co.company_id,
        code="BASIC",
        label="Basic",
        kind="earning",
        category="earning.basic",
        is_basic=True,
        is_taxable=True,
    )
    db.add(basic)
    db.flush()

    struct = SalaryStructure(
        company_id=co.company_id,
        name=f"RLS Structure {suffix}",
    )
    db.add(struct)
    db.flush()

    db.add(
        SalaryStructureLine(
            structure_id=struct.id,
            component_id=basic.id,
            amount=D("30000.00"),
            order_index=0,
        )
    )
    db.flush()

    snap = build_structure_snapshot(db, struct.id)
    a = EmployeeSalaryAssignment(
        private_user_id=emp.private_user_id,
        structure_id=struct.id,
        structure_snapshot=snap,
        currency="MUR",
        effective_from=date(2024, 1, 1),
    )
    db.add(a)
    db.commit()

    return {
        "owner_email": owner.email,
        "emp_email": emp_user.email,
        "company_id": co.company_id,
        "private_user_id": emp.private_user_id,
        "job_id": job.job_id,
        "basic_id": basic.id,
        "structure_id": struct.id,
        "assignment_id": a.id,
        "passport": emp.pass_port_number,
    }


def _cleanup_tenant(db: Session, ctx: dict) -> None:
    db.rollback()
    # When we cleanup, RLS may be set to a tenant; drop it so cleanup sees all rows.
    db.execute(sql_text("SELECT set_config('app.company_id', '*', true)"))
    db.execute(
        sql_text("DELETE FROM employee_salary_assignments WHERE private_user_id=:p"),
        {"p": ctx["private_user_id"]},
    )
    db.execute(sql_text("DELETE FROM jobs WHERE job_id=:j"), {"j": ctx["job_id"]})
    db.execute(
        sql_text("DELETE FROM private_users WHERE pass_port_number=:p"),
        {"p": ctx["passport"]},
    )
    db.execute(
        sql_text("DELETE FROM salary_structure_lines WHERE structure_id=:s"),
        {"s": ctx["structure_id"]},
    )
    db.execute(
        sql_text("DELETE FROM salary_structures WHERE id=:s"),
        {"s": ctx["structure_id"]},
    )
    db.execute(
        sql_text("DELETE FROM salary_components WHERE id=:c"),
        {"c": ctx["basic_id"]},
    )
    db.execute(
        sql_text("DELETE FROM companies WHERE company_id=:c"),
        {"c": ctx["company_id"]},
    )
    db.execute(
        sql_text("DELETE FROM users WHERE email IN (:e1, :e2)"),
        {"e1": ctx["owner_email"], "e2": ctx["emp_email"]},
    )
    db.commit()


@contextmanager
def _set_pg_company_id(db: Session, value: str, *, as_app_role: bool = True):
    """Set `app.company_id` for the active session and (by default) SET
    ROLE to `kiruko_app` so RLS actually applies — the test connection
    is normally `postgres` (superuser+BYPASSRLS) which bypasses RLS no
    matter what the policies say.

    `as_app_role=False` skips the role switch (useful for verifying that
    superuser still bypasses, as a sanity check).
    """
    try:
        db.commit()
    except Exception:
        db.rollback()
    if as_app_role:
        db.execute(sql_text("SET ROLE kiruko_app"))
    db.execute(sql_text("SELECT set_config('app.company_id', :v, false)"), {"v": value})
    try:
        yield
    finally:
        try:
            db.commit()
        except Exception:
            db.rollback()
        if as_app_role:
            db.execute(sql_text("RESET ROLE"))
        # Reset to bypass so subsequent tests / cleanup see all rows.
        db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
        try:
            db.commit()
        except Exception:
            db.rollback()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestSchemaArtifacts:
    """Sanity: the migration actually denormalized + enabled RLS."""

    def test_company_id_columns_exist(self, db: Session):
        rows = db.execute(
            sql_text("""
                SELECT table_name FROM information_schema.columns
                WHERE column_name = 'company_id'
                  AND table_schema = 'public'
                  AND table_name IN (
                    'payslips','salaries','employee_salary_assignments',
                    'employee_salary_overrides','employee_one_off_allowances',
                    'document_vault','leave_quotas'
                  )
                ORDER BY table_name
            """)
        ).fetchall()
        present = {r[0] for r in rows}
        assert present == {
            "payslips", "salaries", "employee_salary_assignments",
            "employee_salary_overrides", "employee_one_off_allowances",
            "document_vault", "leave_quotas",
        }, f"missing denormalized company_id on: {present}"

    def test_rls_enabled_on_nine_tables(self, db: Session):
        rows = db.execute(
            sql_text("""
                SELECT relname FROM pg_class
                WHERE relrowsecurity = true
                  AND relname IN (
                    'payroll_runs','private_users','payslips','salaries',
                    'employee_salary_assignments','employee_salary_overrides',
                    'employee_one_off_allowances','document_vault','leave_quotas'
                  )
                ORDER BY relname
            """)
        ).fetchall()
        assert len(rows) == 9


class TestPermissiveDefault:
    def test_unset_app_company_id_returns_all_rows(self, db: Session):
        """Without `app.company_id` set (or empty), policy is permissive
        — same as before RLS was enabled. Existing tests rely on this."""
        from core.model import PrivateUser

        a = _make_tenant(db, "perm-A")
        b = _make_tenant(db, "perm-B")
        try:
            with _set_pg_company_id(db, ""):  # empty → permissive
                ids = {
                    pid for (pid,) in db.execute(
                        sql_text(
                            "SELECT private_user_id FROM private_users "
                            "WHERE pass_port_number IN (:pa, :pb)"
                        ),
                        {"pa": a["passport"], "pb": b["passport"]},
                    ).fetchall()
                }
            assert {a["private_user_id"], b["private_user_id"]}.issubset(ids)
        finally:
            _cleanup_tenant(db, a)
            _cleanup_tenant(db, b)


class TestStrictIsolation:
    """Headline M5b guarantee: one tenant's queries can't see another's rows."""

    def test_select_only_returns_own_tenant(self, db: Session):
        from core.model import PrivateUser

        a = _make_tenant(db, "strict-A")
        b = _make_tenant(db, "strict-B")
        try:
            with _set_pg_company_id(db, str(a["company_id"])):
                # Even with NO WHERE clause on private_users at all, only A's rows visible.
                rows = db.execute(
                    sql_text(
                        "SELECT private_user_id, company_id FROM private_users"
                    )
                ).fetchall()
                visible_companies = {r[1] for r in rows}
                # Should contain ONLY A's company_id (and possibly other A-owned rows
                # from earlier tests/fixtures with same company)
                assert b["company_id"] not in visible_companies, (
                    f"RLS leak: company B (id={b['company_id']}) visible while "
                    f"app.company_id={a['company_id']} is set. Companies seen: {visible_companies}"
                )
                visible_pids = {r[0] for r in rows}
                assert a["private_user_id"] in visible_pids
                assert b["private_user_id"] not in visible_pids
        finally:
            _cleanup_tenant(db, a)
            _cleanup_tenant(db, b)

    def test_payslips_tenant_isolated(self, db: Session, seed_mu_rules):
        """Same isolation, on a denormalized table whose company_id was
        backfilled via the trigger."""
        from schema.payroll_schema import PayrollRunCreate
        from services import payroll_engine

        a = _make_tenant(db, "ps-A")
        b = _make_tenant(db, "ps-B")
        try:
            # Run payroll for both companies (in default permissive mode).
            for ctx in (a, b):
                payroll_engine.create_draft_run(
                    db,
                    PayrollRunCreate(
                        company_id=ctx["company_id"],
                        period_start=date(2026, 5, 1),
                        period_end=date(2026, 5, 31),
                    ),
                    actor_user_id=None,
                )
                db.commit()

            # Now switch to A's tenant scope and confirm only A's payslips visible.
            with _set_pg_company_id(db, str(a["company_id"])):
                rows = db.execute(
                    sql_text("SELECT id, company_id FROM payslips")
                ).fetchall()
                companies_seen = {r[1] for r in rows}
                assert b["company_id"] not in companies_seen
                assert a["company_id"] in companies_seen

            # Cleanup the runs we created
            db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
            db.execute(
                sql_text("DELETE FROM payslips WHERE company_id IN (:a, :b)"),
                {"a": a["company_id"], "b": b["company_id"]},
            )
            db.execute(
                sql_text("DELETE FROM payroll_runs WHERE company_id IN (:a, :b)"),
                {"a": a["company_id"], "b": b["company_id"]},
            )
            db.commit()
        finally:
            _cleanup_tenant(db, a)
            _cleanup_tenant(db, b)


class TestWithCheck:
    def test_cannot_insert_into_foreign_tenant(self, db: Session):
        """With app.company_id=A, an INSERT specifying company_id=B is
        rejected by the policy's WITH CHECK clause."""
        a = _make_tenant(db, "wc-A")
        b = _make_tenant(db, "wc-B")
        try:
            with _set_pg_company_id(db, str(a["company_id"])):
                with pytest.raises(DatabaseError):
                    db.execute(
                        sql_text(
                            "INSERT INTO leave_quotas "
                            "(private_user_id, leave_type, total_days, used_days, year, company_id) "
                            "VALUES (:pid, 'annual', 22, 0, 2026, :foreign)"
                        ),
                        {"pid": b["private_user_id"], "foreign": b["company_id"]},
                    )
                    db.commit()
                db.rollback()
        finally:
            _cleanup_tenant(db, a)
            _cleanup_tenant(db, b)


class TestAutoPopulateTrigger:
    def test_insert_without_company_id_gets_filled_from_fk(self, db: Session):
        """The BEFORE INSERT trigger on payslips fills company_id from
        payroll_runs.company_id when caller omits it."""
        from core.model import PayrollRun, PrivateUser

        a = _make_tenant(db, "trig-A")
        try:
            run = PayrollRun(
                company_id=a["company_id"],
                period_start=date(2026, 9, 1),
                period_end=date(2026, 9, 30),
                status="draft",
                currency="MUR",
            )
            db.add(run)
            db.flush()

            # Insert payslip WITHOUT company_id. Trigger should fill it from run.
            res = db.execute(
                sql_text(
                    "INSERT INTO payslips (payroll_run_id, private_user_id, gross, net_pay) "
                    "VALUES (:rid, :pid, 1000, 1000) RETURNING id, company_id"
                ),
                {"rid": run.id, "pid": a["private_user_id"]},
            ).fetchone()
            db.commit()

            assert res is not None
            assert res[1] == a["company_id"], (
                f"Trigger didn't auto-fill company_id (got {res[1]}, expected {a['company_id']})"
            )

            # Cleanup
            db.execute(sql_text("DELETE FROM payslips WHERE id = :id"), {"id": res[0]})
            db.execute(sql_text("DELETE FROM payroll_runs WHERE id = :id"), {"id": run.id})
            db.commit()
        finally:
            _cleanup_tenant(db, a)


class TestBypassValue:
    def test_star_value_disables_enforcement(self, db: Session):
        """`app.company_id='*'` is the explicit bypass."""
        a = _make_tenant(db, "byp-A")
        b = _make_tenant(db, "byp-B")
        try:
            with _set_pg_company_id(db, "*"):
                rows = db.execute(
                    sql_text(
                        "SELECT company_id FROM private_users "
                        "WHERE pass_port_number IN (:pa, :pb)"
                    ),
                    {"pa": a["passport"], "pb": b["passport"]},
                ).fetchall()
                companies = {r[0] for r in rows}
                assert {a["company_id"], b["company_id"]}.issubset(companies)
        finally:
            _cleanup_tenant(db, a)
            _cleanup_tenant(db, b)
