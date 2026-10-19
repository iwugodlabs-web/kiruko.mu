"""Pydantic schemas for the Field Sales & Commissions module (Phase 0).

Phase 0 covers the thin slice: a minimal catalog (product + default variant),
admin-entered sales, one flat-percent rule type, and the CommissionRun ->
CommissionPayable -> EmployeeOneOffAllowance bridge into payroll. Later phases
add variants, outlets, the remaining rule types, and the mobile capture path.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator


# How a sale was settled. `mobile_money` is the generic bucket for
# country-specific wallets (M-Pesa, Orange Money, Juice, ...) — the specific
# wallet goes in the sale notes so no migration is needed per country.
PAYMENT_METHODS = ("cash", "card", "bank_transfer", "mobile_money", "cheque", "credit", "other")

# Collection state (independent of the method).
PAYMENT_STATUSES = ("pending", "partial", "paid")


def _validate_payment_method(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    v = value.strip().lower()
    if v == "":
        return None
    if v not in PAYMENT_METHODS:
        raise ValueError(f"payment_method must be one of {', '.join(PAYMENT_METHODS)}")
    return v


def _validate_payment_status(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    v = value.strip().lower()
    if v not in PAYMENT_STATUSES:
        raise ValueError(f"payment_status must be one of {', '.join(PAYMENT_STATUSES)}")
    return v


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------


class ProductVariantCreate(BaseModel):
    sku: str = Field(min_length=1, max_length=64)
    barcode: Optional[str] = Field(default=None, max_length=64)
    unit_price: Decimal = Field(default=Decimal("0.00"), ge=0)
    currency: Optional[str] = Field(default=None, min_length=3, max_length=3)


class ProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    brand: Optional[str] = Field(default=None, max_length=120)
    category: Optional[str] = Field(default=None, max_length=120)
    # Phase 0: a product carries one implicit default variant. If omitted, a
    # variant is auto-created from the product name with price 0.
    default_variant: Optional[ProductVariantCreate] = None


class ProductUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    brand: Optional[str] = Field(default=None, max_length=120)
    category: Optional[str] = Field(default=None, max_length=120)
    status: Optional[str] = None


class ProductVariantRead(BaseModel):
    id: int
    product_id: int
    sku: str
    barcode: Optional[str] = None
    unit_price: Decimal
    currency: str
    is_default: bool
    status: str

    class Config:
        from_attributes = True


class ProductRead(BaseModel):
    id: int
    company_id: int
    name: str
    brand: Optional[str] = None
    category: Optional[str] = None
    status: str
    archived_at: Optional[datetime] = None
    variants: List[ProductVariantRead] = []

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Sales
# ---------------------------------------------------------------------------


class SaleLineCreate(BaseModel):
    variant_id: int
    quantity: Decimal = Field(gt=0)
    # Optional override; when omitted the variant's live unit_price is
    # snapshotted onto the line (see the price-snapshot discipline).
    unit_price: Optional[Decimal] = Field(default=None, ge=0)


class SaleCreate(BaseModel):
    rep_private_user_id: int
    credited_to_private_user_id: Optional[int] = None
    outlet_id: Optional[int] = None
    sold_at: datetime
    payment_status: Optional[str] = Field(default="paid")
    payment_method: Optional[str] = Field(default=None, max_length=30)
    collected_amount: Optional[Decimal] = Field(default=None, ge=0)
    collected_at: Optional[datetime] = None
    currency: Optional[str] = Field(default=None, min_length=3, max_length=3)
    source: Optional[str] = Field(default="admin")
    client_uuid: Optional[str] = Field(default=None, max_length=64)
    notes: Optional[str] = None
    lines: List[SaleLineCreate] = Field(min_length=1)

    @field_validator("payment_status")
    @classmethod
    def _check_payment_status(cls, v: Optional[str]) -> Optional[str]:
        return _validate_payment_status(v)

    @field_validator("payment_method")
    @classmethod
    def _check_payment_method(cls, v: Optional[str]) -> Optional[str]:
        return _validate_payment_method(v)


class SaleUpdate(BaseModel):
    """Admin edit of sale *attributes* — payment, outlet and notes. Line items
    are intentionally immutable so an approved sale's commission math can never
    silently change out from under a finalized period."""

    payment_status: Optional[str] = None
    payment_method: Optional[str] = Field(default=None, max_length=30)
    collected_amount: Optional[Decimal] = Field(default=None, ge=0)
    outlet_id: Optional[int] = None
    notes: Optional[str] = None

    @field_validator("payment_status")
    @classmethod
    def _check_payment_status(cls, v: Optional[str]) -> Optional[str]:
        return _validate_payment_status(v)

    @field_validator("payment_method")
    @classmethod
    def _check_payment_method(cls, v: Optional[str]) -> Optional[str]:
        return _validate_payment_method(v)


class SaleReopenRequest(BaseModel):
    """Re-versions a voided sale. Defaults back to `approved`; a mobile sale
    that was voided before review can be reopened to `submitted` instead."""

    status: Optional[str] = Field(default="approved")


class SaleLineRead(BaseModel):
    id: int
    variant_id: int
    quantity: Decimal
    unit_price_snapshot: Decimal
    line_total: Decimal
    # Enriched so a receipt/list reads as "what was sold" without a second
    # round-trip. Populated from the ORM relationships in crud.get_sale /
    # list_sales (see SaleLine.product_name / variant_sku properties).
    product_id: Optional[int] = None
    product_name: Optional[str] = None
    variant_sku: Optional[str] = None
    uom: Optional[str] = None

    class Config:
        from_attributes = True


class SaleRead(BaseModel):
    id: int
    company_id: int
    rep_private_user_id: int
    credited_to_private_user_id: Optional[int] = None
    outlet_id: Optional[int] = None
    sold_at: datetime
    status: str
    payment_status: str
    payment_method: Optional[str] = None
    collected_amount: Optional[Decimal] = None
    collected_at: Optional[datetime] = None
    currency: str
    source: str
    client_uuid: Optional[str] = None
    visit_verified: Optional[bool] = None
    visit_distance_m: Optional[float] = None
    reviewed_by_user_id: Optional[int] = None
    reviewed_at: Optional[datetime] = None
    notes: Optional[str] = None
    lines: List[SaleLineRead] = []

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Commission plans, rules, assignments
# ---------------------------------------------------------------------------


class CommissionRuleCreate(BaseModel):
    rule_type: str = Field(default="flat_percent", description="flat_percent (Phase 0)")
    params: Dict[str, Any] = Field(default_factory=dict)
    scope_category: Optional[str] = Field(default=None, max_length=120)
    scope_product_id: Optional[int] = None
    scope_variant_id: Optional[int] = None
    scope_option_value_id: Optional[int] = None
    effective_from: Optional[date] = None
    effective_to: Optional[date] = None


class CommissionRuleRead(BaseModel):
    id: int
    plan_id: int
    rule_type: str
    params: Dict[str, Any]
    scope_category: Optional[str] = None
    scope_product_id: Optional[int] = None
    scope_variant_id: Optional[int] = None
    scope_option_value_id: Optional[int] = None
    effective_from: Optional[date] = None
    effective_to: Optional[date] = None

    class Config:
        from_attributes = True


class CommissionPlanCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: Optional[str] = None
    trigger: str = Field(default="on_sale", description="on_sale (Phase 0)")
    rules: List[CommissionRuleCreate] = Field(default_factory=list)
    effective_from: Optional[date] = None


class CommissionPlanRevise(BaseModel):
    """Copy-on-write revision of an active plan. A new version is created as a
    `draft` and only affects pay once activated. Omitted fields inherit the
    family's current values."""
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = None
    trigger: Optional[str] = None
    rules: Optional[List[CommissionRuleCreate]] = None
    effective_from: Optional[date] = None


class CommissionPlanRead(BaseModel):
    id: int
    company_id: int
    name: str
    description: Optional[str] = None
    trigger: str
    status: str
    archived_at: Optional[datetime] = None
    version: int = 1
    family_id: Optional[int] = None
    effective_from: Optional[date] = None
    effective_to: Optional[date] = None
    created_by_user_id: Optional[int] = None
    approved_by_user_id: Optional[int] = None
    approved_at: Optional[datetime] = None
    rules: List[CommissionRuleRead] = []

    class Config:
        from_attributes = True


class PlanAssignmentCreate(BaseModel):
    private_user_id: int
    effective_from: Optional[date] = None
    effective_to: Optional[date] = None


class PlanAssignmentRead(BaseModel):
    id: int
    plan_id: int
    private_user_id: int
    effective_from: Optional[date] = None
    effective_to: Optional[date] = None

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Commission runs
# ---------------------------------------------------------------------------


class CommissionRunCreate(BaseModel):
    period_start: date
    period_end: date


class CommissionLineItemRead(BaseModel):
    id: int
    run_id: int
    private_user_id: int
    rule_id: Optional[int] = None
    amount: Decimal
    currency: str
    trace: Optional[Dict[str, Any]] = None

    class Config:
        from_attributes = True


class CommissionPayableRead(BaseModel):
    id: int
    company_id: int
    private_user_id: int
    run_id: int
    amount: Decimal
    currency: str
    payout_channel: str
    status: str
    one_off_allowance_id: Optional[int] = None
    settled_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CommissionRunRead(BaseModel):
    id: int
    company_id: int
    period_start: date
    period_end: date
    status: str
    currency: str
    computed_at: Optional[datetime] = None
    approved_at: Optional[datetime] = None
    approved_by_user_id: Optional[int] = None
    line_items: List[CommissionLineItemRead] = []
    payables: List[CommissionPayableRead] = []

    class Config:
        from_attributes = True


class CommissionRunSummary(BaseModel):
    """Lightweight run view for list endpoints (no line items)."""

    id: int
    company_id: int
    period_start: date
    period_end: date
    status: str
    currency: str
    computed_at: Optional[datetime] = None
    approved_at: Optional[datetime] = None
    payable_total: Decimal = Decimal("0.00")

    class Config:
        from_attributes = True


class CommissionPushRequest(BaseModel):
    """Push approved payables to payroll for a given payslip period.

    Defaults to the run's own period when omitted.
    """

    payable_in_year: Optional[int] = None
    payable_in_month: Optional[int] = Field(default=None, ge=1, le=12)


# ---------------------------------------------------------------------------
# Phase 1 — outlets, geo-verified capture, sync, approval queue
# ---------------------------------------------------------------------------


class ManualSettlementRequest(BaseModel):
    """Settle off-payroll (contractor) commission outside payroll."""

    reference: Optional[str] = Field(default=None, max_length=160)
    private_user_id: Optional[int] = None


class OutletCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    code: Optional[str] = Field(default=None, max_length=40)
    address: Optional[str] = Field(default=None, max_length=300)
    contact_name: Optional[str] = Field(default=None, max_length=120)
    phone: Optional[str] = Field(default=None, max_length=40)
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    radius_meters: int = Field(default=150, ge=10, le=5000)
    assigned_rep_private_user_id: Optional[int] = None
    visit_cadence: Optional[str] = None
    credit_terms_days: Optional[int] = Field(default=None, ge=0)


class OutletUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    code: Optional[str] = Field(default=None, max_length=40)
    address: Optional[str] = Field(default=None, max_length=300)
    contact_name: Optional[str] = Field(default=None, max_length=120)
    phone: Optional[str] = Field(default=None, max_length=40)
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    radius_meters: Optional[int] = Field(default=None, ge=10, le=5000)
    assigned_rep_private_user_id: Optional[int] = None
    visit_cadence: Optional[str] = None
    credit_terms_days: Optional[int] = Field(default=None, ge=0)
    status: Optional[str] = None


class OutletRead(BaseModel):
    id: int
    company_id: int
    name: str
    code: Optional[str] = None
    address: Optional[str] = None
    contact_name: Optional[str] = None
    phone: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    radius_meters: int
    assigned_rep_private_user_id: Optional[int] = None
    visit_cadence: Optional[str] = None
    credit_terms_days: Optional[int] = None
    status: str

    class Config:
        from_attributes = True


class GeoPoint(BaseModel):
    latitude: float
    longitude: float
    accuracy_m: Optional[float] = None


class SaleSyncItem(BaseModel):
    """One offline-captured sale in a sync batch. `client_uuid` is mandatory so
    a retried flush is idempotent."""

    client_uuid: str = Field(min_length=8, max_length=64)
    rep_private_user_id: int
    outlet_id: Optional[int] = None
    sold_at: datetime
    geo: Optional[GeoPoint] = None
    currency: Optional[str] = Field(default=None, min_length=3, max_length=3)
    payment_method: Optional[str] = Field(default=None, max_length=30)
    notes: Optional[str] = None
    lines: List[SaleLineCreate] = Field(min_length=1)

    @field_validator("payment_method")
    @classmethod
    def _check_payment_method(cls, v: Optional[str]) -> Optional[str]:
        return _validate_payment_method(v)


class SaleSyncRequest(BaseModel):
    items: List[SaleSyncItem] = Field(min_length=1)


class SaleSyncItemResult(BaseModel):
    client_uuid: str
    sale_id: Optional[int] = None
    outcome: str  # created | duplicate | error
    detail: Optional[str] = None


class SaleSyncResult(BaseModel):
    accepted: int
    duplicates: int
    errors: int
    results: List[SaleSyncItemResult]


class SaleReviewRequest(BaseModel):
    decision: str = Field(description="approve | reject")
    notes: Optional[str] = Field(default=None, max_length=500, description="Required when rejecting")


class SaleBulkReviewRequest(BaseModel):
    """Approve/reject a batch of submitted sales in one round-trip (month-end).

    Best-effort: a sale that can't be reviewed (already void, wrong company) is
    reported in `failed` rather than aborting the whole batch."""

    sale_ids: List[int] = Field(min_length=1, max_length=500)
    decision: str = Field(description="approve | reject")
    notes: Optional[str] = Field(default=None, max_length=500, description="Required when rejecting")


class SaleBulkReviewItemResult(BaseModel):
    sale_id: int
    ok: bool
    status: Optional[str] = None
    detail: Optional[str] = None


class SaleBulkReviewResult(BaseModel):
    decision: str
    succeeded: int
    failed: int
    results: List[SaleBulkReviewItemResult]


# ---------------------------------------------------------------------------
# Phase 2 — full catalog, UoM, prices, targets, leaderboards
# ---------------------------------------------------------------------------


class ProductCategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    parent_id: Optional[int] = None


class ProductCategoryUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    parent_id: Optional[int] = None


class ProductCategoryRead(BaseModel):
    id: int
    company_id: int
    parent_id: Optional[int] = None
    name: str

    class Config:
        from_attributes = True


class ProductOptionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    values: List[str] = Field(default_factory=list)


class OptionValueRead(BaseModel):
    id: int
    option_id: int
    value: str

    class Config:
        from_attributes = True


class ProductOptionRead(BaseModel):
    id: int
    company_id: int
    name: str
    values: List[OptionValueRead] = []

    class Config:
        from_attributes = True


class UnitOfMeasureCreate(BaseModel):
    code: str = Field(min_length=1, max_length=20)
    name: str = Field(min_length=1, max_length=60)
    base_uom_id: Optional[int] = None
    factor: Decimal = Field(default=Decimal("1"), gt=0)


class UnitOfMeasureRead(BaseModel):
    id: int
    company_id: int
    code: str
    name: str
    base_uom_id: Optional[int] = None
    factor: Decimal

    class Config:
        from_attributes = True


class ProductPriceCreate(BaseModel):
    variant_id: int
    amount: Decimal = Field(ge=0)
    currency: Optional[str] = Field(default=None, min_length=3, max_length=3)
    territory: Optional[str] = Field(default=None, max_length=80)
    effective_from: Optional[date] = None
    effective_to: Optional[date] = None


class ProductPriceRead(BaseModel):
    id: int
    company_id: int
    variant_id: int
    amount: Decimal
    currency: str
    territory: Optional[str] = None
    effective_from: Optional[date] = None
    effective_to: Optional[date] = None

    class Config:
        from_attributes = True


class VariantCreate(BaseModel):
    """Full Phase 2 variant: SKU + barcode + option values + sell unit + price."""

    sku: str = Field(min_length=1, max_length=64)
    barcode: Optional[str] = Field(default=None, max_length=64)
    unit_price: Decimal = Field(default=Decimal("0.00"), ge=0)
    currency: Optional[str] = Field(default=None, min_length=3, max_length=3)
    is_default: bool = False
    sell_uom_id: Optional[int] = None
    option_value_ids: List[int] = Field(default_factory=list)


class VariantUpdate(BaseModel):
    sku: Optional[str] = Field(default=None, min_length=1, max_length=64)
    barcode: Optional[str] = Field(default=None, max_length=64)
    unit_price: Optional[Decimal] = Field(default=None, ge=0)
    currency: Optional[str] = Field(default=None, min_length=3, max_length=3)
    is_default: Optional[bool] = None
    sell_uom_id: Optional[int] = None
    status: Optional[str] = None


class SalesTargetCreate(BaseModel):
    private_user_id: int
    period_start: date
    period_end: date
    scope_category: Optional[str] = Field(default=None, max_length=120)
    target_amount: Optional[Decimal] = Field(default=None, ge=0)
    target_units: Optional[Decimal] = Field(default=None, ge=0)
    accelerators: Optional[List[Dict[str, Any]]] = Field(
        default=None,
        description='Bands: [{"attainment_pct": "120", "percent": "3"}] raising the payout percent.',
    )


class SalesTargetRead(BaseModel):
    id: int
    company_id: int
    private_user_id: int
    period_start: date
    period_end: date
    scope_category: Optional[str] = None
    target_amount: Optional[Decimal] = None
    target_units: Optional[Decimal] = None
    accelerators: Optional[List[Dict[str, Any]]] = None

    class Config:
        from_attributes = True


class LeaderboardEntry(BaseModel):
    private_user_id: int
    name: Optional[str] = None
    amount: Decimal


class LeaderboardRead(BaseModel):
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    entries: List[LeaderboardEntry] = []


class LiabilityAccrualRead(BaseModel):
    """Earned-but-unpaid commission: settled payables linked to a one-off but
    not yet on a finalized payslip, plus approved-but-unpushed payables."""
    company_id: int
    pending_payroll: Decimal
    settled_pending_payslip: Decimal
    total_outstanding: Decimal
    currency: str


# ---------------------------------------------------------------------------
# Phase 3 — credit assignments, clawbacks, ERP reconcile
# ---------------------------------------------------------------------------


class CreditAssignmentCreate(BaseModel):
    private_user_id: int
    outlet_id: Optional[int] = None
    territory: Optional[str] = Field(default=None, max_length=80)
    account: Optional[str] = Field(default=None, max_length=120)
    split_percent: Decimal = Field(default=Decimal("100"), ge=0, le=1000)
    effective_from: Optional[date] = None
    effective_to: Optional[date] = None


class CreditAssignmentRead(BaseModel):
    id: int
    company_id: int
    private_user_id: int
    outlet_id: Optional[int] = None
    territory: Optional[str] = None
    account: Optional[str] = None
    split_percent: Decimal
    effective_from: Optional[date] = None
    effective_to: Optional[date] = None

    class Config:
        from_attributes = True


class ClawbackCreate(BaseModel):
    private_user_id: int
    amount: Decimal = Field(gt=0, description="Positive amount to recover; stored as a negative earning")
    reason: str = Field(min_length=1, max_length=500)
    payable_in_year: Optional[int] = Field(default=None, ge=2000, le=2100)
    payable_in_month: Optional[int] = Field(default=None, ge=1, le=12)


class ErpReconcileItem(BaseModel):
    external_id: str
    sku: str
    quantity: Decimal
    sold_at: datetime
    rep_private_user_id: Optional[int] = None


class ErpReconcileRequest(BaseModel):
    items: List[ErpReconcileItem]
    commit: bool = Field(default=False, description="When true, create sales for new rows (idempotent)")


class ErpReconcileResult(BaseModel):
    received: int
    new: int
    duplicates: int
    unmatched_sku: int
    created: int = 0
    unmatched: List[dict] = []


# ---------------------------------------------------------------------------
# Returns / credit-notes
# ---------------------------------------------------------------------------


class SalesReturnLineCreate(BaseModel):
    sale_line_id: int
    quantity: Decimal = Field(gt=0)


class SalesReturnCreate(BaseModel):
    sale_id: int
    returned_at: datetime
    reason: Optional[str] = Field(default=None, max_length=300)
    lines: List[SalesReturnLineCreate] = Field(min_length=1)


class SalesReturnLineRead(BaseModel):
    id: int
    sale_line_id: int
    variant_id: int
    quantity: Decimal
    unit_price_snapshot: Decimal
    line_total: Decimal

    class Config:
        from_attributes = True


class SalesReturnRead(BaseModel):
    id: int
    company_id: int
    sale_id: int
    returned_at: datetime
    reason: Optional[str] = None
    currency: str
    lines: List[SalesReturnLineRead] = []

    class Config:
        from_attributes = True
