"""Product (catalog) bulk import — parse → validate → commit.

Drives the service layer directly (the HTTP layer is a thin wrapper). Uses a
throwaway company and cleans up the field-sales catalog tables afterwards.
"""

import uuid

import pytest
from sqlalchemy import text

from core.model import Company, Product, ProductCategory, ProductVariant, User
from services import product_import_service as imp


@pytest.fixture()
def imp_company(db):
    sfx = uuid.uuid4().hex[:8]
    owner = User(
        user_type="company", email=f"imp-owner-{sfx}@kontokazdemo.com",
        user_name=f"imp-owner-{sfx}", password_hash="x",
    )
    db.add(owner)
    db.flush()
    company = Company(
        user_id=owner.user_id, company_name=f"Import Co. {sfx}",
        email=f"imp-co-{sfx}@kontokazdemo.com", brn=f"IMP_BRN_{sfx}", country_code="MU",
    )
    db.add(company)
    db.flush()
    yield company
    db.rollback()
    cid = company.company_id
    db.execute(text("DELETE FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE company_id=:c)"), {"c": cid})
    db.execute(text("DELETE FROM products WHERE company_id=:c"), {"c": cid})
    db.execute(text("DELETE FROM product_categories WHERE company_id=:c"), {"c": cid})
    db.execute(text("DELETE FROM companies WHERE company_id=:c"), {"c": cid})
    db.execute(text("DELETE FROM users WHERE user_id=:u"), {"u": owner.user_id})
    db.commit()


_HEADER = "name,category,sku,price,currency,barcode,brand"


def _csv(*lines: str) -> bytes:
    return ("\n".join([_HEADER, *lines]) + "\n").encode()


def test_template_has_required_columns():
    out = imp.template_csv()
    assert out.splitlines()[0].split(",") == imp.TEMPLATE_COLUMNS
    assert "name" in out.splitlines()[0]


def test_validate_flags_bad_price_and_missing_name(db, imp_company):
    rows = imp.parse(_csv("Good,Beva,GP-1,10.00,MUR,,", ",Beva,BAD-1,9.00,MUR,,"), "p.csv")
    res = imp.validate(db, imp_company.company_id, rows)
    assert res["total"] == 2
    fields = {(e["row"], e["field"]) for e in res["errors"]}
    assert (3, "name") in fields

    rows2 = imp.parse(_csv("Bad,Beva,BAD-2,notanumber,MUR,,"), "p.csv")
    res2 = imp.validate(db, imp_company.company_id, rows2)
    assert any(e["field"] == "price" for e in res2["errors"])


def test_commit_groups_rows_into_one_product(db, imp_company):
    cid = imp_company.company_id
    rows = imp.parse(_csv(
        "Cola,Beverages,COLA-330,22.00,MUR,,Cola",
        "Cola,Beverages,COLA-1500,42.50,MUR,,Cola",
    ), "p.csv")
    summary = imp.commit(db, cid, rows)
    db.commit()

    assert summary["created_products"] == 1
    assert summary["created_variants"] == 2

    product = db.query(Product).filter(Product.company_id == cid, Product.name == "Cola").one()
    variants = db.query(ProductVariant).filter(ProductVariant.product_id == product.id).all()
    assert len(variants) == 2
    assert sum(1 for v in variants if v.is_default) == 1
    # category auto-created
    assert db.query(ProductCategory).filter(ProductCategory.company_id == cid, ProductCategory.name == "Beverages").count() == 1


def test_commit_skips_invalid_rows(db, imp_company):
    cid = imp_company.company_id
    rows = imp.parse(_csv("Good,Beva,GP-1,10.00,MUR,,", "Bad,Beva,BAD-1,oops,MUR,,"), "p.csv")
    summary = imp.commit(db, cid, rows)
    db.commit()
    assert summary["created_products"] == 1
    assert db.query(Product).filter(Product.company_id == cid, Product.name == "Bad").count() == 0
    assert any(f["field"] == "price" for f in summary["failed"])


def test_commit_is_idempotent(db, imp_company):
    cid = imp_company.company_id
    rows = imp.parse(_csv("Cola,Beverages,COLA-330,22.00,MUR,,Cola"), "p.csv")
    imp.commit(db, cid, rows)
    db.commit()
    again = imp.commit(db, cid, rows)
    db.commit()
    assert again["created_products"] == 0
    assert again["created_variants"] == 0
    assert again["skipped"] == 1


def test_existing_product_gains_new_variant(db, imp_company):
    cid = imp_company.company_id
    imp.commit(db, cid, imp.parse(_csv("Cola,Beverages,COLA-330,22.00,MUR,,Cola"), "p.csv"))
    db.commit()
    summary = imp.commit(db, cid, imp.parse(_csv("Cola,Beverages,COLA-1500,42.50,MUR,,Cola"), "p.csv"))
    db.commit()
    assert summary["created_products"] == 0
    assert summary["created_variants"] == 1
    product = db.query(Product).filter(Product.company_id == cid, Product.name == "Cola").one()
    assert db.query(ProductVariant).filter(ProductVariant.product_id == product.id).count() == 2
