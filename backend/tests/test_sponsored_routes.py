"""HTTP-level auth + integration tests for sponsored content (Plan §Integration).

The plan's Testing section explicitly called for HTTP-layer auth tests:
  - Company A admin cannot read Company B's announcements (403)
  - Company admin cannot hit /admin/ads/* (403)
  - Platform admin cannot create kind='employer' via /admin/ads/* (rejected by per-kind validator)
  - Auth-less request returns 401 on protected routes

These were missing from M8 — the previous tests were all CRUD-layer. This
file uses FastAPI TestClient with `dependency_overrides` to swap auth + DB
fixtures, the same pattern as test_payslip_estimate.py.
"""
from __future__ import annotations

from datetime import datetime
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session, sessionmaker


def _client(_engine, current_user_id: int | None) -> TestClient:
    """Build a TestClient that:
      - overrides the DB dep to use the test engine
      - overrides get_current_user to return a specific User row (or 401)
    """
    from fastapi import Depends as _Depends, HTTPException, status
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
        if current_user_id is None:
            # Simulate "no auth" — same shape as the real dependency.
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session has expired or you are not logged in.",
            )
        user = db.query(User).filter(User.user_id == current_user_id).one()
        # The real dependency populates `user.private_user` via relationship —
        # the test session may not have it eager-loaded depending on order.
        return user

    app.dependency_overrides[core_config.get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_user
    return TestClient(app, raise_server_exceptions=False)


def _clear() -> None:
    from main import app
    app.dependency_overrides.clear()


def _create_user_and_company(db: Session, label: str, *, owner_role: str = "company") -> dict:
    """Create a fresh User + Company pair for the test. Returns ids.

    Uses a uuid suffix on top of the label so reruns don't collide with rows
    left over from prior pytest sessions (the test DB is not wiped between
    sessions and users.email is unique)."""
    from core.model import Company, User

    suffix = f"{label}-{uuid.uuid4().hex[:8]}"
    owner = User(
        user_type=owner_role,
        email=f"test-route-owner-{suffix}@kontokaz.test",
        user_name=f"route-owner-{suffix}",
        password_hash="not-used",
    )
    db.add(owner)
    db.flush()

    co = Company(
        user_id=owner.user_id,
        company_name=f"RouteTest {suffix}",
        email=f"co-{suffix}@kontokaz.test",
        brn=f"RT_BRN_{suffix}",
        country_code="MU",
    )
    db.add(co)
    db.commit()
    return {"user_id": owner.user_id, "company_id": co.company_id}


@pytest.fixture(autouse=True)
def _wipe(db):
    db.execute(sql_text("DELETE FROM sponsored_content"))
    db.commit()
    yield
    _clear()


@pytest.fixture(autouse=True)
def _legacy_surface_default(monkeypatch):
    """M17 split home into home_banner (employer) + home_card (ad/house).
    Route tests below all use `?surface=home` — pin defaults back to
    ['home'] so created rows match the legacy surface. Surface-routing
    semantics are covered in test_sponsored_serve.py::TestSurfaceRouting."""
    from db_models.crud import sponsored_content as _sc
    monkeypatch.setattr(
        _sc, "DEFAULT_SURFACES_BY_KIND",
        {"employer": ["home"], "ad": ["home"], "house": ["home"]},
    )


class TestAnnouncementsAuth:
    def test_unauthenticated_returns_401(self, _engine, db):
        client = _client(_engine, current_user_id=None)
        resp = client.get("/api/v1/announcements")
        assert resp.status_code == 401, resp.text

    def test_company_a_admin_cannot_read_company_b_announcement(self, _engine, db):
        """The plan's Phase 1 Verification step 1 — cross-company isolation
        at the HTTP layer."""
        # Set up: Company A (with admin) + Company B (with admin + an announcement).
        a = _create_user_and_company(db, "A")
        b = _create_user_and_company(db, "B")

        # Insert an announcement in B's company via raw SQL (skip the API path).
        b_content_id = db.execute(
            sql_text(
                "INSERT INTO sponsored_content (kind, title, body, funding_company_id, status)"
                " VALUES ('employer', 'B-only', 'b', :cid, 'active') RETURNING sponsored_content_id"
            ),
            {"cid": b["company_id"]},
        ).scalar()
        db.commit()

        # A logs in, tries to fetch B's announcement.
        client = _client(_engine, a["user_id"])
        resp = client.get(f"/api/v1/announcements/{b_content_id}")
        # Two valid outcomes both serve the isolation goal: 403 (we found it
        # but it's not yours) or 404 (we pretend it doesn't exist). The
        # current router returns 404 in this case — see _load_owned. Either
        # way it must NOT be 200 with B's row.
        assert resp.status_code in (403, 404), resp.text

    def test_company_a_list_does_not_include_company_b_rows(self, _engine, db):
        a = _create_user_and_company(db, "ListA")
        b = _create_user_and_company(db, "ListB")
        # B has an announcement; A has none.
        db.execute(
            sql_text(
                "INSERT INTO sponsored_content (kind, title, body, funding_company_id, status)"
                " VALUES ('employer', 'B-private', 'b', :cid, 'active')"
            ),
            {"cid": b["company_id"]},
        )
        db.commit()

        client = _client(_engine, a["user_id"])
        resp = client.get("/api/v1/announcements")
        assert resp.status_code == 200, resp.text
        titles = {row["title"] for row in resp.json()}
        assert "B-private" not in titles


class TestAdminAuth:
    def test_non_platform_admin_blocked_from_admin_ads_house(self, _engine, db):
        """A company admin (not a platform admin) hitting /admin/ads/house
        must be rejected. require_platform_admin enforces the JWT aud='web'
        AND the platform_admin role. With dependency_overrides bypassing the
        normal JWT, the role check inside require_platform_admin should
        still reject (since the test user has no platform_admin role)."""
        co = _create_user_and_company(db, "AdminBlock")
        client = _client(_engine, co["user_id"])
        resp = client.post(
            "/api/v1/admin/ads/house",
            json={
                "kind": "house",
                "funding_company_id": None,
                "title": "trying-to-create",
                "body": "b",
            },
        )
        # 403 from require_platform_admin (most likely path) OR 401 if the
        # aud='web' check fires first against the overridden token payload.
        assert resp.status_code in (401, 403), resp.text

    def test_admin_sponsored_moderation_requires_platform_admin(self, _engine, db):
        co = _create_user_and_company(db, "ModBlock")
        client = _client(_engine, co["user_id"])
        resp = client.get("/api/v1/admin/sponsored")
        assert resp.status_code in (401, 403), resp.text


class TestClickJsonContract:
    """The /sponsored/clicks endpoint MUST return JSON with `redirect_url`
    (not an HTTP 302), because React Native's XHR auto-follows redirects
    and would strip the Location header before mobile code could read it.
    Regression test for that bug — see backend/api/v1/sponsored.py click handler.
    """

    def test_click_returns_redirect_url_in_json_not_302(self, _engine, db):
        co = _create_user_and_company(db, "ClickJSON")
        # Create + activate an announcement so /serve has something.
        client = _client(_engine, co["user_id"])
        create_resp = client.post(
            "/api/v1/announcements",
            json={
                "kind": "employer",
                "funding_company_id": co["company_id"],
                "title": "click-test",
                "body": "b",
                "cta_label": "Open",
                "cta_url": "https://kontokaz.example/landing",
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        created = create_resp.json()

        # Flip status to active so /serve will return it.
        client.patch(
            f"/api/v1/announcements/{created['sponsored_content_id']}",
            json={"status": "active"},
        )

        # Need a private user from this same company to call /serve.
        from core.model import PrivateUser, User
        suffix = uuid.uuid4().hex[:8]
        emp_user = User(
            user_type="private",
            email=f"click-emp-{suffix}@kontokaz.test",
            user_name=f"click-emp-{suffix}",
            password_hash="not-used",
        )
        db.add(emp_user)
        db.flush()
        priv = PrivateUser(
            user_id=emp_user.user_id,
            first_name="Click",
            last_name="Tester",
            company_id=co["company_id"],
            role="employee",
        )
        db.add(priv)
        db.commit()
        # Re-load to populate the relationship the dependency expects.
        emp_user = db.query(User).filter(User.user_id == emp_user.user_id).one()

        # Switch the client to the employee.
        _clear()
        emp_client = _client(_engine, emp_user.user_id)

        # Hit /serve to get the tokens.
        serve_resp = emp_client.get("/api/v1/sponsored/serve?surface=home")
        assert serve_resp.status_code == 200, serve_resp.text
        served = serve_resp.json()
        assert served is not None
        assert served["sponsored_content_id"] == created["sponsored_content_id"]

        # POST /clicks — must return 200 + JSON, NOT a 302.
        click_resp = emp_client.post(
            "/api/v1/sponsored/clicks",
            json={
                "sponsored_content_id": served["sponsored_content_id"],
                "version_id": served["version_id"],
                "click_token": served["click_token"],
            },
            follow_redirects=False,  # belt+braces: if a 302 ever sneaks back in, we catch it
        )
        assert click_resp.status_code == 200, click_resp.text
        body = click_resp.json()
        assert body["ok"] is True
        assert body["redirect_url"] == "https://kontokaz.example/landing"


class TestDateRangeValidation:
    """`end_at <= start_at` is a silent killer — campaign saves cleanly but
    /serve's window query never matches. Schema layer rejects it with 422
    so admins see the error at submit time, not days later when nobody
    saw the announcement."""

    def test_rejects_end_before_start_on_create(self, _engine, db):
        co = _create_user_and_company(db, "DateInv")
        client = _client(_engine, co["user_id"])
        resp = client.post(
            "/api/v1/announcements",
            json={
                "kind": "employer",
                "funding_company_id": co["company_id"],
                "title": "bad-dates",
                "body": "b",
                "start_at": "2026-06-01T00:00:00Z",
                "end_at": "2026-05-15T00:00:00Z",  # before start
            },
        )
        assert resp.status_code == 422, resp.text
        body = resp.json()
        # Pydantic v2 puts the validator message in detail[].msg.
        assert any(
            "end_at must be after start_at" in str(item)
            for item in body.get("detail", [])
        ), body

    def test_accepts_end_after_start(self, _engine, db):
        co = _create_user_and_company(db, "DateOk")
        client = _client(_engine, co["user_id"])
        resp = client.post(
            "/api/v1/announcements",
            json={
                "kind": "employer",
                "funding_company_id": co["company_id"],
                "title": "good-dates",
                "body": "b",
                "start_at": "2026-05-15T00:00:00Z",
                "end_at": "2026-06-01T00:00:00Z",
            },
        )
        assert resp.status_code == 201, resp.text


class TestSurfacedCreate:
    """Sanity check that the happy path through /announcements actually works
    when auth is satisfied (rounds out the auth tests above which only assert
    the negative cases)."""

    def test_creates_and_lists_own_company_announcement(self, _engine, db):
        co = _create_user_and_company(db, "Happy")
        # Make this user a company admin via the legacy is_company_admin check
        # (Company owner → automatic admin). Already the case via Company.user_id.

        client = _client(_engine, co["user_id"])
        # Create.
        resp = client.post(
            "/api/v1/announcements",
            json={
                "kind": "employer",
                "funding_company_id": co["company_id"],
                "title": "Test announcement",
                "body": "Body text",
            },
        )
        assert resp.status_code == 201, resp.text
        created = resp.json()
        assert created["title"] == "Test announcement"
        assert created["kind"] == "employer"
        assert created["funding_company_id"] == co["company_id"]
        # current_version_id should be populated (v1 snapshot was taken).
        assert created["current_version_id"] is not None

        # List should include it.
        resp2 = client.get("/api/v1/announcements")
        assert resp2.status_code == 200, resp2.text
        titles = {row["title"] for row in resp2.json()}
        assert "Test announcement" in titles
