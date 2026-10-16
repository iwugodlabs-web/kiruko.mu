"""Payroll completeness ledger (Phase 1) — every in-scope company member is
accounted for on a run in exactly one bucket (paid / nil_paid / excluded), so a
run can never silently omit someone.

Covers:
  * mixed company → each member in exactly one bucket; counts sum to headcount
  * legacy monthly staff with a `salaries` row but NO structured assignment are
    bucketed excluded:no_assignment_monthly (previously dropped with no trace)
  * a member with no Job row → excluded:no_job
  * an hourly worker with a rate but zero hours → nil_paid (a processed zero),
    NOT excluded
  * recompute rebuilds the ledger and preserves the nil_paid payslip that
    recompute used to silently drop (regression for payroll_engine.py:2310)
"""
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from fastapi import HTTPException

from core.model import (
    Company,
    EmployeeSalaryAssignment,
    Job,
    Payslip,
    PayrollRunMemberStatus,
    PrivateUser,
    Salary,
    SalaryComponent,
    SalaryStructure,
    SalaryStructureLine,
    User,
)
from schema.payroll_schema import PayrollRunCreate
from services import payroll_engine


PERIOD_START = date(2026, 5, 1)
PERIOD_END = date(2026, 5, 31)
BASIC = Decimal("30000.00")


def _mk_user(db, tag, sfx):
    u = User(user_type="private", email=f"{tag}-{sfx}@ledger.test",
             user_name=f"{tag}-{sfx}", password_hash="x")
    db.add(u); db.flush()
    return u


@pytest.fixture()
def ledger_company(db, seed_mu_rules):
    """A company with several members, one per bucket/reason."""
    sfx = uuid.uuid4().hex[:8]
    owner = User(user_type="company", email=f"ledger-owner-{sfx}@ledger.test",
                 user_name=f"ledger-owner-{sfx}", password_hash="x")
    db.add(owner); db.flush()
    company = Company(user_id=owner.user_id, company_name="Ledger Co.",
                      email=f"ledger-co-{sfx}@ledger.test", brn=f"LEDGER_{sfx}",
                      country_code="MU")
    db.add(company); db.flush()

    basic = SalaryComponent(company_id=company.company_id, code="BASIC",
                            label="Basic", kind="earning", category="earning.basic",
                            is_basic=True, is_taxable=True)
    db.add(basic); db.flush()
    structure = SalaryStructure(company_id=company.company_id, name="S", description="x")
    db.add(structure); db.flush()
    db.add(SalaryStructureLine(structure_id=structure.id, component_id=basic.id,
                               amount=BASIC, order_index=0))
    db.flush()

    members = {}

    def _job(pu, **kw):
        j = Job(private_user_id=pu.private_user_id, company_id=company.company_id,
                job_title="Staff", employer_name="Ledger Co.", employer_brn=f"LEDGER_{sfx}",
                first_date_of_employment=datetime(2024, 1, 1, tzinfo=timezone.utc),
                work_days=["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
                weekly_rest_day_dow=7, **kw)
        db.add(j); db.flush()
        return j

    # 1. PAID — monthly with a structured assignment.
    pu = PrivateUser(user_id=_mk_user(db, "paid", sfx).user_id, first_name="Pa", last_name="Id",
                     company_id=company.company_id, role="employee")
    db.add(pu); db.flush()
    _job(pu)
    db.add(Salary(job_id=db.query(Job).filter_by(private_user_id=pu.private_user_id).one().job_id,
                  pay_basis="monthly", salary=BASIC, company_id=company.company_id))
    db.add(EmployeeSalaryAssignment(private_user_id=pu.private_user_id,
           structure_id=structure.id, currency="MUR",
           effective_from=date(2024, 1, 1), notes="x"))
    members["paid"] = pu

    # 2. EXCLUDED:no_assignment_monthly — legacy monthly salary, NO assignment.
    pu = PrivateUser(user_id=_mk_user(db, "legacy", sfx).user_id, first_name="Le", last_name="Gacy",
                     company_id=company.company_id, role="employee")
    db.add(pu); db.flush()
    j = _job(pu)
    db.add(Salary(job_id=j.job_id, pay_basis="monthly", salary=BASIC, company_id=company.company_id))
    members["legacy_monthly"] = pu

    # 3. EXCLUDED:no_job — company member with no Job row at all.
    pu = PrivateUser(user_id=_mk_user(db, "nojob", sfx).user_id, first_name="No", last_name="Job",
                     company_id=company.company_id, role="employee")
    db.add(pu); db.flush()
    members["no_job"] = pu

    # 4. NIL_PAID — hourly with a rate but zero hours logged this period.
    pu = PrivateUser(user_id=_mk_user(db, "hourly", sfx).user_id, first_name="Ho", last_name="Urly",
                     company_id=company.company_id, role="employee")
    db.add(pu); db.flush()
    j = _job(pu)
    db.add(Salary(job_id=j.job_id, pay_basis="hourly", hourly_rate=Decimal("200.00"),
                  company_id=company.company_id))
    members["hourly_zero"] = pu

    db.flush()
    return company, members


def _ledger(db, run_id):
    rows = (
        db.query(PayrollRunMemberStatus)
        .filter(PayrollRunMemberStatus.payroll_run_id == run_id)
        .all()
    )
    return {r.private_user_id: r for r in rows}


def test_every_member_in_exactly_one_bucket(db, ledger_company):
    company, members = ledger_company
    run = payroll_engine.create_draft_run(
        db, PayrollRunCreate(company_id=company.company_id,
                             period_start=PERIOD_START, period_end=PERIOD_END),
        actor_user_id=None,
    )
    db.flush()

    led = _ledger(db, run.id)
    # Every company member accounted for exactly once.
    assert set(led.keys()) == {m.private_user_id for m in members.values()}
    assert len(led) == len(members)

    assert led[members["paid"].private_user_id].bucket == "paid"

    legacy = led[members["legacy_monthly"].private_user_id]
    assert legacy.bucket == "excluded"
    assert legacy.reason_code == "no_assignment_monthly"
    assert legacy.blocks_finalize is True

    nojob = led[members["no_job"].private_user_id]
    assert nojob.bucket == "excluded"
    assert nojob.reason_code == "no_job"

    hourly = led[members["hourly_zero"].private_user_id]
    assert hourly.bucket == "nil_paid"
    assert hourly.reason_code.startswith("hourly_zero_pay:")
    assert hourly.blocks_finalize is False


def test_legacy_monthly_is_not_silently_dropped(db, ledger_company):
    """The original September bug: a monthly employee with a legacy salary but
    no assignment produced no payslip AND no record. Now they are in the ledger
    as a blocking exclusion with a fixable reason."""
    company, members = ledger_company
    run = payroll_engine.create_draft_run(
        db, PayrollRunCreate(company_id=company.company_id,
                             period_start=PERIOD_START, period_end=PERIOD_END),
        actor_user_id=None,
    )
    db.flush()

    pid = members["legacy_monthly"].private_user_id
    # No payslip...
    assert db.query(Payslip).filter_by(payroll_run_id=run.id, private_user_id=pid).count() == 0
    # ...but fully accounted for.
    row = _ledger(db, run.id)[pid]
    assert row.bucket == "excluded" and row.reason_code == "no_assignment_monthly"


def test_recompute_preserves_nil_paid_slip(db, ledger_company):
    """Regression for payroll_engine.py:2310 — recompute used to drop the
    zero-pay payslip the draft created. It must survive."""
    company, members = ledger_company
    run = payroll_engine.create_draft_run(
        db, PayrollRunCreate(company_id=company.company_id,
                             period_start=PERIOD_START, period_end=PERIOD_END),
        actor_user_id=None,
    )
    db.flush()

    hourly_pid = members["hourly_zero"].private_user_id
    assert db.query(Payslip).filter_by(payroll_run_id=run.id, private_user_id=hourly_pid).count() == 1

    payroll_engine.recompute_draft_run(db, run.id, actor_user_id=None)
    db.flush()

    # The nil payslip is still there after recompute...
    assert db.query(Payslip).filter_by(payroll_run_id=run.id, private_user_id=hourly_pid).count() == 1
    # ...and the ledger still buckets them nil_paid.
    assert _ledger(db, run.id)[hourly_pid].bucket == "nil_paid"


def test_off_payroll_member_is_non_blocking(db, ledger_company):
    """A member marked off-payroll is bucketed excluded with an off_payroll_*
    reason that does NOT block finalize — no monthly acknowledgement needed."""
    company, members = ledger_company
    # Mark the legacy-monthly member off-payroll (e.g. moved to contractor).
    pu = db.query(PrivateUser).filter_by(
        private_user_id=members["legacy_monthly"].private_user_id
    ).one()
    pu.payroll_status = "off_payroll"
    pu.off_payroll_reason = "contractor"
    db.add(pu); db.flush()

    run = payroll_engine.create_draft_run(
        db, PayrollRunCreate(company_id=company.company_id,
                             period_start=PERIOD_START, period_end=PERIOD_END),
        actor_user_id=None,
    )
    db.flush()

    row = _ledger(db, run.id)[pu.private_user_id]
    assert row.bucket == "excluded"
    assert row.reason_code == "off_payroll_contractor"
    assert row.blocks_finalize is False
    # Standing status takes precedence over the no_assignment_monthly setup gap.


def test_recompute_flips_fixed_member_to_paid(db, ledger_company):
    """After the legacy-monthly member gets an assignment, recompute moves them
    from excluded to paid in the ledger."""
    company, members = ledger_company
    run = payroll_engine.create_draft_run(
        db, PayrollRunCreate(company_id=company.company_id,
                             period_start=PERIOD_START, period_end=PERIOD_END),
        actor_user_id=None,
    )
    db.flush()

    pid = members["legacy_monthly"].private_user_id
    assert _ledger(db, run.id)[pid].bucket == "excluded"

    # Give them a structured assignment (the fix an admin would apply).
    structure = db.query(SalaryStructure).filter_by(company_id=company.company_id).first()
    db.add(EmployeeSalaryAssignment(private_user_id=pid, structure_id=structure.id,
           currency="MUR", effective_from=date(2024, 1, 1), notes="fix"))
    db.flush()

    payroll_engine.recompute_draft_run(db, run.id, actor_user_id=None)
    db.flush()

    row = _ledger(db, run.id)[pid]
    assert row.bucket == "paid"
    assert row.blocks_finalize is False
    assert db.query(Payslip).filter_by(payroll_run_id=run.id, private_user_id=pid).count() == 1


# ---------------------------------------------------------------------------
# Phase 3 — the finalize completeness gate
# ---------------------------------------------------------------------------


def _enforce(db, company):
    company.payroll_completeness_gate = "enforce"
    db.add(company); db.flush()


def _draft(db, company):
    run = payroll_engine.create_draft_run(
        db, PayrollRunCreate(company_id=company.company_id,
                             period_start=PERIOD_START, period_end=PERIOD_END),
        actor_user_id=None,
    )
    db.flush()
    return run


def test_finalize_blocked_by_unacknowledged_exclusion(db, ledger_company):
    company, members = ledger_company
    _enforce(db, company)
    run = _draft(db, company)

    with pytest.raises(HTTPException) as ei:
        payroll_engine.finalize_run(db, run.id, actor_user_id=None)
    assert ei.value.status_code == 409
    assert ei.value.detail["code"] == "INCOMPLETE_PAYROLL_RUN"
    needs = ei.value.detail["needs_acknowledgement"]
    assert members["legacy_monthly"].private_user_id in needs
    assert members["no_job"].private_user_id in needs


def test_acknowledge_then_finalize(db, ledger_company):
    company, members = ledger_company
    _enforce(db, company)
    run = _draft(db, company)

    led = _ledger(db, run.id)
    for key in ("legacy_monthly", "no_job"):
        row = led[members[key].private_user_id]
        row.acknowledged_at = datetime.now(timezone.utc)
        row.acknowledged_by_user_id = None
        row.acknowledged_reason_code = row.reason_code
        row.ack_note = "contractor, paid separately"
        db.add(row)
    db.flush()

    finalized = payroll_engine.finalize_run(db, run.id, actor_user_id=None)
    assert finalized.status == "finalized"
    # Completeness record frozen.
    counts = finalized.completeness_attestation["counts"]
    assert counts["paid"] == 1
    assert counts["nil_paid"] == 1
    assert counts["excluded_acknowledged"] == 2


def test_drift_blocks_finalize_as_must_fix(db, ledger_company):
    """An assignment created after the draft (never recomputed) means the member
    now resolves to pay but has no payslip — a non-ackable 'must fix'."""
    company, members = ledger_company
    _enforce(db, company)
    run = _draft(db, company)

    pid = members["legacy_monthly"].private_user_id
    structure = db.query(SalaryStructure).filter_by(company_id=company.company_id).first()
    db.add(EmployeeSalaryAssignment(private_user_id=pid, structure_id=structure.id,
           currency="MUR", effective_from=date(2024, 1, 1), notes="late"))
    db.flush()

    with pytest.raises(HTTPException) as ei:
        payroll_engine.finalize_run(db, run.id, actor_user_id=None)
    assert ei.value.status_code == 409
    assert pid in ei.value.detail["must_fix"]


def test_warn_mode_finalizes_and_freezes_attestation(db, ledger_company):
    company, members = ledger_company
    company.payroll_completeness_gate = "warn"
    db.add(company); db.flush()
    run = _draft(db, company)

    finalized = payroll_engine.finalize_run(db, run.id, actor_user_id=None)
    assert finalized.status == "finalized"
    att = finalized.completeness_attestation
    assert att["counts"]["excluded"] >= 2
    # Ledger is still fully populated even though nothing blocked.
    assert len(_ledger(db, run.id)) == len(members)


# ---------------------------------------------------------------------------
# Phase 4 — readiness, maker-checker, statutory hook
# ---------------------------------------------------------------------------


def test_proactive_readiness_without_a_run(db, ledger_company):
    company, members = ledger_company
    r = payroll_engine.assess_company_readiness(db, company.company_id, PERIOD_START, PERIOD_END)
    # paid + hourly-nil would produce payslips; legacy + no_job are gaps.
    assert members["paid"].private_user_id in r["ready"]
    assert members["hourly_zero"].private_user_id in r["ready"]
    not_ready_ids = {x["private_user_id"] for x in r["not_ready"]}
    assert members["legacy_monthly"].private_user_id in not_ready_ids
    assert members["no_job"].private_user_id in not_ready_ids


def test_readiness_counts_off_payroll_as_intentional(db, ledger_company):
    company, members = ledger_company
    pu = db.query(PrivateUser).filter_by(private_user_id=members["no_job"].private_user_id).one()
    pu.payroll_status = "off_payroll"
    pu.off_payroll_reason = "suspended"
    db.add(pu); db.flush()

    r = payroll_engine.assess_company_readiness(db, company.company_id, PERIOD_START, PERIOD_END)
    intentional = {x["private_user_id"]: x["reason_code"] for x in r["intentional"]}
    assert intentional.get(members["no_job"].private_user_id) == "off_payroll_suspended"


def test_maker_checker_blocks_self_finalize(db, ledger_company):
    company, members = ledger_company
    company.payroll_completeness_gate = "enforce"
    company.payroll_maker_checker = True
    db.add(company); db.flush()
    run = _draft(db, company)

    maker = User(user_type="company", email=f"maker-{uuid.uuid4().hex[:8]}@ledger.test",
                 user_name=f"maker-{uuid.uuid4().hex[:8]}", password_hash="x")
    db.add(maker); db.flush()

    # The maker acknowledges the two gaps...
    led = _ledger(db, run.id)
    for key in ("legacy_monthly", "no_job"):
        row = led[members[key].private_user_id]
        row.acknowledged_at = datetime.now(timezone.utc)
        row.acknowledged_by_user_id = maker.user_id
        row.acknowledged_reason_code = row.reason_code
        db.add(row)
    db.flush()

    # ...and the SAME person tries to finalize → blocked by maker-checker.
    with pytest.raises(HTTPException) as ei:
        payroll_engine.finalize_run(db, run.id, actor_user_id=maker.user_id)
    assert ei.value.status_code == 409
    assert ei.value.detail["code"] == "MAKER_CHECKER_REQUIRED"

    # A different admin (id=None here stands in for "someone else") passes the
    # maker-checker rule.
    finalized = payroll_engine.finalize_run(db, run.id, actor_user_id=None)
    assert finalized.status == "finalized"


def test_attestation_has_statutory_hook(db, ledger_company):
    company, members = ledger_company
    company.payroll_completeness_gate = "warn"
    db.add(company); db.flush()
    run = _draft(db, company)
    finalized = payroll_engine.finalize_run(db, run.id, actor_user_id=None)
    stat = finalized.completeness_attestation["statutory"]
    assert stat["contributors"] == 2          # paid + hourly-nil
    assert stat["expected_contributors"] >= 3  # + the legacy/no_job setup gaps
    assert stat["exempt_rules_applied"] is False
