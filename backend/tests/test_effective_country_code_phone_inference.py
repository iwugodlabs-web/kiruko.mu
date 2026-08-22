"""PrivateUser.effective_country_code — phone-based inference for
independent users (no company, no explicit country_code).

There's no signup/settings UI to set PrivateUser.country_code directly yet
(core/model.py:113-118), so an independent user's country was previously
always the hardcoded 'MU' fallback. This adds a phone-calling-code
inference step before that fallback, reusing core/phone_utils.py's
MU_COUNTRY_CODE/TZ_COUNTRY_CODE (already used by login/signup/OTP).

Only affects admin-side display/filtering (compliance dispute lists, the
platform All Users table) — the payroll engine is entirely
Company.country_code-scoped and never consults this property.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy.orm import Session

from core.model import PrivateUser, User


def _make_independent_user(db: Session, phone: str | None, country_code: str | None = None) -> PrivateUser:
    s = uuid.uuid4().hex[:8]
    u = User(user_type="private", email=f"effcc-{s}@kontokaz.test", user_name=f"effcc-{s}", password_hash="x")
    db.add(u)
    db.flush()
    pu = PrivateUser(
        user_id=u.user_id,
        first_name="Test",
        last_name="Independent",
        company_id=None,
        phone=phone,
        country_code=country_code,
        pass_port_number=f"EFFCC_{s}",
        role="employee",
    )
    db.add(pu)
    db.commit()
    return pu


@pytest.fixture(autouse=True)
def _cleanup(db: Session):
    yield
    db.rollback()
    from sqlalchemy import text
    db.execute(text("DELETE FROM private_users WHERE pass_port_number LIKE 'EFFCC_%'"))
    db.execute(text("DELETE FROM users WHERE email LIKE 'effcc-%@kontokaz.test'"))
    db.commit()


def test_infers_tz_from_phone_calling_code(db: Session):
    pu = _make_independent_user(db, phone="+255712345678")
    assert pu.effective_country_code == "TZ"


def test_infers_mu_from_phone_calling_code(db: Session):
    pu = _make_independent_user(db, phone="+23057123456")
    assert pu.effective_country_code == "MU"


def test_infers_from_bare_local_number_via_normalize_phone(db: Session):
    # No explicit country code in the phone string at all — normalize_phone
    # infers MU from the bare local-part length (7-8 digits), which this
    # property then reuses rather than falling straight to 'MU' blindly.
    pu = _make_independent_user(db, phone="57123456")
    assert pu.effective_country_code == "MU"


def test_explicit_country_code_wins_over_phone_inference(db: Session):
    pu = _make_independent_user(db, phone="+23057123456", country_code="TZ")
    assert pu.effective_country_code == "TZ"


def test_falls_back_to_mu_when_no_phone_and_no_country_code(db: Session):
    pu = _make_independent_user(db, phone=None)
    assert pu.effective_country_code == "MU"


def test_falls_back_to_mu_for_unrecognized_phone(db: Session):
    pu = _make_independent_user(db, phone="+33123456789")  # French number, not MU/TZ
    assert pu.effective_country_code == "MU"
