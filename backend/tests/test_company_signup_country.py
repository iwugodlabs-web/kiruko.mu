"""Company signup country_code handling.

Covers the fix in db_models/crud/user.py::register_user() — self-signup
(POST /user/company-sign-up) previously never set country_code/timezone at
all, silently defaulting every company to MU regardless of where the
signup actually happened. This tests: a TZ signup sets country + timezone
correctly, an omitted country_code still defaults to MU (backward
compatibility for older app builds that don't send it yet), and an
unknown/inactive country_code is rejected with 400 rather than silently
accepted or crashing.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from core.model import Company, User


def _unique_email(tag: str) -> str:
    return f"signup-{tag}-{uuid.uuid4().hex[:8]}@signuptest.dev"


def _unique_brn(tag: str) -> str:
    return f"{tag.upper()}{uuid.uuid4().hex[:8].upper()}"


def _signup_payload(email: str, brn: str, country_code: str | None) -> dict:
    company_data = {
        "company_name": "Signup Test Co",
        "brn": brn,
        "email": email,
        "phone": "+23057123456",
        "address": "1 Test Street",
    }
    if country_code is not None:
        company_data["country_code"] = country_code
    return {
        "user_type": "company",
        "first_name": "Test",
        "last_name": "Owner",
        "email": email,
        "phone": "+23057123456",
        "password_hash": "TestPassword123!",
        "company_data": company_data,
    }


@pytest.fixture()
def client() -> TestClient:
    from main import app
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def _clean_signup_state(db: Session):
    """Wipe test signup data before and after each test — this suite has no
    per-test transactional rollback (register_user commits directly)."""
    def _wipe():
        db.rollback()
        db.execute(sql_text(
            "DELETE FROM private_users WHERE user_id IN "
            "(SELECT user_id FROM users WHERE email LIKE 'signup-%@signuptest.dev')"
        ))
        db.execute(sql_text(
            "DELETE FROM companies WHERE user_id IN "
            "(SELECT user_id FROM users WHERE email LIKE 'signup-%@signuptest.dev')"
        ))
        db.execute(sql_text(
            "DELETE FROM users WHERE email LIKE 'signup-%@signuptest.dev'"
        ))
        db.commit()
    _wipe()
    yield
    _wipe()


def test_signup_with_tz_sets_country_and_timezone(client: TestClient, db: Session):
    email = _unique_email("tz")
    resp = client.post(
        "/api/v1/user/company-sign-up",
        json=_signup_payload(email, _unique_brn("tz"), "TZ"),
    )
    assert resp.status_code == 200, resp.text

    db.expire_all()
    company = (
        db.query(Company)
        .join(User, Company.user_id == User.user_id)
        .filter(User.email == email)
        .first()
    )
    assert company is not None
    assert company.country_code == "TZ"
    assert company.timezone == "Africa/Dar_es_Salaam"


def test_signup_without_country_code_defaults_to_mu(client: TestClient, db: Session):
    email = _unique_email("nocc")
    resp = client.post(
        "/api/v1/user/company-sign-up",
        json=_signup_payload(email, _unique_brn("nocc"), None),
    )
    assert resp.status_code == 200, resp.text

    db.expire_all()
    company = (
        db.query(Company)
        .join(User, Company.user_id == User.user_id)
        .filter(User.email == email)
        .first()
    )
    assert company is not None
    assert company.country_code == "MU"


def test_signup_with_unknown_country_code_rejected(client: TestClient, db: Session):
    email = _unique_email("badcc")
    resp = client.post(
        "/api/v1/user/company-sign-up",
        json=_signup_payload(email, _unique_brn("badcc"), "ZZ"),
    )
    assert resp.status_code == 400, resp.text

    db.expire_all()
    # The User insert must be rolled back too, not left orphaned.
    leftover_user = db.query(User).filter(User.email == email).first()
    assert leftover_user is None
