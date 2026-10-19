"""Step B1: effective-dated pricing.

A sale line snapshots the price resolved for the variant effective on the sale
date (`ProductPrice`, optionally per-territory), falling back to the variant's
inline `unit_price` when no price row applies. Purely additive — with no
`ProductPrice` rows behaviour is unchanged. Snapshots freeze, so adding a price
never rewrites an existing sale line.

Drives the CRUD layer directly, mirroring test_field_sales_phase2.
"""

from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import text

from core.model import Company, PrivateUser, User
from db_models.crud import field_sales as crud
from schema.field_sales_schema import (
    ProductCreate,
    ProductPriceCreate,
    ProductVariantCreate,
    SaleCreate,
    SaleLineCreate,
)


SOLD_AT = datetime(2026, 5, 10, 9, 0, tzinfo=timezone.utc)
LATER_SOLD_AT = datetime(2026, 5, 20, 9, 0, tzinfo=timezone.utc)


@pytest.fixture()
def price_company(db):
    import uuid

    sfx = uuid.uuid4().hex[:8]
    owner = User(
        user_type="company", email=f"px-owner-{sfx}@kontokazdemo.com",
        user_name=f"px-owner-{sfx}", password_hash="x",
    )
    db.add(owner)
    db.flush()
    company = Company(
        user_id=owner.user_id, company_name=f"Pricing Co. {sfx}",
        email=f"px-co-{sfx}@kontokazdemo.com", brn=f"PX_BRN_{sfx}", country_code="MU",
    )
    db.add(company)
    db.flush()
    u = User(user_type="private", email=f"px-rep-{sfx}@kontokazdemo.com",
             user_name=f"px-rep-{sfx}", password_hash="x")
    db.add(u)
    db.flush()
    rep = PrivateUser(
        user_id=u.user_id, first_name="Pia", last_name="Rep",
        company_id=company.company_id, pass_port_number=f"PX_REP_{sfx}", role="employee",
    )
    db.add(rep)
    db.flush()
    yield company, rep

    db.rollback()
    for stmt in [
        "DELETE FROM product_prices",
        "DELETE FROM sale_lines",
        "DELETE FROM sales",
        "DELETE FROM product_variant_option_values",
        "DELETE FROM product_variants",
        "DELETE FROM product_categories",
        "DELETE FROM products",
    ]:
        db.execute(text(stmt))
    db.commit()


def _product(db, company, *, unit_price="100.00", sku="PX-SKU"):
    product = crud.create_product(
        db, company.company_id,
        ProductCreate(
            name=f"Product {sku}", category="Beverages",
            default_variant=ProductVariantCreate(sku=sku, unit_price=Decimal(unit_price)),
        ),
    )
    return product.variants[0]


def _sale(db, company, rep, variant_id, *, sold_at=SOLD_AT, **line_kwargs):
    return crud.create_sale(
        db, company.company_id,
        SaleCreate(
            rep_private_user_id=rep.private_user_id,
            sold_at=sold_at,
            lines=[SaleLineCreate(variant_id=variant_id, quantity=Decimal("10"), **line_kwargs)],
        ),
        created_by_user_id=None,
    )


def test_no_price_row_falls_back_to_variant_unit_price(db, price_company):
    company, rep = price_company
    variant = _product(db, company, unit_price="100.00")
    sale = _sale(db, company, rep, variant.id)
    assert Decimal(sale.lines[0].unit_price_snapshot) == Decimal("100.00")


def test_effective_price_by_date_overrides_unit_price(db, price_company):
    company, rep = price_company
    variant = _product(db, company, unit_price="100.00")
    crud.create_price(db, company.company_id, ProductPriceCreate(
        variant_id=variant.id, amount=Decimal("80.00"), effective_from=date(2026, 5, 1),
    ))
    sale = _sale(db, company, rep, variant.id)
    assert Decimal(sale.lines[0].unit_price_snapshot) == Decimal("80.00")
    assert Decimal(sale.lines[0].line_total) == Decimal("800.00")  # 10 × 80


def test_price_outside_its_window_does_not_apply(db, price_company):
    company, rep = price_company
    variant = _product(db, company, unit_price="100.00")
    crud.create_price(db, company.company_id, ProductPriceCreate(
        variant_id=variant.id, amount=Decimal("80.00"),
        effective_from=date(2026, 6, 1), effective_to=date(2026, 6, 30),
    ))
    sale = _sale(db, company, rep, variant.id)  # sold 2026-05-10
    assert Decimal(sale.lines[0].unit_price_snapshot) == Decimal("100.00")


def test_explicit_line_price_wins_over_resolved(db, price_company):
    company, rep = price_company
    variant = _product(db, company, unit_price="100.00")
    crud.create_price(db, company.company_id, ProductPriceCreate(
        variant_id=variant.id, amount=Decimal("80.00"), effective_from=date(2026, 5, 1),
    ))
    sale = _sale(db, company, rep, variant.id, unit_price=Decimal("70.00"))
    assert Decimal(sale.lines[0].unit_price_snapshot) == Decimal("70.00")


def test_newer_price_applies_to_new_sales_only(db, price_company):
    company, rep = price_company
    variant = _product(db, company, unit_price="100.00")
    crud.create_price(db, company.company_id, ProductPriceCreate(
        variant_id=variant.id, amount=Decimal("80.00"), effective_from=date(2026, 5, 1),
    ))
    first = _sale(db, company, rep, variant.id)

    crud.create_price(db, company.company_id, ProductPriceCreate(
        variant_id=variant.id, amount=Decimal("50.00"), effective_from=date(2026, 5, 15),
    ))
    second = _sale(db, company, rep, variant.id, sold_at=LATER_SOLD_AT)

    assert Decimal(second.lines[0].unit_price_snapshot) == Decimal("50.00")
    db.refresh(first.lines[0])
    assert Decimal(first.lines[0].unit_price_snapshot) == Decimal("80.00")  # frozen


def test_resolve_price_scopes_to_territory(db, price_company):
    company, _rep = price_company
    variant = _product(db, company, unit_price="100.00")
    crud.create_price(db, company.company_id, ProductPriceCreate(
        variant_id=variant.id, amount=Decimal("65.00"), territory="North",
        effective_from=date(2026, 5, 1),
    ))
    assert crud.resolve_price(
        db, company.company_id, variant.id, territory="North", on_date=date(2026, 5, 10)
    ) == Decimal("65.00")
    # A territory with no price row falls back to the variant's inline price.
    assert crud.resolve_price(
        db, company.company_id, variant.id, territory="South", on_date=date(2026, 5, 10)
    ) == Decimal("100.00")
