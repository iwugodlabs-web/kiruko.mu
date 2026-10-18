"""Company-currency defaulting on sales + outlet editing (geofence fix-ups)."""

from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import text

from core.model import Company, Outlet, PrivateUser, User
from db_models.crud import field_sales as crud
from schema.field_sales_schema import (
    OutletCreate,
    OutletUpdate,
    ProductCreate,
    SaleCreate,
    SaleLineCreate,
)

SOLD_AT = datetime(2026, 5, 10, 9, 0, tzinfo=timezone.utc)


def _company(db, *, suffix: str, country_code: str = "MU"):
    import uuid

    sfx = f"{suffix}-{uuid.uuid4().hex[:6]}"
    owner = User(
        user_type="company", email=f"oc-owner-{sfx}@kontokazdemo.com",
        user_name=f"oc-owner-{sfx}", password_hash="x",
    )
    db.add(owner)
    db.flush()
    company = Company(
        user_id=owner.user_id, company_name=f"OC Co. {sfx}",
        email=f"oc-co-{sfx}@kontokazdemo.com", brn=f"OC_{sfx}", country_code=country_code,
    )
    db.add(company)
    db.flush()
    rep_user = User(user_type="private", email=f"oc-rep-{sfx}@kontokazdemo.com",
                    user_name=f"oc-rep-{sfx}", password_hash="x")
    db.add(rep_user)
    db.flush()
    rep = PrivateUser(
        user_id=rep_user.user_id, first_name="O", last_name="C",
        company_id=company.company_id, pass_port_number=f"OC_{sfx}", role="employee",
    )
    db.add(rep)
    db.flush()
    db.commit()
    return company, owner, rep


def _cleanup(db):
    db.rollback()
    for stmt in [
        "DELETE FROM sale_lines",
        "DELETE FROM sales",
        "DELETE FROM product_variants",
        "DELETE FROM products",
        "DELETE FROM outlets",
    ]:
        db.execute(text(stmt))
    db.commit()


def test_sale_currency_defaults_to_company_country(db):
    try:
        company, owner, rep = _company(db, suffix="tz", country_code="TZ")
        product = crud.create_product(db, company.company_id, ProductCreate(name="Bottle"))
        sale = crud.create_sale(
            db, company.company_id,
            SaleCreate(
                rep_private_user_id=rep.private_user_id,
                sold_at=SOLD_AT,
                lines=[SaleLineCreate(variant_id=product.variants[0].id, quantity=Decimal("1"))],
            ),
            owner.user_id,
        )
        assert sale.currency == "TZS"
    finally:
        _cleanup(db)


def test_explicit_currency_wins(db):
    try:
        company, owner, rep = _company(db, suffix="ex", country_code="MU")
        product = crud.create_product(db, company.company_id, ProductCreate(name="Bottle"))
        sale = crud.create_sale(
            db, company.company_id,
            SaleCreate(
                rep_private_user_id=rep.private_user_id,
                sold_at=SOLD_AT,
                currency="USD",
                lines=[SaleLineCreate(variant_id=product.variants[0].id, quantity=Decimal("1"))],
            ),
            owner.user_id,
        )
        assert sale.currency == "USD"
    finally:
        _cleanup(db)


def test_update_outlet_geofence(db):
    try:
        company, _owner, rep = _company(db, suffix="out")
        outlet = crud.create_outlet(db, company.company_id, OutletCreate(name="Shop"))
        updated = crud.update_outlet(
            db, company.company_id, outlet.id,
            OutletUpdate(latitude=-20.16, longitude=57.50, radius_meters=250, address="Royal Rd"),
        )
        assert updated.latitude == -20.16
        assert updated.longitude == 57.50
        assert updated.radius_meters == 250
        assert updated.address == "Royal Rd"
        # persisted, not just in-memory
        fresh = db.get(Outlet, outlet.id)
        db.refresh(fresh)
        assert float(fresh.latitude) == -20.16
    finally:
        _cleanup(db)
