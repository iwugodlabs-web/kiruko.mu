"""Sale detail: line enrichment ("what was sold"), payment method/status editing,
and void/reopen. These lock in the read shape the web Sales tab and the mobile
rep hub now depend on, plus the guard rails around editing a voided sale.
"""

from datetime import datetime, timezone
from decimal import Decimal

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import text

from core.model import (
    Company,
    PrivateUser,
    Sale,
    User,
)
from db_models.crud import field_sales as crud
from schema.field_sales_schema import (
    OutletCreate,
    ProductCreate,
    SaleCreate,
    SaleLineCreate,
    SaleUpdate,
    SaleSyncItem,
    UnitOfMeasureCreate,
)

SOLD_AT = datetime(2026, 5, 10, 9, 0, tzinfo=timezone.utc)


@pytest.fixture()
def scene(db):
    import uuid

    sfx = uuid.uuid4().hex[:8]
    owner = User(
        user_type="company", email=f"sd-owner-{sfx}@kontokazdemo.com",
        user_name=f"sd-owner-{sfx}", password_hash="x",
    )
    db.add(owner)
    db.flush()
    company = Company(
        user_id=owner.user_id, company_name=f"Sale Co. {sfx}",
        email=f"sd-co-{sfx}@kontokazdemo.com", brn=f"SD_{sfx}", country_code="MU",
    )
    db.add(company)
    db.flush()

    rep_user = User(user_type="private", email=f"sd-rep-{sfx}@kontokazdemo.com",
                    user_name=f"sd-rep-{sfx}", password_hash="x")
    db.add(rep_user)
    db.flush()
    rep = PrivateUser(
        user_id=rep_user.user_id, first_name="Sam", last_name="Rep",
        company_id=company.company_id, pass_port_number=f"SD_{sfx}", role="employee",
    )
    db.add(rep)
    db.flush()

    cid = company.company_id
    product = crud.create_product(
        db, cid, ProductCreate(name="Cola 500ml", category="Drinks")
    )
    variant = product.variants[0]
    variant.unit_price = Decimal("22.00")
    uom = crud.create_uom(db, cid, UnitOfMeasureCreate(code="CRATE", name="Crate", factor=Decimal("12")))
    variant.sell_uom_id = uom.id
    outlet = crud.create_outlet(db, cid, OutletCreate(name="Shop One"))
    db.commit()

    sale = crud.create_sale(
        db, cid,
        SaleCreate(
            rep_private_user_id=rep.private_user_id,
            outlet_id=outlet.id,
            sold_at=SOLD_AT,
            payment_status="paid",
            payment_method="cash",
            lines=[SaleLineCreate(variant_id=variant.id, quantity=Decimal("2"))],
        ),
        owner.user_id,
    )

    yield {
        "company_id": cid, "owner": owner, "rep": rep, "product": product,
        "variant": variant, "uom": uom, "outlet": outlet, "sale": sale,
    }

    db.rollback()
    for stmt in [
        "DELETE FROM sale_lines",
        "DELETE FROM sales",
        "DELETE FROM product_variants",
        "DELETE FROM products",
        "DELETE FROM outlets",
        "DELETE FROM units_of_measure",
    ]:
        db.execute(text(stmt))
    db.commit()


def test_sale_read_enriches_lines_with_product_and_sku(db, scene):
    sale = crud.get_sale(db, scene["company_id"], scene["sale"].id)
    line = sale.lines[0]
    assert line.product_name == "Cola 500ml"
    assert line.variant_sku == scene["variant"].sku
    assert line.product_id == scene["product"].id
    assert line.uom == "CRATE"


def test_payment_method_recorded_on_create(db, scene):
    sale = crud.get_sale(db, scene["company_id"], scene["sale"].id)
    assert sale.payment_method == "cash"


def test_list_sales_includes_enriched_lines(db, scene):
    sales = crud.list_sales(db, scene["company_id"])
    assert sales
    assert sales[0].lines[0].product_name == "Cola 500ml"


def test_update_sale_edits_payment_and_backfills_collection(db, scene):
    cid, sale_id = scene["company_id"], scene["sale"].id
    updated = crud.update_sale(
        db, cid, sale_id,
        SaleUpdate(payment_status="pending", payment_method="mobile_money", notes="M-Pesa pending"),
    )
    assert updated.payment_status == "pending"
    assert updated.payment_method == "mobile_money"
    assert updated.notes == "M-Pesa pending"
    assert updated.collected_at is None

    paid = crud.update_sale(db, cid, sale_id, SaleUpdate(payment_status="paid"))
    assert paid.payment_status == "paid"
    # 2 x 22.00 backfilled from line totals
    assert Decimal(paid.collected_amount) == Decimal("44.00")
    assert paid.collected_at is not None


def test_update_sale_rejects_voided(db, scene):
    cid, sale_id = scene["company_id"], scene["sale"].id
    crud.void_sale(db, cid, sale_id)
    with pytest.raises(HTTPException) as exc:
        crud.update_sale(db, cid, sale_id, SaleUpdate(payment_status="paid"))
    assert exc.value.status_code == 409


def test_reopen_voided_sale(db, scene):
    cid, sale_id = scene["company_id"], scene["sale"].id
    crud.void_sale(db, cid, sale_id)
    reopened = crud.reopen_sale(db, cid, sale_id)
    assert reopened.status == "approved"


def test_reopen_to_submitted(db, scene):
    cid, sale_id = scene["company_id"], scene["sale"].id
    crud.void_sale(db, cid, sale_id)
    reopened = crud.reopen_sale(db, cid, sale_id, target_status="submitted")
    assert reopened.status == "submitted"


def test_reopen_requires_void(db, scene):
    with pytest.raises(HTTPException) as exc:
        crud.reopen_sale(db, scene["company_id"], scene["sale"].id)
    assert exc.value.status_code == 409


def test_reopen_rejects_bad_target(db, scene):
    cid, sale_id = scene["company_id"], scene["sale"].id
    crud.void_sale(db, cid, sale_id)
    with pytest.raises(HTTPException) as exc:
        crud.reopen_sale(db, cid, sale_id, target_status="banana")
    assert exc.value.status_code == 422


def test_schema_rejects_unknown_payment_method(db, scene):
    with pytest.raises(ValidationError):
        SaleUpdate(payment_method="bitcoin")


def test_schema_rejects_unknown_payment_status(db, scene):
    with pytest.raises(ValidationError):
        SaleCreate(
            rep_private_user_id=scene["rep"].private_user_id,
            sold_at=SOLD_AT,
            payment_status="maybe",
            lines=[SaleLineCreate(variant_id=scene["variant"].id, quantity=Decimal("1"))],
        )


def test_sync_records_payment_method(db, scene):
    result = crud.sync_sales(
        db, scene["company_id"],
        [SaleSyncItem(
            client_uuid="sync-method-0001",
            rep_private_user_id=scene["rep"].private_user_id,
            sold_at=SOLD_AT,
            payment_method="card",
            lines=[SaleLineCreate(variant_id=scene["variant"].id, quantity=Decimal("1"))],
        )],
        scene["owner"].user_id,
    )
    assert result["accepted"] == 1
    synced = db.get(Sale, result["results"][0]["sale_id"])
    assert synced.payment_method == "card"
