"""Employee code generation (initials + random digits, unique per company).

Coverage:
  * Format: first-initial + last-initial + 4 digits.
  * Falls back to 'X' for names with no alphabetic character.
  * Uniqueness is enforced per company, not globally — a collision within a
    company gets a fresh suffix; the same code is fine at a different company.
  * ensure_employee_code is a no-op when company_id is None or a code exists.
"""

from __future__ import annotations

from datetime import datetime
from unittest.mock import patch

import pytest
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from services.employee_code_service import generate_employee_code, ensure_employee_code, _prefix


def test_prefix_uses_first_and_last_initial():
    assert _prefix("John", "Smith") == "JS"


def test_prefix_falls_back_to_x_for_non_alphabetic_names():
    assert _prefix("", "") == "XX"
    assert _prefix("7", None) == "XX"


def _setup_company(db: Session) -> dict:
    from core.model import Company, User

    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    db.commit()
    suffix = datetime.utcnow().strftime("%H%M%S%f")
    owner = User(
        user_type="company",
        email=f"code-owner-{suffix}@kontokaz.test",
        user_name=f"code-owner-{suffix}",
        password_hash="x",
    )
    db.add(owner)
    db.flush()
    co = Company(
        user_id=owner.user_id,
        company_name=f"Code Co {suffix}",
        email=f"code-{suffix}@kontokaz.test",
        brn=f"CODE_BRN_{suffix}",
        country_code="MU",
    )
    db.add(co)
    db.commit()
    return {"owner_user_id": owner.user_id, "owner_email": owner.email, "company_id": co.company_id}


def _cleanup_company(db: Session, ctx: dict) -> None:
    db.rollback()
    db.execute(sql_text("DELETE FROM companies WHERE company_id=:c"), {"c": ctx["company_id"]})
    db.execute(sql_text("DELETE FROM users WHERE user_id=:u"), {"u": ctx["owner_user_id"]})
    db.commit()


class TestGenerateEmployeeCode:
    def test_generates_prefix_plus_4_digits(self, db: Session):
        ctx = _setup_company(db)
        try:
            code = generate_employee_code(db, ctx["company_id"], "John", "Smith")
            assert code[:2] == "JS"
            assert len(code) == 6
            assert code[2:].isdigit()
        finally:
            _cleanup_company(db, ctx)

    def test_retries_on_collision_within_company(self, db: Session):
        from core.model import PrivateUser, User

        ctx = _setup_company(db)
        try:
            # Force the first candidate to collide by pre-inserting it, then
            # verify the generator returns something different in-company.
            with patch("services.employee_code_service.secrets.randbelow", side_effect=[1234, 1234, 5678]):
                first = generate_employee_code(db, ctx["company_id"], "Ann", "Lee")
            assert first == "AL1234"

            emp_user = User(
                user_type="private", email=f"al-{ctx['company_id']}@kontokaz.test",
                user_name=f"al-{ctx['company_id']}", password_hash="x",
            )
            db.add(emp_user)
            db.flush()
            priv = PrivateUser(
                user_id=emp_user.user_id, first_name="Ann", last_name="Lee",
                company_id=ctx["company_id"], role="employee", employee_code=first,
            )
            db.add(priv)
            db.commit()

            with patch("services.employee_code_service.secrets.randbelow", side_effect=[1234, 5678]):
                second = generate_employee_code(db, ctx["company_id"], "Ann", "Lee")
            assert second == "AL5678", "collision on the first candidate should retry, not reuse"

            db.execute(sql_text("DELETE FROM private_users WHERE private_user_id=:p"), {"p": priv.private_user_id})
            db.execute(sql_text("DELETE FROM users WHERE user_id=:u"), {"u": emp_user.user_id})
            db.commit()
        finally:
            _cleanup_company(db, ctx)

    def test_same_code_allowed_across_different_companies(self, db: Session):
        from core.model import PrivateUser, User

        ctx1 = _setup_company(db)
        ctx2 = _setup_company(db)
        try:
            emp_user = User(
                user_type="private", email=f"dup-{ctx1['company_id']}@kontokaz.test",
                user_name=f"dup-{ctx1['company_id']}", password_hash="x",
            )
            db.add(emp_user)
            db.flush()
            priv = PrivateUser(
                user_id=emp_user.user_id, first_name="Ann", last_name="Lee",
                company_id=ctx1["company_id"], role="employee", employee_code="AL1234",
            )
            db.add(priv)
            db.commit()

            with patch("services.employee_code_service.secrets.randbelow", return_value=1234):
                code = generate_employee_code(db, ctx2["company_id"], "Ann", "Lee")
            assert code == "AL1234", "same code should be fine at a different company"

            db.execute(sql_text("DELETE FROM private_users WHERE private_user_id=:p"), {"p": priv.private_user_id})
            db.execute(sql_text("DELETE FROM users WHERE user_id=:u"), {"u": emp_user.user_id})
            db.commit()
        finally:
            _cleanup_company(db, ctx1)
            _cleanup_company(db, ctx2)


class TestEnsureEmployeeCode:
    def test_noop_when_no_company(self, db: Session):
        from core.model import PrivateUser

        p = PrivateUser(user_id=-1, first_name="No", last_name="Company", company_id=None)
        ensure_employee_code(db, p)
        assert p.employee_code is None

    def test_noop_when_code_already_set(self, db: Session):
        from core.model import PrivateUser

        p = PrivateUser(user_id=-1, first_name="Has", last_name="Code", company_id=1, employee_code="XY9999")
        ensure_employee_code(db, p)
        assert p.employee_code == "XY9999"
