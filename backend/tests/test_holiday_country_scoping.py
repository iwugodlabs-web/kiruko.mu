"""Holiday country scoping — company_holiday_rates must never mix countries.

Covers the two guarantees added with the country_code column:
  * import is replace-on-import: it wipes the company's rows for the imported
    YEAR (including legacy/other-country rows) before inserting, and tags the
    new rows with the company's country — so a previously-mixed year is cleaned.
  * list is filtered to the company's country (plus legacy NULL rows), so an
    other-country calendar never shows.
"""
from __future__ import annotations

import asyncio
import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy.orm import Session

from core.model import Company, User, CompanyHolidayRate
from api.v1.company import (
    HolidayRateCreate,
    HolidayRateImport,
    import_company_holiday_rates,
    list_company_holiday_rates,
)


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture()
def tz_company(db: Session):
    # Unique per test — cleanup can be blocked by audit-log FKs, so we must not
    # rely on the previous test's row being gone.
    suffix = uuid.uuid4().hex[:8]
    owner = User(
        user_type="company",
        email=f"hol-scope-{suffix}@kontokaz.test",
        user_name=f"hol-scope-{suffix}",
        password_hash="x",
    )
    db.add(owner)
    db.flush()
    company = Company(
        user_id=owner.user_id,
        company_name="TZ Holiday Co.",
        email=f"tz-hol-{suffix}@kontokaz.test",
        brn=f"TZ_HOL_{suffix}",
        country_code="TZ",
    )
    db.add(company)
    db.commit()
    yield company
    # Best-effort cleanup — teardown failure must not mask the assertion result.
    try:
        db.query(CompanyHolidayRate).filter(
            CompanyHolidayRate.company_id == company.company_id
        ).delete(synchronize_session=False)
        db.delete(company)
        db.delete(owner)
        db.commit()
    except Exception:
        db.rollback()


class TestHolidayCountryScoping:
    def test_import_replaces_mixed_year_and_tags_country(self, db: Session, tz_company):
        cid = tz_company.company_id
        # Pre-existing MIXED 2026 rows (the real-world contamination) + a 2025 row.
        db.add_all([
            CompanyHolidayRate(company_id=cid, country_code="MU", name="Abolition of Slavery", date="2026-02-01", recurrent=True, multiplier=3.0),
            CompanyHolidayRate(company_id=cid, country_code=None, name="Legacy 2026", date="2026-06-01", recurrent=False, multiplier=3.0),
            CompanyHolidayRate(company_id=cid, country_code="TZ", name="Stale TZ 2026", date="2026-01-05", recurrent=True, multiplier=3.0),
            CompanyHolidayRate(company_id=cid, country_code="MU", name="Old MU 2025", date="2025-12-25", recurrent=True, multiplier=3.0),
        ])
        db.commit()

        payload = HolidayRateImport(year=2026, holidays=[
            HolidayRateCreate(name="Union Day", date="2026-04-26", recurrent=True, multiplier=3.0),
            HolidayRateCreate(name="Saba Saba", date="2026-07-07", recurrent=True, multiplier=3.0),
        ])
        user = SimpleNamespace(is_superuser=True, user_id=tz_company.user_id)
        result = _run(import_company_holiday_rates(cid, payload, db, user))

        # The whole 2026 set is replaced by the imported TZ holidays, tagged TZ.
        assert len(result) == 2
        assert {r["name"] for r in result} == {"Union Day", "Saba Saba"}
        assert all(r["country_code"] == "TZ" for r in result)

        rows_2026 = db.query(CompanyHolidayRate).filter(
            CompanyHolidayRate.company_id == cid,
            CompanyHolidayRate.date.like("2026-%"),
        ).all()
        assert {r.name for r in rows_2026} == {"Union Day", "Saba Saba"}  # MU/legacy/stale gone
        assert all(r.country_code == "TZ" for r in rows_2026)

        # A different year is untouched.
        assert db.query(CompanyHolidayRate).filter(
            CompanyHolidayRate.company_id == cid,
            CompanyHolidayRate.date.like("2025-%"),
        ).count() == 1

    def test_list_filters_to_company_country_plus_legacy_null(self, db: Session, tz_company):
        cid = tz_company.company_id
        db.add_all([
            CompanyHolidayRate(company_id=cid, country_code="TZ", name="TZ One", date="2026-04-26", recurrent=True, multiplier=3.0),
            CompanyHolidayRate(company_id=cid, country_code="MU", name="MU One", date="2026-02-01", recurrent=True, multiplier=3.0),
            CompanyHolidayRate(company_id=cid, country_code=None, name="Legacy One", date="2026-06-01", recurrent=False, multiplier=3.0),
        ])
        db.commit()
        user = SimpleNamespace(is_superuser=True, user_id=tz_company.user_id)
        result = _run(list_company_holiday_rates(cid, db, user))
        names = {r["name"] for r in result}
        assert "TZ One" in names        # company country → shown
        assert "Legacy One" in names    # legacy NULL → shown (nothing disappears)
        assert "MU One" not in names    # other country → hidden
