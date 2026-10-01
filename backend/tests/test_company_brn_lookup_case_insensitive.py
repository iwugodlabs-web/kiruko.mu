"""Signup company lookup by BRN must be case-insensitive.

BRNs are typed by hand during signup (mobile step 2) and stored in mixed case,
so "demo001" / "Demo001" / "DEMO001" (and stray whitespace) must all resolve to
the same company. Previously the lookup was an exact `==`, so a lowercased
entry failed to find the employer.
"""
import uuid

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from core.model import Company, User
from db_models.crud.company import get_company_by_brn


def _seed_company(db: Session, brn: str) -> Company:
    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    sfx = uuid.uuid4().hex[:8]
    owner = User(
        user_type="company",
        email=f"own-{sfx}@x.com",
        user_name=f"own-{sfx}",
        password_hash="x",
    )
    db.add(owner)
    db.flush()
    co = Company(
        user_id=owner.user_id,
        company_name=f"C {sfx}",
        email=f"co-{sfx}@x.com",
        brn=brn,
        country_code="MU",
    )
    db.add(co)
    db.flush()
    db.commit()
    return co


def test_brn_lookup_is_case_and_whitespace_insensitive(db: Session):
    co = _seed_company(db, "Demo001")
    assert get_company_by_brn("demo001", db).company_id == co.company_id
    assert get_company_by_brn("DEMO001", db).company_id == co.company_id
    assert get_company_by_brn("  Demo001  ", db).company_id == co.company_id


def test_brn_lookup_missing_returns_none(db: Session):
    assert get_company_by_brn("NOTHING999", db) is None
    assert get_company_by_brn("", db) is None
    assert get_company_by_brn(None, db) is None
