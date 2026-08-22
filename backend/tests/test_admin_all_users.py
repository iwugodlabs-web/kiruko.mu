"""GET /admin/all-users — pagination, staff exclusion, employee_code.

Coverage:
  * limit/offset paginate the actually-visible (staff-excluded) rows, and
    `total` reflects that same post-exclusion count — not the raw table.
  * A user holding a platform role is excluded from the directory even
    when the exclusion is applied at the DB level (not just Python-side
    filtering before pagination math, which would have been the easy way
    to get this wrong).
  * employee_code is present on each row's private_user object.

These tests measure everything RELATIVE to a baseline `total` captured
before creating their own fixture rows, rather than asserting an absolute
count. `get_all_user` orders by user_id ascending, so freshly-created rows
always land at the end of that ordering — baseline + offset lets these tests
find their own rows regardless of how many non-staff users other tests in
the same full-suite run have already created (there's no per-test DB reset;
cleanup is each test's own responsibility, so state from earlier tests is
still present). An earlier version of this file asserted `total == 4`
directly, which only held when run in isolation — it failed the moment the
full suite ran and other tests' users were already in the table.
"""

from __future__ import annotations

from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session


def _client(_engine, current_user_id: int) -> TestClient:
    from fastapi import Depends as _Depends
    from sqlalchemy.orm import Session, sessionmaker
    from core import config as core_config
    from core.dependencies import get_current_user, get_token_payload
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

    def _override_token_payload() -> dict:
        return {"aud": "web"}

    app.dependency_overrides[core_config.get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_user
    app.dependency_overrides[get_token_payload] = _override_token_payload
    return TestClient(app, raise_server_exceptions=False)


def _clear() -> None:
    from main import app
    app.dependency_overrides.clear()


def _setup_admin(db: Session, suffix: str) -> dict:
    """Just the platform-admin user — created first, and separately from the
    end-users below, so a baseline `total` can be captured before the
    end-users exist."""
    from core.model import User
    from db_models.crud.role import assign_role_to_user

    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    db.commit()

    admin_user = User(
        user_type="company",
        email=f"pfadmin-{suffix}@kontokaz.test",
        user_name=f"pfadmin-{suffix}",
        password_hash="x",
    )
    db.add(admin_user)
    db.flush()
    assign_role_to_user(admin_user.user_id, "platform_admin", None, db)
    db.commit()

    return {"admin_user_id": admin_user.user_id, "admin_email": admin_user.email}


def _setup_end_users(db: Session, suffix: str) -> dict:
    from core.model import Company, PrivateUser, User

    company_owner = User(
        user_type="company",
        email=f"co-owner-{suffix}@kontokaz.test",
        user_name=f"co-owner-{suffix}",
        password_hash="x",
    )
    db.add(company_owner)
    db.flush()
    co = Company(
        user_id=company_owner.user_id,
        company_name=f"AllUsersCo {suffix}",
        email=f"co-{suffix}@kontokaz.test",
        brn=f"AU_BRN_{suffix}",
        country_code="MU",
    )
    db.add(co)
    db.flush()

    end_users = []
    for i in range(3):
        u = User(
            user_type="private",
            email=f"au-emp-{i}-{suffix}@kontokaz.test",
            user_name=f"au-emp-{i}-{suffix}",
            password_hash="x",
        )
        db.add(u)
        db.flush()
        pu = PrivateUser(
            user_id=u.user_id,
            first_name=f"Emp{i}",
            last_name="Test",
            company_id=co.company_id,
            role="employee",
            employee_code=f"E{i}9999",
        )
        db.add(pu)
        end_users.append(u)
    db.commit()

    return {
        "owner_user_id": company_owner.user_id,
        "owner_email": company_owner.email,
        "company_id": co.company_id,
        "end_user_ids": [u.user_id for u in end_users],
        "end_user_emails": [u.email for u in end_users],
    }


def _cleanup(db: Session, ctx: dict) -> None:
    db.rollback()
    all_user_ids = [ctx["admin_user_id"], ctx["owner_user_id"], *ctx["end_user_ids"]]
    db.execute(
        sql_text("DELETE FROM private_users WHERE user_id = ANY(:ids)"), {"ids": all_user_ids}
    )
    db.execute(
        sql_text("DELETE FROM user_platform_roles WHERE user_id=:u"), {"u": ctx["admin_user_id"]}
    )
    db.execute(sql_text("DELETE FROM companies WHERE company_id=:c"), {"c": ctx["company_id"]})
    db.execute(sql_text("DELETE FROM users WHERE user_id = ANY(:ids)"), {"ids": all_user_ids})
    db.commit()


class TestAllUsersPagination:
    def test_limit_offset_and_total_reflect_post_exclusion_count(self, db: Session, _engine):
        suffix = datetime.utcnow().strftime("%H%M%S%f")
        admin_ctx = _setup_admin(db, suffix)
        client = _client(_engine, admin_ctx["admin_user_id"])
        try:
            baseline = client.get(
                "/api/v1/admin/all-users", params={"limit": 1, "offset": 0}
            ).json()["total"]

            end_ctx = _setup_end_users(db, suffix)
            ctx = {**admin_ctx, **end_ctx}
            try:
                r1 = client.get(
                    "/api/v1/admin/all-users", params={"limit": 2, "offset": baseline}
                )
                assert r1.status_code == 200, r1.text
                body1 = r1.json()
                assert len(body1["data"]) == 2
                # total counts the company owner + 3 end-users (4 non-staff
                # users) on top of whatever else already existed — the admin
                # itself (platform staff) is excluded from both the count and
                # the page.
                assert body1["total"] == baseline + 4

                r2 = client.get(
                    "/api/v1/admin/all-users", params={"limit": 2, "offset": baseline + 2}
                )
                assert r2.status_code == 200, r2.text
                body2 = r2.json()
                assert len(body2["data"]) == 2
                assert body2["total"] == baseline + 4

                page1_ids = {row["user_id"] for row in body1["data"]}
                page2_ids = {row["user_id"] for row in body2["data"]}
                assert page1_ids.isdisjoint(page2_ids), "pages must not overlap"
                all_non_staff_ids = {ctx["owner_user_id"], *ctx["end_user_ids"]}
                assert (page1_ids | page2_ids) == all_non_staff_ids
            finally:
                _cleanup(db, ctx)
        finally:
            _clear()

    def test_platform_staff_excluded_from_directory(self, db: Session, _engine):
        suffix = datetime.utcnow().strftime("%H%M%S%f")
        admin_ctx = _setup_admin(db, suffix)
        end_ctx = _setup_end_users(db, suffix)
        ctx = {**admin_ctx, **end_ctx}
        client = _client(_engine, admin_ctx["admin_user_id"])
        try:
            r = client.get("/api/v1/admin/all-users", params={"limit": 100000, "offset": 0})
            assert r.status_code == 200, r.text
            body = r.json()
            returned_ids = {row["user_id"] for row in body["data"]}
            assert ctx["admin_user_id"] not in returned_ids
        finally:
            _clear()
            _cleanup(db, ctx)

    def test_employee_code_present_on_rows(self, db: Session, _engine):
        suffix = datetime.utcnow().strftime("%H%M%S%f")
        admin_ctx = _setup_admin(db, suffix)
        client = _client(_engine, admin_ctx["admin_user_id"])
        try:
            baseline = client.get(
                "/api/v1/admin/all-users", params={"limit": 1, "offset": 0}
            ).json()["total"]

            end_ctx = _setup_end_users(db, suffix)
            ctx = {**admin_ctx, **end_ctx}
            try:
                r = client.get(
                    "/api/v1/admin/all-users", params={"limit": 4, "offset": baseline}
                )
                assert r.status_code == 200, r.text
                body = r.json()
                by_email = {row["email"]: row for row in body["data"]}
                for email in ctx["end_user_emails"]:
                    row = by_email[email]
                    assert row["private_user"]["employee_code"] is not None
                    assert row["private_user"]["employee_code"].startswith("E")
            finally:
                _cleanup(db, ctx)
        finally:
            _clear()
