"""Rep self-scoping guard on the field-sales capture routes.

A rank-and-file company member (a field rep) may only create/sync sales credited
to themselves; company admins/operators may act on behalf of any rep. This locks
the guard in `api/v1/commissions.py::_rep_scope_private_user_id` and the two
routes that use it.
"""

from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from api.v1 import commissions
from core.model import Company, PrivateUser, User
from db_models.crud import field_sales as crud
from schema.field_sales_schema import (
    ProductCreate,
    SaleCreate,
    SaleLineCreate,
    SaleSyncItem,
    SaleSyncRequest,
)

SOLD_AT = datetime(2026, 5, 10, 9, 0, tzinfo=timezone.utc)


@pytest.fixture()
def authz_company(db):
    import uuid

    sfx = uuid.uuid4().hex[:8]
    owner_user = User(
        user_type="company", email=f"authz-owner-{sfx}@kontokazdemo.com",
        user_name=f"authz-owner-{sfx}", password_hash="x",
    )
    db.add(owner_user)
    db.flush()
    company = Company(
        user_id=owner_user.user_id, company_name=f"Authz Co. {sfx}",
        email=f"authz-co-{sfx}@kontokazdemo.com", brn=f"AUTHZ_{sfx}", country_code="MU",
    )
    db.add(company)
    db.flush()

    def _rep(label: str):
        u = User(user_type="private", email=f"authz-{label}-{sfx}@kontokazdemo.com",
                 user_name=f"authz-{label}-{sfx}", password_hash="x")
        db.add(u)
        db.flush()
        pu = PrivateUser(
            user_id=u.user_id, first_name=label.title(), last_name="Rep",
            company_id=company.company_id, pass_port_number=f"AUTHZ_{label}_{sfx}",
            role="employee",
        )
        db.add(pu)
        db.flush()
        return u, pu

    rep_user, rep = _rep("one")
    _, other = _rep("two")

    product = crud.create_product(db, company.company_id, ProductCreate(name="Cola 500ml"))
    variant = product.variants[0]
    db.commit()

    yield {
        "company_id": company.company_id,
        "owner_user": owner_user,
        "rep_user": rep_user,
        "rep": rep,
        "other": other,
        "variant": variant,
    }

    db.rollback()
    for stmt in [
        "DELETE FROM sale_lines",
        "DELETE FROM sales",
        "DELETE FROM product_variants",
        "DELETE FROM products",
    ]:
        db.execute(text(stmt))
    db.commit()


def _make_sale(db, company_id, rep_private_user_id, variant_id, *, status="approved"):
    return crud.create_sale(
        db,
        company_id,
        SaleCreate(
            rep_private_user_id=rep_private_user_id,
            sold_at=SOLD_AT,
            lines=[SaleLineCreate(variant_id=variant_id, quantity=1)],
        ),
        None,
        status=status,
    )


def test_rep_scope_helper_binds_rank_and_file_member(db, authz_company):
    bound = commissions._rep_scope_private_user_id(
        authz_company["rep_user"], authz_company["company_id"], db
    )
    assert bound == authz_company["rep"].private_user_id


def test_rep_scope_helper_allows_company_owner(db, authz_company):
    bound = commissions._rep_scope_private_user_id(
        authz_company["owner_user"], authz_company["company_id"], db
    )
    assert bound is None


def test_create_sale_route_rejects_foreign_rep(db, authz_company):
    payload = SaleCreate(
        rep_private_user_id=authz_company["other"].private_user_id,
        sold_at=SOLD_AT,
        lines=[SaleLineCreate(variant_id=1, quantity=1)],
    )
    with pytest.raises(HTTPException) as exc:
        commissions.create_sale(
            company_id=authz_company["company_id"],
            payload=payload,
            db=db,
            current_user=authz_company["rep_user"],
            company=None,
        )
    assert exc.value.status_code == 403


def test_pending_sales_route_is_not_shadowed_by_sale_id():
    """Static "/sales/pending" must be matched before dynamic "/sales/{sale_id}".

    Regression: with "{sale_id}" declared first, GET /sales/pending was parsed
    as sale_id="pending" and returned 422 before auth ran (seen in server logs).
    """
    from main import app

    paths = [getattr(r, "path", None) for r in app.routes]
    pending = "/api/v1/companies/{company_id}/sales/pending"
    dynamic = "/api/v1/companies/{company_id}/sales/{sale_id}"
    assert pending in paths, "pending route not registered"
    assert dynamic in paths, "sale detail route not registered"
    assert paths.index(pending) < paths.index(dynamic), (
        "GET /sales/pending is shadowed by /sales/{sale_id} — reorder the routes"
    )


def test_sync_sales_route_rejects_foreign_rep(db, authz_company):
    payload = SaleSyncRequest(
        items=[
            SaleSyncItem(
                client_uuid="uuid-foreign-rep-1",
                rep_private_user_id=authz_company["other"].private_user_id,
                sold_at=SOLD_AT,
                lines=[SaleLineCreate(variant_id=1, quantity=1)],
            )
        ]
    )
    with pytest.raises(HTTPException) as exc:
        commissions.sync_sales(
            company_id=authz_company["company_id"],
            payload=payload,
            db=db,
            current_user=authz_company["rep_user"],
            company=None,
        )
    assert exc.value.status_code == 403


def test_void_route_rejects_foreign_rep(db, authz_company):
    sale = _make_sale(
        db, authz_company["company_id"], authz_company["other"].private_user_id,
        authz_company["variant"].id,
    )
    db.commit()
    with pytest.raises(HTTPException) as exc:
        commissions.void_sale(
            company_id=authz_company["company_id"],
            sale_id=sale.id,
            db=db,
            current_user=authz_company["rep_user"],
            company=None,
        )
    assert exc.value.status_code == 403
    assert crud.get_sale(db, authz_company["company_id"], sale.id).status != "void"


def test_void_route_allows_own_rep_before_approval(db, authz_company):
    sale = _make_sale(
        db, authz_company["company_id"], authz_company["rep"].private_user_id,
        authz_company["variant"].id, status="submitted",
    )
    db.commit()
    out = commissions.void_sale(
        company_id=authz_company["company_id"],
        sale_id=sale.id,
        db=db,
        current_user=authz_company["rep_user"],
        company=None,
    )
    assert out.status == "void"


def test_void_route_blocks_own_rep_on_approved_sale(db, authz_company):
    sale = _make_sale(
        db, authz_company["company_id"], authz_company["rep"].private_user_id,
        authz_company["variant"].id, status="approved",
    )
    db.commit()
    with pytest.raises(HTTPException) as exc:
        commissions.void_sale(
            company_id=authz_company["company_id"],
            sale_id=sale.id,
            db=db,
            current_user=authz_company["rep_user"],
            company=None,
        )
    assert exc.value.status_code == 403
    assert crud.get_sale(db, authz_company["company_id"], sale.id).status == "approved"


def test_void_route_allows_admin_on_approved_sale(db, authz_company):
    sale = _make_sale(
        db, authz_company["company_id"], authz_company["other"].private_user_id,
        authz_company["variant"].id, status="approved",
    )
    db.commit()
    out = commissions.void_sale(
        company_id=authz_company["company_id"],
        sale_id=sale.id,
        db=db,
        current_user=authz_company["owner_user"],
        company=None,
    )
    assert out.status == "void"


def test_reopen_route_rejects_rep(db, authz_company):
    sale = _make_sale(
        db, authz_company["company_id"], authz_company["rep"].private_user_id,
        authz_company["variant"].id, status="submitted",
    )
    crud.void_sale(db, authz_company["company_id"], sale.id)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        commissions.reopen_sale(
            company_id=authz_company["company_id"],
            sale_id=sale.id,
            payload=None,
            db=db,
            current_user=authz_company["rep_user"],
            company=None,
        )
    assert exc.value.status_code == 403
    assert crud.get_sale(db, authz_company["company_id"], sale.id).status == "void"


def test_reopen_route_allows_company_owner(db, authz_company):
    sale = _make_sale(
        db, authz_company["company_id"], authz_company["other"].private_user_id,
        authz_company["variant"].id,
    )
    crud.void_sale(db, authz_company["company_id"], sale.id)
    db.commit()
    out = commissions.reopen_sale(
        company_id=authz_company["company_id"],
        sale_id=sale.id,
        payload=None,
        db=db,
        current_user=authz_company["owner_user"],
        company=None,
    )
    assert out.status == "approved"
