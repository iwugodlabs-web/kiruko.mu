"""Catalog editing + deletion (categories, products, variants, outlets, UOMs).

Locks in the two rules that matter for correctness:
  * renaming/deleting a category keeps products' free-text `category` tag in step;
  * a product/variant referenced by a sale line can never be hard-deleted
    (409) — sale history must stay reproducible.
"""

from datetime import datetime, timezone
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from core.model import (
    Company,
    Outlet,
    PrivateUser,
    Product,
    ProductCategory,
    ProductVariant,
    Sale,
    UnitOfMeasure,
    User,
)
from db_models.crud import field_sales as crud
from schema.field_sales_schema import (
    OutletCreate,
    ProductCategoryCreate,
    ProductCategoryUpdate,
    ProductCreate,
    SaleCreate,
    SaleLineCreate,
    UnitOfMeasureCreate,
    VariantCreate,
    VariantUpdate,
)

SOLD_AT = datetime(2026, 5, 10, 9, 0, tzinfo=timezone.utc)


@pytest.fixture()
def catalog(db):
    import uuid

    sfx = uuid.uuid4().hex[:8]
    owner = User(
        user_type="company", email=f"cat-owner-{sfx}@kontokazdemo.com",
        user_name=f"cat-owner-{sfx}", password_hash="x",
    )
    db.add(owner)
    db.flush()
    company = Company(
        user_id=owner.user_id, company_name=f"Catalog Co. {sfx}",
        email=f"cat-co-{sfx}@kontokazdemo.com", brn=f"CAT_{sfx}", country_code="MU",
    )
    db.add(company)
    db.flush()

    rep_user = User(user_type="private", email=f"cat-rep-{sfx}@kontokazdemo.com",
                    user_name=f"cat-rep-{sfx}", password_hash="x")
    db.add(rep_user)
    db.flush()
    rep = PrivateUser(
        user_id=rep_user.user_id, first_name="Cat", last_name="Rep",
        company_id=company.company_id, pass_port_number=f"CAT_{sfx}", role="employee",
    )
    db.add(rep)
    db.flush()
    db.commit()

    cid = company.company_id
    product = crud.create_product(
        db, cid, ProductCreate(name="Cola", category="Drinks",
                               default_variant=None)
    )
    other = crud.create_product(db, cid, ProductCreate(name="Water", category="Drinks"))
    category = crud.create_category(db, cid, ProductCategoryCreate(name="Drinks"))
    outlet = crud.create_outlet(db, cid, OutletCreate(name="Shop One"))
    uom = crud.create_uom(db, cid, UnitOfMeasureCreate(code="CASE", name="Case", factor=Decimal("24")))

    yield {
        "company_id": cid, "owner": owner, "rep": rep,
        "product": product, "other": other, "category": category,
        "outlet": outlet, "uom": uom,
    }

    db.rollback()
    for stmt in [
        "DELETE FROM product_variant_option_values",
        "DELETE FROM option_values",
        "DELETE FROM product_options",
        "DELETE FROM product_prices",
        "DELETE FROM sale_lines",
        "DELETE FROM sales",
        "DELETE FROM product_variants",
        "DELETE FROM products",
        "DELETE FROM product_categories",
        "DELETE FROM outlets",
        "DELETE FROM units_of_measure",
    ]:
        db.execute(text(stmt))
    db.commit()


def test_update_category_renames_and_retags_products(db, catalog):
    cid, cat = catalog["company_id"], catalog["category"]
    updated = crud.update_category(
        db, cid, cat.id, ProductCategoryUpdate(name="Beverages")
    )
    assert updated.name == "Beverages"
    tags = {
        p.category
        for p in db.query(Product).filter(Product.company_id == cid).all()
    }
    assert tags == {"Beverages"}


def test_update_category_rejects_duplicate(db, catalog):
    cid = catalog["company_id"]
    db.add(ProductCategory(company_id=cid, name="Snacks"))
    db.commit()
    with pytest.raises(HTTPException) as exc:
        crud.update_category(db, cid, catalog["category"].id, ProductCategoryUpdate(name="Snacks"))
    assert exc.value.status_code == 409


def test_update_category_rejects_self_parent(db, catalog):
    with pytest.raises(HTTPException) as exc:
        crud.update_category(
            db, catalog["company_id"], catalog["category"].id,
            ProductCategoryUpdate(parent_id=catalog["category"].id),
        )
    assert exc.value.status_code == 400


def test_delete_category_retags_products_and_promotes_children(db, catalog):
    cid, cat = catalog["company_id"], catalog["category"]
    child = crud.create_category(db, cid, ProductCategoryCreate(name="Soda", parent_id=cat.id))

    result = crud.delete_category(db, cid, cat.id, reassign_products_to="Misc")
    assert result["products_retagged"] == 2
    assert db.get(ProductCategory, child.id).parent_id is None  # promoted to root
    assert {p.category for p in db.query(Product).filter(Product.company_id == cid)} == {"Misc"}
    assert db.query(ProductCategory).filter(ProductCategory.name == "Drinks").count() == 0


def test_delete_category_clears_tag_when_no_reassign(db, catalog):
    cid, cat = catalog["company_id"], catalog["category"]
    crud.delete_category(db, cid, cat.id, reassign_products_to=None)
    assert {p.category for p in db.query(Product).filter(Product.company_id == cid)} == {None}


def test_product_archive_hides_from_default_listing(db, catalog):
    cid, product = catalog["company_id"], catalog["product"]
    crud.set_product_archived(db, cid, product.id, True)
    assert db.get(Product, product.id).archived_at is not None
    names_default = {p.name for p in crud.list_products(db, cid)}
    names_all = {p.name for p in crud.list_products(db, cid, include_archived=True)}
    assert "Cola" not in names_default
    assert "Cola" in names_all

    crud.set_product_archived(db, cid, product.id, False)
    assert db.get(Product, product.id).archived_at is None


def test_delete_product_without_sales_removes_variants(db, catalog):
    cid, product = catalog["company_id"], catalog["product"]
    variant_ids = [v.id for v in product.variants]
    crud.delete_product(db, cid, product.id)
    assert db.query(Product).filter(Product.id == product.id).count() == 0
    assert db.query(ProductVariant).filter(ProductVariant.id.in_(variant_ids)).count() == 0


def test_delete_product_blocked_when_sold(db, catalog):
    cid, product, rep = catalog["company_id"], catalog["product"], catalog["rep"]
    variant = product.variants[0]
    crud.create_sale(
        db, cid,
        SaleCreate(
            rep_private_user_id=rep.private_user_id, sold_at=SOLD_AT,
            lines=[SaleLineCreate(variant_id=variant.id, quantity=Decimal("1"))],
        ),
        catalog["owner"].user_id,
    )
    with pytest.raises(HTTPException) as exc:
        crud.delete_product(db, cid, product.id)
    assert exc.value.status_code == 409
    assert db.query(Product).filter(Product.id == product.id).count() == 1


def test_update_variant_price_and_sku(db, catalog):
    cid, product = catalog["company_id"], catalog["product"]
    variant = product.variants[0]
    updated = crud.update_variant(
        db, cid, variant.id,
        VariantUpdate(unit_price=Decimal("125.50"), sku="COLA-500"),
    )
    assert updated.unit_price == Decimal("125.50")
    assert updated.sku == "COLA-500"


def test_update_variant_duplicate_sku_rejected(db, catalog):
    cid, product = catalog["company_id"], catalog["product"]
    first = product.variants[0]
    second = crud.create_variant(db, cid, product.id, VariantCreate(sku="COLA-2", unit_price=Decimal("5")))
    with pytest.raises(HTTPException) as exc:
        crud.update_variant(db, cid, second.id, VariantUpdate(sku=first.sku))
    assert exc.value.status_code == 409


def test_update_variant_set_default_unsets_siblings(db, catalog):
    cid, product = catalog["company_id"], catalog["product"]
    first = product.variants[0]
    second = crud.create_variant(db, cid, product.id, VariantCreate(sku="COLA-2", unit_price=Decimal("5")))
    crud.update_variant(db, cid, second.id, VariantUpdate(is_default=True))
    assert db.get(ProductVariant, second.id).is_default is True
    assert db.get(ProductVariant, first.id).is_default is False


def test_delete_variant_blocked_when_last(db, catalog):
    cid, product = catalog["company_id"], catalog["product"]
    variant = product.variants[0]
    with pytest.raises(HTTPException) as exc:
        crud.delete_variant(db, cid, variant.id)
    assert exc.value.status_code == 409


def test_delete_variant_succeeds_when_spare(db, catalog):
    cid, product = catalog["company_id"], catalog["product"]
    first = product.variants[0]
    second = crud.create_variant(db, cid, product.id, VariantCreate(sku="COLA-2", unit_price=Decimal("5")))
    crud.delete_variant(db, cid, second.id)
    assert db.get(ProductVariant, second.id) is None
    assert db.get(ProductVariant, first.id) is not None


def test_delete_outlet_nulls_sale_link(db, catalog):
    cid, outlet, product, rep = (
        catalog["company_id"], catalog["outlet"], catalog["product"], catalog["rep"]
    )
    variant = product.variants[0]
    sale = crud.create_sale(
        db, cid,
        SaleCreate(
            rep_private_user_id=rep.private_user_id, sold_at=SOLD_AT, outlet_id=outlet.id,
            lines=[SaleLineCreate(variant_id=variant.id, quantity=Decimal("1"))],
        ),
        catalog["owner"].user_id,
    )
    crud.delete_outlet(db, cid, outlet.id)
    assert db.get(Outlet, outlet.id) is None
    assert db.get(Sale, sale.id).outlet_id is None


def test_delete_uom_nulls_variant_sell_uom(db, catalog):
    cid, product, uom = catalog["company_id"], catalog["product"], catalog["uom"]
    variant = product.variants[0]
    crud.update_variant(db, cid, variant.id, VariantUpdate(sell_uom_id=uom.id))
    assert db.get(ProductVariant, variant.id).sell_uom_id == uom.id
    crud.delete_uom(db, cid, uom.id)
    db.expire_all()
    assert db.get(UnitOfMeasure, uom.id) is None
    assert db.get(ProductVariant, variant.id).sell_uom_id is None
