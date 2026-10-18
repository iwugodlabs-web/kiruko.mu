"""Off-payroll (contractor) commission:
  * the payable's payout_channel is DERIVED from the rep's payroll_status
    ('off_payroll' -> 'manual'), not hardcoded;
  * push-to-payroll never pays or settles a manual-channel rep;
  * settle_manual_payouts records an external reference and settles it without
    writing a one-off / touching a payslip;
  * the COMMISSION component declares its statutory bases from the shared
    resolver (PAYE + CSG, no NSF).
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import text

from core.model import (
    CommissionPayable,
    Company,
    EmployeeOneOffAllowance,
    PrivateUser,
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
from services import commission_service as engine
from db_models.crud import field_sales as crud

PERIOD_START = date(2026, 5, 1)
PERIOD_END = date(2026, 5, 31)
SOLD_AT = datetime(2026, 5, 10, 9, 0, tzinfo=timezone.utc)


@pytest.fixture()
def contractor_company(db):
    sfx = uuid.uuid4().hex[:8]
    owner = User(user_type="company", email=f"ct-owner-{sfx}@kontokazdemo.com",
                 user_name=f"ct-owner-{sfx}", password_hash="x")
    db.add(owner)
    db.flush()
    company = Company(user_id=owner.user_id, company_name=f"Contractor Co {sfx}",
                      email=f"ct-co-{sfx}@kontokazdemo.com", brn=f"CT_BRN_{sfx}",
                      country_code="MU")
    db.add(company)
    db.flush()
    u = User(user_type="private", email=f"ct-rep-{sfx}@kontokazdemo.com",
             user_name=f"ct-rep-{sfx}", password_hash="x")
    db.add(u)
    db.flush()
    rep = PrivateUser(user_id=u.user_id, first_name="Contractor", last_name="Rep",
                      company_id=company.company_id, pass_port_number=f"CT_REP_{sfx}",
                      role="employee", payroll_status="off_payroll")
    db.add(rep)
    db.flush()
    db.commit()

    yield company, rep

    db.rollback()
    for stmt in [
        "DELETE FROM commission_payables", "DELETE FROM commission_line_items",
        "DELETE FROM commission_runs", "DELETE FROM commission_plan_assignments",
        "DELETE FROM commission_rules", "DELETE FROM commission_plans",
        "DELETE FROM sale_lines", "DELETE FROM sales",
        "DELETE FROM product_variants", "DELETE FROM products",
        "DELETE FROM employee_one_off_allowances",
    ]:
        db.execute(text(stmt))
    db.commit()


def test_offpayroll_rep_routes_to_manual_and_settles(db, contractor_company):
    company, rep = contractor_company
    cid = company.company_id

    product = crud.create_product(
        db, cid,
        ProductCreate(name="Coca-Cola", category="Beverages",
                      default_variant=ProductVariantCreate(sku="CC-500", unit_price=Decimal("100.00"))),
    )
    crud.create_sale(
        db, cid,
        SaleCreate(rep_private_user_id=rep.private_user_id, sold_at=SOLD_AT,
                   lines=[SaleLineCreate(variant_id=product.variants[0].id, quantity=Decimal("24"))]),
        created_by_user_id=None,
    )
    plan = crud.create_plan(
        db, cid,
        CommissionPlanCreate(name="Contractor 3%", trigger="on_sale",
                             rules=[CommissionRuleCreate(rule_type="flat_percent",
                                                         params={"percent": "3.00"},
                                                         scope_category="Beverages")]),
    )
    crud.assign_plan(db, cid, plan.id, rep.private_user_id, effective_from=date(2026, 1, 1))

    run = engine.compute_run(db, cid, PERIOD_START, PERIOD_END)
    db.flush()
    payable = (
        db.query(CommissionPayable)
        .filter(CommissionPayable.run_id == run.id,
                CommissionPayable.private_user_id == rep.private_user_id)
        .one()
    )
    # Channel is derived from payroll_status, not hardcoded "payroll".
    assert payable.payout_channel == "manual"
    assert Decimal(payable.amount) == Decimal("72.00")

    engine.approve_run(db, cid, run.id, actor_user_id=None)

    # Push-to-payroll must NOT pay or settle an off-payroll rep.
    push = engine.push_to_payroll(db, cid, run.id, actor_user_id=None)
    assert push["settled"] == []
    assert (
        db.query(EmployeeOneOffAllowance)
        .filter(EmployeeOneOffAllowance.private_user_id == rep.private_user_id)
        .count()
        == 0
    )

    # Settle via the manual channel with a recorded payout reference.
    res = engine.settle_manual_payouts(db, cid, run.id, actor_user_id=None, reference="BANK-TXN-9931")
    assert res["count"] == 1
    db.refresh(payable)
    assert payable.status == "settled"
    assert payable.settlement_reference == "BANK-TXN-9931"
    assert payable.one_off_allowance_id is None  # never touched payroll

    # Statutory bases declared via the shared resolver: PAYE + CSG, no NSF.
    comp = engine.ensure_commission_component(db, cid)
    assert set(comp.statutory_base_codes) == {"PAYE", "CSG_EE", "CSG_ER"}
