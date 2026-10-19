"""Commission engine (Phase 0) + the single bridge into payroll.

Phase 0 implements one rule type — `flat_percent` — evaluated at period close
into a `CommissionRun` of `CommissionLineItem`s, aggregated per rep into a
`CommissionPayable`. Pushing an approved run writes exactly one
`EmployeeOneOffAllowance` per on-payroll rep, which the existing payroll engine
already folds into the payslip. Nothing else in payroll is touched.

The discipline: sales are pulled by `sold_at` within the period; the variant's
price is already snapshotted on the sale line, so a later price change never
rewrites a closed run.
"""

from __future__ import annotations

from datetime import date, datetime, time, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from core.model import (
    CommissionLineItem,
    CommissionPayable,
    CommissionPlan,
    CommissionPlanAssignment,
    CommissionRule,
    CommissionRun,
    CreditAssignment,
    EmployeeOneOffAllowance,
    PrivateUser,
    Product,
    ProductVariant,
    ProductVariantOptionValue,
    SalaryComponent,
    Sale,
    SaleLine,
    SalesReturn,
    SalesReturnLine,
    SalesTarget,
    UnitOfMeasure,
)
from db_models.crud.field_sales import effective_plan_version

COMMISSION_COMPONENT_CODE = "COMMISSION"
_CENT = Decimal("0.01")


def _q(amount: Decimal) -> Decimal:
    return Decimal(amount).quantize(_CENT, rounding=ROUND_HALF_UP)


def _period_bounds(period_start: date, period_end: date) -> Tuple[datetime, datetime]:
    return (
        datetime.combine(period_start, time.min, tzinfo=timezone.utc),
        datetime.combine(period_end, time.max, tzinfo=timezone.utc),
    )


# ---------------------------------------------------------------------------
# Salary component (the payslip line this module pays through)
# ---------------------------------------------------------------------------


def ensure_commission_component(db: Session, company_id: int) -> SalaryComponent:
    """Return the company's canonical 'Commission' earning component, creating
    it on first use. Commission is taxable pay on top of basic, folded in as a
    one-off — never inside basic. Idempotent on (company_id, CODE)."""
    existing = (
        db.query(SalaryComponent)
        .filter(
            SalaryComponent.company_id == company_id,
            SalaryComponent.code == COMMISSION_COMPONENT_CODE,
        )
        .one_or_none()
    )
    if existing is not None:
        return existing
    from services.salary_resolver import infer_statutory_base_codes

    comp = SalaryComponent(
        company_id=company_id,
        code=COMMISSION_COMPONENT_CODE,
        label="Commission",
        kind="earning",
        category="earning.commission",
        is_basic=False,
        is_taxable=True,
        is_recurring=False,
        is_one_off=True,
        # Statutory bases come from the shared resolver (the same rule payroll
        # applies), not a hardcoded literal — commission is a non-basic taxable
        # earning → PAYE + CSG (no NSF). Stays correct if that rule changes.
        statutory_base_codes=infer_statutory_base_codes(
            kind="earning", is_basic=False, is_taxable=True
        ),
    )
    db.add(comp)
    db.flush()
    return comp


# ---------------------------------------------------------------------------
# Rule scope matching
# ---------------------------------------------------------------------------


def _scope_matches(
    rule: CommissionRule,
    product: Product,
    variant: ProductVariant,
    option_value_ids: Optional[set] = None,
) -> bool:
    if rule.scope_variant_id is not None and rule.scope_variant_id != variant.id:
        return False
    if rule.scope_product_id is not None and rule.scope_product_id != product.id:
        return False
    if rule.scope_category is not None and rule.scope_category != product.category:
        return False
    if rule.scope_option_value_id is not None:
        if not option_value_ids or rule.scope_option_value_id not in option_value_ids:
            return False
    return True


def _rule_active(rule: CommissionRule, period_start: date, period_end: date) -> bool:
    if rule.effective_from is not None and rule.effective_from > period_end:
        return False
    if rule.effective_to is not None and rule.effective_to < period_start:
        return False
    return True


# ---------------------------------------------------------------------------
# Compute
# ---------------------------------------------------------------------------


def _get_or_create_draft_run(
    db: Session, company_id: int, period_start: date, period_end: date, actor_user_id: Optional[int]
) -> CommissionRun:
    run = (
        db.query(CommissionRun)
        .filter(
            CommissionRun.company_id == company_id,
            CommissionRun.period_start == period_start,
            CommissionRun.period_end == period_end,
            CommissionRun.status != "cancelled",
        )
        .one_or_none()
    )
    if run is not None:
        if run.status == "approved":
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Commission run {run.id} for {period_start}..{period_end} is "
                    "already approved and immutable. Create the next period instead."
                ),
            )
        # Re-compute a draft in place: wipe derived rows.
        db.query(CommissionLineItem).filter(CommissionLineItem.run_id == run.id).delete()
        db.query(CommissionPayable).filter(CommissionPayable.run_id == run.id).delete()
        db.flush()
        return run

    run = CommissionRun(
        company_id=company_id,
        period_start=period_start,
        period_end=period_end,
        status="draft",
        currency="MUR",
        created_by_user_id=actor_user_id,
    )
    db.add(run)
    db.flush()
    return run


def _sale_collection_ratio(sale: Sale, trigger: str) -> Decimal:
    """Fraction of a sale that earns when the plan earns on collection. Paid =
    fully earned; partial = pro-rata to the amount collected; pending = 0."""
    if trigger != "on_collection":
        return Decimal("1")
    if (sale.payment_status or "paid") == "paid":
        return Decimal("1")
    total = sum((Decimal(l.line_total) for l in sale.lines), Decimal("0.00"))
    collected = Decimal(sale.collected_amount or 0)
    if total <= 0 or collected <= 0:
        return Decimal("0")
    return min(Decimal("1"), collected / total)


def _uom_factor(db: Session, uom_id: Optional[int], cache: Dict[int, Decimal]) -> Decimal:
    """Base units per one unit of `uom_id`, memoised for the run."""
    if not uom_id:
        return Decimal("1")
    if uom_id in cache:
        return cache[uom_id]
    uom = db.query(UnitOfMeasure).filter(UnitOfMeasure.id == uom_id).one_or_none()
    factor = Decimal(uom.factor) if uom is not None else Decimal("1")
    cache[uom_id] = factor
    return factor


def _line_factor(db: Session, line: SaleLine, variant: ProductVariant, cache: Dict[int, Decimal]) -> Decimal:
    """Base units per one sold unit (UoM pack factor), for volumetric rules."""
    return _uom_factor(db, line.uom_id or variant.sell_uom_id, cache)


def _target_attainment(
    db: Session, rep_id: int, rule: CommissionRule, period_start: date, period_end: date,
    actual_amount: Decimal, actual_units: Decimal,
) -> Tuple[Optional[Decimal], Optional[SalesTarget]]:
    """Ratio of actual to the rep's most specific target for this rule's scope
    and period. None when no target is configured."""
    q = db.query(SalesTarget).filter(
        SalesTarget.private_user_id == rep_id,
        SalesTarget.period_start <= period_end,
        SalesTarget.period_end >= period_start,
    )
    rows = q.all()
    scoped = [t for t in rows if rule.scope_category is None or t.scope_category == rule.scope_category]
    if not scoped:
        return None, None
    target = scoped[0]
    metric = str((rule.params or {}).get("metric", "amount")).lower()
    if metric == "units":
        denom = Decimal(target.target_units or 0)
        actual = actual_units
    else:
        denom = Decimal(target.target_amount or 0)
        actual = actual_amount
    if denom <= 0:
        return None, target
    # Mid-period pro-rating: if the rule is only effective for part of the
    # period, the quota it must beat is reduced to the same fraction.
    eff_from = max(period_start, rule.effective_from) if rule.effective_from else period_start
    eff_to = min(period_end, rule.effective_to) if rule.effective_to else period_end
    if eff_to >= eff_from:
        active_days = (eff_to - eff_from).days + 1
        period_days = (period_end - period_start).days + 1
        if period_days > 0 and 0 < active_days < period_days:
            denom = denom * Decimal(active_days) / Decimal(period_days)
    return actual / denom, target


def _compute_rule_amount(
    db: Session,
    rule: CommissionRule,
    bucket: dict,
    rep_id: int,
    period_start: date,
    period_end: date,
) -> Tuple[Decimal, dict]:
    """The amount a single (rep, rule) bucket earns, plus its trace."""
    params = rule.params or {}
    base_value = bucket["base_value"]
    base_units = bucket["base_units"]
    lines = bucket["lines"]

    if rule.rule_type in ("flat_percent", "spiff") and "amount" not in params:
        pct = Decimal(str(params.get("percent", "0")))
        amount = _q(base_value * pct / Decimal("100"))
        trace = {"rule_type": rule.rule_type, "percent": str(pct), "base": str(_q(base_value))}
    elif rule.rule_type in ("per_unit", "spiff"):
        per = Decimal(str(params.get("amount", "0")))
        amount = _q(base_units * per)
        trace = {"rule_type": rule.rule_type, "amount_per_unit": str(per), "units": str(_q(base_units))}
    elif rule.rule_type == "tiered":
        bands = params.get("bands", [])
        chosen = None
        for band in bands:
            cap = band.get("up_to_units")
            if cap is None or base_units <= Decimal(str(cap)):
                chosen = band
                break
        pct = Decimal(str((chosen or {}).get("percent", "0")))
        amount = _q(base_value * pct / Decimal("100"))
        trace = {"rule_type": "tiered", "band": chosen, "units": str(_q(base_units)), "base": str(_q(base_value))}
    elif rule.rule_type == "target":
        ratio, target = _target_attainment(
            db, rep_id, rule, period_start, period_end, base_value, base_units
        )
        threshold = Decimal(str(params.get("attainment_pct", "100"))) / Decimal("100")
        pct = Decimal(str(params.get("percent", "0")))
        # Accelerator bands raise the payout percent once attainment clears them.
        bands = (target.accelerators if target else None) or []
        best = None
        for band in bands:
            band_pct = Decimal(str(band.get("attainment_pct", "0")))
            if ratio is not None and ratio >= band_pct / Decimal("100"):
                if best is None or band_pct > Decimal(str(best.get("attainment_pct", "0"))):
                    best = band
        if best is not None:
            pct = Decimal(str(best.get("percent", pct)))
        attained = ratio is not None and ratio >= threshold
        amount = _q(base_value * pct / Decimal("100")) if attained else Decimal("0.00")
        trace = {
            "rule_type": "target",
            "attainment": str(_q(ratio)) if ratio is not None else None,
            "threshold": str(threshold),
            "percent": str(pct),
            "accelerated": best is not None,
            "attained": attained,
            "target_id": target.id if target else None,
        }
    else:
        amount, trace = Decimal("0.00"), {"rule_type": rule.rule_type, "skipped": "unsupported"}

    trace["amount"] = str(_q(amount))
    trace["lines"] = lines
    return _q(amount), trace


def compute_run(
    db: Session,
    company_id: int,
    period_start: date,
    period_end: date,
    actor_user_id: Optional[int] = None,
) -> CommissionRun:
    """Evaluate every approved sale in the period against each credited rep's
    assigned plan and write line items + payables onto a draft run.

    Supports all five rule types (flat %, per-unit, tiered, target, SPIFF) and
    both triggers (on_sale / on_collection). Buckets are keyed on
    (rep, rule); volumetric/target rules are applied to the bucket's aggregate.
    """
    if period_end < period_start:
        raise HTTPException(status_code=422, detail="period_end must be on or after period_start")

    run = _get_or_create_draft_run(db, company_id, period_start, period_end, actor_user_id)
    start_dt, end_dt = _period_bounds(period_start, period_end)

    sales: List[Sale] = (
        db.query(Sale)
        .filter(
            Sale.company_id == company_id,
            Sale.status == "approved",
            Sale.sold_at >= start_dt,
            Sale.sold_at <= end_dt,
        )
        .order_by(Sale.id)
        .all()
    )

    buckets: Dict[Tuple[int, int], dict] = {}
    rules_by_id: Dict[int, CommissionRule] = {}
    plan_cache: Dict[Tuple[int, date, date], Optional[CommissionPlan]] = {}
    uom_cache: Dict[int, Decimal] = {}
    opt_cache: Dict[int, set] = {}

    for sale in sales:
        credits = _resolve_credits(db, sale, period_start, period_end)
        if not credits:
            continue
        for rep_id, weight in credits:
            assignments = _active_assignments(db, rep_id, period_start, period_end)
            if not assignments:
                continue
            for assignment in assignments:
                plan = effective_plan_version(db, assignment.plan_id, period_start, period_end, plan_cache)
                if plan is None:
                    continue
                trigger = plan.trigger or "on_sale"
                ratio = _sale_collection_ratio(sale, trigger) * weight
                if ratio == 0:
                    continue
                for rule in plan.rules:
                    if rule.rule_type == "team_override":
                        continue  # evaluated over the team's earnings, not sale lines
                    if not _rule_active(rule, period_start, period_end):
                        continue
                    rules_by_id[rule.id] = rule
                    for line in sale.lines:
                        product, variant = _line_product(db, company_id, line)
                        if product is None or variant is None:
                            continue
                        if variant.id not in opt_cache:
                            opt_cache[variant.id] = _variant_option_value_ids(db, variant.id)
                        if not _scope_matches(rule, product, variant, opt_cache[variant.id]):
                            continue
                        value = Decimal(line.line_total) * ratio
                        units = Decimal(line.quantity) * _line_factor(db, line, variant, uom_cache) * weight
                        key = (rep_id, rule.id)
                        bucket = buckets.setdefault(
                            key, {"base_value": Decimal("0.00"), "base_units": Decimal("0.00"), "lines": []}
                        )
                        bucket["base_value"] += value
                        bucket["base_units"] += units
                        bucket["lines"].append({
                            "sale_id": sale.id,
                            "variant_id": variant.id,
                            "line_total": str(_q(Decimal(line.line_total))),
                            "earned_ratio": str(_q(ratio)),
                            "amount": str(_q(value)),
                            "units": str(_q(units)),
                        })

    returns: List[SalesReturn] = (
        db.query(SalesReturn)
        .filter(
            SalesReturn.company_id == company_id,
            SalesReturn.returned_at >= start_dt,
            SalesReturn.returned_at <= end_dt,
        )
        .order_by(SalesReturn.id)
        .all()
    )

    for ret in returns:
        sale = ret.sale
        if sale is None or sale.status != "approved":
            continue
        credits = _resolve_credits(db, sale, period_start, period_end)
        for rep_id, weight in credits:
            for assignment in _active_assignments(db, rep_id, period_start, period_end):
                plan = effective_plan_version(db, assignment.plan_id, period_start, period_end, plan_cache)
                if plan is None:
                    continue
                ratio = _sale_collection_ratio(sale, plan.trigger or "on_sale") * weight
                if ratio == 0:
                    continue
                for rule in plan.rules:
                    if rule.rule_type == "team_override":
                        continue
                    if not _rule_active(rule, period_start, period_end):
                        continue
                    rules_by_id[rule.id] = rule
                    for rline in ret.lines:
                        variant = (
                            db.query(ProductVariant)
                            .filter(ProductVariant.id == rline.variant_id)
                            .one_or_none()
                        )
                        if variant is None:
                            continue
                        product = (
                            db.query(Product)
                            .filter(Product.id == variant.product_id, Product.company_id == company_id)
                            .one_or_none()
                        )
                        if product is None:
                            continue
                        if variant.id not in opt_cache:
                            opt_cache[variant.id] = _variant_option_value_ids(db, variant.id)
                        if not _scope_matches(rule, product, variant, opt_cache[variant.id]):
                            continue
                        uom_id = None
                        sale_line = (
                            db.query(SaleLine)
                            .filter(SaleLine.id == rline.sale_line_id)
                            .one_or_none()
                        )
                        uom_id = sale_line.uom_id if sale_line is not None else None
                        value = -Decimal(rline.line_total) * ratio
                        units = -Decimal(rline.quantity) * _uom_factor(db, uom_id or variant.sell_uom_id, uom_cache) * weight
                        key = (rep_id, rule.id)
                        bucket = buckets.setdefault(
                            key, {"base_value": Decimal("0.00"), "base_units": Decimal("0.00"), "lines": []}
                        )
                        bucket["base_value"] += value
                        bucket["base_units"] += units
                        bucket["lines"].append({
                            "return_id": ret.id,
                            "sale_id": sale.id,
                            "variant_id": variant.id,
                            "line_total": str(_q(-Decimal(rline.line_total))),
                            "earned_ratio": str(_q(ratio)),
                            "amount": str(_q(value)),
                            "units": str(_q(units)),
                            "is_return": True,
                        })

    payable_totals: Dict[int, Decimal] = {}
    for (rep_id, rule_id), bucket in sorted(buckets.items()):
        rule = rules_by_id.get(rule_id)
        if rule is None:
            continue
        amount, trace = _compute_rule_amount(
            db, rule, bucket, rep_id, period_start, period_end
        )
        if amount == 0:
            continue
        db.add(
            CommissionLineItem(
                run_id=run.id,
                private_user_id=rep_id,
                rule_id=rule_id,
                amount=amount,
                currency=run.currency,
                trace=trace,
            )
        )
        payable_totals[rep_id] = payable_totals.get(rep_id, Decimal("0.00")) + amount

    _apply_team_overrides(
        db, company_id, run, period_start, period_end, payable_totals, plan_cache
    )

    for rep_id, total in sorted(payable_totals.items()):
        total = _q(total)
        if total == 0:
            continue
        # Route the payable by the rep's (configurable) payroll status rather
        # than hardcoding a channel — mirrors how payroll keys off payroll_status.
        # An off-payroll rep (contractor, director's fees, …) settles via the
        # 'manual' channel; everyone else rides payroll.
        rep_row = (
            db.query(PrivateUser)
            .filter(PrivateUser.private_user_id == rep_id)
            .one_or_none()
        )
        channel = (
            "manual"
            if rep_row is not None and _is_off_payroll(rep_row, period_start, period_end)
            else "payroll"
        )
        db.add(
            CommissionPayable(
                company_id=company_id,
                private_user_id=rep_id,
                run_id=run.id,
                amount=total,
                currency=run.currency,
                payout_channel=channel,
                status="pending",
            )
        )

    run.computed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(run)
    return run


def _active_assignments(
    db: Session, private_user_id: int, period_start: date, period_end: date
) -> List[CommissionPlanAssignment]:
    q = db.query(CommissionPlanAssignment).filter(
        CommissionPlanAssignment.private_user_id == private_user_id
    )
    rows = q.all()
    return [
        a
        for a in rows
        if (a.effective_from is None or a.effective_from <= period_end)
        and (a.effective_to is None or a.effective_to >= period_start)
    ]


def _resolve_credits(
    db: Session, sale: Sale, period_start: date, period_end: date
) -> List[Tuple[int, Decimal]]:
    """Who earns on this sale, and in what proportion.

    An explicit `credited_to_private_user_id` wins outright. Otherwise
    CreditAssignments matching the sale's outlet / territory / account split the
    credit by `split_percent` (normalised to sum to 1). With no match, the
    entering rep takes the whole sale — the Phase 0 behaviour.
    """
    if sale.credited_to_private_user_id is not None:
        return [(sale.credited_to_private_user_id, Decimal("1"))]

    rows = (
        db.query(CreditAssignment)
        .filter(CreditAssignment.company_id == sale.company_id)
        .all()
    )
    matches = []
    for a in rows:
        if a.effective_from is not None and a.effective_from > period_end:
            continue
        if a.effective_to is not None and a.effective_to < period_start:
            continue
        if a.outlet_id is not None and a.outlet_id == sale.outlet_id:
            matches.append(a)
        elif a.territory is not None and sale.territory and a.territory == sale.territory:
            matches.append(a)
        elif a.account is not None and sale.account and a.account == sale.account:
            matches.append(a)

    if not matches:
        return [(sale.rep_private_user_id, Decimal("1"))]

    total_pct = sum((Decimal(a.split_percent or 0) for a in matches), Decimal("0"))
    if total_pct <= 0:
        return [(sale.rep_private_user_id, Decimal("1"))]
    return [
        (a.private_user_id, Decimal(a.split_percent or 0) / total_pct)
        for a in matches
    ]


def _apply_team_overrides(
    db: Session,
    company_id: int,
    run: CommissionRun,
    period_start: date,
    period_end: date,
    payable_totals: Dict[int, Decimal],
    plan_cache: Dict[Tuple[int, date, date], Optional[CommissionPlan]],
) -> None:
    """Pay managers an override over their direct reports' earned commission.

    Uses each manager's own active plan rules of type `team_override`
    (`params.percent`). Mutates `payable_totals` in place and writes the
    override line items onto the run.
    """
    manager_ids = {
        row[0]
        for row in db.query(PrivateUser.manager_private_user_id)
        .filter(
            PrivateUser.company_id == company_id,
            PrivateUser.manager_private_user_id.isnot(None),
        )
        .distinct()
        .all()
    }
    if not manager_ids:
        return

    reps_by_manager: Dict[int, List[int]] = {}
    for mid in manager_ids:
        reports = [
            row[0]
            for row in db.query(PrivateUser.private_user_id)
            .filter(
                PrivateUser.company_id == company_id,
                PrivateUser.manager_private_user_id == mid,
            )
            .all()
        ]
        if reports:
            reps_by_manager[mid] = reports

    for manager_id, reports in reps_by_manager.items():
        team_earned = sum(
            (payable_totals.get(r, Decimal("0.00")) for r in reports), Decimal("0.00")
        )
        if team_earned == 0:
            continue
        for assignment in _active_assignments(db, manager_id, period_start, period_end):
            plan = effective_plan_version(db, assignment.plan_id, period_start, period_end, plan_cache)
            if plan is None:
                continue
            for rule in plan.rules:
                if rule.rule_type != "team_override":
                    continue
                if not _rule_active(rule, period_start, period_end):
                    continue
                pct = Decimal(str((rule.params or {}).get("percent", "0")))
                amount = _q(team_earned * pct / Decimal("100"))
                if amount == 0:
                    continue
                payable_totals[manager_id] = payable_totals.get(manager_id, Decimal("0.00")) + amount
                db.add(
                    CommissionLineItem(
                        run_id=run.id,
                        private_user_id=manager_id,
                        rule_id=rule.id,
                        amount=amount,
                        currency=run.currency,
                        trace={
                            "rule_type": "team_override",
                            "percent": str(pct),
                            "team_earned": str(_q(team_earned)),
                            "reports": reports,
                            "amount": str(amount),
                        },
                    )
                )


def _variant_option_value_ids(db: Session, variant_id: int) -> set:
    rows = (
        db.query(ProductVariantOptionValue.option_value_id)
        .filter(ProductVariantOptionValue.variant_id == variant_id)
        .all()
    )
    return {r[0] for r in rows}


def _line_product(
    db: Session, company_id: int, line: SaleLine
) -> Tuple[Optional[Product], Optional[ProductVariant]]:
    variant = (
        db.query(ProductVariant)
        .filter(ProductVariant.id == line.variant_id)
        .one_or_none()
    )
    if variant is None:
        return None, None
    product = (
        db.query(Product)
        .filter(Product.id == variant.product_id, Product.company_id == company_id)
        .one_or_none()
    )
    return product, variant


# ---------------------------------------------------------------------------
# Approve
# ---------------------------------------------------------------------------


def approve_run(db: Session, company_id: int, run_id: int, actor_user_id: int) -> CommissionRun:
    run = _get_run(db, company_id, run_id)
    if run.status == "approved":
        return run
    if run.status == "cancelled":
        raise HTTPException(status_code=409, detail="A cancelled run cannot be approved.")
    run.status = "approved"
    run.approved_at = datetime.now(timezone.utc)
    run.approved_by_user_id = actor_user_id
    db.commit()
    db.refresh(run)
    return run


def record_clawback(
    db: Session,
    company_id: int,
    private_user_id: int,
    amount: Decimal,
    reason: str,
    actor_user_id: Optional[int] = None,
    payable_in_year: Optional[int] = None,
    payable_in_month: Optional[int] = None,
) -> dict:
    """Recover over-paid commission as a signed, negative commission earning.

    Adjustments ride the existing payslip row machinery: this writes one
    `EmployeeOneOffAllowance` on the COMMISSION component with a negative
    amount, which the payroll engine folds into the next payslip as a reduction.
    A clawback larger than net pay is carried by the payslip's own negative-net
    handling — it never silently vanishes. Requires a target month to pay in.
    """
    if amount <= 0:
        raise HTTPException(status_code=422, detail="Clawback amount must be positive.")
    rep = (
        db.query(PrivateUser)
        .filter(
            PrivateUser.private_user_id == private_user_id,
            PrivateUser.company_id == company_id,
        )
        .one_or_none()
    )
    if rep is None:
        raise HTTPException(status_code=404, detail=f"Rep {private_user_id} not found in this company")

    today = datetime.now(timezone.utc).date()
    year = payable_in_year or today.year
    month = payable_in_month or today.month
    component = ensure_commission_component(db, company_id)
    one_off = EmployeeOneOffAllowance(
        private_user_id=private_user_id,
        component_id=component.id,
        amount=-_q(amount),
        payable_in_year=year,
        payable_in_month=month,
        notes=f"Commission clawback — {reason}",
        created_by_user_id=actor_user_id,
    )
    db.add(one_off)
    db.commit()
    db.refresh(one_off)
    return {
        "one_off_allowance_id": one_off.id,
        "private_user_id": private_user_id,
        "amount": str(_q(one_off.amount)),
        "payable_in_year": year,
        "payable_in_month": month,
    }


def _get_run(db: Session, company_id: int, run_id: int) -> CommissionRun:
    run = (
        db.query(CommissionRun)
        .filter(CommissionRun.id == run_id, CommissionRun.company_id == company_id)
        .one_or_none()
    )
    if run is None:
        raise HTTPException(status_code=404, detail=f"Commission run {run_id} not found")
    return run


# ---------------------------------------------------------------------------
# The bridge: CommissionPayable -> EmployeeOneOffAllowance
# ---------------------------------------------------------------------------


def _is_off_payroll(rep: PrivateUser, period_start: date, period_end: date) -> bool:
    """True when the rep is marked off-payroll for the period. Off-payroll reps
    earn commission but have no payslip to receive it on, so Phase 0 skips them
    (visibly — returned in the push summary) rather than writing a one-off that
    would silently never be paid."""
    if (rep.payroll_status or "on_payroll") != "off_payroll":
        return False
    if rep.off_payroll_from is not None and rep.off_payroll_from > period_end:
        return False
    if rep.off_payroll_to is not None and rep.off_payroll_to <= period_start:
        return False
    return True


def settle_manual_payouts(
    db: Session,
    company_id: int,
    run_id: int,
    actor_user_id: int,
    reference: Optional[str] = None,
    private_user_id: Optional[int] = None,
) -> dict:
    """Settle manual-channel (off-payroll / contractor) payables for an approved
    run, recording an external payout reference — without writing a one-off or
    touching a payslip. Optionally scope to a single rep via `private_user_id`.
    Only `pending` manual payables move, so re-calling it is safe."""
    run = _get_run(db, company_id, run_id)
    if run.status != "approved":
        raise HTTPException(
            status_code=409,
            detail="Approve the run before settling manual payouts.",
        )

    q = db.query(CommissionPayable).filter(
        CommissionPayable.run_id == run.id,
        CommissionPayable.payout_channel == "manual",
        CommissionPayable.status == "pending",
    )
    if private_user_id is not None:
        q = q.filter(CommissionPayable.private_user_id == private_user_id)
    payables = q.order_by(CommissionPayable.id).all()

    now = datetime.now(timezone.utc)
    settled: List[dict] = []
    for payable in payables:
        payable.status = "settled"
        payable.settled_at = now
        payable.settlement_reference = reference
        settled.append(
            {
                "private_user_id": payable.private_user_id,
                "amount": str(payable.amount),
                "reference": reference,
            }
        )

    db.commit()
    return {"run_id": run.id, "settled": settled, "count": len(settled)}


def push_to_payroll(
    db: Session,
    company_id: int,
    run_id: int,
    actor_user_id: int,
    payable_in_year: Optional[int] = None,
    payable_in_month: Optional[int] = None,
) -> dict:
    """Write one EmployeeOneOffAllowance per on-payroll rep and mark each payable
    settled. Requires an approved run. `payable_in_year/month` default to the
    run's period (so the amount lands on that month's payslip)."""
    run = _get_run(db, company_id, run_id)
    if run.status != "approved":
        raise HTTPException(
            status_code=409,
            detail="Compute and approve the run before pushing it to payroll.",
        )

    year = payable_in_year or run.period_start.year
    month = payable_in_month or run.period_start.month

    component = ensure_commission_component(db, company_id)

    payables = (
        db.query(CommissionPayable)
        .filter(
            CommissionPayable.run_id == run.id,
            CommissionPayable.status == "pending",
        )
        .order_by(CommissionPayable.id)
        .all()
    )

    settled: List[dict] = []
    skipped: List[dict] = []
    for payable in payables:
        if payable.payout_channel != "payroll":
            skipped.append(
                {"private_user_id": payable.private_user_id, "reason": "non_payroll_channel"}
            )
            continue
        rep = (
            db.query(PrivateUser)
            .filter(PrivateUser.private_user_id == payable.private_user_id)
            .one_or_none()
        )
        if rep is None:
            skipped.append(
                {"private_user_id": payable.private_user_id, "reason": "employee_not_found"}
            )
            continue
        if _is_off_payroll(rep, run.period_start, run.period_end):
            skipped.append(
                {"private_user_id": payable.private_user_id, "reason": "off_payroll"}
            )
            continue

        one_off = EmployeeOneOffAllowance(
            private_user_id=rep.private_user_id,
            component_id=component.id,
            amount=payable.amount,
            payable_in_year=year,
            payable_in_month=month,
            notes=f"Commission — run {run.id} ({run.period_start}..{run.period_end})",
            created_by_user_id=actor_user_id,
        )
        db.add(one_off)
        db.flush()
        payable.one_off_allowance_id = one_off.id
        payable.status = "settled"
        payable.settled_at = datetime.now(timezone.utc)
        settled.append(
            {
                "private_user_id": rep.private_user_id,
                "amount": str(payable.amount),
                "one_off_allowance_id": one_off.id,
            }
        )

    db.commit()
    return {
        "run_id": run.id,
        "payable_in_year": year,
        "payable_in_month": month,
        "settled": settled,
        "skipped": skipped,
    }
