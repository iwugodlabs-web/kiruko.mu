"""CRUD for the Field Sales & Commissions module (Phase 0).

Everything is tenant-scoped by `company_id`. Callers (the API layer) resolve and
authorize the company first; this module assumes a valid company and focuses on
persistence + invariants:

  * a product always has at least one (default) variant;
  * a sale line snapshots its unit price at sale time (never re-read later);
  * a product/variant referenced by a sale can never be hard-deleted.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session, joinedload

from core.model import (
    CommissionLineItem,
    CommissionPayable,
    CommissionPlan,
    CommissionPlanAssignment,
    CommissionRule,
    CommissionRun,
    CreditAssignment,
    EmployeeOneOffAllowance,
    Outlet,
    OptionValue,
    Product,
    ProductCategory,
    ProductOption,
    ProductPrice,
    ProductVariant,
    ProductVariantOptionValue,
    PrivateUser,
    SalaryComponent,
    Sale,
    SaleLine,
    SalesReturn,
    SalesReturnLine,
    SalesTarget,
    UnitOfMeasure,
)
from schema.field_sales_schema import (
    CommissionPlanCreate,
    CreditAssignmentCreate,
    OutletCreate,
    SalesReturnCreate,
    OutletUpdate,
    ProductCategoryCreate,
    ProductCreate,
    ProductOptionCreate,
    ProductPriceCreate,
    ProductUpdate,
    SaleCreate,
    SaleSyncItem,
    SalesTargetCreate,
    UnitOfMeasureCreate,
    VariantCreate,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _default_sku(name: str) -> str:
    base = "".join(ch for ch in (name or "SKU").upper() if ch.isalnum())[:48] or "SKU"
    return f"{base}-DEFAULT"


# ---------------------------------------------------------------------------
# Products + variants
# ---------------------------------------------------------------------------


def _create_default_variant(db: Session, product: Product, currency: str) -> ProductVariant:
    variant = ProductVariant(
        product_id=product.id,
        sku=_default_sku(product.name),
        unit_price=Decimal("0.00"),
        currency=currency,
        is_default=True,
        status="active",
    )
    db.add(variant)
    db.flush()
    return variant


def create_product(db: Session, company_id: int, payload: ProductCreate) -> Product:
    existing = (
        db.query(Product)
        .filter(Product.company_id == company_id, Product.name == payload.name)
        .one_or_none()
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A product named '{payload.name}' already exists.",
        )

    product = Product(
        company_id=company_id,
        name=payload.name,
        brand=payload.brand,
        category=payload.category,
        status="active",
    )
    db.add(product)
    db.flush()

    dv = payload.default_variant
    if dv is None:
        _create_default_variant(db, product, "MUR")
    else:
        variant = ProductVariant(
            product_id=product.id,
            sku=dv.sku,
            barcode=dv.barcode,
            unit_price=dv.unit_price,
            currency=dv.currency or "MUR",
            is_default=True,
            status="active",
        )
        db.add(variant)
        db.flush()

    db.commit()
    db.refresh(product)
    return product


def list_products(
    db: Session, company_id: int, include_archived: bool = False
) -> List[Product]:
    q = (
        db.query(Product)
        .options(joinedload(Product.variants))
        .filter(Product.company_id == company_id)
    )
    if not include_archived:
        q = q.filter(Product.archived_at.is_(None))
    return q.order_by(Product.name).all()


def get_product(db: Session, company_id: int, product_id: int) -> Product:
    product = (
        db.query(Product)
        .options(joinedload(Product.variants))
        .filter(Product.id == product_id, Product.company_id == company_id)
        .one_or_none()
    )
    if product is None:
        raise HTTPException(status_code=404, detail=f"Product {product_id} not found")
    return product


def update_product(
    db: Session, company_id: int, product_id: int, payload: ProductUpdate
) -> Product:
    product = get_product(db, company_id, product_id)
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] != product.name:
        clash = (
            db.query(Product)
            .filter(
                Product.company_id == company_id,
                Product.name == data["name"],
                Product.id != product_id,
            )
            .one_or_none()
        )
        if clash is not None:
            raise HTTPException(
                status_code=409,
                detail=f"A product named '{data['name']}' already exists.",
            )
    for field, value in data.items():
        setattr(product, field, value)
    db.commit()
    db.refresh(product)
    return product


def get_variant(db: Session, company_id: int, variant_id: int) -> ProductVariant:
    variant = (
        db.query(ProductVariant)
        .join(Product, ProductVariant.product_id == Product.id)
        .filter(ProductVariant.id == variant_id, Product.company_id == company_id)
        .one_or_none()
    )
    if variant is None:
        raise HTTPException(status_code=404, detail=f"Variant {variant_id} not found")
    return variant


# ---------------------------------------------------------------------------
# Sales
# ---------------------------------------------------------------------------


def _assert_rep_in_company(db: Session, company_id: int, private_user_id: int) -> PrivateUser:
    rep = (
        db.query(PrivateUser)
        .filter(
            PrivateUser.private_user_id == private_user_id,
            PrivateUser.company_id == company_id,
        )
        .one_or_none()
    )
    if rep is None:
        raise HTTPException(
            status_code=400,
            detail=f"Employee {private_user_id} is not a member of this company.",
        )
    return rep


def create_sale(
    db: Session,
    company_id: int,
    payload: SaleCreate,
    created_by_user_id: Optional[int],
    *,
    status: str = "approved",
    visit_verified: Optional[bool] = None,
    visit_distance_m: Optional[float] = None,
) -> Sale:
    _assert_rep_in_company(db, company_id, payload.rep_private_user_id)
    if payload.credited_to_private_user_id is not None:
        _assert_rep_in_company(db, company_id, payload.credited_to_private_user_id)
    if payload.outlet_id is not None:
        get_outlet(db, company_id, payload.outlet_id)

    if payload.client_uuid:
        dupe = (
            db.query(Sale)
            .filter(
                Sale.company_id == company_id,
                Sale.client_uuid == payload.client_uuid,
            )
            .one_or_none()
        )
        if dupe is not None:
            return dupe

    sale = Sale(
        company_id=company_id,
        rep_private_user_id=payload.rep_private_user_id,
        credited_to_private_user_id=payload.credited_to_private_user_id,
        outlet_id=payload.outlet_id,
        sold_at=payload.sold_at,
        status=status,
        payment_status=payload.payment_status or "paid",
        collected_amount=payload.collected_amount,
        collected_at=payload.collected_at,
        currency=payload.currency or "MUR",
        source=payload.source or "admin",
        client_uuid=payload.client_uuid,
        visit_verified=visit_verified,
        visit_distance_m=visit_distance_m,
        notes=payload.notes,
        created_by_user_id=created_by_user_id,
    )
    db.add(sale)
    db.flush()

    for line in payload.lines:
        variant = get_variant(db, company_id, line.variant_id)
        unit_price = (
            line.unit_price if line.unit_price is not None else Decimal(variant.unit_price)
        )
        quantity = Decimal(line.quantity)
        db.add(
            SaleLine(
                sale_id=sale.id,
                variant_id=variant.id,
                quantity=quantity,
                unit_price_snapshot=unit_price,
                line_total=(unit_price * quantity).quantize(Decimal("0.01")),
            )
        )
    db.flush()
    db.commit()
    db.refresh(sale)
    return sale


def list_sales(
    db: Session,
    company_id: int,
    *,
    period_start: Optional[datetime] = None,
    period_end: Optional[datetime] = None,
    rep_private_user_id: Optional[int] = None,
    sale_status: Optional[str] = None,
) -> List[Sale]:
    q = (
        db.query(Sale)
        .options(joinedload(Sale.lines))
        .filter(Sale.company_id == company_id)
    )
    if period_start is not None:
        q = q.filter(Sale.sold_at >= period_start)
    if period_end is not None:
        q = q.filter(Sale.sold_at <= period_end)
    if rep_private_user_id is not None:
        q = q.filter(Sale.rep_private_user_id == rep_private_user_id)
    if sale_status is not None:
        q = q.filter(Sale.status == sale_status)
    return q.order_by(Sale.sold_at.desc()).all()


def get_sale(db: Session, company_id: int, sale_id: int) -> Sale:
    sale = (
        db.query(Sale)
        .options(joinedload(Sale.lines))
        .filter(Sale.id == sale_id, Sale.company_id == company_id)
        .one_or_none()
    )
    if sale is None:
        raise HTTPException(status_code=404, detail=f"Sale {sale_id} not found")
    return sale


def void_sale(db: Session, company_id: int, sale_id: int) -> Sale:
    sale = get_sale(db, company_id, sale_id)
    if sale.status == "void":
        return sale
    sale.status = "void"
    db.commit()
    db.refresh(sale)
    return sale


# ---------------------------------------------------------------------------
# Commission plans / rules / assignments
# ---------------------------------------------------------------------------


def create_plan(db: Session, company_id: int, payload: CommissionPlanCreate) -> CommissionPlan:
    clash = (
        db.query(CommissionPlan)
        .filter(CommissionPlan.company_id == company_id, CommissionPlan.name == payload.name)
        .one_or_none()
    )
    if clash is not None:
        raise HTTPException(
            status_code=409,
            detail=f"A commission plan named '{payload.name}' already exists.",
        )

    plan = CommissionPlan(
        company_id=company_id,
        name=payload.name,
        description=payload.description,
        trigger=payload.trigger or "on_sale",
        status="active",
    )
    db.add(plan)
    db.flush()

    for rule in payload.rules:
        _validate_rule(rule.rule_type, rule.params)
        db.add(
            CommissionRule(
                plan_id=plan.id,
                rule_type=rule.rule_type,
                params=rule.params,
                scope_category=rule.scope_category,
                scope_product_id=rule.scope_product_id,
                scope_variant_id=rule.scope_variant_id,
                scope_option_value_id=rule.scope_option_value_id,
                effective_from=rule.effective_from,
                effective_to=rule.effective_to,
            )
        )
    db.flush()
    db.commit()
    db.refresh(plan)
    return plan


RULE_TYPES = {"flat_percent", "per_unit", "tiered", "target", "spiff", "team_override"}


def _num(params: dict, key: str) -> Optional[Decimal]:
    raw = (params or {}).get(key)
    if raw is None:
        return None
    try:
        return Decimal(str(raw))
    except Exception:
        raise HTTPException(status_code=422, detail=f"params.{key} must be numeric")


def _validate_rule(rule_type: str, params: dict) -> None:
    """Reject unknown types and malformed params at authoring time, so a bad
    rule can never reach a run."""
    if rule_type not in RULE_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown rule type '{rule_type}'. One of: {', '.join(sorted(RULE_TYPES))}.",
        )
    if rule_type in ("flat_percent", "spiff") and "amount" not in (params or {}):
        pct = _num(params, "percent")
        if pct is None:
            raise HTTPException(status_code=422, detail=f"{rule_type} requires params.percent (or params.amount)")
        if pct < 0:
            raise HTTPException(status_code=422, detail="params.percent must be >= 0")
    elif rule_type == "per_unit":
        amt = _num(params, "amount")
        if amt is None:
            raise HTTPException(status_code=422, detail="per_unit requires params.amount")
    elif rule_type == "tiered":
        bands = (params or {}).get("bands")
        if not bands or not isinstance(bands, list):
            raise HTTPException(status_code=422, detail="tiered requires params.bands (a non-empty list)")
        for band in bands:
            if _num(band, "percent") is None:
                raise HTTPException(status_code=422, detail="each tiered band requires params.percent")
    elif rule_type == "target":
        if _num(params, "percent") is None:
            raise HTTPException(status_code=422, detail="target requires params.percent")
    elif rule_type == "team_override":
        pct = _num(params, "percent")
        if pct is None:
            raise HTTPException(status_code=422, detail="team_override requires params.percent")
        if pct < 0:
            raise HTTPException(status_code=422, detail="params.percent must be >= 0")


def list_plans(db: Session, company_id: int, include_archived: bool = False) -> List[CommissionPlan]:
    q = (
        db.query(CommissionPlan)
        .options(joinedload(CommissionPlan.rules))
        .filter(CommissionPlan.company_id == company_id)
    )
    if not include_archived:
        q = q.filter(CommissionPlan.archived_at.is_(None))
    return q.order_by(CommissionPlan.name).all()


def get_plan(db: Session, company_id: int, plan_id: int) -> CommissionPlan:
    plan = (
        db.query(CommissionPlan)
        .options(joinedload(CommissionPlan.rules))
        .filter(CommissionPlan.id == plan_id, CommissionPlan.company_id == company_id)
        .one_or_none()
    )
    if plan is None:
        raise HTTPException(status_code=404, detail=f"Commission plan {plan_id} not found")
    return plan


def assign_plan(
    db: Session,
    company_id: int,
    plan_id: int,
    private_user_id: int,
    effective_from=None,
    effective_to=None,
) -> CommissionPlanAssignment:
    get_plan(db, company_id, plan_id)
    _assert_rep_in_company(db, company_id, private_user_id)

    existing = (
        db.query(CommissionPlanAssignment)
        .filter(
            CommissionPlanAssignment.plan_id == plan_id,
            CommissionPlanAssignment.private_user_id == private_user_id,
        )
        .one_or_none()
    )
    if existing is not None:
        existing.effective_from = effective_from
        existing.effective_to = effective_to
        db.commit()
        db.refresh(existing)
        return existing

    assignment = CommissionPlanAssignment(
        plan_id=plan_id,
        private_user_id=private_user_id,
        effective_from=effective_from,
        effective_to=effective_to,
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    return assignment


def list_assignments(db: Session, company_id: int, plan_id: int) -> List[CommissionPlanAssignment]:
    get_plan(db, company_id, plan_id)
    return (
        db.query(CommissionPlanAssignment)
        .filter(CommissionPlanAssignment.plan_id == plan_id)
        .order_by(CommissionPlanAssignment.id)
        .all()
    )


# ---------------------------------------------------------------------------
# Phase 1 — outlets
# ---------------------------------------------------------------------------


def create_outlet(db: Session, company_id: int, payload: OutletCreate) -> Outlet:
    clash = (
        db.query(Outlet)
        .filter(Outlet.company_id == company_id, Outlet.name == payload.name)
        .one_or_none()
    )
    if clash is not None:
        raise HTTPException(status_code=409, detail=f"An outlet named '{payload.name}' already exists.")
    if payload.assigned_rep_private_user_id is not None:
        _assert_rep_in_company(db, company_id, payload.assigned_rep_private_user_id)
    outlet = Outlet(company_id=company_id, **payload.model_dump())
    db.add(outlet)
    db.commit()
    db.refresh(outlet)
    return outlet


def list_outlets(
    db: Session, company_id: int, *, assigned_rep_private_user_id: Optional[int] = None,
    include_archived: bool = False,
) -> List[Outlet]:
    q = db.query(Outlet).filter(Outlet.company_id == company_id)
    if not include_archived:
        q = q.filter(Outlet.archived_at.is_(None))
    if assigned_rep_private_user_id is not None:
        q = q.filter(Outlet.assigned_rep_private_user_id == assigned_rep_private_user_id)
    return q.order_by(Outlet.name).all()


def get_outlet(db: Session, company_id: int, outlet_id: int) -> Outlet:
    outlet = (
        db.query(Outlet)
        .filter(Outlet.id == outlet_id, Outlet.company_id == company_id)
        .one_or_none()
    )
    if outlet is None:
        raise HTTPException(status_code=404, detail=f"Outlet {outlet_id} not found")
    return outlet


def update_outlet(db: Session, company_id: int, outlet_id: int, payload: OutletUpdate) -> Outlet:
    outlet = get_outlet(db, company_id, outlet_id)
    data = payload.model_dump(exclude_unset=True)
    if "assigned_rep_private_user_id" in data and data["assigned_rep_private_user_id"] is not None:
        _assert_rep_in_company(db, company_id, data["assigned_rep_private_user_id"])
    for field, value in data.items():
        setattr(outlet, field, value)
    db.commit()
    db.refresh(outlet)
    return outlet


def verify_outlet_visit(
    outlet: Outlet, latitude: Optional[float], longitude: Optional[float]
) -> tuple[Optional[bool], Optional[float]]:
    """Return (verified, distance_m) for a rep's fix against an outlet's fence.

    None when the outlet has no coordinates or the fix is missing — unverified,
    not fraud. Reuses the same great-circle math as clock-in geofencing.
    """
    if outlet.latitude is None or outlet.longitude is None:
        return None, None
    if latitude is None or longitude is None:
        return None, None
    from services.geofence_service import haversine_m

    d = haversine_m(latitude, longitude, outlet.latitude, outlet.longitude)
    return (d <= (outlet.radius_meters or 150)), d


# ---------------------------------------------------------------------------
# Phase 1 — offline sync + approval queue
# ---------------------------------------------------------------------------


def sync_sales(
    db: Session, company_id: int, items: List[SaleSyncItem], created_by_user_id: Optional[int]
) -> dict:
    """Idempotent batch upsert of offline-captured sales, keyed on client_uuid.

    A re-sent item is reported as `duplicate` and never double-counted. Mobile
    sales land in the review queue as `submitted`; a geo fix against the outlet
    is verified here (best-effort — a missing fence/fix is `unverified`, not an
    error). Per-item failures don't abort the batch.
    """
    results = []
    accepted = duplicates = errors = 0
    for item in items:
        try:
            existing = (
                db.query(Sale)
                .filter(Sale.company_id == company_id, Sale.client_uuid == item.client_uuid)
                .one_or_none()
            )
            if existing is not None:
                duplicates += 1
                results.append({"client_uuid": item.client_uuid, "sale_id": existing.id, "outcome": "duplicate"})
                continue

            verified = distance = None
            if item.outlet_id is not None and item.geo is not None:
                outlet = get_outlet(db, company_id, item.outlet_id)
                verified, distance = verify_outlet_visit(outlet, item.geo.latitude, item.geo.longitude)

            payload = SaleCreate(
                rep_private_user_id=item.rep_private_user_id,
                outlet_id=item.outlet_id,
                sold_at=item.sold_at,
                currency=item.currency,
                source="mobile",
                client_uuid=item.client_uuid,
                notes=item.notes,
                lines=item.lines,
            )
            sale = create_sale(
                db, company_id, payload, created_by_user_id,
                status="submitted", visit_verified=verified, visit_distance_m=distance,
            )
            accepted += 1
            results.append({"client_uuid": item.client_uuid, "sale_id": sale.id, "outcome": "created"})
        except HTTPException as exc:
            errors += 1
            db.rollback()
            results.append({"client_uuid": item.client_uuid, "outcome": "error", "detail": str(exc.detail)})
        except Exception as exc:  # noqa: BLE001 - per-item isolation
            errors += 1
            db.rollback()
            results.append({"client_uuid": item.client_uuid, "outcome": "error", "detail": str(exc)})

    return {
        "accepted": accepted,
        "duplicates": duplicates,
        "errors": errors,
        "results": results,
    }


def list_pending_sales(db: Session, company_id: int) -> List[Sale]:
    return (
        db.query(Sale)
        .options(joinedload(Sale.lines))
        .filter(Sale.company_id == company_id, Sale.status == "submitted")
        .order_by(Sale.sold_at)
        .all()
    )


def review_sale(
    db: Session,
    company_id: int,
    sale_id: int,
    decision: str,
    reviewer_user_id: int,
    notes: Optional[str] = None,
) -> Sale:
    """Approve or reject a submitted sale. Approval is what makes a sale earn."""
    sale = get_sale(db, company_id, sale_id)
    if sale.status not in ("submitted", "draft", "approved", "rejected"):
        raise HTTPException(status_code=409, detail=f"Sale {sale_id} cannot be reviewed (status={sale.status}).")
    if decision == "approve":
        sale.status = "approved"
    elif decision == "reject":
        sale.status = "rejected"
        if notes:
            sale.notes = notes
    else:
        raise HTTPException(status_code=422, detail="decision must be 'approve' or 'reject'")
    sale.reviewed_by_user_id = reviewer_user_id
    sale.reviewed_at = _now()
    db.commit()
    db.refresh(sale)
    return sale


# ---------------------------------------------------------------------------
# Phase 2 — full catalog
# ---------------------------------------------------------------------------


def create_category(db: Session, company_id: int, payload: ProductCategoryCreate) -> ProductCategory:
    clash = (
        db.query(ProductCategory)
        .filter(
            ProductCategory.company_id == company_id,
            ProductCategory.name == payload.name,
            ProductCategory.parent_id == payload.parent_id,
        )
        .one_or_none()
    )
    if clash is not None:
        raise HTTPException(status_code=409, detail=f"Category '{payload.name}' already exists here.")
    if payload.parent_id is not None:
        parent = (
            db.query(ProductCategory)
            .filter(ProductCategory.id == payload.parent_id, ProductCategory.company_id == company_id)
            .one_or_none()
        )
        if parent is None:
            raise HTTPException(status_code=404, detail=f"Parent category {payload.parent_id} not found")
    cat = ProductCategory(company_id=company_id, name=payload.name, parent_id=payload.parent_id)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


def list_categories(db: Session, company_id: int) -> List[ProductCategory]:
    return (
        db.query(ProductCategory)
        .filter(ProductCategory.company_id == company_id)
        .order_by(ProductCategory.name)
        .all()
    )


def create_option(db: Session, company_id: int, payload: ProductOptionCreate) -> ProductOption:
    clash = (
        db.query(ProductOption)
        .filter(ProductOption.company_id == company_id, ProductOption.name == payload.name)
        .one_or_none()
    )
    if clash is not None:
        raise HTTPException(status_code=409, detail=f"Option '{payload.name}' already exists.")
    option = ProductOption(company_id=company_id, name=payload.name)
    db.add(option)
    db.flush()
    for value in payload.values or []:
        db.add(OptionValue(option_id=option.id, value=value))
    db.commit()
    db.refresh(option)
    return option


def list_options(db: Session, company_id: int) -> List[ProductOption]:
    return (
        db.query(ProductOption)
        .options(joinedload(ProductOption.values))
        .filter(ProductOption.company_id == company_id)
        .order_by(ProductOption.name)
        .all()
    )


def create_uom(db: Session, company_id: int, payload: UnitOfMeasureCreate) -> UnitOfMeasure:
    clash = (
        db.query(UnitOfMeasure)
        .filter(UnitOfMeasure.company_id == company_id, UnitOfMeasure.code == payload.code)
        .one_or_none()
    )
    if clash is not None:
        raise HTTPException(status_code=409, detail=f"Unit '{payload.code}' already exists.")
    uom = UnitOfMeasure(
        company_id=company_id, code=payload.code, name=payload.name,
        base_uom_id=payload.base_uom_id, factor=payload.factor,
    )
    db.add(uom)
    db.commit()
    db.refresh(uom)
    return uom


def list_uoms(db: Session, company_id: int) -> List[UnitOfMeasure]:
    return (
        db.query(UnitOfMeasure)
        .filter(UnitOfMeasure.company_id == company_id)
        .order_by(UnitOfMeasure.code)
        .all()
    )


def create_variant(db: Session, company_id: int, product_id: int, payload: VariantCreate) -> ProductVariant:
    product = get_product(db, company_id, product_id)
    clash = (
        db.query(ProductVariant)
        .filter(ProductVariant.product_id == product.id, ProductVariant.sku == payload.sku)
        .one_or_none()
    )
    if clash is not None:
        raise HTTPException(status_code=409, detail=f"SKU '{payload.sku}' already exists for this product.")
    if payload.sell_uom_id is not None:
        uom = (
            db.query(UnitOfMeasure)
            .filter(UnitOfMeasure.id == payload.sell_uom_id, UnitOfMeasure.company_id == company_id)
            .one_or_none()
        )
        if uom is None:
            raise HTTPException(status_code=404, detail=f"Unit of measure {payload.sell_uom_id} not found")
    if payload.is_default:
        db.query(ProductVariant).filter(ProductVariant.product_id == product.id).update({"is_default": False})
    variant = ProductVariant(
        product_id=product.id,
        sku=payload.sku,
        barcode=payload.barcode,
        unit_price=payload.unit_price,
        currency=payload.currency or "MUR",
        is_default=payload.is_default,
        sell_uom_id=payload.sell_uom_id,
        status="active",
    )
    db.add(variant)
    db.flush()
    for ov_id in payload.option_value_ids or []:
        ov = (
            db.query(OptionValue)
            .filter(OptionValue.id == ov_id)
            .one_or_none()
        )
        if ov is None:
            raise HTTPException(status_code=404, detail=f"Option value {ov_id} not found")
        db.add(ProductVariantOptionValue(variant_id=variant.id, option_value_id=ov_id))
    db.commit()
    db.refresh(variant)
    return variant


def create_price(db: Session, company_id: int, payload: ProductPriceCreate) -> ProductPrice:
    variant = get_variant(db, company_id, payload.variant_id)
    price = ProductPrice(
        company_id=company_id,
        variant_id=variant.id,
        product_id=variant.product_id,
        amount=payload.amount,
        currency=payload.currency or variant.currency or "MUR",
        territory=payload.territory,
        effective_from=payload.effective_from,
        effective_to=payload.effective_to,
    )
    db.add(price)
    db.commit()
    db.refresh(price)
    return price


def list_prices(db: Session, company_id: int, variant_id: int) -> List[ProductPrice]:
    get_variant(db, company_id, variant_id)
    return (
        db.query(ProductPrice)
        .filter(ProductPrice.company_id == company_id, ProductPrice.variant_id == variant_id)
        .order_by(ProductPrice.effective_from.desc().nullslast())
        .all()
    )


def resolve_price(
    db: Session, company_id: int, variant_id: int, *, territory: Optional[str] = None, on_date=None
) -> Optional[Decimal]:
    """The effective price for a variant on a date (optionally per territory),
    falling back to the variant's inline price."""
    q = db.query(ProductPrice).filter(
        ProductPrice.company_id == company_id, ProductPrice.variant_id == variant_id
    )
    if territory is not None:
        q = q.filter(ProductPrice.territory == territory)
    rows = q.all()
    on_date = on_date or datetime.now(timezone.utc).date()
    candidates = [
        p for p in rows
        if (p.effective_from is None or p.effective_from <= on_date)
        and (p.effective_to is None or p.effective_to >= on_date)
    ]
    if candidates:
        candidates.sort(key=lambda p: (p.effective_from or datetime.min.date()), reverse=True)
        return Decimal(candidates[0].amount)
    variant = db.query(ProductVariant).filter(ProductVariant.id == variant_id).one_or_none()
    return Decimal(variant.unit_price) if variant is not None else None


def create_target(db: Session, company_id: int, payload: SalesTargetCreate) -> SalesTarget:
    if payload.period_end < payload.period_start:
        raise HTTPException(status_code=422, detail="period_end must be on or after period_start")
    _assert_rep_in_company(db, company_id, payload.private_user_id)
    if payload.target_amount is None and payload.target_units is None:
        raise HTTPException(status_code=422, detail="Set target_amount and/or target_units.")
    target = SalesTarget(company_id=company_id, **payload.model_dump())
    db.add(target)
    db.commit()
    db.refresh(target)
    return target


def list_targets(db: Session, company_id: int, private_user_id: Optional[int] = None) -> List[SalesTarget]:
    q = db.query(SalesTarget).filter(SalesTarget.company_id == company_id)
    if private_user_id is not None:
        q = q.filter(SalesTarget.private_user_id == private_user_id)
    return q.order_by(SalesTarget.period_start.desc()).all()


# ---------------------------------------------------------------------------
# Phase 2 — leaderboards
# ---------------------------------------------------------------------------


def leaderboard(
    db: Session, company_id: int, period_start: datetime, period_end: datetime
) -> List[dict]:
    """Approved sales value per credited rep for the period, highest first."""
    from sqlalchemy import func as _func

    rows = (
        db.query(
            Sale.credited_to_private_user_id,
            Sale.rep_private_user_id,
            _func.coalesce(_func.sum(SaleLine.line_total), 0),
        )
        .join(SaleLine, SaleLine.sale_id == Sale.id)
        .filter(
            Sale.company_id == company_id,
            Sale.status == "approved",
            Sale.sold_at >= period_start,
            Sale.sold_at <= period_end,
        )
        .group_by(Sale.credited_to_private_user_id, Sale.rep_private_user_id)
        .all()
    )
    totals: dict = {}
    for credited, rep, total in rows:
        pid = credited or rep
        totals[pid] = totals.get(pid, Decimal("0.00")) + Decimal(total or 0)
    names = {
        p.private_user_id: f"{(p.first_name or '').strip()} {(p.last_name or '').strip()}".strip()
        for p in db.query(PrivateUser).filter(PrivateUser.private_user_id.in_(list(totals.keys()) or [0])).all()
    }
    ordered = sorted(totals.items(), key=lambda kv: kv[1], reverse=True)
    return [
        {"private_user_id": pid, "name": names.get(pid) or None, "amount": _q_plain(total)}
        for pid, total in ordered
    ]


def _q_plain(amount) -> Decimal:
    return Decimal(amount or 0).quantize(Decimal("0.01"))


# ---------------------------------------------------------------------------
# Phase 2 — liability accrual
# ---------------------------------------------------------------------------


def liability_accrual(db: Session, company_id: int) -> dict:
    """Earned-but-unpaid commission, split by why it hasn't hit a payslip yet:

      * pending_payroll — approved payables not yet pushed to payroll;
      * settled_pending_payslip — pushed (settled) payables whose one-off
        allowance is created but not yet applied to a finalized payslip.
    """
    payables = (
        db.query(CommissionPayable)
        .filter(
            CommissionPayable.company_id == company_id,
            CommissionPayable.status.in_(("pending", "settled")),
        )
        .all()
    )
    pending_total = Decimal("0.00")
    settled_total = Decimal("0.00")
    currency = "MUR"
    for p in payables:
        currency = p.currency or currency
        amount = Decimal(p.amount or 0)
        if p.status == "pending":
            pending_total += amount
            continue
        if p.one_off_allowance_id is None:
            # Settled but no allowance (manual channel): still outstanding.
            settled_total += amount
            continue
        one_off = (
            db.query(EmployeeOneOffAllowance)
            .filter(EmployeeOneOffAllowance.id == p.one_off_allowance_id)
            .one_or_none()
        )
        if one_off is None or one_off.applied_to_payslip_id is None:
            settled_total += amount

    pending_total = _q_plain(pending_total)
    settled_total = _q_plain(settled_total)
    return {
        "company_id": company_id,
        "pending_payroll": pending_total,
        "settled_pending_payslip": settled_total,
        "total_outstanding": _q_plain(pending_total + settled_total),
        "currency": currency,
    }


# ---------------------------------------------------------------------------
# Phase 3 — credit assignments (territory / outlet / account → rep)
# ---------------------------------------------------------------------------


def create_credit_assignment(
    db: Session, company_id: int, payload: CreditAssignmentCreate
) -> CreditAssignment:
    _assert_rep_in_company(db, company_id, payload.private_user_id)
    if payload.outlet_id is None and not payload.territory and not payload.account:
        raise HTTPException(
            status_code=422,
            detail="A credit assignment needs at least one of outlet_id, territory or account.",
        )
    if payload.outlet_id is not None:
        get_outlet(db, company_id, payload.outlet_id)
    rule = CreditAssignment(company_id=company_id, **payload.model_dump())
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


def list_credit_assignments(
    db: Session, company_id: int, private_user_id: Optional[int] = None
) -> List[CreditAssignment]:
    q = db.query(CreditAssignment).filter(CreditAssignment.company_id == company_id)
    if private_user_id is not None:
        q = q.filter(CreditAssignment.private_user_id == private_user_id)
    return q.order_by(CreditAssignment.id).all()


def delete_credit_assignment(db: Session, company_id: int, assignment_id: int) -> None:
    row = (
        db.query(CreditAssignment)
        .filter(CreditAssignment.id == assignment_id, CreditAssignment.company_id == company_id)
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=404, detail=f"Credit assignment {assignment_id} not found")
    db.delete(row)
    db.commit()


# ---------------------------------------------------------------------------
# Phase 3.1 — returns / credit-notes
# ---------------------------------------------------------------------------


def create_sales_return(
    db: Session, company_id: int, payload: SalesReturnCreate, created_by_user_id: Optional[int] = None
) -> SalesReturn:
    """Record a (possibly partial) return against an approved sale. Validates
    that no line is returned beyond what was sold, snapshotting the original
    line price — so the return flows forward as a negative commission."""
    sale = get_sale(db, company_id, payload.sale_id)
    if sale.status != "approved":
        raise HTTPException(status_code=409, detail="Only approved sales can be returned.")

    sale_lines = {sl.id: sl for sl in sale.lines}
    already_returned = _returned_qty_by_sale_line(db, [sl.id for sl in sale.lines])

    ret = SalesReturn(
        company_id=company_id,
        sale_id=sale.id,
        returned_at=payload.returned_at,
        reason=payload.reason,
        currency=sale.currency,
        created_by_user_id=created_by_user_id,
    )
    db.add(ret)
    db.flush()

    for req in payload.lines:
        sale_line = sale_lines.get(req.sale_line_id)
        if sale_line is None:
            raise HTTPException(
                status_code=422,
                detail=f"Sale line {req.sale_line_id} does not belong to sale {sale.id}.",
            )
        remaining = Decimal(sale_line.quantity) - already_returned.get(sale_line.id, Decimal("0"))
        if req.quantity > remaining:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Returning {req.quantity} exceeds the {remaining} still-returnable on "
                    f"line {sale_line.id}."
                ),
            )
        db.add(SalesReturnLine(
            return_id=ret.id,
            sale_line_id=sale_line.id,
            variant_id=sale_line.variant_id,
            quantity=req.quantity,
            unit_price_snapshot=sale_line.unit_price_snapshot,
            line_total=Decimal(req.quantity) * Decimal(sale_line.unit_price_snapshot),
        ))
        already_returned[sale_line.id] = already_returned.get(sale_line.id, Decimal("0")) + req.quantity

    db.commit()
    db.refresh(ret)
    return ret


def _returned_qty_by_sale_line(db: Session, sale_line_ids: List[int]) -> dict:
    if not sale_line_ids:
        return {}
    rows = (
        db.query(SalesReturnLine.sale_line_id, SalesReturnLine.quantity)
        .filter(SalesReturnLine.sale_line_id.in_(sale_line_ids))
        .all()
    )
    totals: dict = {}
    for sale_line_id, qty in rows:
        totals[sale_line_id] = totals.get(sale_line_id, Decimal("0")) + Decimal(qty)
    return totals


def list_sales_returns(
    db: Session, company_id: int, sale_id: Optional[int] = None
) -> List[SalesReturn]:
    q = db.query(SalesReturn).filter(SalesReturn.company_id == company_id)
    if sale_id is not None:
        q = q.filter(SalesReturn.sale_id == sale_id)
    return q.order_by(SalesReturn.returned_at.desc()).all()


# ---------------------------------------------------------------------------
# Phase 3 — ERP reconcile (dry-run)
# ---------------------------------------------------------------------------


def reconcile_external_sales(db: Session, company_id: int, items: List, commit: bool = False) -> dict:
    """Match an external feed (SAP/Odoo/QuickBooks export) against the catalog
    and existing sales. Dry-run by default; with `commit=True` it creates an
    approved sale for every new, well-formed row (idempotent on `client_uuid`
    `erp:<external_id>`, so replaying the feed never double-posts)."""
    new = duplicates = unmatched_sku = created = 0
    unmatched: List[dict] = []
    for item in items:
        rep_id = getattr(item, "rep_private_user_id", None)
        if rep_id is None and commit:
            unmatched_sku += 1
            unmatched.append({"external_id": item.external_id, "reason": "rep_private_user_id required to import"})
            continue
        if rep_id is not None:
            try:
                _assert_rep_in_company(db, company_id, rep_id)
            except HTTPException:
                unmatched_sku += 1
                unmatched.append({"external_id": item.external_id, "reason": "rep_not_in_company"})
                continue
        variant = (
            db.query(ProductVariant)
            .join(Product, Product.id == ProductVariant.product_id)
            .filter(Product.company_id == company_id, ProductVariant.sku == item.sku)
            .one_or_none()
        )
        if variant is None:
            unmatched_sku += 1
            unmatched.append({"external_id": item.external_id, "reason": f"unknown sku {item.sku}"})
            continue
        existing = (
            db.query(Sale)
            .filter(Sale.company_id == company_id, Sale.client_uuid == f"erp:{item.external_id}")
            .one_or_none()
        )
        if existing is not None:
            duplicates += 1
            continue
        new += 1
        if commit:
            price = Decimal(variant.unit_price or 0)
            sale = Sale(
                company_id=company_id,
                rep_private_user_id=rep_id,
                sold_at=item.sold_at,
                status="approved",
                source="import",
                client_uuid=f"erp:{item.external_id}",
                currency=variant.currency or "MUR",
            )
            db.add(sale)
            db.flush()
            db.add(SaleLine(
                sale_id=sale.id,
                variant_id=variant.id,
                quantity=item.quantity,
                unit_price_snapshot=price,
                line_total=Decimal(item.quantity) * price,
            ))
            created += 1
    if commit:
        db.commit()
    return {
        "received": len(items),
        "new": new,
        "duplicates": duplicates,
        "unmatched_sku": unmatched_sku,
        "created": created,
        "unmatched": unmatched,
    }
