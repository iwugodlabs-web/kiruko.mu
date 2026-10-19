"""Field Sales & Commissions API (Phase 0).

Thin HTTP layer over `db_models.crud.field_sales` and `services.commission_service`.
Every route is company-scoped via `require_company_scope`, which also authorizes
the caller (owner / company admin / platform operator) and binds tenant context.
"""

from datetime import date, datetime, time
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session, joinedload

from core import config
from core.dependencies import get_current_user, require_company_scope
from core.model import Company, CommissionRun, PrivateUser, User
from db_models.crud import field_sales as crud
from db_models.crud.audit import create_audit_log
from schema.field_sales_schema import (
    CommissionPlanCreate,
    CommissionPlanRead,
    CommissionPlanRevise,
    CommissionPushRequest,
    ManualSettlementRequest,
    CommissionRunCreate,
    CommissionRunRead,
    CommissionRunSummary,
    CreditAssignmentCreate,
    CreditAssignmentRead,
    ClawbackCreate,
    ErpReconcileRequest,
    ErpReconcileResult,
    LeaderboardRead,
    LiabilityAccrualRead,
    OutletCreate,
    OutletRead,
    OutletUpdate,
    PlanAssignmentCreate,
    PlanAssignmentRead,
    ProductCategoryCreate,
    ProductCategoryRead,
    ProductCategoryUpdate,
    ProductCreate,
    ProductOptionCreate,
    ProductOptionRead,
    ProductPriceCreate,
    ProductPriceRead,
    ProductRead,
    ProductUpdate,
    ProductVariantRead,
    SaleBulkReviewRequest,
    SaleBulkReviewResult,
    SaleCreate,
    SaleRead,
    SaleReopenRequest,
    SaleReviewRequest,
    SaleSyncRequest,
    SaleSyncResult,
    SaleUpdate,
    SalesReturnCreate,
    SalesReturnRead,
    SalesTargetCreate,
    SalesTargetRead,
    UnitOfMeasureCreate,
    UnitOfMeasureRead,
    VariantCreate,
    VariantUpdate,
)
from services import commission_service as engine
from services import product_import_service as product_imp


router = APIRouter(tags=["Field Sales & Commissions"])

MAX_IMPORT_BYTES = 5 * 1024 * 1024  # 5 MB — a catalog, not a data lake


def _rep_scope_private_user_id(current_user: User, company_id: int, db: Session) -> Optional[int]:
    """Rep-facing self-service guard.

    Returns the caller's `private_user_id` when they are a rank-and-file company
    member (a field rep capturing their own sales), or `None` when they are an
    admin/operator who may act on behalf of any rep. Reps must never be able to
    attribute sales to — or read — another rep's activity.
    """
    from core.roles import is_company_admin_for, is_platform_operator

    if getattr(current_user, "is_superuser", False):
        return None
    if is_platform_operator(current_user, db) or is_company_admin_for(current_user, company_id, db):
        return None
    pu = getattr(current_user, "private_user", None)
    if pu is None:
        raise HTTPException(status_code=403, detail="Not permitted to capture sales.")
    return pu.private_user_id


def _visible_rep_ids(current_user: User, company_id: int, db: Session) -> Optional[List[int]]:
    """Which reps' sales the caller may READ.

    None → all reps (admin / platform operator / superuser). Otherwise the
    caller's own private_user_id plus — for a manager — their direct reports
    via PrivateUser.manager_private_user_id (the same team relation
    team_override pays over). A plain rep sees only themselves.
    """
    bound = _rep_scope_private_user_id(current_user, company_id, db)
    if bound is None:
        return None
    ids = {bound}
    rows = (
        db.query(PrivateUser.private_user_id)
        .filter(
            PrivateUser.company_id == company_id,
            PrivateUser.manager_private_user_id == bound,
        )
        .all()
    )
    ids.update(r[0] for r in rows)
    return list(ids)


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------


@router.post(
    "/companies/{company_id}/products",
    response_model=ProductRead,
    status_code=201,
)
def create_product(
    company_id: int,
    payload: ProductCreate,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    product = crud.create_product(db, company_id, payload)
    create_audit_log(
        db, current_user.user_id, "field_sales.product.create", "product", product.id,
        {"company_id": company_id, "name": product.name}, commit=False,
    )
    db.commit()
    return crud.get_product(db, company_id, product.id)


@router.get(
    "/companies/{company_id}/products",
    response_model=List[ProductRead],
)
def list_products(
    company_id: int,
    include_archived: bool = Query(False),
    db: Session = Depends(config.get_db),
    company=Depends(require_company_scope),
):
    return crud.list_products(db, company_id, include_archived=include_archived)


# NOTE: the static import paths are declared *before* "/products/{product_id}"
# so "import" can never be parsed as a product_id (FastAPI matches in order).
@router.get("/companies/{company_id}/products/import/template")
def download_product_import_template(
    company_id: int,
    company=Depends(require_company_scope),
):
    """Download the product-import CSV template (header + one example row)."""
    return Response(
        content=product_imp.template_csv(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="product_import_template.csv"'},
    )


@router.post("/companies/{company_id}/products/import")
async def import_products(
    company_id: int,
    file: UploadFile = File(...),
    dry_run: bool = Query(True, description="true → validate + preview only (no writes); false → commit"),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    """Upload a CSV/XLSX of products (one row per variant). dry_run=true returns
    a validation preview without writing; dry_run=false creates the rows."""
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(raw) > MAX_IMPORT_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 5 MB).")

    try:
        rows = product_imp.parse(raw, file.filename or "upload.csv")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not rows:
        raise HTTPException(status_code=400, detail="No data rows found in the file.")

    preview = product_imp.validate(db, company_id, rows)
    if preview["missing_columns"]:
        raise HTTPException(
            status_code=400,
            detail=f"Missing required columns: {', '.join(preview['missing_columns'])}",
        )

    if dry_run:
        return {
            "status": "preview",
            "total": preview["total"],
            "ready": len(preview["ok"]),
            "products": preview["groups"],
            "errors": preview["errors"],
            "warnings": preview["warnings"],
        }

    summary = product_imp.commit(db, company_id, rows, actor_user_id=current_user.user_id)
    db.commit()
    create_audit_log(
        db, current_user.user_id, "field_sales.product.bulk_import", "company", company_id,
        {
            "products_created": summary["created_products"],
            "variants_created": summary["created_variants"],
            "skipped": summary["skipped"],
            "failed": len(summary["failed"]),
        },
        commit=True,
    )
    return {
        "status": "imported",
        "products_created": summary["created_products"],
        "variants_created": summary["created_variants"],
        "skipped": summary["skipped"],
        "failed": summary["failed"],
        "warnings": summary["warnings"],
    }


@router.get(
    "/companies/{company_id}/products/{product_id}",
    response_model=ProductRead,
)
def get_product(
    company_id: int,
    product_id: int,
    db: Session = Depends(config.get_db),
    company=Depends(require_company_scope),
):
    return crud.get_product(db, company_id, product_id)


@router.patch(
    "/companies/{company_id}/products/{product_id}",
    response_model=ProductRead,
)
def update_product(
    company_id: int,
    product_id: int,
    payload: ProductUpdate,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    product = crud.update_product(db, company_id, product_id, payload)
    create_audit_log(
        db, current_user.user_id, "field_sales.product.update", "product", product.id,
        {"company_id": company_id, "fields": list(payload.model_dump(exclude_unset=True))},
        commit=False,
    )
    db.commit()
    return crud.get_product(db, company_id, product.id)


# ---------------------------------------------------------------------------
# Sales
# ---------------------------------------------------------------------------


@router.post(
    "/companies/{company_id}/sales",
    response_model=SaleRead,
    status_code=201,
)
def create_sale(
    company_id: int,
    payload: SaleCreate,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    bound = _rep_scope_private_user_id(current_user, company_id, db)
    if bound is not None and payload.rep_private_user_id not in (None, bound):
        raise HTTPException(status_code=403, detail="Reps may only capture their own sales.")
    if bound is not None:
        payload = payload.model_copy(update={"rep_private_user_id": bound})
    sale = crud.create_sale(db, company_id, payload, current_user.user_id)
    create_audit_log(
        db, current_user.user_id, "field_sales.sale.create", "sale", sale.id,
        {
            "company_id": company_id,
            "rep_private_user_id": sale.rep_private_user_id,
            "line_count": len(sale.lines),
        },
        commit=False,
    )
    db.commit()
    return crud.get_sale(db, company_id, sale.id)


@router.get(
    "/companies/{company_id}/sales",
    response_model=List[SaleRead],
)
def list_sales(
    response: Response,
    company_id: int,
    period_start: Optional[str] = Query(None, description="ISO date; inclusive"),
    period_end: Optional[str] = Query(None, description="ISO date; inclusive"),
    rep_private_user_id: Optional[int] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    outlet_id: Optional[int] = Query(None),
    payment_status: Optional[str] = Query(None),
    payment_method: Optional[str] = Query(None),
    q: Optional[str] = Query(None, description="Free-text: product name/SKU/barcode or notes"),
    limit: Optional[int] = Query(None, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    def _parse(value: Optional[str], *, end: bool) -> Optional[datetime]:
        if not value:
            return None
        from datetime import date as _date
        d = _date.fromisoformat(value)
        return datetime.combine(d, time.max if end else time.min)

    # View-scoping: a rep sees only their own sales, a manager sees their team
    # (self + direct reports), an admin/operator sees all. Reject an explicit
    # rep filter that falls outside the caller's visible set.
    visible = _visible_rep_ids(current_user, company_id, db)
    if visible is not None and rep_private_user_id is not None and rep_private_user_id not in visible:
        raise HTTPException(status_code=403, detail="Not permitted to view this rep's sales.")

    filters = dict(
        period_start=_parse(period_start, end=False),
        period_end=_parse(period_end, end=True),
        rep_private_user_id=rep_private_user_id,
        rep_private_user_ids=visible,
        sale_status=status_filter,
        outlet_id=outlet_id,
        payment_status=payment_status,
        payment_method=payment_method,
        search=q,
    )
    # Only pay for the COUNT when the caller is actually paging.
    if limit is not None or offset:
        response.headers["X-Total-Count"] = str(crud.count_sales(db, company_id, **filters))
    return crud.list_sales(db, company_id, limit=limit, offset=offset, **filters)


# NOTE: static "/sales/pending" MUST be declared before the dynamic
# "/sales/{sale_id}" route. FastAPI matches in declaration order, so if
# "{sale_id}" comes first, GET /sales/pending is parsed as sale_id="pending"
# and rejected with a 422 before auth even runs.
@router.get(
    "/companies/{company_id}/sales/pending",
    response_model=List[SaleRead],
)
def list_pending_sales(
    company_id: int,
    db: Session = Depends(config.get_db),
    company=Depends(require_company_scope),
):
    return crud.list_pending_sales(db, company_id)


@router.get(
    "/companies/{company_id}/sales/{sale_id}",
    response_model=SaleRead,
)
def get_sale(
    company_id: int,
    sale_id: int,
    db: Session = Depends(config.get_db),
    company=Depends(require_company_scope),
):
    return crud.get_sale(db, company_id, sale_id)


@router.post(
    "/companies/{company_id}/sales/{sale_id}/void",
    response_model=SaleRead,
)
def void_sale(
    company_id: int,
    sale_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    bound = _rep_scope_private_user_id(current_user, company_id, db)
    if bound is not None:
        existing = crud.get_sale(db, company_id, sale_id)
        if existing.rep_private_user_id != bound:
            raise HTTPException(status_code=403, detail="Reps may only void their own sales.")
        if existing.status == "approved":
            raise HTTPException(
                status_code=403,
                detail="An approved sale can only be voided by an admin.",
            )
    sale = crud.void_sale(db, company_id, sale_id)
    create_audit_log(
        db, current_user.user_id, "field_sales.sale.void", "sale", sale.id,
        {"company_id": company_id}, commit=False,
    )
    db.commit()
    return crud.get_sale(db, company_id, sale.id)


@router.patch(
    "/companies/{company_id}/sales/{sale_id}",
    response_model=SaleRead,
)
def update_sale(
    company_id: int,
    sale_id: int,
    payload: SaleUpdate,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    """Edit a sale's payment / outlet / notes. Line items are immutable so an
    approved sale's commission math never silently changes."""
    bound = _rep_scope_private_user_id(current_user, company_id, db)
    if bound is not None and crud.get_sale(db, company_id, sale_id).rep_private_user_id != bound:
        raise HTTPException(status_code=403, detail="Reps may only edit their own sales.")
    sale = crud.update_sale(db, company_id, sale_id, payload)
    create_audit_log(
        db, current_user.user_id, "field_sales.sale.update", "sale", sale.id,
        {"company_id": company_id, "fields": sorted(payload.model_dump(exclude_unset=True).keys())},
        commit=False,
    )
    db.commit()
    return crud.get_sale(db, company_id, sale.id)


@router.post(
    "/companies/{company_id}/sales/{sale_id}/reopen",
    response_model=SaleRead,
)
def reopen_sale(
    company_id: int,
    sale_id: int,
    payload: Optional[SaleReopenRequest] = None,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    # Reopening un-voids a sale (back to approved/submitted) — an admin decision,
    # never a rep self-service action.
    if _rep_scope_private_user_id(current_user, company_id, db) is not None:
        raise HTTPException(status_code=403, detail="Only an admin can reopen a sale.")
    target = (payload.status if payload else None) or "approved"
    sale = crud.reopen_sale(db, company_id, sale_id, target_status=target)
    create_audit_log(
        db, current_user.user_id, "field_sales.sale.reopen", "sale", sale.id,
        {"company_id": company_id, "status": sale.status}, commit=False,
    )
    db.commit()
    return crud.get_sale(db, company_id, sale.id)


@router.post(
    "/companies/{company_id}/sales/sync",
    response_model=SaleSyncResult,
)
def sync_sales(
    company_id: int,
    payload: SaleSyncRequest,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    """Idempotent batch flush from an offline mobile client (keyed on client_uuid)."""
    bound = _rep_scope_private_user_id(current_user, company_id, db)
    items = payload.items
    if bound is not None:
        for item in items:
            if item.rep_private_user_id not in (None, bound):
                raise HTTPException(status_code=403, detail="Reps may only sync their own sales.")
        items = [item.model_copy(update={"rep_private_user_id": bound}) for item in items]
    return crud.sync_sales(db, company_id, items, current_user.user_id)


@router.post(
    "/companies/{company_id}/sales/{sale_id}/review",
    response_model=SaleRead,
)
def review_sale(
    company_id: int,
    sale_id: int,
    payload: SaleReviewRequest,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    if payload.decision == "reject" and not payload.notes:
        raise HTTPException(status_code=422, detail="A rejection reason (notes) is required.")
    sale = crud.review_sale(
        db, company_id, sale_id, payload.decision, current_user.user_id, payload.notes
    )
    create_audit_log(
        db, current_user.user_id, f"field_sales.sale.{payload.decision}", "sale", sale.id,
        {"company_id": company_id, "notes": payload.notes}, commit=False,
    )
    db.commit()
    return crud.get_sale(db, company_id, sale.id)


@router.post(
    "/companies/{company_id}/sales/review-bulk",
    response_model=SaleBulkReviewResult,
)
def review_sales_bulk(
    company_id: int,
    payload: SaleBulkReviewRequest,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    """Approve / reject many submitted sales at once (month-end). Best-effort:
    per-sale outcomes come back in `results`; failures don't abort the batch."""
    if payload.decision == "reject" and not payload.notes:
        raise HTTPException(status_code=422, detail="A rejection reason (notes) is required.")
    result = crud.review_sales_bulk(
        db, company_id, payload.sale_ids, payload.decision, current_user.user_id, payload.notes
    )
    create_audit_log(
        db, current_user.user_id, f"field_sales.sale.bulk_{payload.decision}", "sale", None,
        {"company_id": company_id, "count": len(payload.sale_ids),
         "succeeded": result["succeeded"], "failed": result["failed"],
         "notes": payload.notes},
        commit=False,
    )
    db.commit()
    return result


# ---------------------------------------------------------------------------
# Outlets (Phase 1)
# ---------------------------------------------------------------------------


@router.post(
    "/companies/{company_id}/outlets",
    response_model=OutletRead,
    status_code=201,
)
def create_outlet(
    company_id: int,
    payload: OutletCreate,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    outlet = crud.create_outlet(db, company_id, payload)
    create_audit_log(
        db, current_user.user_id, "field_sales.outlet.create", "outlet", outlet.id,
        {"company_id": company_id, "name": outlet.name}, commit=False,
    )
    db.commit()
    return outlet


@router.get(
    "/companies/{company_id}/outlets",
    response_model=List[OutletRead],
)
def list_outlets(
    company_id: int,
    assigned_rep_private_user_id: Optional[int] = Query(None),
    include_archived: bool = Query(False),
    db: Session = Depends(config.get_db),
    company=Depends(require_company_scope),
):
    return crud.list_outlets(
        db, company_id,
        assigned_rep_private_user_id=assigned_rep_private_user_id,
        include_archived=include_archived,
    )


@router.get(
    "/companies/{company_id}/outlets/{outlet_id}",
    response_model=OutletRead,
)
def get_outlet(
    company_id: int,
    outlet_id: int,
    db: Session = Depends(config.get_db),
    company=Depends(require_company_scope),
):
    return crud.get_outlet(db, company_id, outlet_id)


@router.patch(
    "/companies/{company_id}/outlets/{outlet_id}",
    response_model=OutletRead,
)
def update_outlet(
    company_id: int,
    outlet_id: int,
    payload: OutletUpdate,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    """Edit an outlet — notably its geofence coordinates, so a wrong lat/long
    can be corrected instead of only re-created."""
    outlet = crud.update_outlet(db, company_id, outlet_id, payload)
    create_audit_log(
        db, current_user.user_id, "field_sales.outlet.update", "outlet", outlet.id,
        {"company_id": company_id, "fields": sorted(payload.model_dump(exclude_unset=True).keys())},
        commit=False,
    )
    db.commit()
    return outlet


# ---------------------------------------------------------------------------
# Commission plans / rules / assignments
# ---------------------------------------------------------------------------


@router.post(
    "/companies/{company_id}/commission-plans",
    response_model=CommissionPlanRead,
    status_code=201,
)
def create_plan(
    company_id: int,
    payload: CommissionPlanCreate,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    plan = crud.create_plan(db, company_id, payload, created_by_user_id=current_user.user_id)
    create_audit_log(
        db, current_user.user_id, "field_sales.plan.create", "commission_plan", plan.id,
        {"company_id": company_id, "name": plan.name, "trigger": plan.trigger,
         "rule_count": len(plan.rules)}, commit=False,
    )
    db.commit()
    return crud.get_plan(db, company_id, plan.id)


@router.get(
    "/companies/{company_id}/commission-plans",
    response_model=List[CommissionPlanRead],
)
def list_plans(
    company_id: int,
    include_archived: bool = Query(False),
    db: Session = Depends(config.get_db),
    company=Depends(require_company_scope),
):
    return crud.list_plans(db, company_id, include_archived=include_archived)


@router.get(
    "/companies/{company_id}/commission-plans/{plan_id}",
    response_model=CommissionPlanRead,
)
def get_plan(
    company_id: int,
    plan_id: int,
    db: Session = Depends(config.get_db),
    company=Depends(require_company_scope),
):
    return crud.get_plan(db, company_id, plan_id)


@router.get(
    "/companies/{company_id}/commission-plans/{plan_id}/versions",
    response_model=List[CommissionPlanRead],
)
def list_plan_versions(
    company_id: int,
    plan_id: int,
    db: Session = Depends(config.get_db),
    company=Depends(require_company_scope),
):
    return crud.list_plan_versions(db, company_id, plan_id)


@router.put(
    "/companies/{company_id}/commission-plans/{plan_id}",
    response_model=CommissionPlanRead,
    status_code=201,
)
def revise_plan(
    company_id: int,
    plan_id: int,
    payload: CommissionPlanRevise,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    """Copy-on-write: clone the plan into a new `draft` version. It only
    affects pay once activated (a used version is never edited in place)."""
    plan = crud.revise_plan(db, company_id, plan_id, payload, created_by_user_id=current_user.user_id)
    create_audit_log(
        db, current_user.user_id, "field_sales.plan.revise", "commission_plan", plan.id,
        {"company_id": company_id, "family_id": plan.family_id, "version": plan.version,
         "name": plan.name}, commit=False,
    )
    db.commit()
    return crud.get_plan(db, company_id, plan.id)


@router.post(
    "/companies/{company_id}/commission-plans/{plan_id}/activate",
    response_model=CommissionPlanRead,
)
def activate_plan(
    company_id: int,
    plan_id: int,
    effective_from: Optional[date] = Body(None, embed=True),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    """Put a draft version into effect, superseding the current one."""
    plan = crud.activate_plan(
        db, company_id, plan_id,
        approved_by_user_id=current_user.user_id, effective_from=effective_from,
    )
    create_audit_log(
        db, current_user.user_id, "field_sales.plan.activate", "commission_plan", plan.id,
        {"company_id": company_id, "family_id": plan.family_id, "version": plan.version,
         "effective_from": str(plan.effective_from)}, commit=False,
    )
    db.commit()
    return crud.get_plan(db, company_id, plan.id)


@router.post(
    "/companies/{company_id}/commission-plans/{plan_id}/archive",
    response_model=CommissionPlanRead,
)
def archive_plan(
    company_id: int,
    plan_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    plan = crud.archive_plan(db, company_id, plan_id)
    create_audit_log(
        db, current_user.user_id, "field_sales.plan.archive", "commission_plan", plan.id,
        {"company_id": company_id, "family_id": plan.family_id, "version": plan.version}, commit=False,
    )
    db.commit()
    return plan


@router.post(
    "/companies/{company_id}/commission-plans/{plan_id}/assignments",
    response_model=PlanAssignmentRead,
    status_code=201,
)
def assign_plan(
    company_id: int,
    plan_id: int,
    payload: PlanAssignmentCreate,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    assignment = crud.assign_plan(
        db, company_id, plan_id, payload.private_user_id,
        effective_from=payload.effective_from, effective_to=payload.effective_to,
    )
    create_audit_log(
        db, current_user.user_id, "field_sales.plan.assign", "commission_plan", plan_id,
        {"company_id": company_id, "private_user_id": payload.private_user_id}, commit=False,
    )
    db.commit()
    return assignment


@router.get(
    "/companies/{company_id}/commission-plans/{plan_id}/assignments",
    response_model=List[PlanAssignmentRead],
)
def list_assignments(
    company_id: int,
    plan_id: int,
    db: Session = Depends(config.get_db),
    company=Depends(require_company_scope),
):
    return crud.list_assignments(db, company_id, plan_id)


# ---------------------------------------------------------------------------
# Commission runs
# ---------------------------------------------------------------------------


@router.post(
    "/companies/{company_id}/commission-runs",
    response_model=CommissionRunRead,
    status_code=201,
)
def compute_commission_run(
    company_id: int,
    payload: CommissionRunCreate,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    run = engine.compute_run(
        db, company_id, payload.period_start, payload.period_end, current_user.user_id
    )
    create_audit_log(
        db, current_user.user_id, "field_sales.run.compute", "commission_run", run.id,
        {"company_id": company_id, "period_start": str(run.period_start),
         "period_end": str(run.period_end)}, commit=False,
    )
    db.commit()
    return _load_run(db, company_id, run.id)


@router.get(
    "/companies/{company_id}/commission-runs",
    response_model=List[CommissionRunSummary],
)
def list_commission_runs(
    company_id: int,
    db: Session = Depends(config.get_db),
    company=Depends(require_company_scope),
):
    runs = (
        db.query(CommissionRun)
        .options(joinedload(CommissionRun.payables))
        .filter(CommissionRun.company_id == company_id)
        .order_by(CommissionRun.period_start.desc())
        .all()
    )
    out: List[CommissionRunSummary] = []
    for run in runs:
        total = sum((Decimal(p.amount) for p in run.payables), Decimal("0.00"))
        out.append(
            CommissionRunSummary(
                id=run.id, company_id=run.company_id, period_start=run.period_start,
                period_end=run.period_end, status=run.status, currency=run.currency,
                computed_at=run.computed_at, approved_at=run.approved_at,
                payable_total=total,
            )
        )
    return out


@router.get(
    "/companies/{company_id}/commission-runs/{run_id}",
    response_model=CommissionRunRead,
)
def get_commission_run(
    company_id: int,
    run_id: int,
    db: Session = Depends(config.get_db),
    company=Depends(require_company_scope),
):
    return _load_run(db, company_id, run_id)


@router.post(
    "/companies/{company_id}/commission-runs/{run_id}/approve",
    response_model=CommissionRunRead,
)
def approve_commission_run(
    company_id: int,
    run_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    run = engine.approve_run(db, company_id, run_id, current_user.user_id)
    create_audit_log(
        db, current_user.user_id, "field_sales.run.approve", "commission_run", run.id,
        {"company_id": company_id}, commit=False,
    )
    db.commit()
    return _load_run(db, company_id, run.id)


@router.post(
    "/companies/{company_id}/commission-runs/{run_id}/settle-manual",
)
def settle_manual_payouts(
    company_id: int,
    run_id: int,
    payload: Optional[ManualSettlementRequest] = None,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    """Settle off-payroll (contractor) commission outside payroll, recording an
    external payout reference. Only pending `manual`-channel payables move."""
    result = engine.settle_manual_payouts(
        db, company_id, run_id, current_user.user_id,
        reference=payload.reference if payload else None,
        private_user_id=payload.private_user_id if payload else None,
    )
    create_audit_log(
        db, current_user.user_id, "field_sales.run.settle_manual", "commission_run", run_id,
        {"company_id": company_id, **result}, commit=False,
    )
    db.commit()
    return result


@router.post(
    "/companies/{company_id}/commission-runs/{run_id}/push-to-payroll",
)
def push_commission_run(
    company_id: int,
    run_id: int,
    payload: Optional[CommissionPushRequest] = None,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    result = engine.push_to_payroll(
        db, company_id, run_id, current_user.user_id,
        payable_in_year=payload.payable_in_year if payload else None,
        payable_in_month=payload.payable_in_month if payload else None,
    )
    create_audit_log(
        db, current_user.user_id, "field_sales.run.push_to_payroll", "commission_run", run_id,
        {"company_id": company_id, **result}, commit=False,
    )
    db.commit()
    return result


# ---------------------------------------------------------------------------
# Credit assignments / clawbacks / ERP reconcile (Phase 3)
# ---------------------------------------------------------------------------


@router.post(
    "/companies/{company_id}/credit-assignments",
    response_model=CreditAssignmentRead,
    status_code=201,
)
def create_credit_assignment(
    company_id: int,
    payload: CreditAssignmentCreate,
    db: Session = Depends(config.get_db),
    company=Depends(require_company_scope),
):
    return crud.create_credit_assignment(db, company_id, payload)


@router.get(
    "/companies/{company_id}/credit-assignments",
    response_model=List[CreditAssignmentRead],
)
def list_credit_assignments(
    company_id: int,
    private_user_id: Optional[int] = Query(None),
    db: Session = Depends(config.get_db),
    company=Depends(require_company_scope),
):
    return crud.list_credit_assignments(db, company_id, private_user_id=private_user_id)


@router.delete("/companies/{company_id}/credit-assignments/{assignment_id}", status_code=204)
def delete_credit_assignment(
    company_id: int,
    assignment_id: int,
    db: Session = Depends(config.get_db),
    company=Depends(require_company_scope),
):
    crud.delete_credit_assignment(db, company_id, assignment_id)


@router.post(
    "/companies/{company_id}/commission-clawbacks",
    status_code=201,
)
def create_clawback(
    company_id: int,
    payload: ClawbackCreate,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    """Recover over-paid commission as a signed negative earning on the rep's
    next payslip (no rewrite of a closed period)."""
    result = engine.record_clawback(
        db, company_id, payload.private_user_id, payload.amount, payload.reason,
        actor_user_id=current_user.user_id,
        payable_in_year=payload.payable_in_year,
        payable_in_month=payload.payable_in_month,
    )
    create_audit_log(
        db, current_user.user_id, "field_sales.clawback.create",
        "employee_one_off_allowance", result["one_off_allowance_id"],
        {"company_id": company_id, "private_user_id": payload.private_user_id,
         "amount": result["amount"], "reason": payload.reason}, commit=False,
    )
    db.commit()
    return result


@router.post(
    "/companies/{company_id}/sales-returns",
    response_model=SalesReturnRead,
    status_code=201,
)
def create_sales_return(
    company_id: int,
    payload: SalesReturnCreate,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    """Record a return / credit-note against an approved sale. It flows forward
    as a negative commission in the return's period — never a rewrite."""
    ret = crud.create_sales_return(db, company_id, payload, current_user.user_id)
    create_audit_log(
        db, current_user.user_id, "field_sales.return.create", "sales_return", ret.id,
        {"company_id": company_id, "sale_id": ret.sale_id,
         "returned_at": str(ret.returned_at)}, commit=False,
    )
    db.commit()
    return ret


@router.get(
    "/companies/{company_id}/sales-returns",
    response_model=List[SalesReturnRead],
)
def list_sales_returns(
    company_id: int,
    sale_id: Optional[int] = Query(None),
    db: Session = Depends(config.get_db),
    company=Depends(require_company_scope),
):
    return crud.list_sales_returns(db, company_id, sale_id=sale_id)


@router.post(
    "/companies/{company_id}/sales/erp-reconcile",
    response_model=ErpReconcileResult,
)
def erp_reconcile(
    company_id: int,
    payload: ErpReconcileRequest,
    db: Session = Depends(config.get_db),
    company=Depends(require_company_scope),
):
    """Reconcile an external sales feed against the catalog. Dry-run by
    default; `commit=true` imports new rows as approved sales (idempotent)."""
    return crud.reconcile_external_sales(db, company_id, payload.items, commit=payload.commit)


# ---------------------------------------------------------------------------
# Catalog masters (Phase 2)
# ---------------------------------------------------------------------------


@router.post(
    "/companies/{company_id}/product-categories",
    response_model=ProductCategoryRead,
    status_code=201,
)
def create_category(
    company_id: int,
    payload: ProductCategoryCreate,
    db: Session = Depends(config.get_db),
    company=Depends(require_company_scope),
):
    return crud.create_category(db, company_id, payload)


@router.get(
    "/companies/{company_id}/product-categories",
    response_model=List[ProductCategoryRead],
)
def list_categories(
    company_id: int,
    db: Session = Depends(config.get_db),
    company=Depends(require_company_scope),
):
    return crud.list_categories(db, company_id)


@router.post(
    "/companies/{company_id}/product-options",
    response_model=ProductOptionRead,
    status_code=201,
)
def create_option(
    company_id: int,
    payload: ProductOptionCreate,
    db: Session = Depends(config.get_db),
    company=Depends(require_company_scope),
):
    return crud.create_option(db, company_id, payload)


@router.get(
    "/companies/{company_id}/product-options",
    response_model=List[ProductOptionRead],
)
def list_options(
    company_id: int,
    db: Session = Depends(config.get_db),
    company=Depends(require_company_scope),
):
    return crud.list_options(db, company_id)


@router.post(
    "/companies/{company_id}/units-of-measure",
    response_model=UnitOfMeasureRead,
    status_code=201,
)
def create_uom(
    company_id: int,
    payload: UnitOfMeasureCreate,
    db: Session = Depends(config.get_db),
    company=Depends(require_company_scope),
):
    return crud.create_uom(db, company_id, payload)


@router.get(
    "/companies/{company_id}/units-of-measure",
    response_model=List[UnitOfMeasureRead],
)
def list_uoms(
    company_id: int,
    db: Session = Depends(config.get_db),
    company=Depends(require_company_scope),
):
    return crud.list_uoms(db, company_id)


@router.post(
    "/companies/{company_id}/products/{product_id}/variants",
    response_model=ProductVariantRead,
    status_code=201,
)
def create_variant(
    company_id: int,
    product_id: int,
    payload: VariantCreate,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    variant = crud.create_variant(db, company_id, product_id, payload)
    create_audit_log(
        db, current_user.user_id, "field_sales.variant.create", "product_variant", variant.id,
        {"company_id": company_id, "product_id": product_id, "sku": variant.sku}, commit=False,
    )
    db.commit()
    return crud.get_variant(db, company_id, variant.id)


@router.post(
    "/companies/{company_id}/product-prices",
    response_model=ProductPriceRead,
    status_code=201,
)
def create_price(
    company_id: int,
    payload: ProductPriceCreate,
    db: Session = Depends(config.get_db),
    company=Depends(require_company_scope),
):
    return crud.create_price(db, company_id, payload)


@router.get(
    "/companies/{company_id}/products/{product_id}/variants/{variant_id}/prices",
    response_model=List[ProductPriceRead],
)
def list_prices(
    company_id: int,
    product_id: int,
    variant_id: int,
    db: Session = Depends(config.get_db),
    company=Depends(require_company_scope),
):
    return crud.list_prices(db, company_id, variant_id)


# ---------------------------------------------------------------------------
# Sales targets + leaderboards (Phase 2)
# ---------------------------------------------------------------------------


@router.post(
    "/companies/{company_id}/sales-targets",
    response_model=SalesTargetRead,
    status_code=201,
)
def create_target(
    company_id: int,
    payload: SalesTargetCreate,
    db: Session = Depends(config.get_db),
    company=Depends(require_company_scope),
):
    return crud.create_target(db, company_id, payload)


@router.get(
    "/companies/{company_id}/sales-targets",
    response_model=List[SalesTargetRead],
)
def list_targets(
    company_id: int,
    private_user_id: Optional[int] = Query(None),
    db: Session = Depends(config.get_db),
    company=Depends(require_company_scope),
):
    return crud.list_targets(db, company_id, private_user_id=private_user_id)


@router.get(
    "/companies/{company_id}/commission-leaderboard",
    response_model=LeaderboardRead,
)
def commission_leaderboard(
    company_id: int,
    period_start: str = Query(..., description="ISO date; inclusive"),
    period_end: str = Query(..., description="ISO date; inclusive"),
    db: Session = Depends(config.get_db),
    company=Depends(require_company_scope),
):
    from datetime import date as _date
    start = datetime.combine(_date.fromisoformat(period_start), time.min)
    end = datetime.combine(_date.fromisoformat(period_end), time.max)
    entries = crud.leaderboard(db, company_id, start, end)
    return LeaderboardRead(
        period_start=_date.fromisoformat(period_start),
        period_end=_date.fromisoformat(period_end),
        entries=entries,
    )


@router.get(
    "/companies/{company_id}/commission-liability",
    response_model=LiabilityAccrualRead,
)
def commission_liability(
    company_id: int,
    db: Session = Depends(config.get_db),
    company=Depends(require_company_scope),
):
    return crud.liability_accrual(db, company_id)


@router.get("/companies/{company_id}/commission-runs/{run_id}/statement/{private_user_id}.pdf")
def commission_statement_pdf(
    company_id: int,
    run_id: int,
    private_user_id: int,
    db: Session = Depends(config.get_db),
    company=Depends(require_company_scope),
):
    from fastapi.responses import Response
    from services import commission_statement_pdf

    run = _load_run(db, company_id, run_id)
    rep = (
        db.query(PrivateUser)
        .filter(PrivateUser.private_user_id == private_user_id)
        .one_or_none()
    )
    if rep is None:
        raise HTTPException(status_code=404, detail=f"Rep {private_user_id} not found")
    lines = [li for li in run.line_items if li.private_user_id == private_user_id]
    if not lines:
        raise HTTPException(status_code=404, detail="No commission lines for this rep in this run.")
    company_row = db.query(Company).filter(Company.company_id == company_id).one_or_none()
    data = commission_statement_pdf.build_data(db, company_row, rep, run, lines)
    try:
        pdf = commission_statement_pdf.render(data, company_row)
    except commission_statement_pdf.PdfRenderUnavailable as e:
        raise HTTPException(status_code=503, detail=f"PDF renderer unavailable: {e}")
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="commission_{run_id}_{private_user_id}.pdf"'},
    )


def _load_run(db: Session, company_id: int, run_id: int) -> CommissionRun:
    run = (
        db.query(CommissionRun)
        .options(joinedload(CommissionRun.line_items), joinedload(CommissionRun.payables))
        .filter(CommissionRun.id == run_id, CommissionRun.company_id == company_id)
        .one_or_none()
    )
    if run is None:
        raise HTTPException(status_code=404, detail=f"Commission run {run_id} not found")
    return run


# ---------------------------------------------------------------------------
# Catalog editing & deletion
#
# Products/outlets archive (reversible, keeps them out of reps' pickers); hard
# DELETE is refused when a sale line references the row so history stays intact.
# ---------------------------------------------------------------------------


@router.patch(
    "/companies/{company_id}/product-categories/{category_id}",
    response_model=ProductCategoryRead,
)
def update_category(
    company_id: int,
    category_id: int,
    payload: ProductCategoryUpdate,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    category = crud.update_category(db, company_id, category_id, payload)
    create_audit_log(
        db, current_user.user_id, "field_sales.category.update", "product_category", category_id,
        {"company_id": company_id, "fields": list(payload.model_dump(exclude_unset=True))},
        commit=True,
    )
    return category


@router.delete("/companies/{company_id}/product-categories/{category_id}")
def delete_category(
    company_id: int,
    category_id: int,
    reassign_to: Optional[str] = Query(
        None, description="Rename products tagged with this category to this name (default: clear)."
    ),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    result = crud.delete_category(db, company_id, category_id, reassign_products_to=reassign_to)
    create_audit_log(
        db, current_user.user_id, "field_sales.category.delete", "product_category", category_id,
        {"company_id": company_id, "reassign_to": reassign_to}, commit=True,
    )
    return result


@router.post(
    "/companies/{company_id}/products/{product_id}/archive",
    response_model=ProductRead,
)
def archive_product(
    company_id: int,
    product_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    crud.set_product_archived(db, company_id, product_id, True)
    create_audit_log(
        db, current_user.user_id, "field_sales.product.archive", "product", product_id,
        {"company_id": company_id}, commit=True,
    )
    return crud.get_product(db, company_id, product_id)


@router.post(
    "/companies/{company_id}/products/{product_id}/unarchive",
    response_model=ProductRead,
)
def unarchive_product(
    company_id: int,
    product_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    crud.set_product_archived(db, company_id, product_id, False)
    create_audit_log(
        db, current_user.user_id, "field_sales.product.unarchive", "product", product_id,
        {"company_id": company_id}, commit=True,
    )
    return crud.get_product(db, company_id, product_id)


@router.delete("/companies/{company_id}/products/{product_id}", status_code=204)
def delete_product(
    company_id: int,
    product_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    crud.delete_product(db, company_id, product_id)
    create_audit_log(
        db, current_user.user_id, "field_sales.product.delete", "product", product_id,
        {"company_id": company_id}, commit=True,
    )


@router.patch(
    "/companies/{company_id}/products/{product_id}/variants/{variant_id}",
    response_model=ProductVariantRead,
)
def update_variant(
    company_id: int,
    product_id: int,
    variant_id: int,
    payload: VariantUpdate,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    crud.update_variant(db, company_id, variant_id, payload)
    create_audit_log(
        db, current_user.user_id, "field_sales.variant.update", "product_variant", variant_id,
        {"company_id": company_id, "fields": list(payload.model_dump(exclude_unset=True))},
        commit=True,
    )
    return crud.get_variant(db, company_id, variant_id)


@router.delete(
    "/companies/{company_id}/products/{product_id}/variants/{variant_id}", status_code=204
)
def delete_variant(
    company_id: int,
    product_id: int,
    variant_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    crud.delete_variant(db, company_id, variant_id)
    create_audit_log(
        db, current_user.user_id, "field_sales.variant.delete", "product_variant", variant_id,
        {"company_id": company_id, "product_id": product_id}, commit=True,
    )


@router.post(
    "/companies/{company_id}/outlets/{outlet_id}/archive",
    response_model=OutletRead,
)
def archive_outlet(
    company_id: int,
    outlet_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    outlet = crud.set_outlet_archived(db, company_id, outlet_id, True)
    create_audit_log(
        db, current_user.user_id, "field_sales.outlet.archive", "outlet", outlet_id,
        {"company_id": company_id}, commit=True,
    )
    return outlet


@router.post(
    "/companies/{company_id}/outlets/{outlet_id}/unarchive",
    response_model=OutletRead,
)
def unarchive_outlet(
    company_id: int,
    outlet_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    outlet = crud.set_outlet_archived(db, company_id, outlet_id, False)
    create_audit_log(
        db, current_user.user_id, "field_sales.outlet.unarchive", "outlet", outlet_id,
        {"company_id": company_id}, commit=True,
    )
    return outlet


@router.delete("/companies/{company_id}/outlets/{outlet_id}", status_code=204)
def delete_outlet(
    company_id: int,
    outlet_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    crud.delete_outlet(db, company_id, outlet_id)
    create_audit_log(
        db, current_user.user_id, "field_sales.outlet.delete", "outlet", outlet_id,
        {"company_id": company_id}, commit=True,
    )


@router.delete("/companies/{company_id}/product-options/{option_id}", status_code=204)
def delete_option(
    company_id: int,
    option_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    crud.delete_option(db, company_id, option_id)
    create_audit_log(
        db, current_user.user_id, "field_sales.option.delete", "product_option", option_id,
        {"company_id": company_id}, commit=True,
    )


@router.delete("/companies/{company_id}/units-of-measure/{uom_id}", status_code=204)
def delete_uom(
    company_id: int,
    uom_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
    company=Depends(require_company_scope),
):
    crud.delete_uom(db, company_id, uom_id)
    create_audit_log(
        db, current_user.user_id, "field_sales.uom.delete", "unit_of_measure", uom_id,
        {"company_id": company_id}, commit=True,
    )
