"""Tests for M3 — structure snapshot on assignment.

Headline guarantee under test:
    Editing the live structure after an assignment is created MUST NOT
    retroactively change that employee's resolved salary.

Coverage:
  * Snapshot populated when an assignment references a structure
  * Snapshot frozen — live edits don't bleed into resolved values
  * New assignment to the same structure picks up the new amounts
  * Legacy assignment (snapshot=NULL) still resolves via live structure
  * Backfill script populates snapshots for legacy rows
  * Override behavior unchanged — overrides still beat the snapshot value
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal as D

import pytest
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_company_with_structure(db: Session) -> dict:
    """Build an isolated company + employee + structure for snapshot tests.

    Returns a dict of IDs the tests can navigate.
    """
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

    suffix = datetime.utcnow().strftime("%H%M%S%f")

    owner = User(
        user_type="company",
        email=f"snap-owner-{suffix}@kontokaz.test",
        user_name=f"snap-owner-{suffix}",
        password_hash="x",
    )
    db.add(owner)
    db.flush()

    company = Company(
        user_id=owner.user_id,
        company_name=f"Snap Co {suffix}",
        email=f"snap-co-{suffix}@kontokaz.test",
        brn=f"SNAP_BRN_{suffix}",
        country_code="MU",
    )
    db.add(company)
    db.flush()

    emp_user = User(
        user_type="private",
        email=f"snap-emp-{suffix}@kontokaz.test",
        user_name=f"snap-emp-{suffix}",
        password_hash="x",
    )
    db.add(emp_user)
    db.flush()

    emp = PrivateUser(
        user_id=emp_user.user_id,
        first_name="Snap",
        last_name="Emp",
        company_id=company.company_id,
        role="employee",
        pass_port_number=f"SNAP_PASS_{suffix}",
    )
    db.add(emp)
    db.flush()

    job = Job(
        private_user_id=emp.private_user_id,
        company_id=company.company_id,
        job_title="Test",
        employer_name=f"Snap Co {suffix}",
        employer_brn=f"SNAP_BRN_{suffix}",
        employer_email=f"snap-co-{suffix}@kontokaz.test",
        first_date_of_employment=date(2024, 1, 1),
    )
    db.add(job)
    db.flush()

    basic = SalaryComponent(
        company_id=company.company_id,
        code="BASIC",
        label="Basic",
        kind="earning",
        category="earning.basic",
        is_basic=True,
        is_taxable=True,
    )
    allow = SalaryComponent(
        company_id=company.company_id,
        code="TRANSPORT",
        label="Transport",
        kind="earning",
        category="allowance.transport",
        is_basic=False,
        is_taxable=True,
    )
    db.add_all([basic, allow])
    db.flush()

    struct = SalaryStructure(
        company_id=company.company_id,
        name=f"Test Structure {suffix}",
    )
    db.add(struct)
    db.flush()

    db.add_all([
        SalaryStructureLine(
            structure_id=struct.id,
            component_id=basic.id,
            amount=D("30000.00"),
            order_index=0,
        ),
        SalaryStructureLine(
            structure_id=struct.id,
            component_id=allow.id,
            amount=D("3000.00"),
            order_index=1,
        ),
    ])
    db.flush()

    # Create the assignment WITH a snapshot (the M3 path).
    snap = build_structure_snapshot(db, struct.id)
    assignment = EmployeeSalaryAssignment(
        private_user_id=emp.private_user_id,
        structure_id=struct.id,
        structure_snapshot=snap,
        currency="MUR",
        effective_from=date(2024, 1, 1),
        notes="snapshot test",
    )
    db.add(assignment)
    db.commit()

    return {
        "owner_email": owner.email,
        "emp_email": emp_user.email,
        "company_id": company.company_id,
        "private_user_id": emp.private_user_id,
        "job_id": job.job_id,
        "basic_id": basic.id,
        "allow_id": allow.id,
        "structure_id": struct.id,
        "assignment_id": assignment.id,
        "passport": emp.pass_port_number,
    }


def _cleanup(db: Session, ctx: dict) -> None:
    """Tear down everything _make_company_with_structure created."""
    db.rollback()
    db.execute(
        sql_text("DELETE FROM employee_salary_overrides WHERE assignment_id=:id"),
        {"id": ctx["assignment_id"]},
    )
    db.execute(
        sql_text("DELETE FROM employee_salary_assignments WHERE private_user_id=:p"),
        {"p": ctx["private_user_id"]},
    )
    db.execute(
        sql_text("DELETE FROM jobs WHERE job_id=:j"),
        {"j": ctx["job_id"]},
    )
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
        sql_text("DELETE FROM salary_components WHERE id IN (:b, :a)"),
        {"b": ctx["basic_id"], "a": ctx["allow_id"]},
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


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestSnapshotPopulation:
    def test_snapshot_present_after_create(self, db: Session):
        from core.model import EmployeeSalaryAssignment

        ctx = _make_company_with_structure(db)
        try:
            a = (
                db.query(EmployeeSalaryAssignment)
                .filter(EmployeeSalaryAssignment.id == ctx["assignment_id"])
                .one()
            )
            snap = a.structure_snapshot
            assert isinstance(snap, dict)
            assert snap["structure_id"] == ctx["structure_id"]
            assert "snapshotted_at" in snap

            codes = {ln["code"]: ln for ln in snap["lines"]}
            assert codes["BASIC"]["amount"] == "30000.00"
            assert codes["TRANSPORT"]["amount"] == "3000.00"
            assert codes["BASIC"]["is_basic"] is True
            assert codes["TRANSPORT"]["is_basic"] is False
        finally:
            _cleanup(db, ctx)

    def test_resolver_reads_from_snapshot(self, db: Session):
        from services import salary_resolver

        ctx = _make_company_with_structure(db)
        try:
            resolved = salary_resolver.resolve_components(
                db, ctx["private_user_id"], date(2026, 5, 1)
            )
            by_code = {c.code: c.amount for c in resolved.components}
            assert by_code == {"BASIC": D("30000.00"), "TRANSPORT": D("3000.00")}
        finally:
            _cleanup(db, ctx)


class TestSnapshotImmutability:
    """The headline M3 guarantee."""

    def test_live_edit_does_not_change_assigned_employee(self, db: Session):
        """Edit the live structure's amount AFTER the assignment exists.
        Resolver must still return the OLD amount because it reads from
        the snapshot, not the live tables.
        """
        from core.model import SalaryStructureLine
        from services import salary_resolver

        ctx = _make_company_with_structure(db)
        try:
            # Sanity check baseline
            r0 = salary_resolver.resolve_components(
                db, ctx["private_user_id"], date(2026, 5, 1)
            )
            basic_before = next(c for c in r0.components if c.code == "BASIC")
            assert basic_before.amount == D("30000.00")

            # Mutate the LIVE structure's BASIC line to 99999
            line = (
                db.query(SalaryStructureLine)
                .filter(
                    SalaryStructureLine.structure_id == ctx["structure_id"],
                    SalaryStructureLine.component_id == ctx["basic_id"],
                )
                .one()
            )
            line.amount = D("99999.00")
            db.commit()

            # Re-resolve — must still return 30000 (snapshot wins)
            r1 = salary_resolver.resolve_components(
                db, ctx["private_user_id"], date(2026, 5, 1)
            )
            basic_after = next(c for c in r1.components if c.code == "BASIC")
            assert basic_after.amount == D("30000.00"), (
                "Snapshot-backed assignment leaked live structure edits"
            )
        finally:
            _cleanup(db, ctx)

    def test_new_assignment_picks_up_live_edits(self, db: Session):
        """A NEW assignment after the live edit DOES pick up the new amount,
        because the snapshot is built fresh at assignment time."""
        from core.model import EmployeeSalaryAssignment, SalaryStructureLine
        from services import salary_resolver

        ctx = _make_company_with_structure(db)
        try:
            # Edit live structure
            line = (
                db.query(SalaryStructureLine)
                .filter(
                    SalaryStructureLine.structure_id == ctx["structure_id"],
                    SalaryStructureLine.component_id == ctx["basic_id"],
                )
                .one()
            )
            line.amount = D("45000.00")
            db.commit()

            # Close prior assignment, create a new one
            prior = (
                db.query(EmployeeSalaryAssignment)
                .filter(EmployeeSalaryAssignment.id == ctx["assignment_id"])
                .one()
            )
            prior.effective_to = date(2026, 7, 1)
            new_snap = salary_resolver.build_structure_snapshot(db, ctx["structure_id"])
            new_a = EmployeeSalaryAssignment(
                private_user_id=ctx["private_user_id"],
                structure_id=ctx["structure_id"],
                structure_snapshot=new_snap,
                currency="MUR",
                effective_from=date(2026, 7, 1),
                notes="post-edit assignment",
            )
            db.add(new_a)
            db.commit()

            # Old period uses old assignment with old snapshot
            r_old = salary_resolver.resolve_components(
                db, ctx["private_user_id"], date(2026, 5, 1)
            )
            assert next(c for c in r_old.components if c.code == "BASIC").amount == D("30000.00")

            # New period uses new assignment with new snapshot
            r_new = salary_resolver.resolve_components(
                db, ctx["private_user_id"], date(2026, 8, 1)
            )
            assert next(c for c in r_new.components if c.code == "BASIC").amount == D("45000.00")
        finally:
            _cleanup(db, ctx)


class TestLegacyFallback:
    """Pre-M3 assignments (snapshot=NULL) still work via the live structure."""

    def test_resolver_falls_back_when_snapshot_is_null(self, db: Session):
        from core.model import EmployeeSalaryAssignment
        from services import salary_resolver

        ctx = _make_company_with_structure(db)
        try:
            # Simulate a legacy assignment by clearing the snapshot
            db.execute(
                sql_text(
                    "UPDATE employee_salary_assignments SET structure_snapshot=NULL "
                    "WHERE id=:id"
                ),
                {"id": ctx["assignment_id"]},
            )
            db.commit()

            r = salary_resolver.resolve_components(
                db, ctx["private_user_id"], date(2026, 5, 1)
            )
            by_code = {c.code: c.amount for c in r.components}
            assert by_code == {"BASIC": D("30000.00"), "TRANSPORT": D("3000.00")}
        finally:
            _cleanup(db, ctx)


class TestBackfillScript:
    def test_backfill_populates_legacy_rows(self, db: Session):
        from core.model import EmployeeSalaryAssignment
        from scripts import backfill_assignment_snapshots

        ctx = _make_company_with_structure(db)
        try:
            # Wipe the snapshot to simulate a pre-M3 row
            db.execute(
                sql_text(
                    "UPDATE employee_salary_assignments SET structure_snapshot=NULL "
                    "WHERE id=:id"
                ),
                {"id": ctx["assignment_id"]},
            )
            db.commit()

            # Run the backfill
            backfill_assignment_snapshots.main()

            # Re-read — snapshot should now be populated
            db.expire_all()
            a = (
                db.query(EmployeeSalaryAssignment)
                .filter(EmployeeSalaryAssignment.id == ctx["assignment_id"])
                .one()
            )
            assert isinstance(a.structure_snapshot, dict)
            assert a.structure_snapshot["structure_id"] == ctx["structure_id"]
            codes = {ln["code"] for ln in a.structure_snapshot["lines"]}
            assert codes == {"BASIC", "TRANSPORT"}
        finally:
            _cleanup(db, ctx)


class TestOverridesStillWin:
    def test_override_beats_snapshot(self, db: Session):
        """An EmployeeSalaryOverride should still take precedence over the
        snapshot value — same semantics as overriding live structure data."""
        from core.model import EmployeeSalaryOverride
        from services import salary_resolver

        ctx = _make_company_with_structure(db)
        try:
            db.add(
                EmployeeSalaryOverride(
                    assignment_id=ctx["assignment_id"],
                    component_id=ctx["basic_id"],
                    amount=D("77777.00"),
                    notes="override",
                )
            )
            db.commit()

            r = salary_resolver.resolve_components(
                db, ctx["private_user_id"], date(2026, 5, 1)
            )
            basic = next(c for c in r.components if c.code == "BASIC")
            assert basic.amount == D("77777.00")
            assert basic.source == "override"
        finally:
            _cleanup(db, ctx)


class TestOverrideAddsComponentOutsideStructure:
    """Regression: an override for a component that ISN'T on the employee's
    base structure used to be silently dropped by the resolver (it only ever
    looked up overrides against lines already in `effective`). Add one
    employee an allowance nobody else on their structure has, and confirm it
    now actually resolves."""

    def test_override_for_component_not_in_structure_is_resolved(self, db: Session):
        from core.model import EmployeeSalaryOverride, SalaryComponent
        from services import salary_resolver

        ctx = _make_company_with_structure(db)
        bonus = SalaryComponent(
            company_id=ctx["company_id"],
            code="ONEOFF_BONUS",
            label="One-off bonus",
            kind="earning",
            category="earning.other",
            is_basic=False,
            is_taxable=True,
        )
        db.add(bonus)
        db.flush()
        db.add(
            EmployeeSalaryOverride(
                assignment_id=ctx["assignment_id"],
                component_id=bonus.id,
                amount=D("1500.00"),
                notes="employee-only bonus, not part of the structure",
            )
        )
        db.commit()
        try:
            r = salary_resolver.resolve_components(
                db, ctx["private_user_id"], date(2026, 5, 1)
            )
            codes = {c.code: c for c in r.components}
            assert "ONEOFF_BONUS" in codes, "override-only component should be added, not dropped"
            assert codes["ONEOFF_BONUS"].amount == D("1500.00")
            assert codes["ONEOFF_BONUS"].source == "override"
            # The structure's own lines should be unaffected.
            assert codes["BASIC"].amount == D("30000.00")
        finally:
            db.execute(
                sql_text("DELETE FROM employee_salary_overrides WHERE component_id=:i"), {"i": bonus.id}
            )
            db.execute(
                sql_text("DELETE FROM salary_components WHERE id=:i"), {"i": bonus.id}
            )
            _cleanup(db, ctx)

    def test_override_zero_amount_zeros_out_a_structure_component(self, db: Session):
        """'Remove an allowance' — set the override amount to 0 rather than
        needing a separate delete/exclude mechanism."""
        from core.model import EmployeeSalaryOverride
        from services import salary_resolver

        ctx = _make_company_with_structure(db)
        db.add(
            EmployeeSalaryOverride(
                assignment_id=ctx["assignment_id"],
                component_id=ctx["allow_id"],
                amount=D("0.00"),
                notes="removed for this employee",
            )
        )
        db.commit()
        try:
            r = salary_resolver.resolve_components(
                db, ctx["private_user_id"], date(2026, 5, 1)
            )
            transport = next(c for c in r.components if c.code == "TRANSPORT")
            assert transport.amount == D("0.00")
            assert transport.source == "override"
        finally:
            _cleanup(db, ctx)


class TestOverridesOnlyAssignment:
    """Regression: an assignment with structure_id=None (overrides-only —
    the shape create_assignment's 422 check explicitly allows) used to hit
    an early `return components=[]` in resolve_components BEFORE the
    override-merge step ever ran, so its overrides were never read."""

    def test_overrides_only_assignment_resolves_its_overrides(self, db: Session):
        from core.model import EmployeeSalaryAssignment, EmployeeSalaryOverride, SalaryComponent
        from services import salary_resolver

        ctx = _make_company_with_structure(db)
        allowance = SalaryComponent(
            company_id=ctx["company_id"],
            code="STANDALONE_ALLOW",
            label="Standalone allowance",
            kind="earning",
            category="allowance.other",
            is_basic=False,
            is_taxable=True,
        )
        db.add(allowance)
        db.flush()

        # Supersede the structure-based assignment with an overrides-only one.
        ctx["orig_assignment_id"] = ctx["assignment_id"]
        from core.model import EmployeeSalaryAssignment as _A
        prior = db.query(_A).filter(_A.id == ctx["assignment_id"]).one()
        prior.effective_to = date(2026, 6, 1)

        new_assignment = EmployeeSalaryAssignment(
            private_user_id=ctx["private_user_id"],
            structure_id=None,
            structure_snapshot=None,
            currency="MUR",
            effective_from=date(2026, 6, 1),
        )
        db.add(new_assignment)
        db.flush()
        db.add(
            EmployeeSalaryOverride(
                assignment_id=new_assignment.id,
                component_id=allowance.id,
                amount=D("2000.00"),
            )
        )
        db.commit()
        try:
            r = salary_resolver.resolve_components(
                db, ctx["private_user_id"], date(2026, 6, 15)
            )
            assert r.assignment_id == new_assignment.id
            codes = {c.code: c for c in r.components}
            assert "STANDALONE_ALLOW" in codes, "overrides-only assignment should resolve its overrides"
            assert codes["STANDALONE_ALLOW"].amount == D("2000.00")
        finally:
            db.execute(sql_text("DELETE FROM employee_salary_overrides WHERE assignment_id=:i"), {"i": new_assignment.id})
            db.execute(sql_text("DELETE FROM employee_salary_assignments WHERE id=:i"), {"i": new_assignment.id})
            db.execute(sql_text("DELETE FROM salary_components WHERE id=:i"), {"i": allowance.id})
            _cleanup(db, ctx)
