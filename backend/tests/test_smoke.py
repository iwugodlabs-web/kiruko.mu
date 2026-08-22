"""End-to-end smoke tests ported from the engine build session.

Three independent scenarios:
  1. test_paye_math — pure-function PAYE computation across a synthetic bracket set.
  2. test_supersede_and_trigger — supersede CSG_EE, verify v1 closed, audit
     written, DB-level trigger blocks unauthorized UPDATEs.
  3. test_eoy_bonus_full_payroll_flow — Jan + June + Dec runs, verify EOY
     gratuity = YTD/12 surfaces on the December payslip.

These are the canonical smoke scenarios that gated the foundation slice;
they must remain green throughout the hardening phase.
"""

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DatabaseError
from sqlalchemy.orm import Session


# ---------------------------------------------------------------------------
# 1. Pure PAYE math — no DB needed beyond schema imports.
# ---------------------------------------------------------------------------


def test_paye_math_progressive_brackets():
    from decimal import Decimal as D

    from schema.payroll_rules_schema import TaxBracketLineRead
    from services.payroll_rules import compute_paye

    brackets = [
        TaxBracketLineRead(
            id=1, bracket_set_id=1, order_index=1,
            lower_bound=D("0"), upper_bound=D("390000"), rate=D("0"),
        ),
        TaxBracketLineRead(
            id=2, bracket_set_id=1, order_index=2,
            lower_bound=D("390000"), upper_bound=D("430000"), rate=D("0.10"),
        ),
        TaxBracketLineRead(
            id=3, bracket_set_id=1, order_index=3,
            lower_bound=D("430000"), upper_bound=None, rate=D("0.15"),
        ),
    ]
    assert compute_paye(D("0"), brackets) == D("0.00")
    assert compute_paye(D("300000"), brackets) == D("0.00")
    # 410k: 20k taxed at 10% = 2000
    assert compute_paye(D("410000"), brackets) == D("2000.00")
    # 500k: 40k @ 10% (4000) + 70k @ 15% (10500) = 14500
    assert compute_paye(D("500000"), brackets) == D("14500.00")


def test_compute_statutory_applies_threshold(seed_mu_rules):
    from decimal import Decimal as D

    from schema.payroll_rules_schema import StatutoryDeductionRead
    from services.payroll_rules import compute_statutory

    csg_ee = StatutoryDeductionRead(
        id=1, country_code="MU", code="CSG_EE", label="CSG Employee",
        rate=D("0.015"), threshold_high=D("50000"),
        taxable_base="gross", employer_or_employee="employee",
        effective_from=date(2026, 1, 1), version=1,
    )
    out = compute_statutory({"basic": D("30000"), "gross": D("31000")}, [csg_ee])
    # 31k * 1.5% = 465
    assert out == {"CSG_EE": D("465.00")}


# ---------------------------------------------------------------------------
# 2. Supersede flow + DB-level trigger enforcement.
# ---------------------------------------------------------------------------


def test_supersede_csg_creates_v2_and_audits(db: Session, seed_mu_rules, clean_payroll_state):
    from core.model import StatutoryDeduction
    from schema.payroll_rules_schema import StatutoryDeductionCreate
    from services import payroll_rules

    new_payload = StatutoryDeductionCreate(
        country_code="MU", code="CSG_EE", label="CSG — Employee contribution",
        rate=Decimal("0.01600"), threshold_high=Decimal("50000"),
        taxable_base="gross", employer_or_employee="employee",
        effective_from=date(2027, 1, 1),
        source_reference="Test supersede",
        change_reason="Smoke test rate bump",
    )
    v2 = payroll_rules.supersede(
        db,
        model=StatutoryDeduction,
        rule_filter={"country_code": "MU", "code": "CSG_EE"},
        new_payload=new_payload,
        actor_user_id=None,
    )
    db.commit()

    assert v2.version == 2
    assert v2.rate == Decimal("0.01600")
    assert v2.effective_to is None

    prior = (
        db.query(StatutoryDeduction)
        .filter(
            StatutoryDeduction.country_code == "MU",
            StatutoryDeduction.code == "CSG_EE",
            StatutoryDeduction.version == 1,
        )
        .one()
    )
    assert prior.effective_to == date(2027, 1, 1)
    assert prior.superseded_by_id == v2.id

    audit = db.execute(
        text(
            "SELECT action, target_type, meta FROM audit_logs "
            "WHERE action='payroll_rule.superseded' "
            "AND target_type='statutory_deductions' "
            "ORDER BY created_at DESC LIMIT 1"
        )
    ).fetchone()
    assert audit is not None
    assert audit[2]["diff"]["rate"] == ["0.01500", "0.01600"]


def test_supersede_resolve_is_time_aware(db: Session, seed_mu_rules, clean_payroll_state):
    from core.model import StatutoryDeduction
    from schema.payroll_rules_schema import StatutoryDeductionCreate
    from services import payroll_rules

    payroll_rules.supersede(
        db,
        model=StatutoryDeduction,
        rule_filter={"country_code": "MU", "code": "CSG_EE"},
        new_payload=StatutoryDeductionCreate(
            country_code="MU", code="CSG_EE", label="CSG EE",
            rate=Decimal("0.02"), threshold_high=Decimal("50000"),
            taxable_base="gross", employer_or_employee="employee",
            effective_from=date(2027, 1, 1),
            source_reference="t", change_reason="t",
        ),
        actor_user_id=None,
    )
    db.commit()

    snap_2026 = payroll_rules.resolve(db, "MU", date(2026, 5, 1))
    csg_2026 = next(d for d in snap_2026.statutory_deductions if d.code == "CSG_EE")
    assert csg_2026.rate == Decimal("0.01500")

    snap_2027 = payroll_rules.resolve(db, "MU", date(2027, 3, 1))
    csg_2027 = next(d for d in snap_2027.statutory_deductions if d.code == "CSG_EE")
    assert csg_2027.rate == Decimal("0.02000")


def test_trigger_blocks_unauthorized_update(db: Session, seed_mu_rules, clean_payroll_state):
    from core.model import StatutoryDeduction

    target = (
        db.query(StatutoryDeduction)
        .filter(
            StatutoryDeduction.country_code == "MU",
            StatutoryDeduction.code == "CSG_EE",
        )
        .first()
    )
    assert target is not None

    # Direct rate update should be rejected by the trigger.
    with pytest.raises(DatabaseError, match="append-only"):
        db.execute(
            text("UPDATE statutory_deductions SET rate = 0.99 WHERE id = :id"),
            {"id": target.id},
        )
        db.commit()
    db.rollback()

    # effective_to / superseded_by_id round-trip is allowed.
    db.execute(
        text("UPDATE statutory_deductions SET effective_to = '2099-12-31' WHERE id = :id"),
        {"id": target.id},
    )
    db.commit()
    db.execute(
        text("UPDATE statutory_deductions SET effective_to = NULL WHERE id = :id"),
        {"id": target.id},
    )
    db.commit()


def test_supersede_refuses_non_advancing_effective_from(
    db: Session, seed_mu_rules, clean_payroll_state
):
    from core.model import StatutoryDeduction
    from schema.payroll_rules_schema import StatutoryDeductionCreate
    from services import payroll_rules
    from services.payroll_rules import RuleSupersedeError

    bad = StatutoryDeductionCreate(
        country_code="MU", code="CSG_EE", label="x",
        rate=Decimal("0.02"),
        taxable_base="gross", employer_or_employee="employee",
        effective_from=date(2025, 1, 1),  # earlier than seeded effective_from (2026-01-01)
        source_reference="t", change_reason="t",
    )
    with pytest.raises(RuleSupersedeError):
        payroll_rules.supersede(
            db,
            model=StatutoryDeduction,
            rule_filter={"country_code": "MU", "code": "CSG_EE"},
            new_payload=bad,
            actor_user_id=None,
        )
    db.rollback()


# ---------------------------------------------------------------------------
# 3. EOY bonus through a full payroll flow.
# ---------------------------------------------------------------------------


def test_eoy_bonus_appears_in_december_payroll(
    db: Session,
    test_company_id: int,
    test_employee_id: int,
    seed_mu_rules,
    clean_payroll_state,
):
    from core.model import Payslip, PrivateUser
    from schema.payroll_schema import PayrollRunCreate
    from services import bonus_engine, payroll_engine

    emp = db.query(PrivateUser).filter(PrivateUser.private_user_id == test_employee_id).one()

    # Run + finalize January 2026
    draft1 = payroll_engine.create_draft_run(
        db,
        PayrollRunCreate(
            company_id=test_company_id,
            period_start=date(2026, 1, 1),
            period_end=date(2026, 1, 31),
        ),
        actor_user_id=None,
    )
    db.commit()
    final1 = payroll_engine.finalize_run(db, draft1.id, actor_user_id=None)
    db.commit()
    ps1 = next(p for p in final1.payslips if p.private_user_id == emp.private_user_id)
    assert ps1.bonus == Decimal("0.00")
    assert ps1.gross == Decimal("36000.00")

    # Run + finalize June 2026
    draft2 = payroll_engine.create_draft_run(
        db,
        PayrollRunCreate(
            company_id=test_company_id,
            period_start=date(2026, 6, 1),
            period_end=date(2026, 6, 30),
        ),
        actor_user_id=None,
    )
    db.commit()
    final2 = payroll_engine.finalize_run(db, draft2.id, actor_user_id=None)
    db.commit()
    ps2 = next(p for p in final2.payslips if p.private_user_id == emp.private_user_id)
    assert ps2.bonus == Decimal("0.00")

    # YTD before December = 36k + 36k = 72k
    ytd_before_dec = bonus_engine._ytd_earnings(db, emp.private_user_id, date(2026, 12, 1))
    assert ytd_before_dec == Decimal("72000.00")

    # December — EOY should kick in
    draft3 = payroll_engine.create_draft_run(
        db,
        PayrollRunCreate(
            company_id=test_company_id,
            period_start=date(2026, 12, 1),
            period_end=date(2026, 12, 31),
        ),
        actor_user_id=None,
    )
    db.commit()
    ps3 = next(p for p in draft3.payslips if p.private_user_id == emp.private_user_id)

    # Math: pre-bonus December gross = 36k; YTD = 72k; annual = 108k; bonus = 108k/12 = 9k
    assert ps3.bonus == Decimal("9000.00")
    assert ps3.gross == Decimal("45000.00")
    codes = {c["code"] for c in (ps3.components or [])}
    assert "EOY_GRATUITY" in codes
    sources = {c["code"]: c["source"] for c in (ps3.components or [])}
    assert sources["EOY_GRATUITY"] == "bonus"

    # Finalize and confirm bonus survives
    final3 = payroll_engine.finalize_run(db, draft3.id, actor_user_id=None)
    db.commit()
    ps3_final = db.query(Payslip).filter(Payslip.id == ps3.id).one()
    assert ps3_final.bonus == Decimal("9000.00")
    # Snapshot includes the EOY rule
    assert any(
        b["bonus_code"] == "EOY_GRATUITY"
        for b in final3.country_rules_snapshot["bonus_rules"]
    )


def test_eoy_eligibility_excludes_short_service(
    db: Session,
    test_company_id: int,
    test_employee_id: int,
    seed_mu_rules,
    clean_payroll_state,
):
    from core.model import Job, PrivateUser
    from services import bonus_engine

    emp = db.query(PrivateUser).filter(PrivateUser.private_user_id == test_employee_id).one()
    job = db.query(Job).filter(Job.private_user_id == emp.private_user_id).first()

    # Backdate temporarily to a recent start date
    original = job.first_date_of_employment
    db.execute(
        text("UPDATE jobs SET first_date_of_employment='2026-06-01' WHERE job_id=:id"),
        {"id": job.job_id},
    )
    db.commit()

    try:
        amount = bonus_engine.compute_eoy_for_employee(
            db, emp, date(2026, 12, 1), current_period_gross=Decimal("36000")
        )
        # 6 months service < 12-month eligibility → 0
        assert amount == Decimal("0.00")
    finally:
        db.execute(
            text("UPDATE jobs SET first_date_of_employment=:d WHERE job_id=:id"),
            {"d": original, "id": job.job_id},
        )
        db.commit()


def test_eoy_does_not_fire_outside_payable_month(
    db: Session,
    test_employee_id: int,
    seed_mu_rules,
    clean_payroll_state,
):
    from core.model import PrivateUser
    from services import bonus_engine

    emp = db.query(PrivateUser).filter(PrivateUser.private_user_id == test_employee_id).one()
    # November isn't December — no bonus should compute
    amount = bonus_engine.compute_eoy_for_employee(
        db, emp, date(2026, 11, 1), current_period_gross=Decimal("36000")
    )
    assert amount == Decimal("0.00")
