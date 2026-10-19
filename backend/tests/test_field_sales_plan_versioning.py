"""Step A: commission-plan versioning + effective dating.

A plan is a *family* of versioned, effective-dated rows. A used version is
never edited in place — `revise_plan` clones a `draft` version and
`activate_plan` supersedes the prior one. Assignments keep pointing at the
family root and the engine selects the version effective for the run period.

Version selection is per *run period*: among versions whose window covers the
period, the one with the latest `effective_from` wins, so a mid-period change
needs the period split into separate runs.

Drives the CRUD/engine layer directly, mirroring test_field_sales_phase2.
"""

from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import text

from core.model import Company, PrivateUser, User
from db_models.crud import field_sales as crud
from schema.field_sales_schema import (
    CommissionPlanCreate,
    CommissionPlanRevise,
    CommissionRuleCreate,
    ProductCreate,
    ProductVariantCreate,
    SaleCreate,
    SaleLineCreate,
)
from services import commission_service as engine


EARLY_START = date(2026, 5, 1)
EARLY_END = date(2026, 5, 15)
LATE_START = date(2026, 5, 16)
LATE_END = date(2026, 5, 31)
EARLY_SOLD_AT = datetime(2026, 5, 10, 9, 0, tzinfo=timezone.utc)
LATE_SOLD_AT = datetime(2026, 5, 20, 9, 0, tzinfo=timezone.utc)
UNIT_PRICE = Decimal("100.00")


@pytest.fixture()
def v_company(db):
    import uuid

    sfx = uuid.uuid4().hex[:8]
    owner = User(
        user_type="company", email=f"ver-owner-{sfx}@kontokazdemo.com",
        user_name=f"ver-owner-{sfx}", password_hash="x",
    )
    db.add(owner)
    db.flush()
    company = Company(
        user_id=owner.user_id, company_name=f"Versioning Co. {sfx}",
        email=f"ver-co-{sfx}@kontokazdemo.com", brn=f"VER_BRN_{sfx}", country_code="MU",
    )
    db.add(company)
    db.flush()

    def _rep(tag):
        u = User(user_type="private", email=f"ver-{tag}-{sfx}@kontokazdemo.com",
                 user_name=f"ver-{tag}-{sfx}", password_hash="x")
        db.add(u)
        db.flush()
        rep = PrivateUser(
            user_id=u.user_id, first_name="Vera", last_name=tag.title(),
            company_id=company.company_id, pass_port_number=f"VER_{tag.upper()}_{sfx}",
            role="employee",
        )
        db.add(rep)
        db.flush()
        return rep

    rep = _rep("rep")
    rep2 = _rep("alt")
    yield company, rep, rep2

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
    ]:
        db.execute(text(stmt))
    db.commit()


def _product(db, company, *, sku="VER-SKU"):
    return crud.create_product(
        db, company.company_id,
        ProductCreate(
            name=f"Product {sku}", category="Beverages",
            default_variant=ProductVariantCreate(sku=sku, unit_price=UNIT_PRICE),
        ),
    )


def _sale(db, company, rep, variant_id, *, sold_at=EARLY_SOLD_AT, qty=Decimal("10")):
    return crud.create_sale(
        db, company.company_id,
        SaleCreate(
            rep_private_user_id=rep.private_user_id,
            sold_at=sold_at,
            lines=[SaleLineCreate(variant_id=variant_id, quantity=qty)],
        ),
        created_by_user_id=None,
    )


def _plan(db, company, rep, *, percent="5", name="Rep base plan"):
    plan = crud.create_plan(
        db, company.company_id,
        CommissionPlanCreate(
            name=f"{name} {rep.private_user_id}",
            trigger="on_sale",
            rules=[CommissionRuleCreate(rule_type="flat_percent", params={"percent": percent})],
        ),
    )
    crud.assign_plan(db, company.company_id, plan.id, rep.private_user_id,
                     effective_from=date(2026, 1, 1))
    return plan


# ---------------------------------------------------------------------------
# Model / CRUD
# ---------------------------------------------------------------------------


def test_create_plan_is_version_1_root(db, v_company):
    company, rep, _ = v_company
    plan = _plan(db, company, rep)

    assert plan.version == 1
    assert plan.family_id == plan.id
    assert plan.status == "active"
    assert plan.effective_from is None and plan.effective_to is None


def test_revise_creates_a_draft_version(db, v_company):
    company, rep, _ = v_company
    root = _plan(db, company, rep)

    draft = crud.revise_plan(
        db, company.company_id, root.id,
        CommissionPlanRevise(rules=[CommissionRuleCreate(
            rule_type="flat_percent", params={"percent": "10"}),
        ]),
    )

    assert draft.id != root.id
    assert draft.family_id == root.id
    assert draft.version == 2
    assert draft.status == "draft"
    assert draft.effective_from is None

    # The used version is untouched — a draft is inert until activated.
    db.refresh(root)
    assert root.status == "active" and root.effective_to is None

    versions = crud.list_plan_versions(db, company.company_id, root.id)
    assert [v.version for v in versions] == [2, 1]


def test_activate_supersedes_the_prior_version(db, v_company):
    company, rep, _ = v_company
    root = _plan(db, company, rep)
    draft = crud.revise_plan(db, company.company_id, root.id, CommissionPlanRevise(
        rules=[CommissionRuleCreate(rule_type="flat_percent", params={"percent": "10"})],
    ))

    activated = crud.activate_plan(
        db, company.company_id, draft.id, effective_from=date(2026, 5, 16),
    )

    assert activated.status == "active"
    assert activated.effective_from == date(2026, 5, 16)
    assert activated.effective_to is None
    assert activated.approved_at is not None

    db.refresh(root)
    assert root.effective_to == date(2026, 5, 15)  # closed the day before


def test_assign_resolves_to_family_root(db, v_company):
    company, rep, rep2 = v_company
    root = _plan(db, company, rep)
    draft = crud.revise_plan(db, company.company_id, root.id, CommissionPlanRevise())

    # Assigning a specific version id still pins the assignment to the root.
    assignment = crud.assign_plan(db, company.company_id, draft.id, rep2.private_user_id)
    assert assignment.plan_id == root.id
    listed = crud.list_assignments(db, company.company_id, root.id)
    assert assignment.id in [a.id for a in listed]


# ---------------------------------------------------------------------------
# Engine selection
# ---------------------------------------------------------------------------


def test_engine_uses_latest_version_effective_for_the_period(db, v_company):
    company, rep, _ = v_company
    product = _product(db, company)
    variant_id = product.variants[0].id
    _sale(db, company, rep, variant_id, sold_at=EARLY_SOLD_AT)
    _sale(db, company, rep, variant_id, sold_at=LATE_SOLD_AT)

    root = _plan(db, company, rep, percent="5")
    draft = crud.revise_plan(db, company.company_id, root.id, CommissionPlanRevise(
        rules=[CommissionRuleCreate(rule_type="flat_percent", params={"percent": "10"})],
    ))
    crud.activate_plan(db, company.company_id, draft.id, effective_from=LATE_START)

    # Early period → version 1 (5%): 10 × 100 × 5% = 50.
    early = engine.compute_run(db, company.company_id, EARLY_START, EARLY_END)
    assert Decimal(early.payables[0].amount) == Decimal("50.00")

    # Late period → version 2 (10%): 10 × 100 × 10% = 100.
    late = engine.compute_run(db, company.company_id, LATE_START, LATE_END)
    assert Decimal(late.payables[0].amount) == Decimal("100.00")


def test_draft_does_not_affect_pay_until_activated(db, v_company):
    company, rep, _ = v_company
    product = _product(db, company)
    _sale(db, company, rep, product.variants[0].id)
    root = _plan(db, company, rep, percent="5")
    crud.revise_plan(db, company.company_id, root.id, CommissionPlanRevise(
        rules=[CommissionRuleCreate(rule_type="flat_percent", params={"percent": "50"})],
    ))

    run = engine.compute_run(db, company.company_id, EARLY_START, EARLY_END)
    assert Decimal(run.payables[0].amount) == Decimal("50.00")  # still 5%


def test_archived_family_pays_nothing(db, v_company):
    company, rep, _ = v_company
    product = _product(db, company)
    _sale(db, company, rep, product.variants[0].id)
    root = _plan(db, company, rep)

    archived = crud.archive_plan(db, company.company_id, root.id)
    assert archived.status == "archived" and archived.archived_at is not None

    assert crud.list_plans(db, company.company_id) == []
    run = engine.compute_run(db, company.company_id, EARLY_START, EARLY_END)
    assert run.payables == []


# ---------------------------------------------------------------------------
# Listing
# ---------------------------------------------------------------------------


def test_list_plans_returns_one_row_per_family(db, v_company):
    company, rep, _ = v_company
    root = _plan(db, company, rep)

    # A draft is hidden behind the still-effective active version.
    draft = crud.revise_plan(db, company.company_id, root.id, CommissionPlanRevise())
    listed = crud.list_plans(db, company.company_id)
    assert len(listed) == 1 and listed[0].version == 1

    # Once activated the new version is the one listed.
    crud.activate_plan(db, company.company_id, draft.id, effective_from=LATE_START)
    listed = crud.list_plans(db, company.company_id)
    assert len(listed) == 1 and listed[0].version == 2
