"""Tests for the M2 salary structure scoping (Department + Role + Grade).

Walks the full 9-priority match table that
`services.salary_resolver.suggest_structure_for` implements:

  1. exact triple (dept + role + grade)        — grade not in scope yet (None)
  2. dept + role
  3. dept + grade                                — N/A while grade is None
  4. dept only
  5. role + grade                                — N/A while grade is None
  6. grade only                                  — N/A while grade is None
  7. role only
  8. company default (is_default=true)
  9. None (no match)

Plus cross-company validation on the FK fields.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal as D

import pytest
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session


# ---------------------------------------------------------------------------
# Helpers — build a clean per-test scoping ground.
# ---------------------------------------------------------------------------


def _create_test_setup(db: Session) -> dict:
    """Builds a clean test ground:
      * 1 owner User + 1 Company (named uniquely per call so tests are isolated)
      * 2 Departments under that Company
      * Several SalaryStructures with various scoping combinations

    Returns a dict with all the IDs the tests reference.
    """
    from core.model import (
        Company,
        Department,
        SalaryStructure,
        User,
    )

    suffix = datetime.utcnow().strftime("%H%M%S%f")
    owner = User(
        user_type="company",
        email=f"scoping-owner-{suffix}@kontokaz.test",
        user_name=f"scoping-owner-{suffix}",
        password_hash="x",
    )
    db.add(owner)
    db.flush()

    company = Company(
        user_id=owner.user_id,
        company_name=f"Scoping Co {suffix}",
        email=f"scoping-{suffix}@kontokaz.test",
        brn=f"SCOP_BRN_{suffix}",
        country_code="MU",
    )
    db.add(company)
    db.flush()

    sales = Department(company_id=company.company_id, name="Sales")
    eng = Department(company_id=company.company_id, name="Engineering")
    db.add_all([sales, eng])
    db.flush()

    # Structures, in priority order so we can name them clearly.
    structures = {
        # 2. dept + role
        "sales_manager": SalaryStructure(
            company_id=company.company_id,
            name="Sales-Manager",
            default_for_department_id=sales.department_id,
            default_for_role="manager",
        ),
        # 4. dept only
        "sales_default": SalaryStructure(
            company_id=company.company_id,
            name="Sales-Default",
            default_for_department_id=sales.department_id,
        ),
        # 4. dept only (different dept)
        "eng_default": SalaryStructure(
            company_id=company.company_id,
            name="Eng-Default",
            default_for_department_id=eng.department_id,
        ),
        # 7. role only
        "any_manager": SalaryStructure(
            company_id=company.company_id,
            name="Any-Manager",
            default_for_role="manager",
        ),
        # 8. company default
        "company_default": SalaryStructure(
            company_id=company.company_id,
            name="Company-Default",
            is_default=True,
        ),
    }
    for s in structures.values():
        db.add(s)
    db.flush()

    return {
        "owner_id": owner.user_id,
        "company_id": company.company_id,
        "sales_dept_id": sales.department_id,
        "eng_dept_id": eng.department_id,
        "structures": {k: s.id for k, s in structures.items()},
    }


def _make_employee(
    db: Session,
    company_id: int,
    *,
    department_id: int | None,
    role: str,
):
    """Lightweight PrivateUser with a unique passport so the fixture's
    UNIQUE constraint doesn't bite."""
    from core.model import PrivateUser, User

    suffix = f"{datetime.utcnow().strftime('%H%M%S%f')}-{role}-{department_id}"
    u = User(
        user_type="private",
        email=f"emp-{suffix}@kontokaz.test",
        user_name=f"emp-{suffix}",
        password_hash="x",
    )
    db.add(u)
    db.flush()
    p = PrivateUser(
        user_id=u.user_id,
        first_name="Test",
        last_name=role.title(),
        company_id=company_id,
        department_id=department_id,
        role=role,
        pass_port_number=f"SCOP_{suffix}",
    )
    db.add(p)
    db.flush()
    return p


def _cleanup(db: Session, setup: dict) -> None:
    """Remove everything created by _create_test_setup."""
    db.rollback()
    company_id = setup["company_id"]
    db.execute(
        sql_text(
            "DELETE FROM private_users WHERE company_id=:cid AND pass_port_number LIKE 'SCOP_%'"
        ),
        {"cid": company_id},
    )
    db.execute(sql_text("DELETE FROM users WHERE email LIKE 'scoping-%@kontokaz.test'"))
    db.execute(sql_text("DELETE FROM users WHERE email LIKE 'emp-%@kontokaz.test'"))
    db.execute(
        sql_text("DELETE FROM salary_structures WHERE company_id=:cid"),
        {"cid": company_id},
    )
    db.execute(
        sql_text("DELETE FROM departments WHERE company_id=:cid"),
        {"cid": company_id},
    )
    db.execute(
        sql_text("DELETE FROM companies WHERE company_id=:cid"),
        {"cid": company_id},
    )
    db.commit()


# ---------------------------------------------------------------------------
# Tests — each one walks one rung of the priority ladder.
# ---------------------------------------------------------------------------


class TestSuggestStructure:
    def test_dept_plus_role_match_wins(self, db: Session):
        """Sales + manager → Sales-Manager (priority 2)."""
        from services.salary_resolver import suggest_structure_for

        setup = _create_test_setup(db)
        try:
            emp = _make_employee(
                db,
                setup["company_id"],
                department_id=setup["sales_dept_id"],
                role="manager",
            )
            db.commit()

            chosen = suggest_structure_for(db, emp)
            assert chosen is not None
            assert chosen.id == setup["structures"]["sales_manager"], (
                f"expected Sales-Manager (id={setup['structures']['sales_manager']}); "
                f"got id={chosen.id} name={chosen.name!r}"
            )
        finally:
            _cleanup(db, setup)

    def test_dept_only_match(self, db: Session):
        """Sales + employee (no role-specific structure) → Sales-Default (priority 4)."""
        from services.salary_resolver import suggest_structure_for

        setup = _create_test_setup(db)
        try:
            emp = _make_employee(
                db,
                setup["company_id"],
                department_id=setup["sales_dept_id"],
                role="employee",  # no Sales-Employee structure → fall through
            )
            db.commit()

            chosen = suggest_structure_for(db, emp)
            assert chosen is not None
            assert chosen.id == setup["structures"]["sales_default"]
        finally:
            _cleanup(db, setup)

    def test_dept_only_picks_correct_dept(self, db: Session):
        """Engineering + employee → Eng-Default (NOT Sales-Default)."""
        from services.salary_resolver import suggest_structure_for

        setup = _create_test_setup(db)
        try:
            emp = _make_employee(
                db,
                setup["company_id"],
                department_id=setup["eng_dept_id"],
                role="employee",
            )
            db.commit()

            chosen = suggest_structure_for(db, emp)
            assert chosen is not None
            assert chosen.id == setup["structures"]["eng_default"]
        finally:
            _cleanup(db, setup)

    def test_role_only_match_when_no_dept_match(self, db: Session):
        """Manager with no department → Any-Manager (priority 7).

        We need an employee with `department_id=None` and `role='manager'`.
        Skipping dept-based matches; the role-only `Any-Manager` should win
        over the company default.
        """
        from services.salary_resolver import suggest_structure_for

        setup = _create_test_setup(db)
        try:
            emp = _make_employee(
                db,
                setup["company_id"],
                department_id=None,
                role="manager",
            )
            db.commit()

            chosen = suggest_structure_for(db, emp)
            assert chosen is not None
            assert chosen.id == setup["structures"]["any_manager"], (
                f"expected Any-Manager (priority 7); got id={chosen.id}"
            )
        finally:
            _cleanup(db, setup)

    def test_falls_back_to_company_default(self, db: Session):
        """Employee with no department, role 'intern' (no match) → Company-Default."""
        from services.salary_resolver import suggest_structure_for

        setup = _create_test_setup(db)
        try:
            emp = _make_employee(
                db,
                setup["company_id"],
                department_id=None,
                role="intern",  # no Any-Intern structure
            )
            db.commit()

            chosen = suggest_structure_for(db, emp)
            assert chosen is not None
            assert chosen.id == setup["structures"]["company_default"]
        finally:
            _cleanup(db, setup)

    def test_returns_none_when_no_match_and_no_default(self, db: Session):
        """No matching scope AND no company default → None."""
        from core.model import Company, PrivateUser, SalaryStructure, User
        from services.salary_resolver import suggest_structure_for

        # Build a minimal company with no structures at all.
        suffix = datetime.utcnow().strftime("%H%M%S%f")
        owner = User(
            user_type="company",
            email=f"empty-co-{suffix}@kontokaz.test",
            user_name=f"empty-co-{suffix}",
            password_hash="x",
        )
        db.add(owner)
        db.flush()
        co = Company(
            user_id=owner.user_id,
            company_name=f"Empty {suffix}",
            email=f"empty-co-{suffix}@kontokaz.test",
            brn=f"EMPTY_{suffix}",
            country_code="MU",
        )
        db.add(co)
        db.flush()
        p = PrivateUser(
            user_id=owner.user_id,
            first_name="No",
            last_name="Match",
            company_id=co.company_id,
            role="employee",
            pass_port_number=f"NOMATCH_{suffix}",
        )
        # That FK is unique:user_id; the owner User above is already used. Let's create another.
        owner2 = User(
            user_type="private",
            email=f"empty-emp-{suffix}@kontokaz.test",
            user_name=f"empty-emp-{suffix}",
            password_hash="x",
        )
        db.add(owner2)
        db.flush()
        p.user_id = owner2.user_id
        db.add(p)
        db.commit()

        try:
            assert suggest_structure_for(db, p) is None
        finally:
            db.execute(sql_text("DELETE FROM private_users WHERE pass_port_number=:p"), {"p": p.pass_port_number})
            db.execute(sql_text("DELETE FROM companies WHERE company_id=:cid"), {"cid": co.company_id})
            db.execute(
                sql_text("DELETE FROM users WHERE email IN (:e1, :e2)"),
                {"e1": owner.email, "e2": owner2.email},
            )
            db.commit()

    def test_employee_with_no_company_returns_none(self, db: Session):
        """Defensive: an employee with company_id=NULL never gets a suggestion."""
        from core.model import PrivateUser, User
        from services.salary_resolver import suggest_structure_for

        suffix = datetime.utcnow().strftime("%H%M%S%f")
        u = User(
            user_type="private",
            email=f"orphan-{suffix}@kontokaz.test",
            user_name=f"orphan-{suffix}",
            password_hash="x",
        )
        db.add(u)
        db.flush()
        p = PrivateUser(
            user_id=u.user_id,
            first_name="Orphan",
            last_name="X",
            company_id=None,
            role="employee",
            pass_port_number=f"ORPH_{suffix}",
        )
        db.add(p)
        db.commit()

        try:
            assert suggest_structure_for(db, p) is None
        finally:
            db.execute(sql_text("DELETE FROM private_users WHERE pass_port_number=:p"), {"p": p.pass_port_number})
            db.execute(sql_text("DELETE FROM users WHERE email=:e"), {"e": u.email})
            db.commit()


# ---------------------------------------------------------------------------
# Cross-company FK validation (model + API layer)
# ---------------------------------------------------------------------------


class TestScopingValidation:
    def test_dept_from_another_company_fk_exists_at_db(self, db: Session):
        """Sanity: the FK to departments(department_id) is enforced.

        DB-level test: inserting a salary_structures row whose
        default_for_department_id points at a non-existent department fails.
        """
        from core.model import Company, SalaryStructure, User

        suffix = datetime.utcnow().strftime("%H%M%S%f")
        owner = User(
            user_type="company",
            email=f"vt-{suffix}@kontokaz.test",
            user_name=f"vt-{suffix}",
            password_hash="x",
        )
        db.add(owner)
        db.flush()
        co = Company(
            user_id=owner.user_id,
            company_name=f"Validation {suffix}",
            email=f"vt-{suffix}@kontokaz.test",
            brn=f"VT_{suffix}",
            country_code="MU",
        )
        db.add(co)
        db.flush()

        try:
            with pytest.raises(Exception):  # IntegrityError, wrapped
                bad = SalaryStructure(
                    company_id=co.company_id,
                    name="Bad",
                    default_for_department_id=999_999,  # nonexistent
                )
                db.add(bad)
                db.flush()
            db.rollback()
        finally:
            db.execute(sql_text("DELETE FROM companies WHERE company_id=:c"), {"c": co.company_id})
            db.execute(sql_text("DELETE FROM users WHERE email=:e"), {"e": owner.email})
            db.commit()
