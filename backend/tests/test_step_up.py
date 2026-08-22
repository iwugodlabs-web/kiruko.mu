"""Tests for M7 — step-up auth (2FA on payroll finalize).

Covers:
  * issue_step_up_otp creates a single VerificationToken row, invalidating prior
  * consume_otp_and_issue_token rejects bad OTP, expired OTP, replays
  * issued StepUpToken: 5-min expiry, single-use, scoped to (user, purpose)
  * require_step_up_token dependency rejects missing/wrong-purpose/used/expired
  * unknown purpose rejected at issue + verify time
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from core.step_up import (
    ALLOWED_PURPOSES,
    consume_otp_and_issue_token,
    issue_step_up_otp,
    require_step_up_token,
)


# ---------------------------------------------------------------------------
# Helpers — build a fresh User per test (we don't mutate shared fixtures)
# ---------------------------------------------------------------------------


def _make_user(db: Session) -> "User":
    from core.model import User

    suffix = datetime.utcnow().strftime("%H%M%S%f")
    u = User(
        user_type="company",
        email=f"stepup-{suffix}@kontokaz.test",
        user_name=f"stepup-{suffix}",
        password_hash="x",
    )
    db.add(u)
    db.commit()
    return u


def _cleanup_user(db: Session, user) -> None:
    db.execute(
        sql_text("DELETE FROM step_up_tokens WHERE user_id=:uid"),
        {"uid": user.user_id},
    )
    db.execute(
        sql_text("DELETE FROM verification_tokens WHERE email=:e"),
        {"e": user.email},
    )
    db.execute(sql_text("DELETE FROM users WHERE user_id=:uid"), {"uid": user.user_id})
    db.commit()


# ---------------------------------------------------------------------------
# OTP issuance + verification
# ---------------------------------------------------------------------------


class TestIssueOtp:
    def test_issue_returns_six_digit_code(self, db: Session):
        user = _make_user(db)
        try:
            otp = issue_step_up_otp(db, user, "payroll_finalize")
            assert otp.isdigit() and len(otp) == 6
        finally:
            _cleanup_user(db, user)

    def test_issue_invalidates_prior_otp(self, db: Session):
        from core.model import VerificationToken

        user = _make_user(db)
        try:
            issue_step_up_otp(db, user, "payroll_finalize")
            issue_step_up_otp(db, user, "payroll_finalize")
            unused = (
                db.query(VerificationToken)
                .filter(
                    VerificationToken.email == user.email,
                    VerificationToken.token_type == "su.payroll_finalize",
                    VerificationToken.used == False,  # noqa: E712
                )
                .count()
            )
            assert unused == 1, "Re-issue should invalidate the prior unused OTP"
        finally:
            _cleanup_user(db, user)

    def test_unknown_purpose_rejected(self, db: Session):
        user = _make_user(db)
        try:
            with pytest.raises(HTTPException) as exc:
                issue_step_up_otp(db, user, "rogue_purpose")
            assert exc.value.status_code == 400
        finally:
            _cleanup_user(db, user)


class TestConsumeOtp:
    def test_happy_path_returns_token(self, db: Session):
        user = _make_user(db)
        try:
            otp = issue_step_up_otp(db, user, "payroll_finalize")
            token, expires_at = consume_otp_and_issue_token(
                db, user, "payroll_finalize", otp
            )
            assert isinstance(token, str)
            assert len(token) <= 80
            # 5-min TTL → expires_at within (now, now+6min)
            now = datetime.now(timezone.utc)
            assert now < expires_at <= now + timedelta(minutes=6)
        finally:
            _cleanup_user(db, user)

    def test_wrong_otp_rejected(self, db: Session):
        user = _make_user(db)
        try:
            issue_step_up_otp(db, user, "payroll_finalize")
            with pytest.raises(HTTPException) as exc:
                consume_otp_and_issue_token(db, user, "payroll_finalize", "000000")
            assert exc.value.status_code == 400
        finally:
            _cleanup_user(db, user)

    def test_otp_replay_rejected(self, db: Session):
        user = _make_user(db)
        try:
            otp = issue_step_up_otp(db, user, "payroll_finalize")
            consume_otp_and_issue_token(db, user, "payroll_finalize", otp)
            # Same OTP again → rejected (it was marked used)
            with pytest.raises(HTTPException):
                consume_otp_and_issue_token(db, user, "payroll_finalize", otp)
        finally:
            _cleanup_user(db, user)

    def test_expired_otp_rejected(self, db: Session):
        from core.model import VerificationToken

        user = _make_user(db)
        try:
            otp = issue_step_up_otp(db, user, "payroll_finalize")
            # Force the OTP to be expired
            db.execute(
                sql_text(
                    "UPDATE verification_tokens SET expires_at = :exp "
                    "WHERE email=:e AND token_type='su.payroll_finalize' AND used=false"
                ),
                {"e": user.email, "exp": datetime.now(timezone.utc) - timedelta(minutes=1)},
            )
            db.commit()
            with pytest.raises(HTTPException, match="expired"):
                consume_otp_and_issue_token(db, user, "payroll_finalize", otp)
        finally:
            _cleanup_user(db, user)


# ---------------------------------------------------------------------------
# require_step_up_token dependency — exercise via a stub FastAPI app
# ---------------------------------------------------------------------------


def _app_with_protected_endpoint(_engine, fake_user):
    """Build a FastAPI app with a single endpoint that requires step-up
    for purpose='payroll_finalize'. Auth is faked: get_current_user is
    overridden to return the test user."""
    from sqlalchemy.orm import sessionmaker

    from core import config as core_config
    from core.dependencies import get_current_user

    SessionFactory = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

    def _override_db():
        db = SessionFactory()
        try:
            yield db
        finally:
            db.close()

    def _override_user():
        return fake_user

    app = FastAPI()

    @app.post("/protected")
    def protected(_step_up: str = Depends(require_step_up_token("payroll_finalize"))):
        return {"ok": True, "consumed_token": _step_up}

    app.dependency_overrides[core_config.get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_user
    return app


class TestDependencyEnforcement:
    def test_missing_header_401(self, db: Session, _engine):
        user = _make_user(db)
        try:
            app = _app_with_protected_endpoint(_engine, user)
            client = TestClient(app)
            resp = client.post("/protected")
            assert resp.status_code == 401
            assert "missing" in resp.json()["detail"].lower()
        finally:
            _cleanup_user(db, user)

    def test_unknown_token_401(self, db: Session, _engine):
        user = _make_user(db)
        try:
            app = _app_with_protected_endpoint(_engine, user)
            client = TestClient(app)
            resp = client.post(
                "/protected", headers={"X-Step-Up-Token": "totally-fake"}
            )
            assert resp.status_code == 401
            assert "not recognized" in resp.json()["detail"].lower()
        finally:
            _cleanup_user(db, user)

    def test_valid_token_200_then_replay_401(self, db: Session, _engine):
        user = _make_user(db)
        try:
            otp = issue_step_up_otp(db, user, "payroll_finalize")
            token, _ = consume_otp_and_issue_token(db, user, "payroll_finalize", otp)

            app = _app_with_protected_endpoint(_engine, user)
            client = TestClient(app)

            # First call: succeeds, token consumed
            r1 = client.post("/protected", headers={"X-Step-Up-Token": token})
            assert r1.status_code == 200, r1.json()

            # Second call with the same token: rejected (single-use)
            r2 = client.post("/protected", headers={"X-Step-Up-Token": token})
            assert r2.status_code == 401
            assert "already been used" in r2.json()["detail"].lower()
        finally:
            _cleanup_user(db, user)

    def test_wrong_purpose_token_rejected(self, db: Session, _engine):
        """Token issued for one purpose can't be used for another."""
        user = _make_user(db)
        try:
            otp = issue_step_up_otp(db, user, "rule_supersede")
            token, _ = consume_otp_and_issue_token(db, user, "rule_supersede", otp)

            # Mounted endpoint requires 'payroll_finalize' — token shouldn't work
            app = _app_with_protected_endpoint(_engine, user)
            client = TestClient(app)
            resp = client.post("/protected", headers={"X-Step-Up-Token": token})
            assert resp.status_code == 401
            assert "rule_supersede" in resp.json()["detail"]
            assert "payroll_finalize" in resp.json()["detail"]
        finally:
            _cleanup_user(db, user)

    def test_expired_token_rejected(self, db: Session, _engine):
        user = _make_user(db)
        try:
            otp = issue_step_up_otp(db, user, "payroll_finalize")
            token, _ = consume_otp_and_issue_token(db, user, "payroll_finalize", otp)

            # Force expiry
            db.execute(
                sql_text(
                    "UPDATE step_up_tokens SET expires_at = :exp WHERE token = :t"
                ),
                {"exp": datetime.now(timezone.utc) - timedelta(minutes=1), "t": token},
            )
            db.commit()

            app = _app_with_protected_endpoint(_engine, user)
            client = TestClient(app)
            resp = client.post("/protected", headers={"X-Step-Up-Token": token})
            assert resp.status_code == 401
            assert "expired" in resp.json()["detail"].lower()
        finally:
            _cleanup_user(db, user)

    def test_token_for_other_user_rejected(self, db: Session, _engine):
        """A token issued to user A can't be used by user B."""
        user_a = _make_user(db)
        user_b = _make_user(db)
        try:
            otp = issue_step_up_otp(db, user_a, "payroll_finalize")
            token, _ = consume_otp_and_issue_token(
                db, user_a, "payroll_finalize", otp
            )

            # App mounts user B as the current_user
            app = _app_with_protected_endpoint(_engine, user_b)
            client = TestClient(app)
            resp = client.post("/protected", headers={"X-Step-Up-Token": token})
            assert resp.status_code == 401
            assert "not recognized" in resp.json()["detail"].lower()
        finally:
            _cleanup_user(db, user_a)
            _cleanup_user(db, user_b)


class TestRequirePurposeFactory:
    def test_unknown_purpose_raises_at_setup_time(self):
        with pytest.raises(ValueError):
            require_step_up_token("not_a_real_purpose")
