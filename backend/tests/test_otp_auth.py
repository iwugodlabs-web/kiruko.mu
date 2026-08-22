"""Phone-OTP login + trust-on-first-use (TOFU) device-binding test suite.

Covers the feature shipped in api/v1/auth_otp.py + services/trusted_device_service.py:

  * /auth/otp/request  — known phone issues a token; unknown phone returns a
    generic 200 with NO token (anti-enumeration); invalid phone → 400;
    per-phone soft rate limit (3/hour) → 429.
  * /auth/otp/verify   — correct code returns the /user/login shape + tokens
    and auto-verifies the user; wrong/expired/reused code → 400.
  * Device binding policy (check_or_bind) — service-level: TOFU first device,
    repeat device, passwordless-new-device rejection, password-user bypass,
    no-device-id skip. Plus the 403 contract through the verify endpoint.
  * /auth/otp/devices + revoke — list and soft-revoke.

Service-layer policy is driven directly (fast, exhaustive). HTTP contract is
driven through TestClient with the DB + auth dependencies overridden, mirroring
test_kiosk.py / test_payslip_estimate.py.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session, sessionmaker

from core.model import TrustedDevice, User, UserType, VerificationToken
from services.trusted_device_service import (
    check_or_bind,
    list_devices,
    revoke_device,
)

# auth_otp imports these into its own module namespace, and hashes with its
# own bcrypt context — reuse the exact same context so directly-inserted
# tokens verify against the endpoint.
from api.v1 import auth_otp as otp_module

_OTP_TOKEN_TYPE = otp_module._OTP_TOKEN_TYPE
_otp_ctx = otp_module._otp_ctx


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------


def _unique_phone() -> str:
    """A canonical MU phone unlikely to collide across tests. 8-digit local
    part starting with 5 (mobile), random tail."""
    return "+230" + "5" + uuid.uuid4().int.__str__()[:7]


def _mk_user(db: Session, *, phone: str, password: str | None = None,
             verified: bool = False) -> User:
    """Create a minimal phone-login User. `password=None` → passwordless
    (device binding applies); a value → password-fallback eligible."""
    u = User(
        user_type=UserType.private if hasattr(UserType, "private") else "private",
        email=f"otp-{uuid.uuid4().hex[:12]}@otptest.dev",
        user_name=f"otp-{uuid.uuid4().hex[:12]}",
        phone=phone,
        password_hash=("hashed-" + password) if password else None,
        user_verified=verified,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _insert_token(db: Session, *, phone: str, code: str,
                  expires_in_minutes: int = 10, used: bool = False) -> VerificationToken:
    """Insert a login-phone OTP token with a known code (bcrypt-hashed via
    the endpoint's own context) so verify tests don't depend on the provider."""
    tok = VerificationToken(
        email=phone,
        token_type=_OTP_TOKEN_TYPE,
        otp_hash=_otp_ctx.hash(code),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=expires_in_minutes),
        used=used,
    )
    db.add(tok)
    db.commit()
    return tok


@pytest.fixture(autouse=True)
def _disable_ip_limiter() -> Iterator[None]:
    """Disable the shared slowapi limiter for the duration of each test (and
    restore it after) so the @limiter.limit decorators on the OTP endpoints
    don't enforce per-IP limits across tests that all originate from the same
    TestClient address. Restoring avoids leaking the flag into other files."""
    from core.limiter import limiter
    if limiter is None:
        yield
        return
    original = limiter.enabled
    limiter.enabled = False
    try:
        yield
    finally:
        limiter.enabled = original


@pytest.fixture(autouse=True)
def _clean_otp_state(db: Session) -> Iterator[None]:
    """Wipe OTP/device churn before and after each test so the cases can't
    bleed into each other (the suite has no per-test transactional rollback)."""
    def _wipe():
        db.rollback()
        db.execute(sql_text(
            "DELETE FROM trusted_devices WHERE device_name LIKE 'otptest-%' "
            "OR device_id LIKE 'otptest-%'"
        ))
        db.execute(sql_text(
            "DELETE FROM verification_tokens WHERE token_type = :t",
        ), {"t": _OTP_TOKEN_TYPE})
        db.execute(sql_text(
            "DELETE FROM users WHERE email LIKE 'otp-%@otptest.dev'"
        ))
        db.commit()
    _wipe()
    yield
    _wipe()
    # Don't leak dependency overrides onto the shared main.app for later tests.
    from main import app
    app.dependency_overrides.clear()


def _capture_provider(monkeypatch) -> dict:
    """Replace the OTP provider with a capturing fake so request-endpoint
    tests can read the code that would have been sent."""
    captured: dict = {}

    class _Fake:
        name = "capture"

        def send(self, *, phone_e164, code, locale=None):
            captured["phone"] = phone_e164
            captured["code"] = code
            captured["locale"] = locale

    monkeypatch.setattr(otp_module, "get_provider", lambda: _Fake())
    return captured


def _otp_client(_engine, *, current_user: User | None = None) -> TestClient:
    """A TestClient on the REAL app (`main.app`) with the DB (and optionally
    auth) dependencies overridden. Using the real app — rather than a bare
    FastAPI() — is necessary: the @limiter.limit decorators on the OTP routes
    only resolve their request body correctly under the app's configured
    limiter state (a minimal app makes FastAPI treat `body` as a query param).
    Overrides are cleared by the autouse _clean_otp_state teardown."""
    from main import app
    from core import config as core_config
    from core.dependencies import get_current_user

    SessionFactory = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

    def _override_db():
        s = SessionFactory()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[core_config.get_db] = _override_db
    if current_user is not None:
        app.dependency_overrides[get_current_user] = lambda: current_user
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# /auth/otp/request
# ---------------------------------------------------------------------------


class TestRequestOtp:
    def test_known_phone_issues_token(self, db, _engine, monkeypatch):
        captured = _capture_provider(monkeypatch)
        phone = _unique_phone()
        _mk_user(db, phone=phone)

        client = _otp_client(_engine)
        resp = client.post("/api/v1/auth/otp/request", json={"phone": phone})

        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"
        # A token was stored, and the provider was asked to send the code.
        assert captured.get("code") and len(captured["code"]) == 6
        n = db.query(VerificationToken).filter(
            VerificationToken.email == phone,
            VerificationToken.token_type == _OTP_TOKEN_TYPE,
        ).count()
        assert n == 1

    def test_unknown_phone_is_generic_and_stores_nothing(self, db, _engine, monkeypatch):
        captured = _capture_provider(monkeypatch)
        phone = _unique_phone()  # no user created

        client = _otp_client(_engine)
        resp = client.post("/api/v1/auth/otp/request", json={"phone": phone})

        # Same 200 shape as the known-phone path — no enumeration signal.
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"
        # No code sent (don't burn WhatsApp/SMS on probes) and no token stored.
        assert "code" not in captured
        n = db.query(VerificationToken).filter(
            VerificationToken.email == phone,
            VerificationToken.token_type == _OTP_TOKEN_TYPE,
        ).count()
        assert n == 0

    def test_invalid_phone_rejected(self, db, _engine, monkeypatch):
        _capture_provider(monkeypatch)
        client = _otp_client(_engine)
        resp = client.post("/api/v1/auth/otp/request", json={"phone": "123"})  # too short
        assert resp.status_code in (400, 422)

    def test_per_phone_rate_limit(self, db, _engine, monkeypatch):
        _capture_provider(monkeypatch)
        phone = _unique_phone()
        _mk_user(db, phone=phone)
        client = _otp_client(_engine)

        # 3 allowed, 4th within the hour → 429 (manual per-phone limit).
        for _ in range(3):
            assert client.post("/api/v1/auth/otp/request", json={"phone": phone}).status_code == 200
        resp = client.post("/api/v1/auth/otp/request", json={"phone": phone})
        assert resp.status_code == 429


# ---------------------------------------------------------------------------
# /auth/otp/verify
# ---------------------------------------------------------------------------


class TestVerifyOtp:
    def test_correct_code_returns_tokens_and_verifies_user(self, db, _engine):
        phone = _unique_phone()
        user = _mk_user(db, phone=phone, verified=False)
        _insert_token(db, phone=phone, code="654321")

        client = _otp_client(_engine)
        resp = client.post("/api/v1/auth/otp/verify", json={"phone": phone, "code": "654321"})

        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "success"
        assert body["access_token"] and body["refresh_token"]
        # Successful OTP delivery proves phone ownership → user auto-verified.
        db.expire_all()
        assert db.query(User).filter(User.user_id == user.user_id).one().user_verified is True

    def test_wrong_code_rejected(self, db, _engine):
        phone = _unique_phone()
        _mk_user(db, phone=phone)
        _insert_token(db, phone=phone, code="111111")

        client = _otp_client(_engine)
        resp = client.post("/api/v1/auth/otp/verify", json={"phone": phone, "code": "222222"})
        assert resp.status_code == 400
        assert resp.json()["detail"] == "invalid_code"

    def test_expired_code_rejected(self, db, _engine):
        phone = _unique_phone()
        _mk_user(db, phone=phone)
        _insert_token(db, phone=phone, code="333333", expires_in_minutes=-1)  # already expired

        client = _otp_client(_engine)
        resp = client.post("/api/v1/auth/otp/verify", json={"phone": phone, "code": "333333"})
        assert resp.status_code == 400
        assert resp.json()["detail"] == "code_expired"

    def test_code_cannot_be_reused(self, db, _engine):
        phone = _unique_phone()
        _mk_user(db, phone=phone)
        _insert_token(db, phone=phone, code="444444")

        client = _otp_client(_engine)
        first = client.post("/api/v1/auth/otp/verify", json={"phone": phone, "code": "444444"})
        assert first.status_code == 200
        # Token is now marked used → replay fails.
        second = client.post("/api/v1/auth/otp/verify", json={"phone": phone, "code": "444444"})
        assert second.status_code == 400


# ---------------------------------------------------------------------------
# Device binding policy (service-level)
# ---------------------------------------------------------------------------


class TestDeviceBindingPolicy:
    def test_first_device_tofu_binds(self, db):
        user = _mk_user(db, phone=_unique_phone())  # passwordless, no devices
        outcome, row = check_or_bind(
            db=db, user=user, device_id="otptest-dev-A", device_name="otptest-A",
        )
        assert outcome == "bound"
        assert row is not None and row.device_id == "otptest-dev-A"

    def test_same_device_is_trusted_and_bumps_last_seen(self, db):
        user = _mk_user(db, phone=_unique_phone())
        check_or_bind(db=db, user=user, device_id="otptest-dev-A", device_name="otptest-A")
        before = db.query(TrustedDevice).filter(
            TrustedDevice.user_id == user.user_id,
            TrustedDevice.device_id == "otptest-dev-A",
        ).one().last_seen_at

        outcome, row = check_or_bind(
            db=db, user=user, device_id="otptest-dev-A", device_name="otptest-A",
        )
        assert outcome == "trusted"
        assert row.last_seen_at >= before

    def test_passwordless_new_device_needs_approval(self, db):
        # Passwordless user already has one active device → a NEW device
        # can't silently bind (recycled-number mitigation).
        user = _mk_user(db, phone=_unique_phone())
        check_or_bind(db=db, user=user, device_id="otptest-dev-A", device_name="otptest-A")
        outcome, row = check_or_bind(
            db=db, user=user, device_id="otptest-dev-B", device_name="otptest-B",
        )
        assert outcome == "needs_approval"
        assert row is None

    def test_password_user_new_device_bypasses(self, db):
        # User WITH a password can always fall back to password, so a new
        # device binds silently even with another active.
        user = _mk_user(db, phone=_unique_phone(), password="pw")
        check_or_bind(db=db, user=user, device_id="otptest-dev-A", device_name="otptest-A")
        outcome, row = check_or_bind(
            db=db, user=user, device_id="otptest-dev-B", device_name="otptest-B",
        )
        assert outcome == "bound"
        assert row is not None

    def test_no_device_id_skips(self, db):
        user = _mk_user(db, phone=_unique_phone())
        outcome, row = check_or_bind(db=db, user=user, device_id=None, device_name=None)
        assert outcome == "skipped"
        assert row is None


# ---------------------------------------------------------------------------
# Device binding through the verify endpoint (403 contract)
# ---------------------------------------------------------------------------


class TestVerifyDeviceContract:
    def test_new_device_for_passwordless_user_returns_403(self, db, _engine):
        phone = _unique_phone()
        user = _mk_user(db, phone=phone)
        # Pre-existing active device on a different id.
        check_or_bind(db=db, user=user, device_id="otptest-dev-A", device_name="otptest-A")
        _insert_token(db, phone=phone, code="999999")

        client = _otp_client(_engine)
        resp = client.post(
            "/api/v1/auth/otp/verify",
            json={"phone": phone, "code": "999999"},
            headers={"X-Device-Id": "otptest-dev-B", "X-Device-Name": "otptest-B"},
        )
        assert resp.status_code == 403
        assert resp.json()["detail"] == "new_device_requires_approval"


# ---------------------------------------------------------------------------
# /auth/otp/devices  +  revoke
# ---------------------------------------------------------------------------


class TestDeviceManagementEndpoints:
    def test_list_devices(self, db, _engine):
        # Password user so both devices bind (a passwordless user's 2nd device
        # would be rejected as needs_approval).
        user = _mk_user(db, phone=_unique_phone(), password="pw")
        check_or_bind(db=db, user=user, device_id="otptest-dev-A", device_name="otptest-A")
        check_or_bind(db=db, user=user, device_id="otptest-dev-B", device_name="otptest-B")

        client = _otp_client(_engine, current_user=user)
        resp = client.get("/api/v1/auth/otp/devices")
        assert resp.status_code == 200
        ids = {d["device_id"] for d in resp.json()["devices"]}
        assert ids == {"otptest-dev-A", "otptest-dev-B"}

    def test_revoke_device(self, db, _engine):
        user = _mk_user(db, phone=_unique_phone())
        check_or_bind(db=db, user=user, device_id="otptest-dev-A", device_name="otptest-A")

        client = _otp_client(_engine, current_user=user)
        resp = client.post("/api/v1/auth/otp/devices/otptest-dev-A/revoke")
        assert resp.status_code == 204
        # Gone from the active list.
        assert list_devices(db, user.user_id, include_revoked=False) == []

    def test_revoke_unknown_device_404(self, db, _engine):
        user = _mk_user(db, phone=_unique_phone())
        client = _otp_client(_engine, current_user=user)
        resp = client.post("/api/v1/auth/otp/devices/otptest-does-not-exist/revoke")
        assert resp.status_code == 404
