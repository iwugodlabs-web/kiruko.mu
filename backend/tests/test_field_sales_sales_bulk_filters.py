"""Month-end ergonomics: bulk approve/reject and server-side sales filtering.

Bulk review is best-effort (one bad id must not sink the batch); list filters
(payment, outlet, free-text) and the matching COUNT back the web pager.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from core.model import Company, PrivateUser, Sale, User
from db_models.crud import field_sales as crud
from schema.field_sales_schema import (
    OutletCreate,
    ProductCreate,
    SaleCreate,
    SaleLineCreate,
)

SOLD_AT = datetime(2026, 5, 10, 9, 0, tzinfo=timezone.utc)


@pytest.fixture()
def scene(db):
    import uuid

    sfx = uuid.uuid4().hex[:8]
    owner = User(
        user_type="company", email=f"bf-owner-{sfx}@kontokazdemo.com",
        user_name=f"bf-owner-{sfx}", password_hash="x",
    )
    db.add(owner)
    db.flush()
    company = Company(
        user_id=owner.user_id, company_name=f"Bulk Co. {sfx}",
        email=f"bf-co-{sfx}@kontokazdemo.com", brn=f"BF_{sfx}", country_code="MU",
    )
    db.add(company)
    db.flush()

    rep_user = User(user_type="private", email=f"bf-rep-{sfx}@kontokazdemo.com",
                    user_name=f"bf-rep-{sfx}", password_hash="x")
    db.add(rep_user)
    db.flush()
    rep = PrivateUser(
        user_id=rep_user.user_id, first_name="Bo", last_name="Rep",
        company_id=company.company_id, pass_port_number=f"BF_{sfx}", role="employee",
    )
    db.add(rep)
    db.flush()

    cid = company.company_id
    product = crud.create_product(db, cid, ProductCreate(name="Juice 1L", category="Drinks"))
    variant = product.variants[0]
    variant.unit_price = Decimal("30.00")
    outlet_a = crud.create_outlet(db, cid, OutletCreate(name="Shop A"))
    outlet_b = crud.create_outlet(db, cid, OutletCreate(name="Shop B"))
    db.commit()

    def _sale(outlet, *, method, payment_status="paid", segments=1, days=0):
        return crud.create_sale(
            db, cid,
            SaleCreate(
                rep_private_user_id=rep.private_user_id,
                outlet_id=outlet.id if outlet else None,
                sold_at=SOLD_AT + timedelta(days=days),
                payment_status=payment_status,
                payment_method=method,
                notes=f"note-{method}",
                lines=[SaleLineCreate(variant_id=variant.id, quantity=Decimal(str(segments)))],
            ),
            owner.user_id,
            status="submitted",
        )

    s1 = _sale(outlet_a, method="cash")
    s2 = _sale(outlet_a, method="card")
    s3 = _sale(outlet_b, method="mobile_money", payment_status="pending", days=1)

    yield {
        "company_id": cid, "owner": owner, "rep": rep, "variant": variant,
        "outlet_a": outlet_a, "outlet_b": outlet_b, "sales": [s1, s2, s3],
        "s1": s1, "s2": s2, "s3": s3,
    }

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


def _ids(sales):
    return [s.id for s in sales]


# --- bulk review -----------------------------------------------------------


def test_bulk_approve_all(db, scene):
    result = crud.review_sales_bulk(
        db, scene["company_id"], _ids(scene["sales"]), "approve", scene["owner"].user_id
    )
    assert result["succeeded"] == 3
    assert result["failed"] == 0
    assert all(r["status"] == "approved" for r in result["results"])
    for s in scene["sales"]:
        assert db.get(Sale, s.id).status == "approved"


def test_bulk_reject_records_reason(db, scene):
    result = crud.review_sales_bulk(
        db, scene["company_id"], [scene["s1"].id], "reject",
        scene["owner"].user_id, notes="price mismatch",
    )
    assert result["succeeded"] == 1
    rejected = db.get(Sale, scene["s1"].id)
    assert rejected.status == "rejected"
    assert rejected.notes == "price mismatch"


def test_bulk_is_best_effort(db, scene):
    # one real id + one that doesn't exist → partial success, no exception
    result = crud.review_sales_bulk(
        db, scene["company_id"], [scene["s1"].id, 999999], "approve", scene["owner"].user_id
    )
    assert result["succeeded"] == 1
    assert result["failed"] == 1
    failed = [r for r in result["results"] if not r["ok"]]
    assert failed and failed[0]["sale_id"] == 999999
    assert db.get(Sale, scene["s1"].id).status == "approved"


def test_bulk_rejects_bad_decision(db, scene):
    with pytest.raises(HTTPException) as exc:
        crud.review_sales_bulk(
            db, scene["company_id"], [scene["s1"].id], "maybe", scene["owner"].user_id
        )
    assert exc.value.status_code == 422


# --- list filters ----------------------------------------------------------


def test_list_sales_filter_by_payment_method(db, scene):
    cash = crud.list_sales(db, scene["company_id"], payment_method="cash")
    assert _ids(cash) == [scene["s1"].id]


def test_list_sales_filter_by_outlet(db, scene):
    at_a = crud.list_sales(db, scene["company_id"], outlet_id=scene["outlet_a"].id)
    assert sorted(_ids(at_a)) == sorted([scene["s1"].id, scene["s2"].id])


def test_list_sales_filter_by_payment_status(db, scene):
    pending = crud.list_sales(db, scene["company_id"], payment_status="pending")
    assert _ids(pending) == [scene["s3"].id]


def test_list_sales_search_matches_product_name(db, scene):
    hit = crud.list_sales(db, scene["company_id"], search="Juice")
    assert len(hit) == 3
    miss = crud.list_sales(db, scene["company_id"], search="Nonexistent")
    assert miss == []


def test_list_sales_search_matches_sku(db, scene):
    hit = crud.list_sales(db, scene["company_id"], search=scene["variant"].sku)
    assert len(hit) == 3


def test_list_sales_search_matches_notes(db, scene):
    hit = crud.list_sales(db, scene["company_id"], search="note-card")
    assert _ids(hit) == [scene["s2"].id]


def test_list_sales_pagination_and_count(db, scene):
    total = crud.count_sales(db, scene["company_id"])
    assert total == 3
    page = crud.list_sales(db, scene["company_id"], limit=2, offset=0)
    assert len(page) == 2
    # newest first (s3 sold a day later)
    assert page[0].id == scene["s3"].id
    rest = crud.list_sales(db, scene["company_id"], limit=2, offset=2)
    assert len(rest) == 1


def test_count_respects_filters(db, scene):
    assert crud.count_sales(db, scene["company_id"], payment_method="cash") == 1
    assert crud.count_sales(db, scene["company_id"], search="note-mobile") == 1
