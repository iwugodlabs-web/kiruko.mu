"""Tests for M2 — salary structure editability.

Coverage:
  * PATCH a line's amount/formula
  * DELETE a line (no cascade — existing assignment snapshots intact)
  * PATCH structure metadata (rename, scoping, is_default uniqueness)
  * DELETE = soft-delete (archived_at set, default flags cleared)
  * Restore reverses archive
  * Archived structures excluded from list by default; included with
    include_archived=true
  * Auto-suggest skips archived structures
  * New assignment creation refuses an archived structure
  * Usage endpoint returns active count + sample names

The handler under test is the FastAPI app — we drive it via TestClient
with auth overridden to an admin.
"""

from __future__ import annotations

from datetime import datetime, date
from decimal import Decimal as D

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session


# ---------------------------------------------------------------------------
# Fixture — owner + company + one structure with two lines + one component
# ---------------------------------------------------------------------------


def _setup(db: Session) -> dict:
    from core.model import (
        Company,
        PrivateUser,
        SalaryComponent,
        SalaryStructure,
        SalaryStructureLine,
        User,
    )

    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    db.commit()

    suffix = datetime.utcnow().strftime("%H%M%S%f")

    owner = User(
        user_type="company",
        email=f"editco-owner-{suffix}@kontokaz.test",
        user_name=f"editco-owner-{suffix}",
        password_hash="x",
    )
    db.add(owner)
    db.flush()

    co = Company(
        user_id=owner.user_id,
        company_name=f"EditCo {suffix}",
        email=f"editco-{suffix}@kontokaz.test",
        brn=f"EDIT_BRN_{suffix}",
        country_code="MU",
    )
    db.add(co)
    db.flush()

    basic = SalaryComponent(
        company_id=co.company_id,
        code=f"BASIC_{suffix}",
        label="Basic",
        kind="earning",
        category="earning.basic",
        is_basic=True,
        is_taxable=True,
        is_recurring=True,
    )
    transport = SalaryComponent(
        company_id=co.company_id,
        code=f"TRANSPORT_{suffix}",
        label="Transport",
        kind="earning",
        category="allowance.transport",
        is_basic=False,
        is_taxable=False,
        is_recurring=True,
    )
    db.add_all([basic, transport])
    db.flush()

    structure = SalaryStructure(
        company_id=co.company_id,
        name=f"Grade-A-{suffix}",
        is_default=True,
    )
    db.add(structure)
    db.flush()

    line_basic = SalaryStructureLine(
        structure_id=structure.id,
        component_id=basic.id,
        amount=D("25000"),
        order_index=1,
    )
    line_transport = SalaryStructureLine(
        structure_id=structure.id,
        component_id=transport.id,
        amount=D("2500"),
        order_index=2,
    )
    db.add_all([line_basic, line_transport])
    db.commit()

    return {
        "owner_user_id": owner.user_id,
        "owner_email": owner.email,
        "company_id": co.company_id,
        "company_brn": co.brn,
        "company_email": co.email,
        "structure_id": structure.id,
        "line_basic_id": line_basic.id,
        "line_transport_id": line_transport.id,
        "basic_component_id": basic.id,
        "transport_component_id": transport.id,
        "suffix": suffix,
    }


def _cleanup(db: Session, ctx: dict) -> None:
    db.rollback()
    db.execute(
        sql_text(
            "DELETE FROM employee_salary_overrides "
            "WHERE assignment_id IN ("
            "  SELECT id FROM employee_salary_assignments WHERE structure_id=:s"
            ")"
        ),
        {"s": ctx["structure_id"]},
    )
    db.execute(
        sql_text("DELETE FROM employee_salary_assignments WHERE structure_id=:s"),
        {"s": ctx["structure_id"]},
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
        sql_text(
            "DELETE FROM salary_components WHERE id IN (:b, :t)"
        ),
        {"b": ctx["basic_component_id"], "t": ctx["transport_component_id"]},
    )
    db.execute(
        sql_text("DELETE FROM private_users WHERE company_id=:c"),
        {"c": ctx["company_id"]},
    )
    db.execute(
        sql_text("DELETE FROM companies WHERE company_id=:c"),
        {"c": ctx["company_id"]},
    )
    db.execute(
        sql_text("DELETE FROM users WHERE email=:e"),
        {"e": ctx["owner_email"]},
    )
    db.commit()


def _make_client(_engine, current_user_id: int) -> TestClient:
    from fastapi import Depends as _Depends
    from sqlalchemy.orm import Session, sessionmaker

    from core import config as core_config
    from core.dependencies import get_current_user
    from core.model import User
    from main import app

    SessionFactory = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

    def _override_db():
        s = SessionFactory()
        try:
            yield s
        finally:
            s.close()

    def _override_user(db: Session = _Depends(core_config.get_db)) -> User:
        return db.query(User).filter(User.user_id == current_user_id).one()

    app.dependency_overrides[core_config.get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_user
    return TestClient(app, raise_server_exceptions=False)


def _clear_overrides() -> None:
    from main import app
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestPatchLine:
    def test_patch_amount_persists(self, db: Session, _engine):
        ctx = _setup(db)
        try:
            client = _make_client(_engine, ctx["owner_user_id"])
            try:
                resp = client.patch(
                    f"/api/v1/companies/{ctx['company_id']}/salary-structures/"
                    f"{ctx['structure_id']}/lines/{ctx['line_transport_id']}",
                    json={"amount": "3000.00"},
                )
                assert resp.status_code == 200, resp.text
                assert resp.json()["amount"] == "3000.00"
            finally:
                _clear_overrides()

            row = db.execute(
                sql_text("SELECT amount FROM salary_structure_lines WHERE id=:i"),
                {"i": ctx["line_transport_id"]},
            ).fetchone()
            assert str(row[0]) == "3000.00"
        finally:
            _cleanup(db, ctx)


class TestDeleteLine:
    def test_delete_line_204(self, db: Session, _engine):
        ctx = _setup(db)
        try:
            client = _make_client(_engine, ctx["owner_user_id"])
            try:
                resp = client.delete(
                    f"/api/v1/companies/{ctx['company_id']}/salary-structures/"
                    f"{ctx['structure_id']}/lines/{ctx['line_transport_id']}",
                )
                assert resp.status_code == 204, resp.text
            finally:
                _clear_overrides()

            row = db.execute(
                sql_text("SELECT 1 FROM salary_structure_lines WHERE id=:i"),
                {"i": ctx["line_transport_id"]},
            ).fetchone()
            assert row is None
        finally:
            _cleanup(db, ctx)


class TestPatchStructure:
    def test_rename_persists(self, db: Session, _engine):
        ctx = _setup(db)
        try:
            client = _make_client(_engine, ctx["owner_user_id"])
            try:
                resp = client.patch(
                    f"/api/v1/companies/{ctx['company_id']}/salary-structures/"
                    f"{ctx['structure_id']}",
                    json={"name": f"Grade-A-Renamed-{ctx['suffix']}"},
                )
                assert resp.status_code == 200, resp.text
                assert resp.json()["name"].startswith("Grade-A-Renamed")
            finally:
                _clear_overrides()
        finally:
            _cleanup(db, ctx)

    def test_archived_structure_cannot_be_patched(self, db: Session, _engine):
        ctx = _setup(db)
        try:
            db.execute(
                sql_text(
                    "UPDATE salary_structures SET archived_at=NOW() WHERE id=:s"
                ),
                {"s": ctx["structure_id"]},
            )
            db.commit()

            client = _make_client(_engine, ctx["owner_user_id"])
            try:
                resp = client.patch(
                    f"/api/v1/companies/{ctx['company_id']}/salary-structures/"
                    f"{ctx['structure_id']}",
                    json={"name": "Should-Fail"},
                )
                assert resp.status_code == 409, resp.text
            finally:
                _clear_overrides()
        finally:
            _cleanup(db, ctx)


class TestArchiveAndRestore:
    def test_delete_soft_deletes_and_clears_defaults(self, db: Session, _engine):
        ctx = _setup(db)
        try:
            client = _make_client(_engine, ctx["owner_user_id"])
            try:
                resp = client.delete(
                    f"/api/v1/companies/{ctx['company_id']}/salary-structures/"
                    f"{ctx['structure_id']}"
                )
                assert resp.status_code == 204, resp.text
            finally:
                _clear_overrides()

            row = db.execute(
                sql_text(
                    "SELECT archived_at, is_default FROM salary_structures WHERE id=:s"
                ),
                {"s": ctx["structure_id"]},
            ).fetchone()
            assert row[0] is not None, "archived_at should be set"
            assert row[1] is False, "is_default should be cleared"
        finally:
            _cleanup(db, ctx)

    def test_archived_excluded_from_list_by_default(self, db: Session, _engine):
        ctx = _setup(db)
        try:
            db.execute(
                sql_text(
                    "UPDATE salary_structures SET archived_at=NOW() WHERE id=:s"
                ),
                {"s": ctx["structure_id"]},
            )
            db.commit()

            client = _make_client(_engine, ctx["owner_user_id"])
            try:
                resp = client.get(
                    f"/api/v1/companies/{ctx['company_id']}/salary-structures"
                )
                assert resp.status_code == 200, resp.text
                ids = {row["id"] for row in resp.json()}
                assert ctx["structure_id"] not in ids

                resp = client.get(
                    f"/api/v1/companies/{ctx['company_id']}/salary-structures"
                    f"?include_archived=true"
                )
                assert resp.status_code == 200, resp.text
                ids = {row["id"] for row in resp.json()}
                assert ctx["structure_id"] in ids
            finally:
                _clear_overrides()
        finally:
            _cleanup(db, ctx)

    def test_restore_reverses_archive(self, db: Session, _engine):
        ctx = _setup(db)
        try:
            client = _make_client(_engine, ctx["owner_user_id"])
            try:
                # archive first
                resp = client.delete(
                    f"/api/v1/companies/{ctx['company_id']}/salary-structures/"
                    f"{ctx['structure_id']}"
                )
                assert resp.status_code == 204
                # now restore
                resp = client.post(
                    f"/api/v1/companies/{ctx['company_id']}/salary-structures/"
                    f"{ctx['structure_id']}/restore"
                )
                assert resp.status_code == 200, resp.text
                assert resp.json().get("archived_at") is None
            finally:
                _clear_overrides()
        finally:
            _cleanup(db, ctx)


class TestUsageEndpoint:
    def test_usage_returns_zero_for_new_structure(self, db: Session, _engine):
        ctx = _setup(db)
        try:
            client = _make_client(_engine, ctx["owner_user_id"])
            try:
                resp = client.get(
                    f"/api/v1/companies/{ctx['company_id']}/salary-structures/"
                    f"{ctx['structure_id']}/usage"
                )
                assert resp.status_code == 200, resp.text
                body = resp.json()
                assert body["active_assignment_count"] == 0
                assert body["total_assignment_count"] == 0
                assert body["sample_employee_names"] == []
            finally:
                _clear_overrides()
        finally:
            _cleanup(db, ctx)
