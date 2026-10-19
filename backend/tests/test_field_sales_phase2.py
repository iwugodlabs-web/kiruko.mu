"""Phase 2: catalog masters, all five rule types, on-collection, attribute
scope, UoM volumetrics, targets, leaderboards and liability accrual.

Drives the service/CRUD layer directly. Each test builds its own company and
rep and cleans the field-sales tables on teardown.
"""

from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import text

from core.model import Company, PrivateUser, Sale, User
from db_models.crud import field_sales as crud
from schema.field_sales_schema import (
    CommissionPlanCreate,
    CommissionRuleCreate,
    ProductCategoryCreate,
    ProductCreate,
    ProductOptionCreate,
    ProductPriceCreate,
    ProductVariantCreate,
    SaleCreate,
    SaleLineCreate,
    SalesTargetCreate,
    UnitOfMeasureCreate,
    VariantCreate,
)
from services import commission_service as engine


PERIOD_START = date(2026, 5, 1)
PERIOD_END = date(2026, 5, 31)
SOLD_AT = datetime(2026, 5, 10, 9, 0, tzinfo=timezone.utc)
UNIT_PRICE = Decimal("100.00")


@pytest.fixture()
def p2_company(db):
    import uuid

    sfx = uuid.uuid4().hex[:8]
    owner = User(
        user_type="company", email=f"p2-owner-{sfx}@kontokazdemo.com",
        user_name=f"p2-owner-{sfx}", password_hash="x",
    )
    db.add(owner)
    db.flush()
    company = Company(
        user_id=owner.user_id, company_name=f"Phase Two Co. {sfx}",
        email=f"p2-co-{sfx}@kontokazdemo.com", brn=f"P2_BRN_{sfx}", country_code="MU",
    )
    db.add(company)
    db.flush()
    u = User(user_type="private", email=f"p2-rep-{sfx}@kontokazdemo.com",
             user_name=f"p2-rep-{sfx}", password_hash="x")
    db.add(u)
    db.flush()
    rep = PrivateUser(
        user_id=u.user_id, first_name="Priya", last_name="Rep",
        company_id=company.company_id, pass_port_number=f"P2_REP_{sfx}", role="employee",
    )
    db.add(rep)
    db.flush()
    yield company, rep

    db.rollback()
    for stmt in [
        "DELETE FROM commission_payables",
        "DELETE FROM commission_line_items",
        "DELETE FROM commission_runs",
        "DELETE FROM commission_plan_assignments",
        "DELETE FROM commission_rules",
        "DELETE FROM commission_plans",
        "DELETE FROM sales_return_lines",
        "DELETE FROM sales_returns",
        "DELETE FROM sale_lines",
        "DELETE FROM sales",
        "DELETE FROM product_variant_option_values",
        "DELETE FROM product_prices",
        "DELETE FROM product_variants",
        "DELETE FROM product_categories",
        "DELETE FROM option_values",
        "DELETE FROM product_options",
        "DELETE FROM units_of_measure",
        "DELETE FROM products",
        "DELETE FROM sales_targets",
    ]:
        db.execute(text(stmt))
    db.commit()


def _product(db, company, *, sku="P2-SKU", price=UNIT_PRICE, variant=None):
    return crud.create_product(
        db, company.company_id,
        ProductCreate(
            name=f"Product {sku}", category="Beverages",
            default_variant=variant or ProductVariantCreate(sku=sku, unit_price=price),
        ),
    )


def _sale(db, company, rep, variant_id, *, qty=Decimal("10"), **sale_fields):
    sale = crud.create_sale(
        db, company.company_id,
        SaleCreate(
            rep_private_user_id=rep.private_user_id,
            sold_at=SOLD_AT,
            lines=[SaleLineCreate(variant_id=variant_id, quantity=qty)],
        ),
        created_by_user_id=None,
    )
    for k, v in sale_fields.items():
        setattr(sale, k, v)
    db.flush()
    return sale


def _plan(db, company, rep, rules, *, trigger="on_sale"):
    plan = crud.create_plan(
        db, company.company_id,
        CommissionPlanCreate(
            name=f"P2 plan {trigger} {len(rules)} r{rep.private_user_id}",
            trigger=trigger, rules=rules,
        ),
    )
    crud.assign_plan(db, company.company_id, plan.id, rep.private_user_id,
                     effective_from=date(2026, 1, 1))
    return plan


# ---------------------------------------------------------------------------
# Rule types
# ---------------------------------------------------------------------------


def test_per_unit_rule(db, p2_company):
    company, rep = p2_company
    product = _product(db, company)
    _sale(db, company, rep, product.variants[0].id, qty=Decimal("10"))
    _plan(db, company, rep, [CommissionRuleCreate(rule_type="per_unit", params={"amount": "5"})])

    run = engine.compute_run(db, company.company_id, PERIOD_START, PERIOD_END)
    assert Decimal(run.payables[0].amount) == Decimal("50.00")  # 10 units × 5
    assert run.line_items[0].trace["rule_type"] == "per_unit"


def test_tiered_rule_picks_band_by_units(db, p2_company):
    company, rep = p2_company
    product = _product(db, company)
    _sale(db, company, rep, product.variants[0].id, qty=Decimal("150"))  # 150×100 = 15000
    _plan(db, company, rep, [CommissionRuleCreate(
        rule_type="tiered",
        params={"bands": [{"up_to_units": 100, "percent": "2"}, {"percent": "5"}]},
    )])

    run = engine.compute_run(db, company.company_id, PERIOD_START, PERIOD_END)
    # 150 units > 100 → falls to the open 5% band: 15000 × 5% = 750.
    assert Decimal(run.payables[0].amount) == Decimal("750.00")
    assert run.line_items[0].trace["band"]["percent"] == "5"


def test_spiff_by_amount_is_time_boxed(db, p2_company):
    company, rep = p2_company
    product = _product(db, company)
    _sale(db, company, rep, product.variants[0].id, qty=Decimal("10"))
    _plan(db, company, rep, [CommissionRuleCreate(
        rule_type="spiff", params={"amount": "3"},
        effective_from=date(2026, 5, 1), effective_to=date(2026, 5, 31),
    )])
    run = engine.compute_run(db, company.company_id, PERIOD_START, PERIOD_END)
    assert Decimal(run.payables[0].amount) == Decimal("30.00")  # 10 units × 3

    # Outside its window the SPIFF no longer applies.
    run2 = engine.compute_run(db, company.company_id, date(2026, 6, 1), date(2026, 6, 30))
    assert run2.payables == []


def test_target_rule_attainment_gate(db, p2_company):
    company, rep = p2_company
    product = _product(db, company)
    _sale(db, company, rep, product.variants[0].id, qty=Decimal("30"))  # 3000
    crud.create_target(db, company.company_id, SalesTargetCreate(
        private_user_id=rep.private_user_id,
        period_start=PERIOD_START, period_end=PERIOD_END,
        scope_category="Beverages", target_amount=Decimal("2000.00"),
    ))
    _plan(db, company, rep, [CommissionRuleCreate(
        rule_type="target", params={"percent": "2", "attainment_pct": "100", "metric": "amount"},
        scope_category="Beverages",
    )])
    run = engine.compute_run(db, company.company_id, PERIOD_START, PERIOD_END)
    # 3000 actual / 2000 target = 150% ≥ 100% → 2% of 3000 = 60.
    assert Decimal(run.payables[0].amount) == Decimal("60.00")
    assert run.line_items[0].trace["attained"] is True


def test_target_rule_miss_pays_nothing(db, p2_company):
    company, rep = p2_company
    product = _product(db, company)
    _sale(db, company, rep, product.variants[0].id, qty=Decimal("10"))  # 1000
    crud.create_target(db, company.company_id, SalesTargetCreate(
        private_user_id=rep.private_user_id,
        period_start=PERIOD_START, period_end=PERIOD_END,
        scope_category="Beverages", target_amount=Decimal("2000.00"),
    ))
    _plan(db, company, rep, [CommissionRuleCreate(
        rule_type="target", params={"percent": "2", "attainment_pct": "100"},
        scope_category="Beverages",
    )])
    run = engine.compute_run(db, company.company_id, PERIOD_START, PERIOD_END)
    assert run.payables == []
    # The miss is still recorded as a zero-amount trace? No — zero lines are
    # dropped, so nothing to show. The run is empty and honest about it.
    assert run.line_items == []


def test_on_collection_prorates_unpaid_sale(db, p2_company):
    company, rep = p2_company
    product = _product(db, company)
    _sale(
        db, company, rep, product.variants[0].id, qty=Decimal("10"),
        payment_status="partial", collected_amount=Decimal("400.00"),
    )  # sale total 1000, collected 400 → 40% earned.
    _plan(db, company, rep, [CommissionRuleCreate(rule_type="flat_percent", params={"percent": "3"})],
          trigger="on_collection")

    run = engine.compute_run(db, company.company_id, PERIOD_START, PERIOD_END)
    # 1000 × 40% = 400 base × 3% = 12.
    assert Decimal(run.payables[0].amount) == Decimal("12.00")
    assert run.line_items[0].trace["lines"][0]["earned_ratio"] == "0.40"


def test_fully_uncollected_on_collection_pays_nothing(db, p2_company):
    company, rep = p2_company
    product = _product(db, company)
    _sale(db, company, rep, product.variants[0].id, payment_status="pending", collected_amount=Decimal("0"))
    _plan(db, company, rep, [CommissionRuleCreate(rule_type="flat_percent", params={"percent": "3"})],
          trigger="on_collection")
    run = engine.compute_run(db, company.company_id, PERIOD_START, PERIOD_END)
    assert run.payables == []


def test_uom_factor_scales_base_units(db, p2_company):
    company, rep = p2_company
    case = crud.create_uom(db, company.company_id, UnitOfMeasureCreate(
        code="CASE", name="Case", factor=Decimal("24"),
    ))
    product = _product(db, company)
    variant = crud.create_variant(db, company.company_id, product.id, VariantCreate(
        sku="P2-CASE", unit_price=UNIT_PRICE, sell_uom_id=case.id,
    ))
    _sale(db, company, rep, variant.id, qty=Decimal("2"))  # 2 cases = 48 base units
    _plan(db, company, rep, [CommissionRuleCreate(rule_type="per_unit", params={"amount": "1"})])

    run = engine.compute_run(db, company.company_id, PERIOD_START, PERIOD_END)
    assert Decimal(run.payables[0].amount) == Decimal("48.00")
    assert run.line_items[0].trace["units"] == "48.00"


def test_attribute_scope_matches_only_tagged_variant(db, p2_company):
    company, rep = p2_company
    option = crud.create_option(db, company.company_id, ProductOptionCreate(
        name="Size", values=["500ml", "1L"],
    ))
    val_500 = next(v for v in option.values if v.value == "500ml")
    val_1l = next(v for v in option.values if v.value == "1L")

    tagged = _product(db, company, sku="P2-500")
    tagged_v = crud.create_variant(db, company.company_id, tagged.id, VariantCreate(
        sku="P2-500-V", unit_price=UNIT_PRICE, option_value_ids=[val_500.id],
    ))
    other = _product(db, company, sku="P2-1L")
    other_v = crud.create_variant(db, company.company_id, other.id, VariantCreate(
        sku="P2-1L-V", unit_price=UNIT_PRICE, option_value_ids=[val_1l.id],
    ))

    _sale(db, company, rep, tagged_v.id, qty=Decimal("10"))
    _sale(db, company, rep, other_v.id, qty=Decimal("10"))
    _plan(db, company, rep, [CommissionRuleCreate(
        rule_type="flat_percent", params={"percent": "10"}, scope_option_value_id=val_500.id,
    )])

    run = engine.compute_run(db, company.company_id, PERIOD_START, PERIOD_END)
    # Only the 500ml-tagged variant earns: 10 × 100 × 10% = 100.
    assert Decimal(run.payables[0].amount) == Decimal("100.00")


# ---------------------------------------------------------------------------
# Catalog + price resolution
# ---------------------------------------------------------------------------


def test_category_option_uom_and_price_crud(db, p2_company):
    company, _ = p2_company
    parent = crud.create_category(db, company.company_id, ProductCategoryCreate(name="Drinks"))
    child = crud.create_category(db, company.company_id, ProductCategoryCreate(
        name="Soft Drinks", parent_id=parent.id,
    ))
    assert child.parent_id == parent.id

    crud.create_uom(db, company.company_id, UnitOfMeasureCreate(code="BTL", name="Bottle"))
    uoms = crud.list_uoms(db, company.company_id)
    assert any(u.code == "BTL" for u in uoms)

    product = _product(db, company)
    vid = product.variants[0].id
    crud.create_price(db, company.company_id, ProductPriceCreate(
        variant_id=vid, amount=Decimal("120.00"), effective_from=date(2026, 1, 1),
    ))
    resolved = crud.resolve_price(db, company.company_id, vid, on_date=date(2026, 6, 1))
    assert Decimal(resolved) == Decimal("120.00")


# ---------------------------------------------------------------------------
# Leaderboard + liability
# ---------------------------------------------------------------------------


def test_leaderboard_ranks_by_approved_sales(db, p2_company):
    company, rep = p2_company
    product = _product(db, company)
    _sale(db, company, rep, product.variants[0].id, qty=Decimal("10"))  # 1000
    _plan(db, company, rep, [CommissionRuleCreate(rule_type="flat_percent", params={"percent": "3"})])

    entries = crud.leaderboard(
        db, company.company_id,
        datetime.combine(PERIOD_START, datetime.min.time()),
        datetime.combine(PERIOD_END, datetime.max.time()),
    )
    assert len(entries) == 1
    assert entries[0]["private_user_id"] == rep.private_user_id
    assert Decimal(entries[0]["amount"]) == Decimal("1000.00")


def test_liability_accrual_counts_pending_payables(db, p2_company):
    company, rep = p2_company
    product = _product(db, company)
    _sale(db, company, rep, product.variants[0].id, qty=Decimal("10"))
    _plan(db, company, rep, [CommissionRuleCreate(rule_type="flat_percent", params={"percent": "3"})])
    engine.compute_run(db, company.company_id, PERIOD_START, PERIOD_END)

    accrual = crud.liability_accrual(db, company.company_id)
    assert Decimal(accrual["pending_payroll"]) == Decimal("30.00")
    assert Decimal(accrual["total_outstanding"]) == Decimal("30.00")


# ---------------------------------------------------------------------------
# Phase 3 — credit assignments, team overrides, clawbacks, ERP reconcile
# ---------------------------------------------------------------------------


def _new_rep(db, company, suffix):
    from core.model import PrivateUser, User
    import uuid

    sfx = uuid.uuid4().hex[:6]
    u = User(user_type="private", email=f"p3-{suffix}-{sfx}@kontokazdemo.com",
             user_name=f"p3-{suffix}-{sfx}", password_hash="x")
    db.add(u)
    db.flush()
    rep = PrivateUser(
        user_id=u.user_id, first_name=suffix, last_name="Rep",
        company_id=company.company_id, pass_port_number=f"P3_{suffix}_{sfx}", role="employee",
    )
    db.add(rep)
    db.flush()
    return rep


def test_credit_assignment_splits_by_outlet(db, p2_company):
    from schema.field_sales_schema import CreditAssignmentCreate, OutletCreate

    company, rep_a = p2_company
    rep_b = _new_rep(db, company, "B")
    outlet = crud.create_outlet(db, company.company_id, OutletCreate(name="Split Shop"))
    crud.create_credit_assignment(db, company.company_id, CreditAssignmentCreate(
        private_user_id=rep_a.private_user_id, outlet_id=outlet.id, split_percent=Decimal("60"),
    ))
    crud.create_credit_assignment(db, company.company_id, CreditAssignmentCreate(
        private_user_id=rep_b.private_user_id, outlet_id=outlet.id, split_percent=Decimal("40"),
    ))

    product = _product(db, company)
    _sale(db, company, rep_a, product.variants[0].id, qty=Decimal("10"),
          outlet_id=outlet.id, credited_to_private_user_id=None)
    _plan(db, company, rep_a, [CommissionRuleCreate(rule_type="flat_percent", params={"percent": "10"})])
    _plan(db, company, rep_b, [CommissionRuleCreate(rule_type="flat_percent", params={"percent": "10"})])

    run = engine.compute_run(db, company.company_id, PERIOD_START, PERIOD_END)
    totals = {p.private_user_id: Decimal(p.amount) for p in run.payables}
    # 1000 total × 10% = 100 earned split 60/40.
    assert totals[rep_a.private_user_id] == Decimal("60.00")
    assert totals[rep_b.private_user_id] == Decimal("40.00")


def test_credit_assignment_by_territory(db, p2_company):
    from schema.field_sales_schema import CreditAssignmentCreate

    company, rep_a = p2_company
    rep_b = _new_rep(db, company, "T")
    crud.create_credit_assignment(db, company.company_id, CreditAssignmentCreate(
        private_user_id=rep_b.private_user_id, territory="North",
    ))
    product = _product(db, company)
    _sale(db, company, rep_a, product.variants[0].id, qty=Decimal("10"),
          territory="North", credited_to_private_user_id=None)
    _plan(db, company, rep_b, [CommissionRuleCreate(rule_type="flat_percent", params={"percent": "5"})])

    run = engine.compute_run(db, company.company_id, PERIOD_START, PERIOD_END)
    assert len(run.payables) == 1
    assert run.payables[0].private_user_id == rep_b.private_user_id
    assert Decimal(run.payables[0].amount) == Decimal("50.00")  # 1000 × 5%


def test_team_override_pays_manager_over_reports(db, p2_company):
    company, rep = p2_company
    manager = _new_rep(db, company, "Mgr")
    rep.manager_private_user_id = manager.private_user_id
    db.flush()

    product = _product(db, company)
    _sale(db, company, rep, product.variants[0].id, qty=Decimal("10"))  # 1000
    _plan(db, company, rep, [CommissionRuleCreate(rule_type="flat_percent", params={"percent": "5"})])
    _plan(db, company, manager, [CommissionRuleCreate(rule_type="team_override", params={"percent": "10"})])

    run = engine.compute_run(db, company.company_id, PERIOD_START, PERIOD_END)
    totals = {p.private_user_id: Decimal(p.amount) for p in run.payables}
    assert totals[rep.private_user_id] == Decimal("50.00")        # 1000 × 5%
    assert totals[manager.private_user_id] == Decimal("5.00")     # 10% of the rep's 50
    override_lines = [li for li in run.line_items if li.trace["rule_type"] == "team_override"]
    assert len(override_lines) == 1


def test_clawback_writes_negative_commission_earning(db, p2_company):
    company, rep = p2_company
    result = engine.record_clawback(
        db, company.company_id, rep.private_user_id, Decimal("360.00"),
        "November return of 6 units", payable_in_year=2026, payable_in_month=11,
    )
    from core.model import EmployeeOneOffAllowance
    one_off = db.query(EmployeeOneOffAllowance).filter(
        EmployeeOneOffAllowance.id == result["one_off_allowance_id"]
    ).one()
    assert Decimal(one_off.amount) == Decimal("-360.00")
    assert one_off.payable_in_year == 2026 and one_off.payable_in_month == 11


def test_erp_reconcile_dry_run_classifies_rows(db, p2_company):
    from schema.field_sales_schema import ErpReconcileItem

    company, rep = p2_company
    product = _product(db, company, sku="ERP-1")
    _sale(db, company, rep, product.variants[0].id, qty=Decimal("5"), client_uuid="erp:EXT-9")

    result = crud.reconcile_external_sales(db, company.company_id, [
        ErpReconcileItem(external_id="EXT-1", sku="ERP-1", quantity=Decimal("2"), sold_at=SOLD_AT),
        ErpReconcileItem(external_id="EXT-9", sku="ERP-1", quantity=Decimal("5"), sold_at=SOLD_AT),
        ErpReconcileItem(external_id="EXT-2", sku="NOPE", quantity=Decimal("1"), sold_at=SOLD_AT),
    ])
    assert result["received"] == 3
    assert result["new"] == 1
    assert result["duplicates"] == 1
    assert result["unmatched_sku"] == 1


# ---------------------------------------------------------------------------
# Phase 3.1/3.2 — returns, target accelerators + pro-rating, ERP import
# ---------------------------------------------------------------------------


def test_return_emits_negative_commission(db, p2_company):
    from schema.field_sales_schema import SalesReturnCreate, SalesReturnLineCreate

    company, rep = p2_company
    product = _product(db, company)
    sale = _sale(db, company, rep, product.variants[0].id, qty=Decimal("24"))  # 2400
    _plan(db, company, rep, [CommissionRuleCreate(rule_type="flat_percent", params={"percent": "3"})])

    crud.create_sales_return(db, company.company_id, SalesReturnCreate(
        sale_id=sale.id, returned_at=SOLD_AT,
        lines=[SalesReturnLineCreate(sale_line_id=sale.lines[0].id, quantity=Decimal("6"))],
    ))
    run = engine.compute_run(db, company.company_id, PERIOD_START, PERIOD_END)
    # 2400 − 600 = 1800 base × 3% = 54.
    assert Decimal(run.payables[0].amount) == Decimal("54.00")
    assert any(l.get("is_return") for l in run.line_items[0].trace["lines"])


def test_over_return_is_rejected(db, p2_company):
    from fastapi import HTTPException
    from schema.field_sales_schema import SalesReturnCreate, SalesReturnLineCreate

    company, rep = p2_company
    product = _product(db, company)
    sale = _sale(db, company, rep, product.variants[0].id, qty=Decimal("10"))
    with pytest.raises(HTTPException) as exc:
        crud.create_sales_return(db, company.company_id, SalesReturnCreate(
            sale_id=sale.id, returned_at=SOLD_AT,
            lines=[SalesReturnLineCreate(sale_line_id=sale.lines[0].id, quantity=Decimal("11"))],
        ))
    assert exc.value.status_code == 422


def test_target_accelerator_band_raises_percent(db, p2_company):
    from schema.field_sales_schema import SalesTargetCreate as ST

    company, rep = p2_company
    product = _product(db, company)
    _sale(db, company, rep, product.variants[0].id, qty=Decimal("30"))  # 3000, attainment 150%
    crud.create_target(db, company.company_id, ST(
        private_user_id=rep.private_user_id, period_start=PERIOD_START, period_end=PERIOD_END,
        scope_category="Beverages", target_amount=Decimal("2000.00"),
        accelerators=[{"attainment_pct": "120", "percent": "5"}],
    ))
    _plan(db, company, rep, [CommissionRuleCreate(
        rule_type="target", params={"percent": "2", "attainment_pct": "100"}, scope_category="Beverages",
    )])
    run = engine.compute_run(db, company.company_id, PERIOD_START, PERIOD_END)
    # 3000 × 5% (accelerated) = 150, not 2%.
    assert Decimal(run.payables[0].amount) == Decimal("150.00")
    assert run.line_items[0].trace["accelerated"] is True


def test_target_pro_rates_for_partial_period(db, p2_company):
    from schema.field_sales_schema import SalesTargetCreate as ST

    company, rep = p2_company
    product = _product(db, company)
    _sale(db, company, rep, product.variants[0].id, qty=Decimal("11"))  # 1100
    crud.create_target(db, company.company_id, ST(
        private_user_id=rep.private_user_id, period_start=PERIOD_START, period_end=PERIOD_END,
        scope_category="Beverages", target_amount=Decimal("2000.00"),
    ))
    # Rule only effective from 16 May → active window 16 of 31 days → quota 1032.
    _plan(db, company, rep, [CommissionRuleCreate(
        rule_type="target", params={"percent": "5", "attainment_pct": "100"},
        scope_category="Beverages", effective_from=date(2026, 5, 16),
    )])
    run = engine.compute_run(db, company.company_id, PERIOD_START, PERIOD_END)
    assert Decimal(run.payables[0].amount) == Decimal("55.00")  # 1100 × 5%, target pro-rated
    assert run.line_items[0].trace["attained"] is True


def test_erp_commit_imports_and_is_idempotent(db, p2_company):
    from schema.field_sales_schema import ErpReconcileItem

    company, rep = p2_company
    _product(db, company, sku="IMP-1")
    items = [ErpReconcileItem(
        external_id="X-1", sku="IMP-1", quantity=Decimal("4"), sold_at=SOLD_AT,
        rep_private_user_id=rep.private_user_id,
    )]
    first = crud.reconcile_external_sales(db, company.company_id, items, commit=True)
    assert first["new"] == 1 and first["created"] == 1

    second = crud.reconcile_external_sales(db, company.company_id, items, commit=True)
    assert second["duplicates"] == 1 and second["created"] == 0

    imported = db.query(Sale).filter(Sale.client_uuid == "erp:X-1").one()
    assert imported.status == "approved"
    assert Decimal(imported.lines[0].line_total) == Decimal("400.00")  # 4 × 100
