"""CRUD for the Field Sales & Commissions module (Phase 0).

Everything is tenant-scoped by `company_id`. Callers (the API layer) resolve and
authorize the company first; this module assumes a valid company and focuses on
persistence + invariants:

  * a product always has at least one (default) variant;
  * a sale line snapshots its unit price at sale time (never re-read later);
  * a product/variant referenced by a sale can never be hard-deleted.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload, selectinload

from core.company_user_role import CompanyUserRole
from core.roles import CompanyRole
from core.model import (
    CommissionLineItem,
    CommissionPayable,
    CommissionPlan,
    CommissionPlanAssignment,
    CommissionRule,
    CommissionRun,
    Company,
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
    User,
)
from schema.field_sales_schema import (
    CommissionPlanCreate,
    CommissionPlanRevise,
    CreditAssignmentCreate,
    OutletCreate,
    SalesReturnCreate,
    OutletUpdate,
    ProductCategoryCreate,
    ProductCategoryUpdate,
    ProductCreate,
    ProductOptionCreate,
    ProductPriceCreate,
    ProductUpdate,
    SaleCreate,
    SaleSyncItem,
    SaleUpdate,
    SalesTargetCreate,
    UnitOfMeasureCreate,
    VariantCreate,
    VariantUpdate,
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


def _company_currency(db: Session, company_id: int) -> str:
    """The company's operating currency (derived from its country), so a sale
    captured without an explicit currency is labelled correctly for a non-MU
    company instead of defaulting to MUR."""
    company = db.get(Company, company_id)
    return (company.currency if company and company.currency else None) or "MUR"


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
        payment_method=payload.payment_method,
        collected_amount=payload.collected_amount,
        collected_at=payload.collected_at,
        currency=payload.currency or _company_currency(db, company_id),
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
        if line.unit_price is not None:
            unit_price = Decimal(line.unit_price)
        else:
            # Effective-dated price for the sale date, falling back to the
            # variant's inline unit_price when no price row applies (Step B1).
            unit_price = resolve_price(
                db, company_id, variant.id, on_date=payload.sold_at.date()
            )
            if unit_price is None:
                unit_price = Decimal(variant.unit_price)
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


def _sale_read_options():
    """Loader chain so SaleRead can render *what* was sold without N+1: lines →
    variant → product/sell_uom. Cheap for the small page sizes these endpoints
    return."""
    return [
        joinedload(Sale.lines)
        .joinedload(SaleLine.variant)
        .joinedload(ProductVariant.product),
        joinedload(Sale.lines)
        .joinedload(SaleLine.variant)
        .joinedload(ProductVariant.sell_uom),
    ]


def list_sales(
    db: Session,
    company_id: int,
    *,
    period_start: Optional[datetime] = None,
    period_end: Optional[datetime] = None,
    rep_private_user_id: Optional[int] = None,
    sale_status: Optional[str] = None,
    outlet_id: Optional[int] = None,
    payment_status: Optional[str] = None,
    payment_method: Optional[str] = None,
    search: Optional[str] = None,
    limit: Optional[int] = None,
    rep_private_user_ids: Optional[List[int]] = None,
    offset: int = 0,
) -> List[Sale]:
    q = (
        db.query(Sale)
        .options(*_sale_read_options())
        .filter(Sale.company_id == company_id)
    )
    if period_start is not None:
        q = q.filter(Sale.sold_at >= period_start)
    if period_end is not None:
        q = q.filter(Sale.sold_at <= period_end)
    if rep_private_user_id is not None:
        q = q.filter(Sale.rep_private_user_id == rep_private_user_id)
    if rep_private_user_ids is not None:
        q = q.filter(Sale.rep_private_user_id.in_(rep_private_user_ids))
    if sale_status is not None:
        q = q.filter(Sale.status == sale_status)
    if outlet_id is not None:
        q = q.filter(Sale.outlet_id == outlet_id)
    if payment_status is not None:
        q = q.filter(Sale.payment_status == payment_status)
    if payment_method is not None:
        q = q.filter(Sale.payment_method == payment_method)
    if search:
        # Free-text across notes and the sold product names/SKUs. EXISTS keeps
        # it a single indexed query rather than post-filtering in Python.
        like = f"%{search.strip()}%"
        q = q.filter(
            or_(
                Sale.notes.ilike(like),
                Sale.lines.any(
                    SaleLine.variant.has(
                        or_(
                            ProductVariant.sku.ilike(like),
                            ProductVariant.barcode.ilike(like),
                            ProductVariant.product.has(Product.name.ilike(like)),
                        )
                    )
                ),
            )
        )
    q = q.order_by(Sale.sold_at.desc(), Sale.id.desc())
    if offset:
        q = q.offset(offset)
    if limit is not None:
        q = q.limit(limit)
    return q.all()


def count_sales(
    db: Session,
    company_id: int,
    *,
    period_start: Optional[datetime] = None,
    period_end: Optional[datetime] = None,
    rep_private_user_id: Optional[int] = None,
    sale_status: Optional[str] = None,
    outlet_id: Optional[int] = None,
    payment_status: Optional[str] = None,
    payment_method: Optional[str] = None,
    search: Optional[str] = None,
    rep_private_user_ids: Optional[List[int]] = None,
) -> int:
    """Cheap COUNT matching the same filters as list_sales — powers the pager."""
    q = db.query(Sale).filter(Sale.company_id == company_id)
    if period_start is not None:
        q = q.filter(Sale.sold_at >= period_start)
    if period_end is not None:
        q = q.filter(Sale.sold_at <= period_end)
    if rep_private_user_id is not None:
        q = q.filter(Sale.rep_private_user_id == rep_private_user_id)
    if rep_private_user_ids is not None:
        q = q.filter(Sale.rep_private_user_id.in_(rep_private_user_ids))
    if sale_status is not None:
        q = q.filter(Sale.status == sale_status)
    if outlet_id is not None:
        q = q.filter(Sale.outlet_id == outlet_id)
    if payment_status is not None:
        q = q.filter(Sale.payment_status == payment_status)
    if payment_method is not None:
        q = q.filter(Sale.payment_method == payment_method)
    if search:
        like = f"%{search.strip()}%"
        q = q.filter(
            or_(
                Sale.notes.ilike(like),
                Sale.lines.any(
                    SaleLine.variant.has(
                        or_(
                            ProductVariant.sku.ilike(like),
                            ProductVariant.barcode.ilike(like),
                            ProductVariant.product.has(Product.name.ilike(like)),
                        )
                    )
                ),
            )
        )
    return q.count()


def get_sale(db: Session, company_id: int, sale_id: int) -> Sale:
    sale = (
        db.query(Sale)
        .options(*_sale_read_options())
        .filter(Sale.id == sale_id, Sale.company_id == company_id)
        .one_or_none()
    )
    if sale is None:
        raise HTTPException(status_code=404, detail=f"Sale {sale_id} not found")
    return sale


def update_sale(db: Session, company_id: int, sale_id: int, payload: SaleUpdate) -> Sale:
    """Edit a sale's *attributes* (payment, outlet, notes). Line items are
    immutable by design — see SaleUpdate. A switch to `paid` without an explicit
    collected_amount backfills it from the line totals; `collected_at` is only
    stamped when the sale is (or becomes) fully paid."""
    sale = get_sale(db, company_id, sale_id)
    if sale.status == "void":
        raise HTTPException(status_code=409, detail="Voided sales can't be edited — reopen it first.")

    data = payload.model_dump(exclude_unset=True)

    if "outlet_id" in data and data["outlet_id"] is not None:
        get_outlet(db, company_id, data["outlet_id"])

    for field in ("payment_status", "payment_method", "outlet_id", "notes"):
        if field in data:
            setattr(sale, field, data[field])

    if "collected_amount" in data:
        sale.collected_amount = data["collected_amount"]

    if sale.payment_status == "paid":
        if sale.collected_amount is None:
            sale.collected_amount = sum(
                (Decimal(l.line_total) for l in sale.lines), Decimal("0.00")
            )
        if sale.collected_at is None:
            sale.collected_at = datetime.now(timezone.utc)
    else:
        # Moving off `paid` clears the collection stamp so it can't imply money
        # was taken. Keep any partial collected_amount the admin typed.
        sale.collected_at = None

    db.commit()
    db.refresh(sale)
    return sale


def reopen_sale(db: Session, company_id: int, sale_id: int, *, target_status: str = "approved") -> Sale:
    """Re-version a voided sale. The original pre-void status isn't retained, so
    the caller chooses: `approved` (admin-entered) or `submitted` (back to the
    review queue)."""
    if target_status not in ("approved", "submitted"):
        raise HTTPException(status_code=422, detail="Reopen target must be 'approved' or 'submitted'.")
    sale = get_sale(db, company_id, sale_id)
    if sale.status != "void":
        raise HTTPException(status_code=409, detail="Only voided sales can be reopened.")
    sale.status = target_status
    sale.reviewed_by_user_id = None
    sale.reviewed_at = None
    db.commit()
    db.refresh(sale)
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


def _maker_checker(db: Session, company_id: int) -> bool:
    """True when this company has opted into Field Sales segregation of duties."""
    row = (
        db.query(Company.field_sales_maker_checker)
        .filter(Company.company_id == company_id)
        .first()
    )
    return bool(row[0]) if row is not None else False


def _norm_role(name) -> str:
    return str(name).strip().lower().replace(" ", "_")


def _admin_role_names() -> set:
    names = {_norm_role(getattr(r, "value", r)) for r in CompanyRole.admin_roles()}
    try:
        from core.permission_guards import _SEEDED_COMPANY_ADMIN_ROLE_NAMES

        names |= {_norm_role(n) for n in _SEEDED_COMPANY_ADMIN_ROLE_NAMES}
    except Exception:
        pass
    return names


def count_company_admins(db: Session, company_id: int) -> int:
    """Enabled users holding an admin-level company role (owner included).

    Used to gate switching maker-checker on: a company with one admin could
    never satisfy `approved_by != created_by`, so the flag would deadlock it.
    """
    company = db.query(Company).filter(Company.company_id == company_id).one_or_none()
    if company is None:
        return 0

    admin_names = _admin_role_names()
    user_ids = set()
    if company.user_id:
        user_ids.add(company.user_id)

    privates = (
        db.query(PrivateUser.private_user_id, PrivateUser.user_id, PrivateUser.role)
        .filter(PrivateUser.company_id == company_id)
        .all()
    )
    private_to_user = {}
    for pu_id, user_id, role in privates:
        private_to_user[pu_id] = user_id
        if _norm_role(role) in admin_names:
            user_ids.add(user_id)

    for pu_id, role in (
        db.query(CompanyUserRole.private_user_id, CompanyUserRole.role)
        .filter(CompanyUserRole.company_id == company_id)
        .all()
    ):
        if _norm_role(role) in admin_names and pu_id in private_to_user:
            user_ids.add(private_to_user[pu_id])

    if not user_ids:
        return 0
    return (
        db.query(User)
        .filter(User.user_id.in_(user_ids), User.user_enabled.is_(True))
        .count()
    )


def _add_rules(db: Session, plan_id: int, rules) -> None:
    for rule in rules:
        _validate_rule(rule.rule_type, rule.params)
        db.add(
            CommissionRule(
                plan_id=plan_id,
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


def create_plan(
    db: Session,
    company_id: int,
    payload: CommissionPlanCreate,
    created_by_user_id: Optional[int] = None,
) -> CommissionPlan:
    clash = (
        db.query(CommissionPlan)
        .filter(
            CommissionPlan.company_id == company_id,
            CommissionPlan.name == payload.name,
            CommissionPlan.version == 1,
        )
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
        # Maker-checker: a new plan waits for a second admin to activate it.
        status="pending" if _maker_checker(db, company_id) else "active",
        version=1,
        effective_from=payload.effective_from,
        created_by_user_id=created_by_user_id,
    )
    db.add(plan)
    db.flush()
    # Root row is its own family; assignments and versions reference this id.
    plan.family_id = plan.id
    _add_rules(db, plan.id, payload.rules)
    db.flush()
    db.commit()
    db.refresh(plan)
    return plan


def _family_root_id(db: Session, company_id: int, plan_id: int) -> int:
    """Resolve any version id to the family root id (assignments target the
    root; the engine resolves the effective version from there)."""
    plan = (
        db.query(CommissionPlan)
        .filter(CommissionPlan.id == plan_id, CommissionPlan.company_id == company_id)
        .one_or_none()
    )
    if plan is None:
        raise HTTPException(status_code=404, detail=f"Commission plan {plan_id} not found")
    return plan.family_id or plan.id


def list_plan_versions(db: Session, company_id: int, plan_id: int) -> List[CommissionPlan]:
    root = _family_root_id(db, company_id, plan_id)
    return (
        db.query(CommissionPlan)
        .options(joinedload(CommissionPlan.rules))
        .filter(CommissionPlan.company_id == company_id, CommissionPlan.family_id == root)
        .order_by(CommissionPlan.version.desc())
        .all()
    )


def revise_plan(
    db: Session,
    company_id: int,
    plan_id: int,
    payload: CommissionPlanRevise,
    created_by_user_id: Optional[int] = None,
) -> CommissionPlan:
    """Copy-on-write: clone the family's current version into a new `draft`
    version. A used version is never mutated, so historical pay is stable.
    Rules are replaced wholesale (not inherited) when provided."""
    root = _family_root_id(db, company_id, plan_id)
    current = (
        db.query(CommissionPlan)
        .options(joinedload(CommissionPlan.rules))
        .filter(CommissionPlan.id == root)
        .one()
    )
    if current.archived_at is not None or current.status == "archived":
        raise HTTPException(
            status_code=409, detail=f"Commission plan {root} is archived and cannot be revised."
        )
    versions = (
        db.query(CommissionPlan)
        .filter(CommissionPlan.company_id == company_id, CommissionPlan.family_id == root)
        .all()
    )
    next_version = max((v.version or 1) for v in versions) + 1

    name = payload.name or current.name
    clash = (
        db.query(CommissionPlan)
        .filter(
            CommissionPlan.company_id == company_id,
            CommissionPlan.name == name,
            CommissionPlan.version == next_version,
        )
        .one_or_none()
    )
    if clash is not None:
        raise HTTPException(
            status_code=409,
            detail=f"A commission plan named '{name}' version {next_version} already exists.",
        )

    new_plan = CommissionPlan(
        company_id=company_id,
        name=name,
        description=payload.description if payload.description is not None else current.description,
        trigger=payload.trigger or current.trigger,
        status="pending" if _maker_checker(db, company_id) else "draft",
        version=next_version,
        family_id=root,
        effective_from=payload.effective_from,
        created_by_user_id=created_by_user_id,
    )
    db.add(new_plan)
    db.flush()

    if payload.rules is not None:
        _add_rules(db, new_plan.id, payload.rules)
    else:
        for rule in current.rules:
            db.add(
                CommissionRule(
                    plan_id=new_plan.id,
                    rule_type=rule.rule_type,
                    params=dict(rule.params or {}),
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
    db.refresh(new_plan)
    return new_plan


def activate_plan(
    db: Session,
    company_id: int,
    plan_id: int,
    *,
    approved_by_user_id: Optional[int] = None,
    effective_from: Optional[date] = None,
) -> CommissionPlan:
    """Activate a draft version and supersede the currently-active sibling
    (its `effective_to` is closed the day before this version takes effect)."""
    plan = (
        db.query(CommissionPlan)
        .options(joinedload(CommissionPlan.rules))
        .filter(CommissionPlan.id == plan_id, CommissionPlan.company_id == company_id)
        .one_or_none()
    )
    if plan is None:
        raise HTTPException(status_code=404, detail=f"Commission plan {plan_id} not found")
    if plan.archived_at is not None or plan.status == "archived":
        raise HTTPException(
            status_code=409, detail=f"Commission plan {plan_id} is archived and cannot be activated."
        )
    if (
        _maker_checker(db, company_id)
        and plan.created_by_user_id is not None
        and approved_by_user_id == plan.created_by_user_id
    ):
        raise HTTPException(
            status_code=403,
            detail="Maker-checker is on: a different admin must activate this version.",
        )
    root = plan.family_id or plan.id
    start = effective_from or plan.effective_from or date.today()

    siblings = (
        db.query(CommissionPlan)
        .filter(
            CommissionPlan.company_id == company_id,
            CommissionPlan.family_id == root,
            CommissionPlan.id != plan.id,
            CommissionPlan.status == "active",
            CommissionPlan.archived_at.is_(None),
        )
        .all()
    )
    for prior in siblings:
        prior.effective_to = start - timedelta(days=1)

    plan.status = "active"
    plan.effective_from = start
    plan.effective_to = None
    plan.approved_by_user_id = approved_by_user_id
    plan.approved_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(plan)
    return plan


def archive_plan(db: Session, company_id: int, plan_id: int) -> CommissionPlan:
    """Archive the whole plan family. Archiving a single row would leave the
    family's other active versions paying, so every version is retired — the
    returned row is the family root."""
    root_id = _family_root_id(db, company_id, plan_id)
    now = datetime.now(timezone.utc)
    plans = (
        db.query(CommissionPlan)
        .filter(CommissionPlan.company_id == company_id, CommissionPlan.family_id == root_id)
        .all()
    )
    root = None
    for p in plans:
        p.status = "archived"
        p.archived_at = now
        if p.id == root_id:
            root = p
    db.commit()
    if root is not None:
        db.refresh(root)
        return root
    return get_plan(db, company_id, plan_id)


def effective_plan_version(
    db: Session,
    plan_id: int,
    period_start: date,
    period_end: date,
    cache: Optional[dict] = None,
) -> Optional[CommissionPlan]:
    """The version of the plan family effective for a run period. Among
    versions whose window covers the period, the latest `effective_from`
    (NULL == open start, i.e. oldest) wins; ties break on higher `version`.

    `plan_id` is the family root (assignments target the root). The optional
    `cache` is keyed by `(root, period_start, period_end)` so a caller that
    spans several periods (e.g. a season roll-up) can't get a stale hit."""
    cache_key = (plan_id, period_start, period_end)
    if cache is not None and cache_key in cache:
        return cache[cache_key]

    plans = (
        db.query(CommissionPlan)
        .options(joinedload(CommissionPlan.rules))
        .filter(
            CommissionPlan.family_id == plan_id,
            CommissionPlan.status == "active",
            CommissionPlan.archived_at.is_(None),
        )
        .all()
    )
    best: Optional[CommissionPlan] = None
    best_key = None
    for p in plans:
        if p.effective_from is not None and p.effective_from > period_end:
            continue
        if p.effective_to is not None and p.effective_to < period_start:
            continue
        key = (p.effective_from or date.min, p.version or 1)
        if best is None or key >= best_key:
            best, best_key = p, key
    if cache is not None:
        cache[cache_key] = best
    return best


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


def _representative_rank(plan: CommissionPlan):
    """Pick the row that best represents a family in listings: the currently
    effective active version, else the newest version."""
    return (
        1 if plan.status == "active" else 0,
        1 if plan.effective_to is None else 0,
        plan.version or 1,
    )


def list_plans(db: Session, company_id: int, include_archived: bool = False) -> List[CommissionPlan]:
    q = (
        db.query(CommissionPlan)
        .options(joinedload(CommissionPlan.rules))
        .filter(CommissionPlan.company_id == company_id)
    )
    if not include_archived:
        q = q.filter(CommissionPlan.archived_at.is_(None))
    rows = q.all()

    representatives: dict = {}
    for plan in rows:
        key = plan.family_id or plan.id
        current = representatives.get(key)
        if current is None or _representative_rank(plan) >= _representative_rank(current):
            representatives[key] = plan
    return sorted(representatives.values(), key=lambda p: p.name)


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
    # Assignments always target the family root; the engine resolves the
    # version effective for the run period from there.
    root_id = _family_root_id(db, company_id, plan_id)
    _assert_rep_in_company(db, company_id, private_user_id)

    existing = (
        db.query(CommissionPlanAssignment)
        .filter(
            CommissionPlanAssignment.plan_id == root_id,
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
        plan_id=root_id,
        private_user_id=private_user_id,
        effective_from=effective_from,
        effective_to=effective_to,
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    return assignment


def list_assignments(db: Session, company_id: int, plan_id: int) -> List[CommissionPlanAssignment]:
    root_id = _family_root_id(db, company_id, plan_id)
    return (
        db.query(CommissionPlanAssignment)
        .filter(CommissionPlanAssignment.plan_id == root_id)
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
                payment_method=item.payment_method,
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
        .options(*_sale_read_options())
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


def review_sales_bulk(
    db: Session,
    company_id: int,
    sale_ids: List[int],
    decision: str,
    reviewer_user_id: int,
    notes: Optional[str] = None,
) -> dict:
    """Best-effort batch review. Each sale is committed on its own so one bad
    id (e.g. already void, or another company) can't sink the whole batch."""
    if decision not in ("approve", "reject"):
        raise HTTPException(status_code=422, detail="decision must be 'approve' or 'reject'")
    results: List[dict] = []
    succeeded = 0
    for sale_id in sale_ids:
        try:
            sale = review_sale(db, company_id, sale_id, decision, reviewer_user_id, notes)
            succeeded += 1
            results.append({"sale_id": sale_id, "ok": True, "status": sale.status})
        except HTTPException as exc:
            db.rollback()
            results.append({"sale_id": sale_id, "ok": False, "detail": str(exc.detail)})
    return {
        "decision": decision,
        "succeeded": succeeded,
        "failed": len(sale_ids) - succeeded,
        "results": results,
    }


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


def create_price(
    db: Session,
    company_id: int,
    payload: ProductPriceCreate,
    created_by_user_id: Optional[int] = None,
) -> ProductPrice:
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
        # Maker-checker: a pending price does not resolve until approved.
        status="pending" if _maker_checker(db, company_id) else "active",
        created_by_user_id=created_by_user_id,
    )
    db.add(price)
    db.commit()
    db.refresh(price)
    return price


def _get_price(db: Session, company_id: int, price_id: int) -> ProductPrice:
    price = (
        db.query(ProductPrice)
        .filter(ProductPrice.company_id == company_id, ProductPrice.id == price_id)
        .one_or_none()
    )
    if price is None:
        raise HTTPException(status_code=404, detail=f"Product price {price_id} not found")
    return price


def approve_price(db: Session, company_id: int, price_id: int, *, approved_by_user_id: int) -> ProductPrice:
    """Approve a pending price version. The approver must differ from its
    creator when maker-checker is on (403 otherwise)."""
    price = _get_price(db, company_id, price_id)
    if price.status == "active":
        return price
    if (
        _maker_checker(db, company_id)
        and price.created_by_user_id is not None
        and price.created_by_user_id == approved_by_user_id
    ):
        raise HTTPException(
            status_code=403,
            detail="Maker-checker is on: a different admin must approve this price.",
        )
    price.status = "active"
    price.approved_by_user_id = approved_by_user_id
    price.approved_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(price)
    return price


def reject_price(db: Session, company_id: int, price_id: int, *, rejected_by_user_id: int) -> ProductPrice:
    price = _get_price(db, company_id, price_id)
    if price.status == "active":
        raise HTTPException(status_code=409, detail="An active price cannot be rejected.")
    if (
        _maker_checker(db, company_id)
        and price.created_by_user_id is not None
        and price.created_by_user_id == rejected_by_user_id
    ):
        raise HTTPException(
            status_code=403,
            detail="Maker-checker is on: a different admin must reject this price.",
        )
    price.status = "rejected"
    price.approved_by_user_id = rejected_by_user_id
    price.approved_at = datetime.now(timezone.utc)
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
        ProductPrice.company_id == company_id,
        ProductPrice.variant_id == variant_id,
        ProductPrice.status == "active",
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
            price = resolve_price(
                db, company_id, variant.id, on_date=item.sold_at.date()
            )
            if price is None:
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


# ---------------------------------------------------------------------------
# Catalog editing & deletion
#
# Invariant (module docstring): a product/variant referenced by a sale line can
# never be hard-deleted — we 409 and direct the caller to archive instead. Sale
# history must stay reproducible (SaleLine snapshots prices and points at a
# variant row).
# ---------------------------------------------------------------------------


def _variant_reference_count(db: Session, variant_id: int) -> int:
    return db.query(SaleLine).filter(SaleLine.variant_id == variant_id).count()


def update_category(
    db: Session, company_id: int, category_id: int, payload: ProductCategoryUpdate
) -> ProductCategory:
    cat = (
        db.query(ProductCategory)
        .filter(ProductCategory.id == category_id, ProductCategory.company_id == company_id)
        .one_or_none()
    )
    if cat is None:
        raise HTTPException(status_code=404, detail=f"Category {category_id} not found")

    data = payload.model_dump(exclude_unset=True)
    new_parent = data.get("parent_id", cat.parent_id)
    if "parent_id" in data and data["parent_id"] is not None:
        if data["parent_id"] == category_id:
            raise HTTPException(status_code=400, detail="A category cannot be its own parent.")
        parent = (
            db.query(ProductCategory)
            .filter(ProductCategory.id == data["parent_id"], ProductCategory.company_id == company_id)
            .one_or_none()
        )
        if parent is None:
            raise HTTPException(status_code=404, detail=f"Parent category {data['parent_id']} not found")
        # Walk up the ancestor chain to reject cycles (A -> B -> A).
        cur = parent
        while cur is not None:
            if cur.id == category_id:
                raise HTTPException(status_code=400, detail="That would create a category cycle.")
            cur = (
                db.get(ProductCategory, cur.parent_id)
                if cur.parent_id is not None
                else None
            )

    old_name = cat.name
    new_name = data.get("name")
    if new_name and new_name != old_name:
        clash = (
            db.query(ProductCategory)
            .filter(
                ProductCategory.company_id == company_id,
                ProductCategory.name == new_name,
                ProductCategory.parent_id == new_parent,
                ProductCategory.id != category_id,
            )
            .one_or_none()
        )
        if clash is not None:
            raise HTTPException(status_code=409, detail=f"Category '{new_name}' already exists here.")

    for field, value in data.items():
        setattr(cat, field, value)

    # Rename products' free-text tag in step so nothing goes missing.
    if new_name and new_name != old_name:
        db.query(Product).filter(
            Product.company_id == company_id, Product.category == old_name
        ).update({"category": new_name}, synchronize_session=False)

    db.commit()
    db.refresh(cat)
    return cat


def delete_category(
    db: Session, company_id: int, category_id: int, reassign_products_to: Optional[str] = None
) -> dict:
    cat = (
        db.query(ProductCategory)
        .filter(ProductCategory.id == category_id, ProductCategory.company_id == company_id)
        .one_or_none()
    )
    if cat is None:
        raise HTTPException(status_code=404, detail=f"Category {category_id} not found")

    # Promote children to the deleted node's parent rather than nuking a subtree.
    children = (
        db.query(ProductCategory)
        .filter(ProductCategory.company_id == company_id, ProductCategory.parent_id == category_id)
        .update({"parent_id": cat.parent_id}, synchronize_session=False)
    )
    # Products tagged with this name are re-tagged (or cleared). Their plain
    # string tag is independent of the tree, so we must fix it explicitly.
    retagged = db.query(Product).filter(
        Product.company_id == company_id, Product.category == cat.name
    ).update({"category": reassign_products_to or None}, synchronize_session=False)

    db.delete(cat)
    db.commit()
    return {
        "deleted": category_id,
        "reparented_children": int(children or 0),
        "products_retagged": int(retagged or 0),
    }


def set_product_archived(
    db: Session, company_id: int, product_id: int, archived: bool
) -> Product:
    product = get_product(db, company_id, product_id)
    product.archived_at = _now() if archived else None
    product.status = "discontinued" if archived else "active"
    db.commit()
    db.refresh(product)
    return product


def delete_product(db: Session, company_id: int, product_id: int) -> None:
    product = get_product(db, company_id, product_id)
    variant_ids = [v.id for v in product.variants]
    refs = (
        db.query(SaleLine).filter(SaleLine.variant_id.in_(variant_ids)).count()
        if variant_ids
        else 0
    )
    if refs:
        raise HTTPException(
            status_code=409,
            detail=(
                f"'{product.name}' is used by {refs} sale line(s) and cannot be deleted. "
                "Archive it instead to hide it from reps."
            ),
        )
    db.delete(product)  # cascades variants + their option-value links
    db.commit()


def update_variant(
    db: Session, company_id: int, variant_id: int, payload: VariantUpdate
) -> ProductVariant:
    variant = get_variant(db, company_id, variant_id)
    data = payload.model_dump(exclude_unset=True)

    # Maker-checker: the inline unit price is the uncontrolled lever. When the
    # flag is on, route price changes through effective-dated price versions.
    if data.get("unit_price") is not None:
        current = Decimal(str(variant.unit_price or 0))
        if Decimal(str(data["unit_price"])) != current and _maker_checker(db, company_id):
            raise HTTPException(
                status_code=409,
                detail=(
                    "Maker-checker is on: change prices via effective-dated price "
                    "versions, not the variant's inline unit price."
                ),
            )

    new_sku = data.get("sku")
    if new_sku and new_sku != variant.sku:
        clash = (
            db.query(ProductVariant)
            .filter(
                ProductVariant.product_id == variant.product_id,
                ProductVariant.sku == new_sku,
                ProductVariant.id != variant_id,
            )
            .one_or_none()
        )
        if clash is not None:
            raise HTTPException(status_code=409, detail=f"SKU '{new_sku}' already exists for this product.")

    if data.get("sell_uom_id") is not None:
        uom = (
            db.query(UnitOfMeasure)
            .filter(UnitOfMeasure.id == data["sell_uom_id"], UnitOfMeasure.company_id == company_id)
            .one_or_none()
        )
        if uom is None:
            raise HTTPException(status_code=404, detail=f"Unit of measure {data['sell_uom_id']} not found")

    if data.get("is_default") is True:
        db.query(ProductVariant).filter(
            ProductVariant.product_id == variant.product_id, ProductVariant.id != variant_id
        ).update({"is_default": False}, synchronize_session=False)

    for field, value in data.items():
        setattr(variant, field, value)
    db.commit()
    db.refresh(variant)
    return variant


def delete_variant(db: Session, company_id: int, variant_id: int) -> None:
    variant = get_variant(db, company_id, variant_id)
    refs = _variant_reference_count(db, variant_id)
    if refs:
        raise HTTPException(
            status_code=409,
            detail=(
                f"SKU '{variant.sku}' is used by {refs} sale line(s) and cannot be deleted. "
                "Archive it instead."
            ),
        )
    remaining = (
        db.query(ProductVariant)
        .filter(ProductVariant.product_id == variant.product_id, ProductVariant.id != variant_id)
        .count()
    )
    if remaining == 0:
        raise HTTPException(
            status_code=409,
            detail="A product must keep at least one variant — delete or archive the product instead.",
        )
    db.delete(variant)
    db.commit()


def set_outlet_archived(
    db: Session, company_id: int, outlet_id: int, archived: bool
) -> Outlet:
    outlet = get_outlet(db, company_id, outlet_id)
    outlet.archived_at = _now() if archived else None
    outlet.status = "inactive" if archived else "active"
    db.commit()
    db.refresh(outlet)
    return outlet


def delete_outlet(db: Session, company_id: int, outlet_id: int) -> None:
    outlet = get_outlet(db, company_id, outlet_id)
    # sales.outlet_id is ON DELETE SET NULL — history survives, the link is dropped.
    db.delete(outlet)
    db.commit()


def delete_option(db: Session, company_id: int, option_id: int) -> None:
    option = (
        db.query(ProductOption)
        .filter(ProductOption.id == option_id, ProductOption.company_id == company_id)
        .one_or_none()
    )
    if option is None:
        raise HTTPException(status_code=404, detail=f"Option {option_id} not found")
    db.delete(option)  # cascades values (and their variant links via FK)
    db.commit()


def delete_uom(db: Session, company_id: int, uom_id: int) -> None:
    uom = (
        db.query(UnitOfMeasure)
        .filter(UnitOfMeasure.id == uom_id, UnitOfMeasure.company_id == company_id)
        .one_or_none()
    )
    if uom is None:
        raise HTTPException(status_code=404, detail=f"Unit of measure {uom_id} not found")
    # variants.sell_uom_id / sale_lines.uom_id / base_uom_id all ON DELETE SET NULL.
    db.delete(uom)
    db.commit()
