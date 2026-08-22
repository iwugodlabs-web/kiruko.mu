"""Phase 2 / M10 backend tests — ad campaigns, per-company toggle, consent.

Covers what shipped in M10:

  - POST /admin/ads/campaigns auth + creation (kind='ad' pinned server-side)
  - GET / PATCH / DELETE / versions / stats / export.csv plumbing
  - POST /admin/companies/{id}/ads-enabled toggle + AuditLog
  - POST /sponsored/consent  (accept + decline branches)
  - DELETE /sponsored/consent (withdrawal)
  - End-to-end ad serving: consent + ads_enabled + paid_amount → ad wins
  - Negative: company.ads_enabled=false drops the ad from /serve
  - Negative: consent withdrawn drops the ad from /serve

Test DB is not wiped between sessions, so every row gets a uuid suffix.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session, sessionmaker


# ── Shared client helpers ────────────────────────────────────────────────
def _client(_engine, current_user_id: int | None) -> TestClient:
    """Build a TestClient with DB + get_current_user overridden, identical to
    test_sponsored_routes.py. Does NOT override require_platform_admin —
    callers that need platform-admin access pass `is_admin=True`."""
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
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="not logged in",
            )
        return db.query(User).filter(User.user_id == current_user_id).one()

    app.dependency_overrides[core_config.get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_user
    return TestClient(app, raise_server_exceptions=True)


def _admin_client(_engine, current_user_id: int) -> TestClient:
    """Like _client but ALSO overrides require_platform_admin to skip the
    JWT aud='web' + platform_admin role check (those live in production
    code that's tested separately — here we're testing the route bodies)."""
    client = _client(_engine, current_user_id)
    from api.v1.admin import require_platform_admin
    from core.dependencies import get_current_user
    from main import app
    # Reuse the same get_current_user override for require_platform_admin —
    # if get_current_user returns a User, that's good enough for our tests.
    app.dependency_overrides[require_platform_admin] = app.dependency_overrides[get_current_user]
    return client


def _clear() -> None:
    from main import app
    app.dependency_overrides.clear()


# ── Fixtures: minimal user/company/employee setup ────────────────────────
def _make_user(db: Session, label: str, *, user_type: str = "private") -> int:
    """Insert a User and COMMIT so the route's separate SessionLocal-bound
    session can see it (the test client uses a different session per request)."""
    from core.model import User
    suffix = f"{label}-{uuid.uuid4().hex[:8]}"
    u = User(
        user_type=user_type,
        email=f"m10-{suffix}@kontokaz.test",
        user_name=f"m10-{suffix}",
        password_hash="not-used",
    )
    db.add(u)
    db.commit()
    return u.user_id


def _make_company(db: Session, label: str, owner_user_id: int) -> int:
    from core.model import Company
    suffix = f"{label}-{uuid.uuid4().hex[:8]}"
    co = Company(
        user_id=owner_user_id,
        company_name=f"M10 {suffix}",
        email=f"co-{suffix}@kontokaz.test",
        brn=f"M10_BRN_{suffix}",
        country_code="MU",
    )
    db.add(co)
    db.commit()
    return co.company_id


def _make_employee(db: Session, company_id: int, label: str) -> tuple[int, int]:
    """Returns (user_id, private_user_id)."""
    from core.model import PrivateUser
    user_id = _make_user(db, label, user_type="private")
    pu = PrivateUser(
        user_id=user_id,
        first_name="Test",
        last_name=label,
        company_id=company_id,
        role="employee",
    )
    db.add(pu)
    db.commit()
    return user_id, pu.private_user_id


@pytest.fixture(autouse=True)
def _wipe_per_test(db):
    """Trim sponsored_content between tests so candidate pools are deterministic.
    Don't touch the other tables — they cascade or live behind UNIQUEs."""
    db.execute(sql_text("DELETE FROM sponsored_content"))
    db.commit()
    yield
    _clear()


@pytest.fixture(autouse=True)
def _legacy_surface_default(monkeypatch):
    """M17 split home into home_banner (employer) + home_card (ad/house).
    The M10 ad-serving HTTP-level tests below all use `?surface=home` —
    pin defaults back to ['home'] so created rows match the legacy
    surface the tests query against. Surface-routing semantics are
    covered separately in test_sponsored_serve.py::TestSurfaceRouting."""
    from db_models.crud import sponsored_content as _sc
    monkeypatch.setattr(
        _sc, "DEFAULT_SURFACES_BY_KIND",
        {"employer": ["home"], "ad": ["home"], "house": ["home"]},
    )


# ─────────────────────────────────────────────────────────────────────────
# 1. /admin/ads/campaigns — auth + CRUD plumbing
# ─────────────────────────────────────────────────────────────────────────
class TestAdminAdCampaigns:
    def test_non_admin_blocked_from_create(self, _engine, db):
        # Plain employee (no platform_admin) → 401/403.
        emp_uid, _ = _make_employee(db, _make_company(db, "C", _make_user(db, "owner", user_type="company")), "emp")
        client = _client(_engine, emp_uid)  # no admin override
        resp = client.post(
            "/api/v1/admin/ads/campaigns",
            json={
                "kind": "ad",
                "funding_company_id": 1,
                "title": "x",
                "body": "x",
                "paid_amount_cents": 10000,
                "paid_currency": "MUR",
            },
        )
        assert resp.status_code in (401, 403), resp.text

    def test_admin_can_create_ad_campaign(self, _engine, db, monkeypatch):
        # ENABLED_KINDS still 'employer,house' — must not block create.
        monkeypatch.setenv("ENABLED_KINDS", "employer,house")
        admin_uid = _make_user(db, "admin", user_type="company")
        advertiser_id = _make_company(db, "Advertiser", admin_uid)
        client = _admin_client(_engine, admin_uid)
        resp = client.post(
            "/api/v1/admin/ads/campaigns",
            json={
                "kind": "ad",
                "funding_company_id": advertiser_id,
                "title": "BigCo summer sale",
                "body": "Visit our store",
                "cta_label": "Shop",
                "cta_url": "https://bigco.example/sale",
                "paid_amount_cents": 250_000,
                "paid_currency": "MUR",
                "payment_notes": "Q3 invoice #1234",
            },
        )
        assert resp.status_code == 201, resp.text
        out = resp.json()
        assert out["kind"] == "ad"
        assert out["funding_company_id"] == advertiser_id
        assert out["paid_amount_cents"] == 250_000
        assert out["status"] == "draft"
        assert out["current_version_id"] is not None

    def test_create_rejects_ad_without_payment_fields(self, _engine, db):
        admin_uid = _make_user(db, "admin2", user_type="company")
        advertiser_id = _make_company(db, "Adv2", admin_uid)
        client = _admin_client(_engine, admin_uid)
        resp = client.post(
            "/api/v1/admin/ads/campaigns",
            json={
                "kind": "ad",
                "funding_company_id": advertiser_id,
                "title": "missing-pay",
                "body": "b",
                # paid_amount_cents + paid_currency omitted on purpose
            },
        )
        # Pydantic validator rejects at the schema layer.
        assert resp.status_code == 422, resp.text

    def test_list_get_patch_delete_round_trip(self, _engine, db):
        admin_uid = _make_user(db, "admin3", user_type="company")
        advertiser_id = _make_company(db, "Adv3", admin_uid)
        client = _admin_client(_engine, admin_uid)

        # Create.
        create = client.post(
            "/api/v1/admin/ads/campaigns",
            json={
                "kind": "ad",
                "funding_company_id": advertiser_id,
                "title": "draft",
                "body": "b",
                "paid_amount_cents": 100_000,
                "paid_currency": "MUR",
            },
        )
        assert create.status_code == 201, create.text
        ad_id = create.json()["sponsored_content_id"]

        # List should include it.
        listing = client.get(f"/api/v1/admin/ads/campaigns")
        assert listing.status_code == 200
        assert any(r["sponsored_content_id"] == ad_id for r in listing.json())

        # Get.
        getr = client.get(f"/api/v1/admin/ads/campaigns/{ad_id}")
        assert getr.status_code == 200, getr.text

        # Patch: change a creative field → should create v2.
        patched = client.patch(
            f"/api/v1/admin/ads/campaigns/{ad_id}",
            json={"title": "ACTIVE — Promo", "status": "active"},
        )
        assert patched.status_code == 200, patched.text
        assert patched.json()["status"] == "active"

        # Versions: now 2.
        vers = client.get(f"/api/v1/admin/ads/campaigns/{ad_id}/versions")
        assert vers.status_code == 200
        assert len(vers.json()) == 2

        # Stats: shape only (no traffic yet, all zero).
        stats = client.get(f"/api/v1/admin/ads/campaigns/{ad_id}/stats")
        assert stats.status_code == 200
        assert stats.json()["total_views"] == 0

        # CSV: empty but the headers should land.
        csv_resp = client.get(f"/api/v1/admin/ads/campaigns/{ad_id}/export.csv")
        assert csv_resp.status_code == 200
        assert "event_type" in csv_resp.text

        # Soft delete.
        deleted = client.delete(f"/api/v1/admin/ads/campaigns/{ad_id}")
        assert deleted.status_code == 200
        assert deleted.json()["status"] == "ended"
        assert deleted.json()["deleted_at"] is not None

    def test_admin_cannot_reach_ad_via_announcements_router(self, _engine, db):
        """Belt+suspenders: ad row should 404 through /announcements/{id} (a
        company-admin route) regardless of who's asking. The company-side
        router pins kind='employer'."""
        admin_uid = _make_user(db, "admin4", user_type="company")
        advertiser_id = _make_company(db, "Adv4", admin_uid)
        client = _admin_client(_engine, admin_uid)
        create = client.post(
            "/api/v1/admin/ads/campaigns",
            json={
                "kind": "ad",
                "funding_company_id": advertiser_id,
                "title": "leak-test",
                "body": "b",
                "paid_amount_cents": 1000,
                "paid_currency": "MUR",
            },
        )
        ad_id = create.json()["sponsored_content_id"]
        _clear()  # reset overrides

        # Now the company owner tries to read it via /announcements/{id} —
        # that router enforces kind='employer' inside _load_owned, so even
        # though admin_uid owns this company, the ad row should 404 there.
        co_client = _client(_engine, admin_uid)
        resp = co_client.get(f"/api/v1/announcements/{ad_id}")
        assert resp.status_code == 404, resp.text


# ─────────────────────────────────────────────────────────────────────────
# 2. /admin/companies/{id}/ads-enabled toggle
# ─────────────────────────────────────────────────────────────────────────
class TestAdsEnabledToggle:
    def test_toggle_flips_company_flag_and_audits(self, _engine, db):
        admin_uid = _make_user(db, "admin5", user_type="company")
        co_id = _make_company(db, "Toggle", admin_uid)

        # Brand-new company: M9 default for NEW signups is True.
        from core.model import Company
        co = db.query(Company).filter(Company.company_id == co_id).one()
        assert co.ads_enabled is True

        client = _admin_client(_engine, admin_uid)
        resp = client.post(
            f"/api/v1/admin/companies/{co_id}/ads-enabled",
            json={"enabled": False},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"company_id": co_id, "ads_enabled": False}

        # DB state actually changed.
        db.refresh(co)
        assert co.ads_enabled is False

        # AuditLog row was written with before/after.
        from core.model import AuditLog
        log = (
            db.query(AuditLog)
            .filter(AuditLog.target_type == "company", AuditLog.target_id == str(co_id))
            .filter(AuditLog.action == "sponsored_content.ads_enabled_toggle")
            .order_by(AuditLog.created_at.desc())
            .first()
        )
        assert log is not None
        assert log.meta["before"] is True
        assert log.meta["after"] is False

    def test_toggle_404_unknown_company(self, _engine, db):
        admin_uid = _make_user(db, "admin6", user_type="company")
        client = _admin_client(_engine, admin_uid)
        resp = client.post(
            "/api/v1/admin/companies/99999999/ads-enabled",
            json={"enabled": True},
        )
        assert resp.status_code == 404, resp.text


# ─────────────────────────────────────────────────────────────────────────
# 3. Consent endpoints
# ─────────────────────────────────────────────────────────────────────────
class TestConsent:
    def test_accept_sets_consent_clears_ad_free(self, _engine, db):
        owner_uid = _make_user(db, "co7", user_type="company")
        co_id = _make_company(db, "C7", owner_uid)
        emp_uid, pu_id = _make_employee(db, co_id, "consent-accept")
        # Default: ads_consent_at is NULL, is_ad_free is False.

        client = _client(_engine, emp_uid)
        resp = client.post(
            "/api/v1/sponsored/consent",
            json={"accepted": True, "policy_version": "2026-05-17"},
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["is_ad_free"] is False
        assert body["ads_consent_at"] is not None

        # Verify DB.
        from core.model import PrivateUser
        pu = db.query(PrivateUser).filter(PrivateUser.private_user_id == pu_id).one()
        assert pu.ads_consent_at is not None
        assert pu.is_ad_free is False

    def test_decline_clears_consent_sets_ad_free(self, _engine, db):
        owner_uid = _make_user(db, "co8", user_type="company")
        co_id = _make_company(db, "C8", owner_uid)
        emp_uid, pu_id = _make_employee(db, co_id, "consent-decline")
        client = _client(_engine, emp_uid)
        resp = client.post(
            "/api/v1/sponsored/consent",
            json={"accepted": False, "policy_version": "2026-05-17"},
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["is_ad_free"] is True
        assert body["ads_consent_at"] is None

        from core.model import PrivateUser
        pu = db.query(PrivateUser).filter(PrivateUser.private_user_id == pu_id).one()
        assert pu.is_ad_free is True
        assert pu.ads_consent_at is None

    def test_delete_consent_withdrawal(self, _engine, db):
        owner_uid = _make_user(db, "co9", user_type="company")
        co_id = _make_company(db, "C9", owner_uid)
        emp_uid, pu_id = _make_employee(db, co_id, "consent-withdraw")
        client = _client(_engine, emp_uid)
        # Accept first.
        client.post("/api/v1/sponsored/consent", json={"accepted": True})
        # Withdraw.
        resp = client.delete("/api/v1/sponsored/consent")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["is_ad_free"] is True
        assert body["ads_consent_at"] is None

    def test_consent_requires_employee_account(self, _engine, db):
        # User without a PrivateUser row → 403.
        owner_uid = _make_user(db, "no-pu", user_type="company")
        client = _client(_engine, owner_uid)
        resp = client.post("/api/v1/sponsored/consent", json={"accepted": True})
        assert resp.status_code == 403, resp.text

    def test_get_consent_reflects_server_state(self, _engine, db):
        """M13 — GET /sponsored/consent surfaces the authoritative state.
        Used by mobile Settings to render the toggle after device switching."""
        owner_uid = _make_user(db, "co-get", user_type="company")
        co_id = _make_company(db, "Cget", owner_uid)
        emp_uid, _pu_id = _make_employee(db, co_id, "consent-get")
        client = _client(_engine, emp_uid)

        # Fresh employee: never consented.
        resp = client.get("/api/v1/sponsored/consent")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["ads_consent_at"] is None
        assert body["is_ad_free"] is False

        # Accept → GET reflects it.
        client.post("/api/v1/sponsored/consent", json={"accepted": True})
        after = client.get("/api/v1/sponsored/consent").json()
        assert after["ads_consent_at"] is not None
        assert after["is_ad_free"] is False

        # Withdraw → GET reflects withdrawal.
        client.delete("/api/v1/sponsored/consent")
        withdrawn = client.get("/api/v1/sponsored/consent").json()
        assert withdrawn["ads_consent_at"] is None
        assert withdrawn["is_ad_free"] is True

    def test_get_consent_surfaces_company_ads_enabled(self, _engine, db):
        """M14 gate — GET /sponsored/consent returns `company_ads_enabled`
        so the mobile first-launch modal can short-circuit for users
        whose employer has ads disabled (no point prompting for consent
        for something they'd never see)."""
        from core.model import Company
        owner_uid = _make_user(db, "co-gate", user_type="company")
        co_id = _make_company(db, "Cgate", owner_uid)
        emp_uid, _pu_id = _make_employee(db, co_id, "consent-gate")

        # New signups default ads_enabled=true (M9 column default).
        client = _client(_engine, emp_uid)
        body = client.get("/api/v1/sponsored/consent").json()
        assert body["company_ads_enabled"] is True

        # Flip ads off on the company.
        co = db.query(Company).filter(Company.company_id == co_id).one()
        co.ads_enabled = False
        db.commit()

        body = client.get("/api/v1/sponsored/consent").json()
        assert body["company_ads_enabled"] is False

    def test_get_consent_403_for_non_employee(self, _engine, db):
        owner_uid = _make_user(db, "co-noemp", user_type="company")
        client = _client(_engine, owner_uid)
        resp = client.get("/api/v1/sponsored/consent")
        assert resp.status_code == 403, resp.text


# ─────────────────────────────────────────────────────────────────────────
# 5. Cross-kind moderation PATCH + DELETE (covers the "can't publish a
#    house draft" gap discovered after Phase 2 shipped).
# ─────────────────────────────────────────────────────────────────────────
class TestCrossKindModeration:
    def test_platform_admin_can_publish_house_draft(self, _engine, db):
        admin_uid = _make_user(db, "mod-house-pub", user_type="company")
        client = _admin_client(_engine, admin_uid)
        # Create a house draft directly via CRUD (mirrors what the house
        # page does via createHouseAnnouncement).
        from db_models.crud import sponsored_content as crud
        house = crud.create_sponsored_content(
            db, actor_user_id=admin_uid, kind="house",
            funding_company_id=None, title="house-draft", body="b",
        )
        assert house.status == "draft"
        # Flip to active via the new admin/sponsored PATCH.
        resp = client.patch(
            f"/api/v1/admin/sponsored/{house.sponsored_content_id}",
            json={"status": "active"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "active"

    def test_platform_admin_can_edit_creative_on_employer_row(self, _engine, db):
        admin_uid = _make_user(db, "mod-emp-edit", user_type="company")
        co_id = _make_company(db, "ModEmpCo", admin_uid)
        client = _admin_client(_engine, admin_uid)
        from db_models.crud import sponsored_content as crud
        emp = crud.create_sponsored_content(
            db, actor_user_id=admin_uid, kind="employer",
            funding_company_id=co_id, title="orig", body="b",
        )
        before_v_count = len(crud.list_versions(db, emp.sponsored_content_id))
        # Creative change must snapshot a new version (the cross-kind
        # moderator gets the same version-snapshot semantics as the
        # dedicated routers).
        resp = client.patch(
            f"/api/v1/admin/sponsored/{emp.sponsored_content_id}",
            json={"title": "moderated"},
        )
        assert resp.status_code == 200, resp.text
        after = crud.list_versions(db, emp.sponsored_content_id)
        assert len(after) == before_v_count + 1

    def test_platform_admin_can_soft_delete_any_kind(self, _engine, db):
        admin_uid = _make_user(db, "mod-del", user_type="company")
        client = _admin_client(_engine, admin_uid)
        from db_models.crud import sponsored_content as crud
        house = crud.create_sponsored_content(
            db, actor_user_id=admin_uid, kind="house",
            funding_company_id=None, title="kill-me", body="b",
        )
        resp = client.delete(f"/api/v1/admin/sponsored/{house.sponsored_content_id}")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "ended"
        assert body["deleted_at"] is not None

    def test_non_admin_blocked_from_moderation_patch(self, _engine, db):
        emp_uid, _ = _make_employee(
            db, _make_company(db, "ModBlockCo", _make_user(db, "owner-modblock", user_type="company")),
            "emp-modblock",
        )
        client = _client(_engine, emp_uid)  # no admin override
        resp = client.patch("/api/v1/admin/sponsored/1", json={"status": "active"})
        assert resp.status_code in (401, 403), resp.text

    def test_moderation_404_unknown_id(self, _engine, db):
        admin_uid = _make_user(db, "mod-404", user_type="company")
        client = _admin_client(_engine, admin_uid)
        resp = client.patch("/api/v1/admin/sponsored/99999999", json={"status": "active"})
        assert resp.status_code == 404, resp.text
        resp2 = client.delete("/api/v1/admin/sponsored/99999999")
        assert resp2.status_code == 404, resp2.text


# ─────────────────────────────────────────────────────────────────────────
# 4. End-to-end ad serving: consent + ads_enabled gate the candidate
# ─────────────────────────────────────────────────────────────────────────
class TestAdServingE2E:
    def _activate(self, db, content_id: int) -> None:
        db.execute(
            sql_text("UPDATE sponsored_content SET status='active' WHERE sponsored_content_id=:i"),
            {"i": content_id},
        )
        db.commit()

    def test_consent_plus_ads_enabled_lets_ad_serve(self, _engine, db, monkeypatch):
        monkeypatch.setenv("ENABLED_KINDS", "employer,ad,house")
        owner_uid = _make_user(db, "co10", user_type="company")
        co_id = _make_company(db, "C10", owner_uid)
        emp_uid, pu_id = _make_employee(db, co_id, "e2e-yes")

        # Create + activate an ad targeting this employee's company.
        admin_client = _admin_client(_engine, owner_uid)
        create = admin_client.post(
            "/api/v1/admin/ads/campaigns",
            json={
                "kind": "ad",
                "funding_company_id": co_id,
                "title": "served-ad",
                "body": "b",
                "paid_amount_cents": 500_000,
                "paid_currency": "MUR",
                "targeting": {"company_ids": [co_id]},
            },
        )
        ad_id = create.json()["sponsored_content_id"]
        self._activate(db, ad_id)
        _clear()

        # Employee accepts consent.
        emp_client = _client(_engine, emp_uid)
        emp_client.post("/api/v1/sponsored/consent", json={"accepted": True})

        # /serve should now return the ad.
        resp = emp_client.get("/api/v1/sponsored/serve?surface=home")
        assert resp.status_code == 200, resp.text
        payload = resp.json()
        assert payload is not None
        assert payload["sponsored_content_id"] == ad_id
        assert payload["kind"] == "ad"

    def test_company_ads_disabled_drops_ad(self, _engine, db, monkeypatch):
        monkeypatch.setenv("ENABLED_KINDS", "employer,ad,house")
        owner_uid = _make_user(db, "co11", user_type="company")
        co_id = _make_company(db, "C11", owner_uid)
        emp_uid, pu_id = _make_employee(db, co_id, "e2e-no-ads")

        admin_client = _admin_client(_engine, owner_uid)
        create = admin_client.post(
            "/api/v1/admin/ads/campaigns",
            json={
                "kind": "ad", "funding_company_id": co_id,
                "title": "wont-serve", "body": "b",
                "paid_amount_cents": 500_000, "paid_currency": "MUR",
                "targeting": {"company_ids": [co_id]},
            },
        )
        ad_id = create.json()["sponsored_content_id"]
        self._activate(db, ad_id)
        # Flip the company's ads_enabled OFF.
        admin_client.post(
            f"/api/v1/admin/companies/{co_id}/ads-enabled", json={"enabled": False}
        )
        _clear()

        # Employee consents but company says no.
        emp_client = _client(_engine, emp_uid)
        emp_client.post("/api/v1/sponsored/consent", json={"accepted": True})

        resp = emp_client.get("/api/v1/sponsored/serve?surface=home")
        assert resp.status_code == 200, resp.text
        # The ad is the only candidate; it must be filtered out.
        assert resp.json() is None

    def test_consent_withdrawal_stops_ad_on_next_serve(self, _engine, db, monkeypatch):
        """The /serve cache is invalidated for this user on consent change so
        the new state is reflected immediately, not up to 60s later."""
        monkeypatch.setenv("ENABLED_KINDS", "employer,ad,house")
        owner_uid = _make_user(db, "co12", user_type="company")
        co_id = _make_company(db, "C12", owner_uid)
        emp_uid, pu_id = _make_employee(db, co_id, "e2e-withdraw")

        admin_client = _admin_client(_engine, owner_uid)
        create = admin_client.post(
            "/api/v1/admin/ads/campaigns",
            json={
                "kind": "ad", "funding_company_id": co_id,
                "title": "withdraw-ad", "body": "b",
                "paid_amount_cents": 500_000, "paid_currency": "MUR",
                "targeting": {"company_ids": [co_id]},
            },
        )
        ad_id = create.json()["sponsored_content_id"]
        self._activate(db, ad_id)
        _clear()

        emp_client = _client(_engine, emp_uid)
        emp_client.post("/api/v1/sponsored/consent", json={"accepted": True})

        # First /serve: ad shows.
        first = emp_client.get("/api/v1/sponsored/serve?surface=home")
        assert first.json() is not None
        assert first.json()["sponsored_content_id"] == ad_id

        # Withdraw.
        emp_client.delete("/api/v1/sponsored/consent")

        # Next /serve: no ad.
        second = emp_client.get("/api/v1/sponsored/serve?surface=home")
        assert second.json() is None
