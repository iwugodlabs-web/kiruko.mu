"""Phase 0 end-to-end: sale -> commission run -> payable -> one-off -> payslip.

Drives the service layer directly (the HTTP layer is a thin wrapper) and then
runs the real payroll engine to prove the commission actually lands on a
payslip as a taxed earning line. Fully isolated: each test builds its own
company and cleans up the field-sales tables on teardown.
"""

from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import text

from core.model import (
    Company,
    EmployeeOneOffAllowance,
    EmployeeSalaryAssignment,
    Job,
    Payslip,
    PrivateUser,
    Salary,
    SalaryComponent,
    SalaryStructure,
    SalaryStructureLine,
    Sale,
    User,
)
from schema.field_sales_schema import (
    CommissionPlanCreate,
    CommissionRuleCreate,
    ProductCreate,
    ProductVariantCreate,
    SaleCreate,
    SaleLineCreate,
)
from schema.payroll_schema import PayrollRunCreate
from services import commission_service as engine
from services import payroll_engine
from db_models.crud import field_sales as crud


PERIOD_START = date(2026, 5, 1)
PERIOD_END = date(2026, 5, 31)
SOLD_AT = datetime(2026, 5, 10, 9, 0, tzinfo=timezone.utc)
UNIT_PRICE = Decimal("100.00")


@pytest.fixture()
def sales_company(db, seed_mu_rules):
    """A MU company + one salaried, on-payroll rep wired for payroll."""
    import uuid

    sfx = uuid.uuid4().hex[:8]
    owner = User(
        user_type="company", email=f"fs-owner-{sfx}@kontokazdemo.com",
        user_name=f"fs-owner-{sfx}", password_hash="x",
    )
    db.add(owner)
    db.flush()
    company = Company(
        user_id=owner.user_id, company_name=f"Field Sales Co. {sfx}",
        email=f"fs-co-{sfx}@kontokazdemo.com", brn=f"FS_BRN_{sfx}", country_code="MU",
    )
    db.add(company)
    db.flush()

    basic = SalaryComponent(
        company_id=company.company_id, code="BASIC", label="Basic",
        kind="earning", category="earning.basic", is_basic=True, is_taxable=True,
    )
    db.add(basic)
    db.flush()
    structure = SalaryStructure(company_id=company.company_id, name="S", description="x")
    db.add(structure)
    db.flush()
    db.add(SalaryStructureLine(
        structure_id=structure.id, component_id=basic.id,
        amount=Decimal("30000.00"), order_index=0,
    ))

    u = User(user_type="private", email=f"fs-rep-{sfx}@kontokazdemo.com",
             user_name=f"fs-rep-{sfx}", password_hash="x")
    db.add(u)
    db.flush()
    rep = PrivateUser(
        user_id=u.user_id, first_name="Rahul", last_name="Rep",
        company_id=company.company_id, pass_port_number=f"FS_REP_{sfx}", role="employee",
    )
    db.add(rep)
    db.flush()
    job = Job(
        private_user_id=rep.private_user_id, company_id=company.company_id,
        job_title="Field Rep", employer_name="Field Sales Co.", employer_brn="FS_BRN",
        employer_email="fs-employer@kontokazdemo.com",
        first_date_of_employment=datetime(2024, 1, 1, tzinfo=timezone.utc),
    )
    db.add(job)
    db.flush()
    db.add(Salary(job_id=job.job_id, pay_basis="monthly", salary=Decimal("30000.00")))
    db.add(EmployeeSalaryAssignment(
        private_user_id=rep.private_user_id, structure_id=structure.id,
        currency="MUR", effective_from=date(2024, 1, 1), notes="x",
    ))
    db.flush()

    yield company, rep, u

    db.rollback()
    for stmt in [
        "DELETE FROM commission_payables",
        "DELETE FROM commission_line_items",
        "DELETE FROM commission_runs",
        "DELETE FROM commission_plan_assignments",
        "DELETE FROM commission_rules",
        "DELETE FROM commission_plans",
        "DELETE FROM sale_lines",
        "DELETE FROM sales",
        "DELETE FROM product_variants",
        "DELETE FROM products",
        "DELETE FROM employee_one_off_allowances",
        "DELETE FROM payslips",
        "DELETE FROM payroll_runs",
    ]:
        db.execute(text(stmt))
    db.commit()


def _sell_coke(db, company, rep, *, category="Beverages", qty=Decimal("24")):
    product = crud.create_product(
        db, company.company_id,
        ProductCreate(
            name="Coca-Cola", category=category,
            default_variant=ProductVariantCreate(sku="CC-500", unit_price=UNIT_PRICE),
        ),
    )
    sale = crud.create_sale(
        db, company.company_id,
        SaleCreate(
            rep_private_user_id=rep.private_user_id,
            sold_at=SOLD_AT,
            lines=[SaleLineCreate(variant_id=product.variants[0].id, quantity=qty)],
        ),
        created_by_user_id=None,
    )
    return product, sale


def _plan(db, company, rep, *, percent="3.00", scope_category=None):
    plan = crud.create_plan(
        db, company.company_id,
        CommissionPlanCreate(
            name=f"Field Rep {percent} {scope_category or 'all'}",
            trigger="on_sale",
            rules=[CommissionRuleCreate(
                rule_type="flat_percent", params={"percent": percent},
                scope_category=scope_category,
            )],
        ),
    )
    crud.assign_plan(
        db, company.company_id, plan.id, rep.private_user_id,
        effective_from=date(2026, 1, 1),
    )
    return plan


def test_sale_to_payslip_closes_the_loop(db, sales_company):
    company, rep, _ = sales_company
    _, sale = _sell_coke(db, company, rep)
    _plan(db, company, rep, percent="3.00")

    # 24 × 100 = 2400; 3% = 72.00
    run = engine.compute_run(db, company.company_id, PERIOD_START, PERIOD_END)
    db.flush()
    assert run.status == "draft"
    payables = [p for p in run.payables]
    assert len(payables) == 1
    assert Decimal(payables[0].amount) == Decimal("72.00")
    assert payables[0].private_user_id == rep.private_user_id

    line = run.line_items[0]
    assert line.trace["percent"] == "3.00"
    assert line.trace["base"] == "2400.00"

    engine.approve_run(db, company.company_id, run.id, actor_user_id=None)
    result = engine.push_to_payroll(db, company.company_id, run.id, actor_user_id=None)
    assert len(result["settled"]) == 1
    assert result["skipped"] == []

    one_off = db.query(EmployeeOneOffAllowance).filter(
        EmployeeOneOffAllowance.private_user_id == rep.private_user_id
    ).one()
    assert Decimal(one_off.amount) == Decimal("72.00")
    comp = db.query(SalaryComponent).filter(SalaryComponent.id == one_off.component_id).one()
    assert comp.code == engine.COMMISSION_COMPONENT_CODE
    assert comp.is_taxable is True

    # Now run real payroll for the same period — the commission must appear.
    payroll_run = payroll_engine.create_draft_run(
        db,
        PayrollRunCreate(
            company_id=company.company_id,
            period_start=PERIOD_START, period_end=PERIOD_END,
            private_user_ids=[rep.private_user_id],
        ),
        actor_user_id=None,
    )
    db.flush()
    ps = db.query(Payslip).filter(Payslip.payroll_run_id == payroll_run.id).one()
    commission_lines = [
        c for c in (ps.components or []) if c.get("code") == engine.COMMISSION_COMPONENT_CODE
    ]
    assert len(commission_lines) == 1
    assert Decimal(commission_lines[0]["amount"]) == Decimal("72.00")
    # The draft picked the pending one-off up (it is stamped on finalize, which
    # is the existing engine's job — not this module's).


def test_scope_mismatch_pays_nothing(db, sales_company):
    company, rep, _ = sales_company
    _sell_coke(db, company, rep, category="Beverages")
    _plan(db, company, rep, percent="5.00", scope_category="Snacks")

    run = engine.compute_run(db, company.company_id, PERIOD_START, PERIOD_END)
    assert run.payables == []
    assert run.line_items == []


def test_off_payroll_rep_skipped_not_paid(db, sales_company):
    company, rep, _ = sales_company
    _, sale = _sell_coke(db, company, rep)
    _plan(db, company, rep, percent="3.00")

    rep.payroll_status = "off_payroll"
    rep.off_payroll_reason = "contractor"
    db.flush()

    run = engine.compute_run(db, company.company_id, PERIOD_START, PERIOD_END)
    engine.approve_run(db, company.company_id, run.id, actor_user_id=None)
    result = engine.push_to_payroll(db, company.company_id, run.id, actor_user_id=None)

    assert result["settled"] == []
    # Off-payroll status is now derived into the payable's channel at compute
    # time, so push skips it as a non-payroll channel (routed to 'manual').
    assert result["skipped"] == [
        {"private_user_id": rep.private_user_id, "reason": "non_payroll_channel"}
    ]
    # The payable is on the manual channel and left pending (never silently
    # written-then-lost) — it settles off-payroll via settle_manual_payouts.
    db.refresh(run)
    assert all(p.payout_channel == "manual" for p in run.payables)
    assert all(p.status == "pending" for p in run.payables)
    assert all(p.one_off_allowance_id is None for p in run.payables)
    assert db.query(EmployeeOneOffAllowance).filter(
        EmployeeOneOffAllowance.private_user_id == rep.private_user_id
    ).count() == 0


def test_voided_sale_excluded_from_run(db, sales_company):
    company, rep, _ = sales_company
    _, sale = _sell_coke(db, company, rep)
    _plan(db, company, rep, percent="3.00")
    crud.void_sale(db, company.company_id, sale.id)

    run = engine.compute_run(db, company.company_id, PERIOD_START, PERIOD_END)
    assert run.payables == []


# ---------------------------------------------------------------------------
# Phase 1 — outlets, geo-verified sync, approval queue
# ---------------------------------------------------------------------------


def test_outlet_sync_verifies_visit_and_is_idempotent(db, sales_company):
    from schema.field_sales_schema import (
        GeoPoint,
        OutletCreate,
        SaleSyncItem,
        SaleSyncRequest,
    )

    company, rep, _ = sales_company
    product = crud.create_product(
        db, company.company_id,
        ProductCreate(
            name="Coke", category="Beverages",
            default_variant=ProductVariantCreate(sku="CC", unit_price=UNIT_PRICE),
        ),
    )
    outlet = crud.create_outlet(
        db, company.company_id,
        OutletCreate(name="Shop #12", latitude=-20.16, longitude=57.50, radius_meters=150),
    )
    _plan(db, company, rep, percent="3.00")

    item = SaleSyncItem(
        client_uuid="offline-uuid-0001",
        rep_private_user_id=rep.private_user_id,
        outlet_id=outlet.id,
        sold_at=SOLD_AT,
        geo=GeoPoint(latitude=-20.16, longitude=57.50),
        lines=[SaleLineCreate(variant_id=product.variants[0].id, quantity=Decimal("10"))],
    )
    result = crud.sync_sales(db, company.company_id, [item], created_by_user_id=None)
    assert result["accepted"] == 1 and result["errors"] == 0

    sale = (
        db.query(Sale)
        .filter(Sale.client_uuid == "offline-uuid-0001")
        .one()
    )
    assert sale.status == "submitted"
    assert sale.visit_verified is True
    assert sale.visit_distance_m is not None

    # Re-sending the same client_uuid is a no-op duplicate.
    result2 = crud.sync_sales(db, company.company_id, [item], created_by_user_id=None)
    assert result2["duplicates"] == 1 and result2["accepted"] == 0

    # A sale far from the outlet is recorded unverified, not blocked.
    far = item.model_copy(update={
        "client_uuid": "offline-uuid-0002",
        "geo": GeoPoint(latitude=-19.0, longitude=57.0),
    })
    crud.sync_sales(db, company.company_id, [far], created_by_user_id=None)
    far_sale = db.query(Sale).filter(Sale.client_uuid == "offline-uuid-0002").one()
    assert far_sale.visit_verified is False


def test_submitted_sale_earns_only_after_approval(db, sales_company):
    from schema.field_sales_schema import SaleSyncItem

    company, rep, rep_user = sales_company
    product = crud.create_product(
        db, company.company_id,
        ProductCreate(
            name="Coke", category="Beverages",
            default_variant=ProductVariantCreate(sku="CC", unit_price=UNIT_PRICE),
        ),
    )
    _plan(db, company, rep, percent="10.00")

    crud.sync_sales(
        db, company.company_id,
        [SaleSyncItem(
            client_uuid="offline-approve-01",
            rep_private_user_id=rep.private_user_id,
            sold_at=SOLD_AT,
            lines=[SaleLineCreate(variant_id=product.variants[0].id, quantity=Decimal("10"))],
        )],
        created_by_user_id=None,
    )
    sale = db.query(Sale).filter(Sale.client_uuid == "offline-approve-01").one()

    # Submitted sales do not earn.
    run = engine.compute_run(db, company.company_id, PERIOD_START, PERIOD_END)
    assert run.payables == []

    crud.review_sale(db, company.company_id, sale.id, "approve", reviewer_user_id=rep_user.user_id)
    run = engine.compute_run(db, company.company_id, PERIOD_START, PERIOD_END)
    assert len(run.payables) == 1
    assert Decimal(run.payables[0].amount) == Decimal("100.00")  # 10 × 100 × 10%
