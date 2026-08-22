"""Payroll engine — orchestrates resolver + country rules into payslips.

Two public entry points:

    create_draft_run(db, payload, actor_user_id) -> PayrollRun
        Creates a PayrollRun in 'draft' status and one Payslip per active
        employee. Country rules are looked up live (not yet snapshot).

    finalize_run(db, run_id, actor_user_id) -> PayrollRun
        Moves the run to 'finalized', stores country_rules_snapshot,
        re-runs computation against the snapshot to ensure values match.
        Idempotent only on already-finalized runs.

Computation per payslip:

    components = salary_resolver.resolve_components(employee, period_start)
    gross      = sum(earnings)
    taxable    = sum(earnings WHERE is_taxable)
    paye       = compute_paye(ytd_taxable + taxable, brackets) - ytd_paye_withheld
    statutory  = compute_statutory({basic, gross}, deductions)
    deductions = explicit deductions in components
                 + employee statutory deductions
                 + paye
    net_pay    = gross - deductions

PAYE is cumulative over the fiscal year (Country.fiscal_year_start, '07-01'
for MU): each period, tax is computed on year-to-date taxable income summed
across all finalized payslips this fiscal year plus the current period, and
only the delta over tax already withheld this fiscal year is deducted. This
is the standard MRA PAYE-as-you-earn approach — treating each month as an
isolated mini tax year (annualize-then-divide-by-12) was the old, incorrect
approach and produced wrong withholding for anyone with irregular income.

Bonus/loan/leave_impact are placeholders (zero) until their respective
modules wire in. The columns exist now so the engine output is stable.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import List, Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.model import (
    BreakLog,
    Company,
    EmployeeSalaryAssignment,
    Job,
    Loan,
    PayrollRun,
    Payslip,
    PrivateUser,
    PublicHoliday,
    Repayment,
    Salary,
    TimeLog,
)
from schema.payroll_schema import PayrollRunCreate
from schema.payroll_rules_schema import CountryOvertimeRuleRead, CountryRulesSnapshot, TaxBracketLineRead
from schema.salary_structure_schema import ResolvedComponent
from services import bonus_engine, country_assignment, fx_service, kiosk_service, one_off_allowances_service, overtime_engine, payroll_calendar, payroll_rules, proration, salary_resolver
from services.salary_resolver import ResolvedSalary


logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Per-payslip computation (pure given a snapshot)
# ---------------------------------------------------------------------------


def _resolve_fiscal_year_start(db: Session, country_code: str, period_start: date) -> date:
    """Resolve which fiscal year `period_start` falls into, returning that
    fiscal year's start date. Reads Country.fiscal_year_start ('MM-DD',
    seeded '07-01' for MU). Defaults to '01-01' (calendar year) if the
    country row or field is missing, so unconfigured countries degrade to
    calendar-year cumulative PAYE rather than crash."""
    from core.model import Country

    country = db.query(Country).filter(Country.code == country_code).one_or_none()
    raw = (country.fiscal_year_start if country else None) or "01-01"
    month, day = (int(x) for x in raw.split("-"))
    candidate = date(period_start.year, month, day)
    return candidate if candidate <= period_start else date(period_start.year - 1, month, day)


def _ytd_paye_state(
    db: Session, private_user_id: int, fiscal_year_start: date, period_start: date,
) -> tuple[Decimal, Decimal]:
    """Sum (taxable_income, paye) from FINALIZED payslips for this employee,
    strictly before period_start, within the current fiscal year — the basis
    for cumulative PAYE. Same query shape as bonus_engine._ytd_earnings
    (services/bonus_engine.py:95-112), windowed by fiscal year instead of
    calendar year. Adjustment rows (is_adjustment=True) are included — they
    are real corrections to what was actually withheld and must count toward
    true YTD state."""
    rows = (
        db.query(Payslip.taxable_income, Payslip.paye)
        .join(PayrollRun, Payslip.payroll_run_id == PayrollRun.id)
        .filter(
            Payslip.private_user_id == private_user_id,
            PayrollRun.status == "finalized",
            PayrollRun.period_start < period_start,
            PayrollRun.period_start >= fiscal_year_start,
        )
        .all()
    )
    ytd_taxable = sum((Decimal(r[0]) for r in rows), Decimal("0.00"))
    ytd_paye = sum((Decimal(r[1]) for r in rows), Decimal("0.00"))
    return ytd_taxable, ytd_paye


def compute_for_resolved(
    resolved: ResolvedSalary,
    snapshot: CountryRulesSnapshot,
    *,
    db: Session,
    private_user_id: int,
    period_start: date,
    country_code: str,
    loan_repayments: Decimal = Decimal("0.00"),
    leave_impact: Decimal = Decimal("0.00"),
    absence_deduction: Decimal = Decimal("0.00"),
    sdl_applicable: bool = False,
    flags_out: Optional[List[str]] = None,
    shadow_country_code: Optional[str] = None,
    fx_rate: Optional[Decimal] = None,
) -> dict:
    """Pure: given a resolved salary + a country rules snapshot, return the
    full payslip computation as a dict ready for Payslip creation.

    Bonus components (source='bonus') are summed into the dedicated
    `payslip.bonus` column for reporting, while still flowing through
    earnings/taxable like any other component.

    ``loan_repayments`` and ``leave_impact`` are caller-provided so this
    function remains pure (deterministic given inputs). Callers compute
    them from Loan/Leave state outside; see _compute_loan_repayments_for_period
    and _compute_leave_impact_for_period.
    """
    earnings = [c for c in resolved.components if c.kind == "earning"]
    explicit_deductions = [c for c in resolved.components if c.kind == "deduction"]

    gross = sum((c.amount for c in earnings), Decimal("0.00"))
    basic = sum(
        (c.amount for c in earnings if c.is_basic), Decimal("0.00")
    )
    bonus_total = sum(
        (c.amount for c in earnings if c.source == "bonus"), Decimal("0.00")
    )
    # Allowances are non-basic earnings excluding bonuses.
    allowances_total = sum(
        (c.amount for c in earnings if not c.is_basic and c.source != "bonus"),
        Decimal("0.00"),
    )

    # M4: build per-deduction bases by summing each component's amount into
    # every statutory code its `statutory_base_codes` lists. PAYE is included
    # so the tax bracket lookup uses the per-code base.
    bases_by_code: Dict[str, Decimal] = {}
    for c in earnings:
        codes = c.statutory_base_codes or []
        for code in codes:
            bases_by_code[code] = bases_by_code.get(code, Decimal("0")) + c.amount
    # Legacy keys for compute_statutory backward compatibility.
    bases_by_code.setdefault("basic", basic)
    bases_by_code.setdefault("gross", gross)

    # Absence docks BASIC pay the worker never earned, so it must also shrink the
    # statutory + PAYE base — otherwise CSG/NSF/PAYE are charged on pay that was
    # never received (a fully-absent month would compute statutory on full salary
    # and drive net negative). Reduce every base the basic feeds (plus the legacy
    # basic/gross keys) by the absence amount, floored at zero. Allowances are
    # untouched (absence only docks basic).
    if absence_deduction > 0:
        basic_codes = {
            code for c in earnings if c.is_basic for code in (c.statutory_base_codes or [])
        } | {"basic", "gross"}
        for code in basic_codes:
            if code in bases_by_code:
                bases_by_code[code] = max(Decimal("0"), bases_by_code[code] - absence_deduction)

    # Taxable income for PAYE: prefer the M4 'PAYE' base; fall back to
    # is_taxable summation for legacy components without statutory_base_codes.
    if "PAYE" in bases_by_code:
        taxable_monthly = bases_by_code["PAYE"]  # already net of absence above
    else:
        taxable_monthly = sum(
            (c.amount for c in earnings if c.is_taxable), Decimal("0.00")
        )
        if absence_deduction > 0:
            taxable_monthly = max(Decimal("0"), taxable_monthly - absence_deduction)

    # Statutory split (employee vs employer) using per-code bases (M4).
    # Split out first (before PAYE) so base-reducing deductions — e.g.
    # Tanzania's NSSF employee contribution reducing the PAYE base — are
    # computed and subtracted before PAYE reads that base. NULL
    # reduces_base_code for every MU row today means base_reducing_deds is
    # always empty for MU, so this is an unconditional no-op there.
    employee_deds = [
        d for d in snapshot.statutory_deductions if d.employer_or_employee == "employee"
    ]
    employer_deds = [
        d for d in snapshot.statutory_deductions if d.employer_or_employee == "employer"
    ]
    # SDL (Tanzania) only applies to employers with 10+ staff — a headcount
    # condition Company.sdl_applicable captures (see the model comment for
    # why it's an admin-set flag, not a live count). No MU row is ever
    # code=="SDL", so this is an unconditional no-op for MU.
    if not sdl_applicable:
        employer_deds = [d for d in employer_deds if d.code != "SDL"]
    base_reducing_deds = [d for d in employee_deds if d.reduces_base_code]
    other_employee_deds = [d for d in employee_deds if not d.reduces_base_code]

    base_reducing_statutory: Dict[str, Decimal] = {}
    if base_reducing_deds:
        # Only needs earnings-derived bases (gross/basic/etc) — none of these
        # rows can name a code another base-reducing row also produces, so
        # there's no ordering ambiguity within this group.
        base_reducing_statutory = payroll_rules.compute_statutory(bases_by_code, base_reducing_deds)
        for d in base_reducing_deds:
            amount = base_reducing_statutory.get(d.code, Decimal("0.00"))
            if amount <= 0:
                continue
            if d.reduces_base_code in bases_by_code:
                bases_by_code[d.reduces_base_code] = max(
                    Decimal("0"), bases_by_code[d.reduces_base_code] - amount
                )
            if d.reduces_base_code == "PAYE":
                taxable_monthly = max(Decimal("0"), taxable_monthly - amount)

    # PAYE computation mode is country-configured (TaxBracketSet.tax_computation_mode):
    #
    # CUMULATIVE_YTD (default, MU's WRA model): tax is computed on YTD taxable
    # income (prior finalized periods + this one), and only the delta over
    # what was already withheld this fiscal year is deducted now. This is the
    # standard MRA PAYE-as-you-earn approach — NOT each month annualized in
    # isolation, which double-counts nothing but also never reconciles with
    # what a full year's income actually owes until the very last month.
    #
    # FLAT_PERIODIC (TZ's TRA model): apply this period's bracket table
    # directly to this period's taxable income, independently — no YTD
    # lookup, no cumulative reconciliation. TRA publishes monthly bracket
    # tables and doesn't require an annual return for simple employment
    # income, so there's no year-end true-up to model.
    paye_monthly = Decimal("0.00")
    if snapshot.tax_bracket_set is not None:
        if snapshot.tax_bracket_set.tax_computation_mode == "FLAT_PERIODIC":
            paye_monthly = payroll_rules.compute_paye(
                taxable_monthly,
                list(snapshot.tax_bracket_set.brackets),
            )
        else:
            fy_start = _resolve_fiscal_year_start(db, country_code, period_start)
            ytd_taxable_before, ytd_paye_before = _ytd_paye_state(
                db, private_user_id, fy_start, period_start
            )
            cumulative_tax_due = payroll_rules.compute_paye(
                ytd_taxable_before + taxable_monthly,
                list(snapshot.tax_bracket_set.brackets),
            )
            # Floor at zero rather than withhold negative tax mid-year (e.g. a
            # negative adjustment on an earlier period, or a mid-year bracket-rate
            # decrease) — any true-up happens via a manual year-end correction,
            # not an automatic refund through this period's withholding.
            paye_monthly = max(Decimal("0.00"), cumulative_tax_due - ytd_paye_before)
            if cumulative_tax_due < ytd_paye_before and flags_out is not None:
                flags_out.append("paye_ytd_would_be_negative_floored")

    # other_employee_deds are computed against bases_by_code as it stands
    # now: only the specific code(s) named by reduces_base_code were
    # adjusted above (e.g. "PAYE"), so a deduction keyed to "gross" still
    # sees the full, unreduced gross — exactly right, since only PAYE
    # itself needs to see NSSF's reduction, not every other deduction.
    other_employee_statutory = payroll_rules.compute_statutory(bases_by_code, other_employee_deds)
    employee_statutory = {**base_reducing_statutory, **other_employee_statutory}
    employer_statutory = payroll_rules.compute_statutory(bases_by_code, employer_deds)

    loan_repayments = loan_repayments.quantize(Decimal("0.01"))
    leave_impact = leave_impact.quantize(Decimal("0.01"))
    absence_deduction = absence_deduction.quantize(Decimal("0.01"))

    deductions_total = (
        sum((c.amount for c in explicit_deductions), Decimal("0.00"))
        + sum(employee_statutory.values(), Decimal("0.00"))
        + paye_monthly
        + loan_repayments
        + leave_impact
        + absence_deduction
    )

    # Net-pay floor — net can never be negative (you can't pay someone a debt).
    # Cap the discretionary loan repayment first (its unpaid portion carries
    # forward via the loan ledger, which reads the returned loan_repayments),
    # then floor any residual at zero — e.g. statutory assessed on a fully-absent
    # month, where the employee took home nothing so nothing can be collected.
    net_pay = gross - deductions_total
    if net_pay < 0:
        reduce_loan = min(loan_repayments, -net_pay)
        if reduce_loan > 0:
            loan_repayments -= reduce_loan
            deductions_total -= reduce_loan
            net_pay = gross - deductions_total
            if flags_out is not None:
                flags_out.append(f"loan_capped_to_net:{reduce_loan.quantize(Decimal('0.01'))}")
        if net_pay < 0:
            uncollected = (-net_pay).quantize(Decimal("0.01"))
            deductions_total = gross
            net_pay = Decimal("0.00")
            if flags_out is not None:
                flags_out.append(f"net_pay_floored:{uncollected}")

    components_list = [
        {
            "code": c.code,
            "label": c.label,
            "kind": c.kind,
            "category": c.category,
            "amount": str(c.amount),
            "is_taxable": c.is_taxable,
            "is_basic": c.is_basic,
            "source": c.source,
            # M4 — overtime audit drill-down (multiplier, hours, source
            # clock-ins, weekly accumulator). None for non-overtime components.
            **({"meta": c.meta} if getattr(c, "meta", None) else {}),
        }
        for c in resolved.components
    ]
    if leave_impact > 0:
        components_list.append({
            "code": "LEAVE_UNPAID",
            "label": "Unpaid leave",
            "kind": "deduction",
            "category": "deduction.leave_unpaid",
            "amount": str(leave_impact),
            "is_taxable": False,
            "is_basic": False,
            "source": "leave_unpaid",
        })
    if loan_repayments > 0:
        components_list.append({
            "code": "LOAN",
            "label": "Loan repayment",
            "kind": "deduction",
            "category": "deduction.loan",
            "amount": str(loan_repayments),
            "is_taxable": False,
            "is_basic": False,
            "source": "loan",
        })
    if absence_deduction > 0:
        components_list.append({
            "code": "ABSENCE_DEDUCTION",
            "label": "Unclocked absence",
            "kind": "deduction",
            "category": "deduction.salaried_absence",
            "amount": str(absence_deduction),
            "is_taxable": False,
            "is_basic": False,
            "source": "salaried_absence",
        })

    # ------------------------------------------------------------------
    # Shadow payroll (Phase 2) — host-country statutory figures for an
    # employee whose effective country (active assignment) differs from the
    # employer country. Pure estimate on the home-resolved figures converted
    # into host currency; the home figures above remain the real payroll.
    # ------------------------------------------------------------------
    shadow_payload = {
        "shadow_country_code": None,
        "shadow_currency": None,
        "shadow_gross": None,
        "shadow_taxable_income": None,
        "shadow_tax": None,
        "shadow_ss": None,
        "shadow_equalization_due": None,
    }
    if shadow_country_code and shadow_country_code.upper() != country_code.upper():
        try:
            from core.model import Country as _Country
            from decimal import Decimal as _Dec

            flags = flags_out if flags_out is not None else []
            fx = _Dec(str(fx_rate)) if fx_rate is not None else None
            if fx is None or fx <= 0:
                flags.append(f"shadow_fx_unavailable:{shadow_country_code}")
            else:
                host_snapshot = payroll_rules.resolve(db, shadow_country_code.upper(), period_start)
                host_ccy = (
                    db.query(_Country)
                    .filter(_Country.code == shadow_country_code.upper())
                    .one_or_none()
                )
                host_currency = (host_ccy.currency if host_ccy else None) or "XXX"
                host_gross = (gross / fx).quantize(Decimal("0.01"))
                host_taxable = taxable_monthly / fx
                host_bases = {
                    k: (v / fx) for k, v in bases_by_code.items() if v is not None
                }
                shadow = payroll_rules.compute_shadow(
                    taxable_host=host_taxable,
                    bases_host=host_bases,
                    snapshot=host_snapshot,
                    fx_rate=fx,
                    home_paye=paye_monthly,
                    host_currency=host_currency,
                )
                if host_snapshot.tax_bracket_set is None and not host_snapshot.statutory_deductions:
                    flags.append(f"shadow_missing_rules:{shadow_country_code}")
                shadow_payload = {
                    "shadow_country_code": shadow_country_code.upper(),
                    "shadow_currency": host_currency,
                    "shadow_gross": host_gross,
                    "shadow_taxable_income": host_taxable.quantize(Decimal("0.01")),
                    "shadow_tax": shadow["shadow_tax"],
                    "shadow_ss": shadow["shadow_ss"],
                    "shadow_equalization_due": shadow["shadow_equalization_due"],
                }
        except Exception as exc:  # noqa: BLE001 — never let shadow break payroll
            flags_out = flags_out or []
            flags_out.append(f"shadow_error:{shadow_country_code}:{str(exc)[:80]}")

    return {
        "gross": gross.quantize(Decimal("0.01")),
        "taxable_income": taxable_monthly.quantize(Decimal("0.01")),
        "paye": paye_monthly,
        "bonus": bonus_total.quantize(Decimal("0.01")),
        "allowances_total": allowances_total.quantize(Decimal("0.01")),
        "deductions_total": deductions_total.quantize(Decimal("0.01")),
        "loan_repayments": loan_repayments,
        "leave_impact": leave_impact,
        "net_pay": net_pay.quantize(Decimal("0.01")),
        "statutory_employee": {k: str(v) for k, v in employee_statutory.items()},
        "statutory_employer": {k: str(v) for k, v in employer_statutory.items()},
        "currency": resolved.currency,
        "components": components_list,
        **shadow_payload,
    }


# ---------------------------------------------------------------------------
# Run lifecycle
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Leave summary — per-type day counts in the payroll period.
# ---------------------------------------------------------------------------


# MU paid-leave defaults; used only when a Leave row's leave_type_id is null.
# When leave_type_id is set, the LeaveType row's `is_paid` flag is the truth.
_DEFAULT_PAID_TYPES = frozenset({"sick", "annual", "paid", "public_holiday"})


def _compute_leave_summary(
    db: Session, private_user_id: int, period_start: date, period_end: date,
    country_code: Optional[str] = None,
    flags_out: Optional[List[str]] = None,
) -> list[dict]:
    """Approved Leave rows whose [start_date, end_date] intersect the period,
    aggregated by type. Returns a list shaped for the payslip JSONB column:

        [
          {"code": "sick",   "label": "Sick leave",   "days": 2, "paid": True},
          {"code": "annual", "label": "Annual leave", "days": 1, "paid": True},
        ]

    Days are intersection days (the part of the leave that falls within the
    period), counted inclusive of both endpoints. Returns an empty list if
    the employee took no approved leave in the period.

    M3 — public holidays falling inside a leave window are NOT counted as
    leave days (MU WRA s.31: the holiday is credited back to the balance and
    is paid as a holiday, not consumed as leave). When `country_code` is given
    we subtract those holiday days per leave row; if any adjustment happened we
    append "holiday_during_leave_adjusted" to `flags_out` for the audit trail.
    """
    from core.model import Leave, LeaveType, PublicHoliday

    rows = (
        db.query(Leave, LeaveType)
        .outerjoin(LeaveType, LeaveType.id == Leave.leave_type_id)
        .filter(Leave.private_user_id == private_user_id)
        .filter(Leave.status == "approved")
        .filter(Leave.start_date <= period_end)
        .filter(Leave.end_date >= period_start)
        .all()
    )
    if not rows:
        return []

    # Holiday dates (observed) for the country within the period, looked up
    # once. Empty set when country_code is None — no adjustment then.
    holiday_dates: set[date] = set()
    if country_code:
        for h in (
            db.query(PublicHoliday)
            .filter(PublicHoliday.country_code == country_code.upper())
            .filter(func.coalesce(PublicHoliday.observed_date, PublicHoliday.date) >= period_start)
            .filter(func.coalesce(PublicHoliday.observed_date, PublicHoliday.date) <= period_end)
            .all()
        ):
            holiday_dates.add(h.observed_date or h.date)

    adjusted = False
    buckets: dict[str, dict] = {}
    for lv, lt in rows:
        eff_start = max(lv.start_date, period_start)
        eff_end = min(lv.end_date, period_end)
        if eff_end < eff_start:
            continue
        days = (eff_end - eff_start).days + 1

        # Credit back public-holiday days that fall inside the leave window —
        # they are paid as holidays, not consumed as leave.
        if holiday_dates:
            holidays_in_window = sum(
                1 for hd in holiday_dates if eff_start <= hd <= eff_end
            )
            if holidays_in_window:
                days -= holidays_in_window
                adjusted = True
        if days <= 0:
            continue

        # Resolve code/label/paid: prefer the catalog row when present.
        if lt is not None:
            code = lt.code
            label = lt.label or lt.code
            paid = bool(lt.is_paid)
        else:
            code = (lv.leave_type or "other").lower()
            label = (lv.leave_type or "Other").replace("_", " ").title()
            paid = code in _DEFAULT_PAID_TYPES

        bucket = buckets.setdefault(code, {"code": code, "label": label, "days": 0, "paid": paid})
        bucket["days"] += days

    if adjusted and flags_out is not None:
        flags_out.append("holiday_during_leave_adjusted")

    return sorted(buckets.values(), key=lambda b: b["code"])


# ---------------------------------------------------------------------------
# Loan & unpaid-leave deductions (A1 / A2).
# ---------------------------------------------------------------------------


# Approximate installments-per-month for non-monthly frequencies. Biweekly and
# weekly are intentionally coarse: payroll runs monthly, so an employee on a
# weekly loan plan gets ~4 weekly installments per payroll period.
_INSTALLMENTS_PER_MONTH = {
    "monthly": Decimal("1"),
    "biweekly": Decimal("2"),
    "weekly": Decimal("4"),
}


def _compute_loan_repayments_for_period(
    db: Session, private_user_id: int, period_start: date, period_end: date,
) -> Decimal:
    """Sum of loan installments due in the payroll period for the employee.

    Only **employer** loans are deducted from pay — 'personal' loans are the
    employee's own self-tracked records (mobile Expenses) and must never be
    deducted from their salary. Skips loans not yet started, fully repaid, or
    non-active. The per-period installment is `amount / duration_months` (the
    monthly slice), scaled by payment_frequency. Each installment is capped at
    the remaining principal so we never over-deduct on the final period.
    """
    loans = (
        db.query(Loan)
        .filter(Loan.private_user_id == private_user_id)
        .filter(Loan.loan_type == "employer")
        .filter(Loan.status == "active")
        .all()
    )
    total = Decimal("0.00")
    for loan in loans:
        if loan.start_date and loan.start_date > period_end:
            continue
        principal = Decimal(str(loan.amount or 0))
        repaid = Decimal(str(loan.repaid_amount or 0))
        remaining = principal - repaid
        if remaining <= 0:
            continue
        duration = loan.duration_months or 0
        if duration <= 0:
            # Without a duration we can't derive a sane installment; skip.
            continue
        freq = (loan.payment_frequency or "monthly").lower()
        scale = _INSTALLMENTS_PER_MONTH.get(freq, Decimal("1"))
        per_installment = principal / Decimal(duration)
        period_amount = (per_installment * scale).quantize(Decimal("0.01"))
        if period_amount > remaining:
            period_amount = remaining.quantize(Decimal("0.01"))
        total += period_amount
    return total.quantize(Decimal("0.01"))


def _record_loan_repayments_for_period(
    db: Session, private_user_id: int, period_end: date, total: Decimal,
    run_id: int,
) -> None:
    """Distribute a single payroll-period repayment across the employee's
    active loans, oldest-first, and stamp `Repayment` rows + advance
    `Loan.repaid_amount`. Called on finalize so the audit trail is durable.

    Each row is tagged with ``run_id`` so the booking is idempotent (a re-run
    for the same run won't double-book) and reversible (cancel_run rolls back
    exactly this run's rows). On a redo the old run is cancelled first, which
    reverses its rows, so the fresh run advances the ledger from a clean base.
    """
    if total <= 0:
        return
    # Idempotency: if this run already booked repayments for this employee,
    # don't book again (defends against a retried finalize).
    already = (
        db.query(Repayment.repayment_id)
        .join(Loan, Loan.loan_id == Repayment.loan_id)
        .filter(Repayment.payroll_run_id == run_id)
        .filter(Loan.private_user_id == private_user_id)
        .first()
    )
    if already is not None:
        return
    loans = (
        db.query(Loan)
        # Employer loans only — never book a repayment against a personal loan
        # (must stay in lockstep with _compute_loan_repayments_for_period).
        .filter(Loan.private_user_id == private_user_id)
        .filter(Loan.loan_type == "employer")
        .filter(Loan.status == "active")
        .order_by(Loan.start_date.asc().nulls_first(), Loan.loan_id.asc())
        .all()
    )
    remaining_to_apply = total
    for loan in loans:
        if remaining_to_apply <= 0:
            break
        principal = Decimal(str(loan.amount or 0))
        repaid = Decimal(str(loan.repaid_amount or 0))
        owed = principal - repaid
        if owed <= 0:
            continue
        apply_amount = min(owed, remaining_to_apply).quantize(Decimal("0.01"))
        db.add(Repayment(
            loan_id=loan.loan_id,
            amount=float(apply_amount),
            payment_date=period_end,
            payroll_run_id=run_id,
        ))
        loan.repaid_amount = float((repaid + apply_amount).quantize(Decimal("0.01")))
        if loan.repaid_amount >= float(principal):
            loan.status = "paid"
        remaining_to_apply -= apply_amount


def _salaried_days_divisor(salary, total_working: int) -> int:
    """Days basis for a salaried worker's daily rate (absence / unpaid-leave
    docking). Uses the employer-set ``days_of_work_per_month`` (e.g. 22 for a
    5-day week, 26 for 6) so one absent day costs the SAME every month instead
    of swinging with the calendar's working-day count. Falls back to the
    period's actual working days when the profile value is unset/invalid, or for
    non-monthly pay bases (hourly/daily already net out missing days)."""
    pb = (getattr(salary, "pay_basis", None) or "monthly").lower()
    if pb != "monthly":
        return total_working
    try:
        d = int(getattr(salary, "days_of_work_per_month", None) or 0)
    except (TypeError, ValueError):
        d = 0
    return d if d > 0 else total_working


def _compute_leave_impact_for_period(
    db: Session,
    country_code: str,
    employee: PrivateUser,
    leave_summary: list[dict],
    earnings_gross: Decimal,
    period_start: date,
    period_end: date,
) -> Decimal:
    """Deduction for unpaid leave taken during the period.

    impact = unpaid_days × (earnings_gross / working_days_in_period)

    Earnings_gross already reflects FTE/proration. We cap unpaid_days at the
    number of working days so we never deduct more than the gross.
    """
    unpaid_days = 0
    for entry in leave_summary or []:
        if not entry.get("paid", True):
            unpaid_days += int(entry.get("days") or 0)
    if unpaid_days <= 0 or earnings_gross <= 0:
        return Decimal("0.00")
    job = (
        db.query(Job)
        .filter(Job.private_user_id == employee.private_user_id)
        .order_by(Job.created_at.desc())
        .first()
    )
    work_days_mask = job.work_days if job else None
    total_working = proration.working_days_in_period(
        db, country_code, period_start, period_end, work_days_mask,
    )
    if total_working <= 0:
        return Decimal("0.00")
    capped_days = min(unpaid_days, total_working)
    daily = earnings_gross / Decimal(total_working)
    return (daily * Decimal(capped_days)).quantize(Decimal("0.01"))


def _compute_salaried_absence_for_period(
    db: Session,
    country_code: str,
    employee: PrivateUser,
    earnings_gross_basic: Decimal,
    period_start: date,
    period_end: date,
    company_timezone: str,
    require_approved_clockins: bool,
    flags_out: Optional[List[str]] = None,
    as_of: Optional[date] = None,
    details_out: Optional[dict] = None,
) -> Decimal:
    """#17 — Deduction for scheduled working days a SALARIED (monthly) employee
    neither clocked in for nor took approved leave on (unexplained absence),
    when the company runs clock-driven payroll. This is what makes "the clock is
    the constant": the contracted basic stays fixed and not showing up adjusts it
    down, rather than recomputing basic as hours × rate.

        impact = absent_days × (gross_basic / days_basis)

    where days_basis is the employer-set `days_of_work_per_month` (22/26) when
    present, else the period's actual working days (see `_salaried_days_divisor`).
    Using the contracted days basis keeps one absent day worth the same every
    month, instead of swinging with the calendar. (Unpaid *statutory* leave keeps
    its own "ordinary daily wage" basis in `_compute_leave_impact_for_period` —
    the two never stack on the same day, since absence excludes approved-leave
    dates, but they are no longer required to share a divisor.)

    Guards (defense-in-depth — ANY failing guard returns 0.00):
      * pay_basis must be 'monthly'. The hourly/daily bases already net out
        missing days (hours×rate / days×daily_rate); deducting again would
        double-hit the same absence.
      * require_approved_clockins must be ON. This is the company's explicit
        opt-in to clock-driven payroll; it is OFF by default, so a company that
        does not run attendance is NEVER silently zeroed.
      * the employee must have >= 1 non-rejected clock-in in the period. A
        salaried manager who never clocks in is *untracked*, not
        absent-every-day — docking their whole salary would be catastrophic.
        No clock-ins → skip (and flag it so it's visible, not silently dropped).

    Presence is approval-INDEPENDENT: any clock-in that wasn't admin-rejected
    proves the person showed up, whether or not it's been approved yet. Approval
    gates whether the *hours/overtime* pay, not whether the day was worked. This
    also keeps the run and the pre-approval estimate in agreement (the estimate
    surface shows the same absence the finalized run will). A REJECTED clock-in
    does not count as presence — the employer judged it invalid, so the day
    falls back to absence.

    Days covered by approved leave (paid OR unpaid) are NOT counted as absent:
    paid leave is present, and unpaid leave is already handled by
    `_compute_leave_impact_for_period`. Public holidays are excluded by the
    working-day mask. The result is capped at total working days so it can never
    exceed the gross.

    ``details_out``, when passed, is populated with
    ``{"scheduled_days", "present_days", "absent_days"}`` whenever the
    computation actually runs (i.e. none of the early-return guards fire) —
    for the estimate/profile UI to show a real day-count breakdown instead of
    just the resulting deduction amount. Left untouched on any early return.
    """
    if earnings_gross_basic <= 0 or not require_approved_clockins:
        return Decimal("0.00")

    job, salary = _active_job_with_salary(db, employee.private_user_id)
    pay_basis = (salary.pay_basis if salary and salary.pay_basis else "monthly").lower()
    if pay_basis != "monthly":
        return Decimal("0.00")

    work_days_mask = job.work_days if job else None
    working_dates = proration.working_dates_in_period(
        db, country_code, period_start, period_end, work_days_mask,
    )
    # Don't count days OUTSIDE the employment span as absences. A mid-month
    # joiner/leaver can't be "absent" before they're hired or after they leave,
    # and proration already pays only the in-employment portion — without this
    # the dock stacks on top of proration and double-penalises them.
    _ds = getattr(job, "first_date_of_employment", None) if job else None
    _de = getattr(job, "end_date", None) if job else None
    emp_start = _ds.date() if _ds is not None and hasattr(_ds, "date") else _ds
    emp_end = _de.date() if _de is not None and hasattr(_de, "date") else _de
    # Upper bound: employment end, and — in projection mode — `as_of` (today), so
    # a mid-period draft is a true "so far" projection and doesn't dock days that
    # haven't happened yet. as_of is None on a normal final run (no cap).
    upper = emp_end
    if as_of is not None:
        upper = as_of if upper is None else min(upper, as_of)
    if emp_start or upper:
        working_dates = {
            d for d in working_dates
            if (emp_start is None or d >= emp_start) and (upper is None or d <= upper)
        }
    total_working = len(working_dates)
    if total_working <= 0:
        return Decimal("0.00")

    # Approved clock-ins → set of company-LOCAL dates the employee was present.
    # start_time is TIMESTAMPTZ (UTC); attribute each session to its local day so
    # a near-midnight clock-in lands on the right calendar date for the company.
    try:
        tz = ZoneInfo(company_timezone)
    except Exception:
        tz = ZoneInfo("Indian/Mauritius")
    start_dt = datetime.combine(period_start, time.min, tzinfo=timezone.utc)
    end_dt = datetime.combine(period_end, time.max, tzinfo=timezone.utc)
    clocked_dates: set[date] = set()
    for (st,) in (
        db.query(TimeLog.start_time)
        .filter(TimeLog.private_user_id == employee.private_user_id)
        .filter(TimeLog.start_time >= start_dt)
        .filter(TimeLog.start_time <= end_dt)
        .filter(TimeLog.start_time.isnot(None))
        .filter(TimeLog.admin_rejected.is_(False))
        .all()
    ):
        if st is not None:
            clocked_dates.add(st.astimezone(tz).date())

    # Safety valve: zero (non-rejected) clock-ins ⇒ untracked employee, not
    # someone absent every working day. Never zero them out.
    if not clocked_dates:
        if flags_out is not None:
            flags_out.append("salaried_absence_skipped:no_clockins")
        return Decimal("0.00")

    # Approved leave dates (paid or unpaid) are presence/handled elsewhere.
    from core.model import Leave

    leave_dates: set[date] = set()
    for lv in (
        db.query(Leave)
        .filter(Leave.private_user_id == employee.private_user_id)
        .filter(Leave.status == "approved")
        .filter(Leave.start_date <= period_end)
        .filter(Leave.end_date >= period_start)
        .all()
    ):
        cursor = max(lv.start_date, period_start)
        last = min(lv.end_date, period_end)
        while cursor <= last:
            leave_dates.add(cursor)
            cursor += timedelta(days=1)

    absent_days = len(working_dates - clocked_dates - leave_dates)
    absent_days = min(absent_days, total_working)
    if details_out is not None:
        details_out["scheduled_days"] = total_working
        details_out["absent_days"] = absent_days
        details_out["present_days"] = total_working - absent_days
    if absent_days <= 0:
        return Decimal("0.00")

    divisor = _salaried_days_divisor(salary, total_working)
    daily = earnings_gross_basic / Decimal(divisor)
    impact = (daily * Decimal(absent_days)).quantize(Decimal("0.01"))
    impact = min(impact, earnings_gross_basic.quantize(Decimal("0.01")))
    if flags_out is not None:
        flags_out.append(f"salaried_absence:{absent_days}d")
    return impact


def _active_job_with_salary(db: Session, private_user_id: int) -> tuple[Optional[Job], Optional[Salary]]:
    """Most recent Job + its first Salary row, or (None, None)."""
    job = (
        db.query(Job)
        .filter(Job.private_user_id == private_user_id)
        .order_by(Job.created_at.desc())
        .first()
    )
    if job is None:
        return None, None
    salary = (
        db.query(Salary)
        .filter(Salary.job_id == job.job_id)
        .order_by(Salary.created_at.desc())
        .first()
    )
    return job, salary


def _replace_or_add_basic(
    resolved: ResolvedSalary, amount: Decimal, label: str, source: str,
    meta: Optional[dict] = None,
) -> None:
    """Replace the resolved BASIC earning's amount, or insert a synthetic one
    if the structure didn't define a basic component.

    ``meta`` is the proration breakdown (e.g. hours × rate) surfaced to the
    employee as a "how this was computed" drill-down on the payslip.
    """
    for c in resolved.components:
        if c.is_basic and c.kind == "earning":
            c.amount = amount.quantize(Decimal("0.01"))
            c.source = source
            if meta is not None:
                c.meta = meta
            return
    # No basic in the structure — synthesize one. We use a sentinel
    # component_id of 0 because there is no underlying SalaryComponent row.
    resolved.components.insert(0, ResolvedComponent(
        component_id=0,
        code="BASIC",
        label=label,
        kind="earning",
        category="earning.basic",
        amount=amount.quantize(Decimal("0.01")),
        is_taxable=True,
        is_basic=True,
        source=source,
        statutory_base_codes=["PAYE", "CSG_EE", "CSG_ER", "NSF_EE", "NSF_ER"],
        meta=meta,
    ))


_BUCKET_LABELS = {
    "REG": "Regular hours",
    "OT_REST_DAY": "Rest-day work",
    "OT_HOLIDAY_NORMAL": "Public holiday (normal hours)",
    "OT_HOLIDAY_AFTER": "Public holiday (after hours)",
    "NIGHT_PREMIUM": "Night premium",
}


def _bucket_label(code: str) -> str:
    if code in _BUCKET_LABELS:
        return _BUCKET_LABELS[code]
    if code.startswith("OT_WEEKDAY_T"):
        return f"Overtime (tier {code[len('OT_WEEKDAY_T'):]})"
    return code


def _load_and_bucket_overtime(
    db: Session,
    employee: PrivateUser,
    job: Optional[Job],
    period_start: date,
    period_end: date,
    country_code: str,
    overtime_rule: CountryOvertimeRuleRead,
    company_timezone: str,
    require_approved_clockins: bool,
    *,
    eligibility: str,
    monthly_basic: Optional[Decimal],
    assume_ot_confirmed: bool = False,
    break_in_minutes_per_day: int = 0,
):
    """Load TimeLogs (extended 6-day lookback so the weekly accumulator is
    correct at period boundaries) + BreakLogs + holidays and run
    overtime_engine.bucket(). Shared by BOTH the hourly and the monthly
    (MONTHLY_ELIGIBLE salaried) pay-basis paths so the OT math + log→bucketer
    conversion live in exactly one place.

    Returns (buckets, flags, logs_q, raw_log_count, dropped_unapproved) — the
    trailing three feed the hourly path's zero-pay diagnostics; the monthly
    path ignores them.
    """
    from datetime import timedelta as _td

    load_start = period_start - _td(days=6)

    logs_q = (
        db.query(TimeLog)
        .filter(TimeLog.private_user_id == employee.private_user_id)
        # start_time is TIMESTAMPTZ — bound with explicit UTC datetimes. Naive
        # bounds get coerced using the DB session TimeZone, which silently
        # shifts the window (and can drop boundary clock-ins) on any non-UTC
        # session. Match the rest of the codebase: always compare in UTC.
        .filter(TimeLog.start_time >= datetime.combine(load_start, time.min, tzinfo=timezone.utc))
        .filter(TimeLog.start_time <= datetime.combine(period_end, time.max, tzinfo=timezone.utc))
        .all()
    )
    raw_log_count = len(logs_q)
    # Approval gate: when require_approved_clockins, drop unapproved logs here
    # (engine's own confirmation gate handles is_overtime separately).
    dropped_unapproved = 0
    if require_approved_clockins:
        kept = [t for t in logs_q if getattr(t, "admin_approved", False)]
        dropped_unapproved = len(logs_q) - len(kept)
        logs_q = kept

    # Clamp each session's start to the job's scheduled shift start before it
    # ever reaches the bucketer — same rule the no-overtime-rule-configured
    # hourly fallback applies via proration.sum_hours_worked_in_period. This
    # is the actual production path (both the hourly bucketed engine and the
    # salaried WRA overtime detection share this loader), so without this,
    # early clock-in minutes would count toward REG/OT hours here even
    # though the fallback path already excludes them.
    _job_work_start = getattr(job, "work_start_time", None)
    _job_work_end = getattr(job, "work_end_time", None)
    bucketer_logs = [
        overtime_engine.BucketerTimeLog(
            timelog_id=t.timelog_id,
            start_utc=kiosk_service.KioskService.effective_paid_start(
                _job_work_start, _job_work_end, company_timezone, t.start_time,
            ),
            end_utc=t.end_time,
            is_overtime=bool(t.is_overtime),
            overtime_confirmed=bool(t.overtime_confirmed_by_employer),
        )
        for t in logs_q
        if t.start_time is not None
    ]

    timelog_ids = [t.timelog_id for t in logs_q]
    # A break the worker never explicitly ended (end_time NULL) must still be
    # deducted through to the enclosing shift's own end_time — same rule as
    # db_models/crud/job.py::update_time_log's hours_worked calc. Filtering
    # these out entirely (as an earlier version of this query did) silently
    # paid straight through an unclosed break in the actual payroll run, not
    # just a display estimate.
    end_time_by_log = {t.timelog_id: t.end_time for t in logs_q}
    breaks_by_log: Dict[int, List] = {}
    if timelog_ids:
        for br in (
            db.query(BreakLog)
            .filter(BreakLog.timelog_id.in_(timelog_ids))
            .all()
        ):
            effective_end = br.end_time if br.end_time is not None else end_time_by_log.get(br.timelog_id)
            if br.start_time is None or effective_end is None:
                continue
            breaks_by_log.setdefault(br.timelog_id, []).append(
                overtime_engine.BucketerBreak(
                    timelog_id=br.timelog_id,
                    start_utc=br.start_time,
                    end_utc=effective_end,
                )
            )

    # #3 — break fallback: a shift with NO logged break still has its contracted
    # unpaid break deducted, using the salary profile's break_in_minutes_per_day.
    # Logged breaks always win; the profile value only fills shifts where the
    # worker never clocked a break, so forgetting to clock out for lunch doesn't
    # silently pay through it. Hourly path only — the salaried caller passes 0.
    if break_in_minutes_per_day and break_in_minutes_per_day > 0:
        for t in bucketer_logs:
            if t.timelog_id in breaks_by_log:
                continue  # real logged break(s) take precedence
            if t.start_utc is None or t.end_utc is None or t.end_utc <= t.start_utc:
                continue
            shift_secs = (t.end_utc - t.start_utc).total_seconds()
            # leave >= 1 paid minute; never deduct more than the shift itself
            br_secs = min(break_in_minutes_per_day * 60, max(0.0, shift_secs - 60))
            if br_secs <= 0:
                continue
            b_start = t.start_utc + (t.end_utc - t.start_utc) / 2 - _td(seconds=br_secs / 2)
            breaks_by_log.setdefault(t.timelog_id, []).append(
                overtime_engine.BucketerBreak(
                    timelog_id=t.timelog_id,
                    start_utc=b_start,
                    end_utc=b_start + _td(seconds=br_secs),
                )
            )

    # Holidays — observed_date set (falls back to date when observed_date NULL).
    holidays = frozenset(
        (h.observed_date or h.date)
        for h in (
            db.query(PublicHoliday)
            .filter(PublicHoliday.country_code == country_code)
            .filter(PublicHoliday.date >= load_start)
            .filter(PublicHoliday.date <= period_end)
            .all()
        )
    )

    # M6 — per-company holiday multiplier overrides (CompanyHolidayRate).
    # date is stored as a 'YYYY-MM-DD' string; parse to date for the engine.
    from core.model import CompanyHolidayRate as _CHR
    holiday_overrides: Dict[date, Decimal] = {}
    company_id = getattr(job, "company_id", None) or getattr(employee, "company_id", None)
    if company_id is not None:
        for r in (
            db.query(_CHR)
            .filter(_CHR.company_id == company_id)
            .all()
        ):
            try:
                d = date.fromisoformat(str(r.date)[:10])
            except (ValueError, TypeError):
                continue
            if load_start <= d <= period_end:
                holiday_overrides[d] = Decimal(str(r.multiplier))

    rest_day = int(getattr(job, "weekly_rest_day_dow", 7) or 7)
    contracted = getattr(job, "contracted_hours_per_week", None)

    buckets, flags = overtime_engine.bucket(
        logs=bucketer_logs,
        breaks_by_log=breaks_by_log,
        rule=overtime_rule,
        holidays_by_observed_date=holidays,
        period_start=period_start,
        period_end=period_end,
        weekly_rest_day_dow=rest_day,
        contracted_hours_per_week=Decimal(contracted) if contracted is not None else None,
        overtime_eligibility=eligibility,
        monthly_basic=monthly_basic,
        company_timezone=company_timezone,
        holiday_overrides=holiday_overrides,
        assume_ot_confirmed=assume_ot_confirmed,
    )
    return buckets, flags, logs_q, raw_log_count, dropped_unapproved


def _bucket_hourly_overtime(
    db: Session,
    employee: PrivateUser,
    job: Optional[Job],
    salary: Salary,
    period_start: date,
    period_end: date,
    country_code: str,
    overtime_rule: CountryOvertimeRuleRead,
    company_timezone: str,
    require_approved_clockins: bool,
    flags_out: Optional[List[str]] = None,
    assume_ot_confirmed: bool = False,
) -> List[ResolvedComponent]:
    """M4 — route the hourly pay basis through the bucketed overtime engine.

    Maps each BucketedHours to a ResolvedComponent with the multiplier baked
    into the amount and is_basic set only on REG buckets. Loading + bucketing
    is shared with the salaried path via _load_and_bucket_overtime.
    """
    eligibility = (getattr(job, "overtime_eligibility", "HOURLY") or "HOURLY")
    hourly_rate = Decimal(salary.hourly_rate)

    buckets, flags, logs_q, raw_log_count, dropped_unapproved = _load_and_bucket_overtime(
        db, employee, job, period_start, period_end, country_code, overtime_rule,
        company_timezone, require_approved_clockins,
        eligibility=eligibility, monthly_basic=None, assume_ot_confirmed=assume_ot_confirmed,
        break_in_minutes_per_day=int(getattr(salary, "break_in_minutes_per_day", 0) or 0),
    )
    if flags_out is not None:
        flags_out.extend(flags)

    # Zero-pay diagnostics — when the employee has clock-in data in the period
    # but it all dropped out of the computation, surface WHY so the employer
    # isn't left staring at a bare 0. Pick the dominant reason; the bucketer
    # itself silently skips open logs and pending OT (overtime_engine ~L491).
    total_bucket_hours = sum((b.hours for b in buckets), Decimal("0"))
    if total_bucket_hours == 0 and flags_out is not None:
        open_logs = sum(1 for t in logs_q if t.end_time is None and t.start_time is not None)
        pending_ot = sum(
            1 for t in logs_q
            if t.end_time is not None
            and bool(t.is_overtime)
            and not bool(t.overtime_confirmed_by_employer)
            and not assume_ot_confirmed
        )
        if raw_log_count == 0:
            flags_out.append("hourly_zero_pay:no_logs_in_period")
        elif dropped_unapproved:
            flags_out.append(f"hourly_zero_pay:unapproved_clockins:{dropped_unapproved}")
        elif pending_ot:
            flags_out.append(f"hourly_zero_pay:pending_overtime:{pending_ot}")
        elif open_logs:
            flags_out.append(f"hourly_zero_pay:open_logs:{open_logs}")
        else:
            flags_out.append("hourly_zero_pay:no_payable_hours")

    components: List[ResolvedComponent] = []
    for b in buckets:
        amount = b.amount(hourly_rate)
        components.append(ResolvedComponent(
            component_id=0,
            code=b.code,
            label=_bucket_label(b.code),
            kind="earning",
            category="earning.basic" if b.counts_in_basic_gross else "earning.overtime",
            amount=amount,
            is_taxable=True,
            is_basic=b.counts_in_basic_gross,
            source="overtime",
            statutory_base_codes=["PAYE", "CSG_EE", "CSG_ER", "NSF_EE", "NSF_ER"]
                if b.counts_in_basic_gross
                else ["PAYE", "CSG_EE", "CSG_ER"],  # OT excluded from NSF base
            meta={
                "multiplier": str(b.multiplier),
                "hours": str(b.hours),
                "source_timelog_ids": list(b.source_timelog_ids),
                "weekly_accumulator_at_emit": str(b.weekly_accumulator_at_emit),
                "notes": b.notes,
            },
        ))
    return components


def _salaried_ot_mode() -> str:
    """SALARIED_OT_MODE env: 'off' | 'warn' | 'auto' (default 'warn').

    warn  = compute the s.24 overtime a MONTHLY_ELIGIBLE worker is owed and emit
            it as a `salaried_ot_review` flag WITHOUT changing pay. The employer
            reviews it and pays via the manual "Additional duty" allowance. This
            is the chosen production mode: it stops salaried OT being silently
            missed while keeping a human in the loop (see doc/SALARIED-OVERTIME-
            PLAN.md decision banner).
    auto  = add the computed OT to pay directly. DEFERRED — do not enable until
            the prod measurement + lawyer sign-off in Phase 0 clear.
    off   = compute nothing (pre-detection behavior).
    """
    import os
    v = (os.getenv("SALARIED_OT_MODE", "warn") or "warn").strip().lower()
    return v if v in ("off", "warn", "auto") else "warn"


def _apply_salaried_overtime(
    db: Session,
    employee: PrivateUser,
    job: Optional[Job],
    period_start: date,
    period_end: date,
    country_code: str,
    resolved: ResolvedSalary,
    overtime_rule: CountryOvertimeRuleRead,
    company_timezone: str,
    require_approved_clockins: bool,
    *,
    flags_out: Optional[List[str]] = None,
    assume_ot_confirmed: bool = False,
) -> None:
    """WRA s.24/s.25 — overtime detection for MONTHLY_ELIGIBLE (salaried) workers.

    The fixed monthly salary already pays normal hours, so we keep ONLY the
    bucketer's OT buckets (rest-day / public-holiday / >45h) and price them at
    the s.25 notional rate (monthly basic ÷ 195). Inert unless the worker is
    classified MONTHLY_ELIGIBLE AND SALARIED_OT_MODE != 'off'.

    Default 'warn' mode emits a `salaried_ot_review:<hours>:<amount>` flag and
    does NOT touch pay (the employer pays via the manual Additional-duty rail).
    'auto' mode (deferred) would add the OT components to pay. Runs BEFORE the
    proration early-return so full-month employees are covered; OT components
    carry source='overtime' so the proration loop (which only scales
    source=='structure') never touches them. The bucketer auto-downgrades a
    worker whose basic exceeds the OT cap (s.3, >Rs600k/yr) to EXEMPT → no OT.
    """
    eligibility = (getattr(job, "overtime_eligibility", "HOURLY") or "HOURLY")
    if eligibility != "MONTHLY_ELIGIBLE":
        return
    mode = _salaried_ot_mode()
    if mode == "off":
        return

    # Notional s.25 hourly rate from the FULL (pre-proration) monthly basic.
    basic = next(
        (c.amount for c in resolved.components
         if c.is_basic and c.kind == "earning" and c.source == "structure"),
        None,
    )
    if basic is None or Decimal(basic) <= 0:
        return
    monthly_basic = Decimal(basic)
    # WRA s.25 (MU): 195. NULL on the rule (every existing MU row) falls
    # back to 195 — preserves current output. A future country's own
    # notional-rate formula sets overtime_rule.notional_hourly_divisor
    # explicitly on its own row.
    divisor = overtime_rule.notional_hourly_divisor or Decimal("195")
    hourly_rate = (monthly_basic / divisor).quantize(Decimal("0.0001"))

    buckets, flags, *_ = _load_and_bucket_overtime(
        db, employee, job, period_start, period_end, country_code, overtime_rule,
        company_timezone, require_approved_clockins,
        eligibility="MONTHLY_ELIGIBLE", monthly_basic=monthly_basic,
        assume_ot_confirmed=assume_ot_confirmed,
    )
    if flags_out is not None:
        flags_out.extend(flags)

    # Keep only overtime buckets — REG hours are already covered by the salary.
    ot_buckets = [b for b in buckets if not b.counts_in_basic_gross]
    if not ot_buckets:
        return

    total_hours = sum((b.hours for b in ot_buckets), Decimal("0"))
    total_amount = sum((b.amount(hourly_rate) for b in ot_buckets), Decimal("0")).quantize(Decimal("0.01"))

    if mode == "warn":
        # Surface the owed OT without touching pay — the employer reviews and
        # pays via the manual "Additional duty" allowance (s.24(5) gate).
        if flags_out is not None:
            flags_out.append(f"salaried_ot_review:{total_hours}:{total_amount}")
        return

    # mode == 'auto' (deferred) — pay it: OT components on top of the salary.
    for b in ot_buckets:
        resolved.components.append(ResolvedComponent(
            component_id=0,
            code=b.code,
            label=_bucket_label(b.code),
            kind="earning",
            category="earning.overtime",
            amount=b.amount(hourly_rate),
            is_taxable=True,
            is_basic=False,
            source="overtime",
            statutory_base_codes=["PAYE", "CSG_EE", "CSG_ER"],  # OT excluded from NSF base
            meta={
                "multiplier": str(b.multiplier),
                "hours": str(b.hours),
                "source_timelog_ids": list(b.source_timelog_ids),
                "pay_basis": "monthly",
                "hourly_rate_s25": str(hourly_rate),
                "notes": b.notes,
            },
        ))


def _apply_pay_basis(
    db: Session,
    employee: PrivateUser,
    period_start: date,
    period_end: date,
    country_code: str,
    resolved: ResolvedSalary,
    require_approved_clockins: bool = False,
    *,
    overtime_rule: Optional[CountryOvertimeRuleRead] = None,
    company_timezone: str = "Indian/Mauritius",
    flags_out: Optional[List[str]] = None,
    assume_ot_confirmed: bool = False,
) -> None:
    """M20: scale or replace the resolved structure components according to the
    employee's pay basis, FTE, and joiner/leaver dates.

    Mutates `resolved.components` in place. Runs *before* one-offs and bonus
    are appended so those sit on top of the post-proration base.

    Branches:
        hourly  → BASIC := sum(time_logs.hours_worked) × hourly_rate.
                  Allowances/recurring are wiped (hourly employees rarely
                  have recurring monthly allowances; one-offs still apply).
        daily   → BASIC := working_days_in_period × daily_rate. Same allowance
                  handling as hourly.
        monthly → multiply structure earnings by FTE × proration factor.
                  proration_factor handles joiner/leaver via Job.first_date_of_employment
                  and Job.end_date.
    """
    job, salary = _active_job_with_salary(db, employee.private_user_id)
    pay_basis = (salary.pay_basis if salary and salary.pay_basis else "monthly").lower()
    work_days_mask = job.work_days if job else None

    # value_type='percent_of_basic' components were resolved (in
    # resolve_components) against the structure's BASIC line — but hourly/
    # daily pay bases replace BASIC below with hours×rate / days×rate, which
    # can differ substantially from the structure figure. Rather than risk a
    # silently-wrong percentage, flag it for manual review — same "don't
    # guess, surface it" pattern as salaried_absence/hourly_zero_pay above.
    if pay_basis in ("hourly", "daily") and flags_out is not None:
        percent_codes = [
            c.code for c in resolved.components
            if c.value_type == "percent_of_basic" and not c.is_basic
        ]
        for code in percent_codes:
            flags_out.append(f"percent_of_basic_with_{pay_basis}_pay_basis:{code}")

    if pay_basis == "hourly":
        if salary is None or salary.hourly_rate is None:
            logger.warning(
                "payroll_engine: private_user_id=%s pay_basis=hourly but no hourly_rate; treating as zero",
                employee.private_user_id,
            )
            if flags_out is not None:
                flags_out.append("hourly_zero_pay:no_hourly_rate")
            _replace_or_add_basic(resolved, Decimal("0"), "Hourly wages", "hourly")
            return
        # Drop structure-sourced non-basic earnings — those don't apply to
        # hourly employees by default. One-offs (signing bonus, etc.) are
        # appended *after* this in _resolve_full so they remain.
        resolved.components = [
            c for c in resolved.components
            if not (c.kind == "earning" and not c.is_basic and c.source == "structure")
        ]

        # Bucketed overtime engine. Each bucket (REG, OT_*, NIGHT_PREMIUM)
        # becomes its own earning component with the multiplier baked into
        # the amount. REG buckets carry is_basic=True so they feed
        # gross_basic (NSF / leave-deduction base); OT buckets feed gross_total only.
        if overtime_rule is not None:
            # Remove any existing basic placeholder; buckets replace it.
            resolved.components = [
                c for c in resolved.components
                if not (c.is_basic and c.kind == "earning" and c.source in ("structure", "hourly"))
            ]
            bucket_components = _bucket_hourly_overtime(
                db, employee, job, salary, period_start, period_end, country_code,
                overtime_rule, company_timezone, require_approved_clockins,
                flags_out=flags_out, assume_ot_confirmed=assume_ot_confirmed,
            )
            resolved.components.extend(bucket_components)
            return

        # Fallback: no overtime rule configured for this country/period yet
        # (e.g. a not-yet-onboarded country) — plain hours × rate, no bucketing.
        # This must not hard-fail the way create_draft_run's real-run gate does.
        hours = proration.sum_hours_worked_in_period(
            db,
            private_user_id=employee.private_user_id,
            period_start=period_start,
            period_end=period_end,
            require_approved=require_approved_clockins,
            company_timezone=company_timezone,
        )
        amount = (Decimal(hours) * Decimal(salary.hourly_rate)).quantize(Decimal("0.01"))
        _replace_or_add_basic(resolved, amount, "Hourly wages", "hourly", meta={
            "pay_basis": "hourly",
            "hours": str(hours),
            "rate": str(salary.hourly_rate),
        })
        return

    if pay_basis == "daily":
        if salary is None or salary.daily_rate is None:
            logger.warning(
                "payroll_engine: private_user_id=%s pay_basis=daily but no daily_rate; treating as zero",
                employee.private_user_id,
            )
            _replace_or_add_basic(resolved, Decimal("0"), "Daily wages", "daily")
            return
        emp_start = job.first_date_of_employment.date() if (job and job.first_date_of_employment) else None
        emp_end = job.end_date if job else None
        eff_start = max(emp_start, period_start) if emp_start else period_start
        eff_end = min(emp_end, period_end) if emp_end else period_end
        days = proration.working_days_in_period(
            db, country_code, eff_start, eff_end, work_days_mask
        )
        amount = (Decimal(days) * Decimal(salary.daily_rate)).quantize(Decimal("0.01"))
        # Monthly-frequency structure earnings don't mean anything without a
        # "month" concept for a daily-rate worker — drop them. Daily-frequency
        # ones (e.g. a per-day transport allowance) DO apply here — scale by
        # the same working-day count as BASIC above rather than dropping them.
        kept: list[ResolvedComponent] = []
        for c in resolved.components:
            if c.kind == "earning" and not c.is_basic and c.source == "structure":
                if c.frequency != "daily":
                    continue
                per_day = c.amount
                c.amount = (Decimal(days) * per_day).quantize(Decimal("0.01"))
                c.meta = {"frequency": "daily", "days": days, "rate": str(per_day)}
            kept.append(c)
        resolved.components = kept
        _replace_or_add_basic(resolved, amount, "Daily wages", "daily", meta={
            "pay_basis": "daily",
            "days": days,
            "rate": str(salary.daily_rate),
        })
        return

    # pay_basis == 'monthly' — apply FTE × joiner/leaver proration to all
    # structure-sourced earning components. Allowances pro-rate alongside
    # basic pay (the typical Mauritius rule for partial-month employment).

    # WRA s.24/s.25 salaried overtime — runs BEFORE proration so full-month
    # MONTHLY_ELIGIBLE workers are covered (the multiplier==1 early-return below
    # would otherwise skip it). Default 'warn' mode only emits a review flag;
    # it never changes pay, so the proration that follows is unaffected.
    if overtime_rule is not None:
        _apply_salaried_overtime(
            db, employee, job, period_start, period_end, country_code, resolved,
            overtime_rule, company_timezone, require_approved_clockins,
            flags_out=flags_out, assume_ot_confirmed=assume_ot_confirmed,
        )

    fte = Decimal(employee.fte or 1)
    emp_start = job.first_date_of_employment.date() if (job and job.first_date_of_employment) else None
    emp_end = job.end_date if job else None

    # Daily-frequency components (e.g. a per-day transport allowance) price
    # per day EVERY period, not just at month boundaries — so they're scaled
    # here unconditionally, bounded to the employee's actual employed window
    # within the period (same bounding pay_basis='daily' BASIC uses above).
    # That bounding already reflects a mid-month joiner/leaver, so these are
    # excluded from the FTE/proration-factor loop below to avoid scaling twice.
    daily_component_ids: set[int] = set()
    eff_start = max(emp_start, period_start) if emp_start else period_start
    eff_end = min(emp_end, period_end) if emp_end else period_end
    for c in resolved.components:
        if c.kind == "earning" and c.source == "structure" and c.frequency == "daily":
            days = proration.working_days_in_period(db, country_code, eff_start, eff_end, work_days_mask)
            per_day = c.amount
            c.amount = (Decimal(days) * per_day).quantize(Decimal("0.01"))
            c.meta = {"frequency": "daily", "days": days, "rate": str(per_day)}
            daily_component_ids.add(c.component_id)

    factor = proration.compute_proration_factor(
        db,
        employee_start=emp_start,
        employee_end=emp_end,
        period_start=period_start,
        period_end=period_end,
        country_code=country_code,
        work_days_mask=work_days_mask,
    )
    multiplier = (fte * factor).quantize(Decimal("0.00000001"))
    if multiplier == Decimal("1.00000000"):
        return  # No-op for the common full-time, full-month case.

    for c in resolved.components:
        if c.component_id in daily_component_ids:
            continue
        # prorate_on_partial_month=False components (e.g. a fixed relocation
        # allowance that shouldn't shrink for a mid-month joiner) keep their
        # full amount — previously this flag was captured but never read.
        if c.kind == "earning" and c.source == "structure" and c.prorate_on_partial_month:
            full = c.amount
            c.amount = (c.amount * multiplier).quantize(Decimal("0.01"))
            if c.is_basic:
                # Surface the joiner/leaver/part-time proration on the base line.
                c.meta = {
                    "pay_basis": "monthly",
                    "fte": str(fte),
                    "proration_factor": str(factor),
                    "full_amount": str(full),
                }


def _resolve_full(
    db: Session,
    employee: PrivateUser,
    period_start: date,
    period_end: date,
    country_code: str,
    require_approved_clockins: bool = False,
    *,
    overtime_rule: Optional[CountryOvertimeRuleRead] = None,
    company_timezone: str = "Indian/Mauritius",
    flags_out: Optional[List[str]] = None,
) -> ResolvedSalary:
    """Single source of truth for resolving an employee's payslip components.

    Both create_draft_run and finalize_run call this so the consistency
    check in finalize sees identical numbers. Order matters:
      1. Structure components (resolver)
      2. M20 — pay basis branching (scales structure / replaces BASIC)
      3. One-off allowances scheduled for the period (full amount)
      4. EOY-style bonus (sees gross of #1+#2+#3 in current period)

    ``require_approved_clockins`` is plumbed in from
    Company.require_approved_clockins_for_payroll. When true, the hourly
    pay-basis branch only sums admin_approved=true time_logs.
    """
    resolved = salary_resolver.resolve_components(db, employee.private_user_id, period_start, period_end)

    _apply_pay_basis(
        db, employee, period_start, period_end, country_code, resolved,
        require_approved_clockins=require_approved_clockins,
        overtime_rule=overtime_rule,
        company_timezone=company_timezone,
        flags_out=flags_out,
    )

    one_offs = one_off_allowances_service.list_pending_for_period(
        db, employee.private_user_id, period_start.year, period_start.month
    )
    if one_offs:
        resolved.components.extend(
            one_off_allowances_service.to_resolved_components(one_offs)
        )

    # Bonus uses pre-bonus current-period gross to apply 'twelfth_of_annual'.
    pre_bonus_gross = sum(
        (c.amount for c in resolved.components if c.kind == "earning"),
        Decimal("0.00"),
    )
    bonus_amount = bonus_engine.compute_eoy_for_employee(
        db, employee, period_start, current_period_gross=pre_bonus_gross
    )
    bonus_component = bonus_engine.synthesize_bonus_component(
        db, employee, period_start, bonus_amount
    )
    if bonus_component is not None:
        resolved.components.append(bonus_component)

    return resolved


def _eligible_employees(
    db: Session, company_id: int, period_start: date, explicit_ids: Optional[List[int]] = None
) -> List[PrivateUser]:
    """Employees who get a payslip in this run."""
    q = db.query(PrivateUser).filter(PrivateUser.company_id == company_id)
    if explicit_ids:
        q = q.filter(PrivateUser.private_user_id.in_(explicit_ids))
    employees = q.all()
    # Eligible = anyone with ANY pay setup for this period: a structured salary
    # ASSIGNMENT *or* a profile Salary (a `salaries` row on their Job). The latter
    # is how hourly/daily staff are configured — clock-ins × the profile rate, read
    # by _apply_pay_basis. Gating on the assignment alone silently dropped
    # profile-salary employees (approved hours → Rs 0 with no payslip); including
    # them lets hourly/daily pay actually compute.
    eligible: List[PrivateUser] = []
    for e in employees:
        job, salary = _active_job_with_salary(db, e.private_user_id)
        # Skip employees who left BEFORE this period starts. A terminated worker
        # must not reappear in (or accrue an EOY bonus on) a later month's run —
        # their final pay and pro-rated gratuity belong to the termination
        # settlement, paid in their last employed month, not months later.
        end = getattr(job, "end_date", None) if job else None
        if end is not None and end < period_start:
            continue
        if (
            salary_resolver.get_active_assignment(db, e.private_user_id, period_start) is not None
            or salary is not None
        ):
            eligible.append(e)
    return eligible


def _pending_period_signals(db: Session, company_id: int, period_start: date, period_end: date) -> List[str]:
    """Trust signals for a draft run: work that WON'T be in this run unless the
    employer acts before finalizing. Surfacing these prevents closing a period
    with un-reviewed clock-ins, and is what stops a task verified too late from
    missing its month (the month-boundary edge)."""
    from core.model import Schedule, ScheduleAssigneeStatus

    flags: List[str] = []
    tl_start = datetime.combine(period_start, time.min, tzinfo=timezone.utc)
    tl_end = datetime.combine(period_end, time.max, tzinfo=timezone.utc)
    pending_clockins = (
        db.query(TimeLog)
        .join(Job, Job.job_id == TimeLog.job_id)
        .filter(Job.company_id == company_id)
        .filter(TimeLog.start_time >= tl_start, TimeLog.start_time <= tl_end)
        .filter(TimeLog.admin_approved.is_(False), TimeLog.admin_rejected.is_(False))
        .count()
    )
    if pending_clockins:
        flags.append(f"pending_clockins:{pending_clockins}")

    # Completed paid-task assignees not yet verified → their pay isn't booked.
    s_start = datetime.combine(period_start, time.min)
    s_end = datetime.combine(period_end, time.max)
    unverified_task_pay = (
        db.query(ScheduleAssigneeStatus)
        .join(Schedule, Schedule.schedule_id == ScheduleAssigneeStatus.schedule_id)
        .filter(Schedule.company_id == company_id)
        .filter(Schedule.start_time >= s_start, Schedule.start_time <= s_end)
        .filter(Schedule.additional_remuneration_amount.isnot(None))
        .filter(Schedule.additional_remuneration_amount > 0)
        .filter(ScheduleAssigneeStatus.status == "completed")
        .filter(ScheduleAssigneeStatus.remuneration_one_off_id.is_(None))
        .count()
    )
    if unverified_task_pay:
        flags.append(f"unverified_task_pay:{unverified_task_pay}")

    return flags


def _worked_but_unpaid_flags(
    db: Session, company_id: int, period_start: date, period_end: date, paid_ids: set
) -> List[str]:
    """Flag employees who have APPROVED clock-ins in the period but got NO payslip.

    They were excluded for lack of an active salary assignment (``_eligible_employees``)
    or resolved to nothing with no hourly diagnostic. Without this the run is
    silently empty ("approved hours but Rs 0") with no reason — the single most
    confusing payroll failure. Almost always a missing salary/rate setup.
    """
    tl_start = datetime.combine(period_start, time.min, tzinfo=timezone.utc)
    tl_end = datetime.combine(period_end, time.max, tzinfo=timezone.utc)
    worked = {
        r[0]
        for r in db.query(Job.private_user_id)
        .join(TimeLog, TimeLog.job_id == Job.job_id)
        .filter(Job.company_id == company_id)
        .filter(Job.private_user_id.isnot(None))
        .filter(TimeLog.start_time >= tl_start, TimeLog.start_time <= tl_end)
        .filter(TimeLog.admin_approved.is_(True))
        .distinct()
        .all()
    }
    return [f"u{pid}:worked_but_unpaid_no_salary" for pid in (worked - paid_ids)]


def _no_schedule_flags(
    db: Session, company_id: int, period_start: date, period_end: date,
    paid_ids: set, require_approved: bool,
) -> List[str]:
    """When clock-driven (hours drive pay), flag any PAID employee with approved
    clock-ins on a job that has NO ``work_end_time``. Their auto-closed hours are
    capped at the day-boundary / max-shift (not a precise scheduled end), and
    overtime can't be measured against a threshold — so the hours feeding pay may
    be imprecise. The admin should verify them or set a schedule. Skipped entirely
    when not clock-driven (hours don't drive pay there)."""
    if not require_approved or not paid_ids:
        return []
    tl_start = datetime.combine(period_start, time.min, tzinfo=timezone.utc)
    tl_end = datetime.combine(period_end, time.max, tzinfo=timezone.utc)
    rows = (
        db.query(Job.private_user_id)
        .join(TimeLog, TimeLog.job_id == Job.job_id)
        .filter(Job.company_id == company_id)
        .filter(Job.private_user_id.in_(paid_ids))
        .filter(Job.work_end_time.is_(None))
        .filter(TimeLog.start_time >= tl_start, TimeLog.start_time <= tl_end)
        .filter(TimeLog.admin_approved.is_(True))
        .distinct()
        .all()
    )
    return [f"u{r[0]}:no_schedule_hours_imprecise" for r in rows]


def _shadow_host_map(
    db: Session,
    employees: list,
    company_country: str,
    run_currency: str,
    as_of: date,
) -> tuple[Dict[int, Optional[str]], Optional[dict]]:
    """Map each eligible employee -> their effective shadow host country code
    (or None when it equals the employer country), and build the run's BOM FX
    snapshot covering the distinct host currencies. FX is fetched on the
    business day of ``as_of``; the snapshot is frozen on the run."""
    host_by_emp: Dict[int, Optional[str]] = {}
    host_currencies: Dict[str, str] = {}

    from core.model import Country

    company_ccy = company_country.upper()
    for emp in employees:
        try:
            host = country_assignment.resolve_effective_country(db, emp, as_of=as_of)
        except Exception:  # noqa: BLE001
            host = None
        if not host or host.upper() == company_ccy:
            host_by_emp[emp.private_user_id] = None
            continue
        host = host.upper()
        host_by_emp[emp.private_user_id] = host
        if host not in host_currencies:
            c = db.query(Country).filter(Country.code == host).one_or_none()
            host_currencies[host] = (c.currency if c and c.currency else None) or "XXX"

    if not host_currencies:
        return host_by_emp, None
    snapshot = fx_service.build_run_fx_snapshot(run_currency, host_currencies, as_of=as_of)
    return host_by_emp, snapshot or None


def _shadow_rate(fx_snapshot: Optional[dict], host_country: Optional[str]) -> Optional[Decimal]:
    """Per-employee base-per-host FX rate from the run snapshot (None when no
    shadow or no public rate)."""
    if host_country is None or not fx_snapshot:
        return None
    return fx_service.rate_for(fx_snapshot, host_country)


def create_draft_run(
    db: Session,
    payload: PayrollRunCreate,
    actor_user_id: Optional[int],
) -> PayrollRun:
    """Create a draft run + one payslip per eligible employee.

    Caller is responsible for db.commit().
    """
    company = db.query(Company).filter(Company.company_id == payload.company_id).one_or_none()
    if company is None:
        raise HTTPException(status_code=404, detail=f"Company {payload.company_id} not found")
    if payload.period_end < payload.period_start:
        raise HTTPException(status_code=400, detail="period_end must be on or after period_start")

    # Reject if a non-cancelled run already exists for this period.
    existing = (
        db.query(PayrollRun)
        .filter(
            PayrollRun.company_id == payload.company_id,
            PayrollRun.period_start == payload.period_start,
            PayrollRun.period_end == payload.period_end,
            PayrollRun.status != "cancelled",
        )
        .first()
    )
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Payroll run for this period already exists (id={existing.id}, status={existing.status})",
        )

    # M24 — period-close discipline. A draft for May can't start while
    # April's run is still open (draft/review). Fully unfinalized periods
    # would otherwise sit in a half-state and confuse the bonus + leave
    # accruals downstream.
    payroll_calendar.assert_prior_period_closed(
        db,
        company_id=payload.company_id,
        period_start=payload.period_start,
        country_code=company.country_code,
    )

    # M2 — fail-safe gate. A real payroll run requires an overtime rule to
    # exist for the country. This forces admins to seed before any payroll
    # can run, preventing silent wage-theft in unseeded countries.
    # resolve_overtime_rule raises MissingOvertimeRule, which the API layer
    # translates to HTTP 422 NO_OVERTIME_RULE_FOR_COUNTRY.
    overtime_rule = payroll_rules.resolve_overtime_rule(db, company.country_code, payload.period_start)

    snapshot = payroll_rules.resolve(db, company.country_code, payload.period_start)

    # A4: derive run currency from the company's country (fallback MUR).
    from core.model import Country
    country = db.query(Country).filter(Country.code == company.country_code).one_or_none()
    run_currency = country.currency if country and country.currency else "MUR"

    company_tz = getattr(company, "timezone", None) or "Indian/Mauritius"

    run = PayrollRun(
        company_id=payload.company_id,
        period_start=payload.period_start,
        period_end=payload.period_end,
        status="draft",
        currency=run_currency,
        notes=payload.notes,
        created_by_user_id=actor_user_id,
        compute_version=2,  # M4 — bucketed overtime engine
    )
    db.add(run)
    db.flush()

    employees = _eligible_employees(
        db, payload.company_id, payload.period_start, payload.private_user_ids
    )

    # Shadow payroll (Phase 2): resolve each eligible employee's effective
    # host country, snapshot FX once per run (BOM), and freeze it on the run
    # so a finalized run's host figures are auditable and never re-derive from
    # a later market rate.
    shadow_host, fx_snapshot = _shadow_host_map(
        db, employees, company.country_code, run_currency, payload.period_start
    )
    if fx_snapshot:
        run.fx_snapshot = fx_snapshot
        run.fx_source = fx_snapshot.get("source")
        run.fx_as_of = payload.period_start

    require_approved = bool(getattr(company, "require_approved_clockins_for_payroll", False))
    run_flags: List[str] = []
    paid_ids: set = set()
    skipped_for_data_error: List[dict] = []
    for emp in employees:
        emp_flags: List[str] = []
        # SAVEPOINT, not a bare try — this loop shares ONE session/transaction
        # across all employees (run + every prior payslip are still pending,
        # uncommitted, in `db`). A plain db.rollback() on exception would
        # discard the WHOLE transaction, including the run and every employee
        # already processed successfully. begin_nested() (a real SQL
        # SAVEPOINT) scopes the automatic rollback-on-exception to just this
        # employee's partial writes, leaving everything else in the session
        # intact — do NOT call db.rollback() inside the except below, the
        # context manager already handles it.
        try:
            with db.begin_nested():
                resolved = _resolve_full(
                    db, emp, payload.period_start, payload.period_end, company.country_code,
                    require_approved_clockins=require_approved,
                    overtime_rule=overtime_rule,
                    company_timezone=company_tz,
                    flags_out=emp_flags,
                )

                # When an hourly employee's clock-ins all dropped out (unapproved /
                # open / pending OT / no rate), _apply_pay_basis leaves no components
                # but records a `hourly_zero_pay:*` reason. Don't silently skip those —
                # emit a zero payslip so the person stays visible in the run with the
                # reason attached (via run.compliance_flags, prefixed below). Only
                # genuinely empty cases with no diagnostic are skipped.
                has_zero_pay_reason = any(f.startswith("hourly_zero_pay:") for f in emp_flags)
                if not resolved.components and not has_zero_pay_reason:
                    logger.info(f"payroll_engine: skip private_user_id={emp.private_user_id} (no resolved components)")
                    continue

                leave_summary = _compute_leave_summary(
                    db, emp.private_user_id, payload.period_start, payload.period_end,
                    country_code=company.country_code, flags_out=emp_flags,
                )
                loan_repayments = _compute_loan_repayments_for_period(
                    db, emp.private_user_id, payload.period_start, payload.period_end,
                )
                # M4 — unpaid-leave deduction uses gross_basic (REG only), per MU WRA
                # s.30 "ordinary daily wage". OT premiums don't inflate the deduction.
                earnings_gross_basic = sum(
                    (c.amount for c in resolved.components if c.kind == "earning" and c.is_basic),
                    Decimal("0.00"),
                )
                leave_impact = _compute_leave_impact_for_period(
                    db, company.country_code, emp, leave_summary, earnings_gross_basic,
                    payload.period_start, payload.period_end,
                )
                absence_deduction = _compute_salaried_absence_for_period(
                    db, company.country_code, emp, earnings_gross_basic,
                    payload.period_start, payload.period_end,
                    company_tz, require_approved, flags_out=emp_flags,
                    as_of=getattr(payload, "as_of", None),
                )

                computed = compute_for_resolved(
                    resolved, snapshot,
                    db=db, private_user_id=emp.private_user_id,
                    period_start=payload.period_start, country_code=company.country_code,
                    loan_repayments=loan_repayments,
                    leave_impact=leave_impact,
                    absence_deduction=absence_deduction,
                    sdl_applicable=bool(company.sdl_applicable),
                    flags_out=emp_flags,
                    shadow_country_code=shadow_host.get(emp.private_user_id),
                    fx_rate=_shadow_rate(fx_snapshot, shadow_host.get(emp.private_user_id)),
                )
                # Prefix each employee's flags with their id for the run-level list.
                run_flags.extend(f"u{emp.private_user_id}:{f}" for f in emp_flags)

                # Pick the active job (if any) to attach to the payslip.
                active_job = (
                    db.query(Job)
                    .filter(Job.private_user_id == emp.private_user_id)
                    .order_by(Job.created_at.desc())
                    .first()
                )

                payslip = Payslip(
                    payroll_run_id=run.id,
                    private_user_id=emp.private_user_id,
                    job_id=active_job.job_id if active_job else None,
                    home_geofence_id=emp.home_geofence_id,
                    leave_summary=leave_summary,
                    **computed,
                )
                db.add(payslip)
                paid_ids.add(emp.private_user_id)
        except Exception as exc:
            # A data problem with ONE employee (most plausibly overlapping
            # clock-in records reaching overtime_engine._assert_no_overlaps —
            # the write-time gate should catch new ones now, but existing bad
            # rows can still be here) must not abort payroll for everyone
            # else in the company. The savepoint above already rolled back
            # just this employee's partial writes; flag them and keep going —
            # see notify_payroll_run_employees_skipped for how this gets
            # surfaced to admins.
            name = f"{emp.first_name} {emp.last_name}".strip() or f"user {emp.private_user_id}"
            logger.error(
                f"payroll_engine: skipping private_user_id={emp.private_user_id} "
                f"({name}) due to a data error — {exc}", exc_info=True,
            )
            run_flags.append(f"u{emp.private_user_id}:data_error:{str(exc)[:200]}")
            skipped_for_data_error.append({
                "private_user_id": emp.private_user_id,
                "name": name,
                "reason": str(exc)[:200],
            })
            continue

    run_flags.extend(_pending_period_signals(db, company.company_id, payload.period_start, payload.period_end))
    # Surface anyone with approved hours this period who got no payslip (excluded
    # for no salary assignment) — otherwise the run is silently Rs 0 with no reason.
    run_flags.extend(_worked_but_unpaid_flags(db, company.company_id, payload.period_start, payload.period_end, paid_ids))
    run_flags.extend(_no_schedule_flags(db, company.company_id, payload.period_start, payload.period_end, paid_ids, require_approved))
    run.compliance_flags = run_flags
    db.flush()

    if skipped_for_data_error:
        from services.notification_service import NotificationService
        NotificationService.notify_payroll_run_employees_skipped(
            db, company.company_id, run.id, skipped_for_data_error,
        )

    return run


def recompute_employee_for_run(db: Session, run: PayrollRun, private_user_id: int) -> Optional[dict]:
    """Recompute ONE employee's payslip VALUES for a run's period using current
    data (after the employer fixed whatever was wrong). Returns the same dict
    compute_for_resolved produces, plus ``leave_summary`` — or None if the
    employee resolves to nothing.

    Pure-ish: does NOT create a Payslip, does NOT book loans/statutory. The
    caller decides what to do with the values (the correction endpoint deltas
    them against the original payslip and stores an adjustment record).
    """
    company = db.query(Company).filter(Company.company_id == run.company_id).one()
    overtime_rule = payroll_rules.resolve_overtime_rule(db, company.country_code, run.period_start)
    snapshot = payroll_rules.resolve(db, company.country_code, run.period_start)
    company_tz = getattr(company, "timezone", None) or "Indian/Mauritius"
    require_approved = bool(getattr(company, "require_approved_clockins_for_payroll", False))

    emp = db.query(PrivateUser).filter(PrivateUser.private_user_id == private_user_id).one_or_none()
    if emp is None:
        return None

    shadow_host = _recompute_shadow_host(db, run, private_user_id)

    emp_flags: List[str] = []
    resolved = _resolve_full(
        db, emp, run.period_start, run.period_end, company.country_code,
        require_approved_clockins=require_approved,
        overtime_rule=overtime_rule, company_timezone=company_tz, flags_out=emp_flags,
    )
    if not resolved.components and not any(f.startswith("hourly_zero_pay:") for f in emp_flags):
        return None

    leave_summary = _compute_leave_summary(
        db, emp.private_user_id, run.period_start, run.period_end,
        country_code=company.country_code, flags_out=emp_flags,
    )
    loan_repayments = _compute_loan_repayments_for_period(
        db, emp.private_user_id, run.period_start, run.period_end,
    )
    earnings_gross_basic = sum(
        (c.amount for c in resolved.components if c.kind == "earning" and c.is_basic),
        Decimal("0.00"),
    )
    leave_impact = _compute_leave_impact_for_period(
        db, company.country_code, emp, leave_summary, earnings_gross_basic,
        run.period_start, run.period_end,
    )
    absence_deduction = _compute_salaried_absence_for_period(
        db, company.country_code, emp, earnings_gross_basic,
        run.period_start, run.period_end, company_tz, require_approved, flags_out=emp_flags,
    )
    computed = compute_for_resolved(
        resolved, snapshot,
        db=db, private_user_id=emp.private_user_id,
        period_start=run.period_start, country_code=company.country_code,
        loan_repayments=loan_repayments, leave_impact=leave_impact,
        absence_deduction=absence_deduction, sdl_applicable=bool(company.sdl_applicable),
        flags_out=emp_flags,
        shadow_country_code=shadow_host,
        fx_rate=_shadow_rate(run.fx_snapshot, shadow_host),
    )
    computed["leave_summary"] = leave_summary
    return computed


def _recompute_shadow_host(db: Session, run: PayrollRun, private_user_id: int) -> Optional[str]:
    """Effective shadow host for an employee, or None when it equals the
    employer country. Uses the run's frozen FX snapshot for the rate."""
    emp = db.query(PrivateUser).filter(PrivateUser.private_user_id == private_user_id).one_or_none()
    if emp is None:
        return None
    company = db.query(Company).filter(Company.company_id == run.company_id).one()
    host = country_assignment.resolve_effective_country(db, emp, as_of=run.period_start)
    if host and host.upper() == company.country_code.upper():
        return None
    return host.upper() if host else None


def _count_open_disputes_in_period(
    db: Session, company_id: int, period_start: date, period_end: date,
) -> int:
    """Count pending time-log disputes whose clock-in falls in the period.

    period_start/period_end are dates; we bound TimeLog.start_time (TIMESTAMPTZ)
    with inclusive UTC datetimes — the same pattern as the rest of this file.
    A naive `< period_end` (midnight at the *start* of the last day) silently
    excluded disputes filed on the final day of the period, which let finalize
    freeze a payslip the dispute might still change.
    """
    from core.model import TimeLog, TimeLogDispute, Job as _Job
    return (
        db.query(TimeLogDispute)
        .join(TimeLog, TimeLog.timelog_id == TimeLogDispute.time_log_id)
        .join(_Job, _Job.job_id == TimeLog.job_id)
        .filter(_Job.company_id == company_id)
        .filter(TimeLog.start_time >= datetime.combine(period_start, time.min, tzinfo=timezone.utc))
        .filter(TimeLog.start_time <= datetime.combine(period_end, time.max, tzinfo=timezone.utc))
        .filter(TimeLogDispute.resolution == "pending")
        .count()
    )


def finalize_run(
    db: Session,
    run_id: int,
    actor_user_id: Optional[int],
) -> PayrollRun:
    """Move a draft run to 'finalized'. Stores rules snapshot.

    Re-resolves and re-computes every payslip, then asserts the numbers
    match the draft (sanity check: did rules change between draft and
    finalize? if so, refuse and let the user re-create the draft).

    Caller commits.
    """
    run = db.query(PayrollRun).filter(PayrollRun.id == run_id).one_or_none()
    if run is None:
        raise HTTPException(status_code=404, detail=f"PayrollRun {run_id} not found")
    if run.status == "finalized":
        return run  # idempotent
    if run.status != "draft":
        raise HTTPException(status_code=409, detail=f"Cannot finalize run in status {run.status}")

    company = db.query(Company).filter(Company.company_id == run.company_id).one()
    snapshot = payroll_rules.resolve(db, company.country_code, run.period_start)

    # Cumulative PAYE gate: finalizing periods out of order within a fiscal
    # year would let a later period's YTD baseline shift depending on whether
    # an earlier period happened to finalize first, tripping the net_pay
    # consistency check below for reasons that have nothing to do with rules
    # changing. Require chronological finalize order within each fiscal year.
    fy_start_gate = _resolve_fiscal_year_start(db, company.country_code, run.period_start)
    earlier_open = (
        db.query(PayrollRun)
        .filter(
            PayrollRun.company_id == run.company_id,
            PayrollRun.status == "draft",
            PayrollRun.period_start < run.period_start,
            PayrollRun.period_start >= fy_start_gate,
        )
        .first()
    )
    if earlier_open is not None:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot finalize {run.period_start}: an earlier period "
                f"({earlier_open.period_start}) in this fiscal year is still in "
                "draft. Finalize periods in chronological order so cumulative "
                "PAYE stays consistent."
            ),
        )

    # M3 finalize gate: refuse if any time_log in the period is under an
    # unresolved dispute. Disputes block finalize because the underlying
    # rejection might be reversed, which would change net_pay.
    open_disputes = _count_open_disputes_in_period(
        db, run.company_id, run.period_start, run.period_end,
    )
    if open_disputes > 0:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot finalize: {open_disputes} unresolved time-log dispute(s) "
                "in this period. Resolve them first."
            ),
        )

    require_approved = bool(getattr(company, "require_approved_clockins_for_payroll", False))
    company_tz = getattr(company, "timezone", None) or "Indian/Mauritius"

    # Re-resolve through the bucketed overtime engine so the numbers match
    # the draft — the overtime rule comes from the freshly-resolved snapshot
    # (same rule that was in force for the draft).
    finalize_overtime_rule = snapshot.overtime

    # Re-compute and verify each existing payslip matches. The same
    # _resolve_full path runs here so the consistency check passes.
    payslips = db.query(Payslip).filter(Payslip.payroll_run_id == run.id).all()
    for ps in payslips:
        emp = db.query(PrivateUser).filter(PrivateUser.private_user_id == ps.private_user_id).one()
        resolved = _resolve_full(
            db, emp, run.period_start, run.period_end, company.country_code,
            require_approved_clockins=require_approved,
            overtime_rule=finalize_overtime_rule,
            company_timezone=company_tz,
        )
        one_offs = one_off_allowances_service.list_pending_for_period(
            db, ps.private_user_id, run.period_start.year, run.period_start.month
        )
        # Re-derive loan + leave impact from current state so the recompute
        # mirrors the draft path. If Loan/Leave state changed since the draft
        # was created, net_pay will differ and the check below will trigger
        # an admin re-draft, which is the correct behavior.
        loan_repayments = _compute_loan_repayments_for_period(
            db, ps.private_user_id, run.period_start, run.period_end,
        )
        # gross_basic (REG only) — OT premiums don't inflate the leave/absence base.
        earnings_gross = sum(
            (c.amount for c in resolved.components if c.kind == "earning" and c.is_basic),
            Decimal("0.00"),
        )
        leave_impact = _compute_leave_impact_for_period(
            db, company.country_code, emp, ps.leave_summary or [], earnings_gross,
            run.period_start, run.period_end,
        )
        absence_deduction = _compute_salaried_absence_for_period(
            db, company.country_code, emp, earnings_gross,
            run.period_start, run.period_end,
            company_tz, require_approved,
        )
        recomputed = compute_for_resolved(
            resolved, snapshot,
            db=db, private_user_id=ps.private_user_id,
            period_start=run.period_start, country_code=company.country_code,
            loan_repayments=loan_repayments,
            leave_impact=leave_impact,
            absence_deduction=absence_deduction,
            sdl_applicable=bool(company.sdl_applicable),
            shadow_country_code=ps.shadow_country_code,
            fx_rate=_shadow_rate(run.fx_snapshot, ps.shadow_country_code),
        )
        if recomputed["net_pay"] != ps.net_pay:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Rules changed since draft: payslip {ps.id} net_pay would be "
                    f"{recomputed['net_pay']} (was {ps.net_pay}). "
                    "Cancel and re-create the draft."
                ),
            )
        # Refresh JSONB columns + components in case the snapshot pinning
        # surfaces small differences (e.g. statutory rounding).
        ps.statutory_employee = recomputed["statutory_employee"]
        ps.statutory_employer = recomputed["statutory_employer"]
        ps.components = recomputed["components"]
        # Shadow figures re-derive deterministically from the run's frozen FX
        # snapshot + current host rules; refresh them the same way.
        ps.shadow_country_code = recomputed.get("shadow_country_code")
        ps.shadow_currency = recomputed.get("shadow_currency")
        ps.shadow_gross = recomputed.get("shadow_gross")
        ps.shadow_taxable_income = recomputed.get("shadow_taxable_income")
        ps.shadow_tax = recomputed.get("shadow_tax")
        ps.shadow_ss = recomputed.get("shadow_ss")
        ps.shadow_equalization_due = recomputed.get("shadow_equalization_due")

        # Stamp the one-offs as applied so they can't be paid again.
        if one_offs:
            one_off_allowances_service.stamp_applied(db, one_offs, ps.id)

        # Persist loan repayments as Repayment rows so the audit trail
        # advances and the loan principal balance moves with the payslip.
        if loan_repayments > 0:
            _record_loan_repayments_for_period(
                db, ps.private_user_id, run.period_end, loan_repayments, run.id,
            )

    run.status = "finalized"
    run.finalized_at = datetime.now(timezone.utc)
    run.finalized_by_user_id = actor_user_id
    run.country_rules_snapshot = snapshot.model_dump(mode="json")
    db.flush()

    # M21 — generate PDF artifacts. Runs synchronously (cheap enough for a
    # typical SME of <500 employees) but never raises: the run is finalized
    # before this point, and PDFs are regeneratable derived artifacts.
    try:
        from jobs import payslip_pdf
        payslip_pdf.generate_for_run(db, run.id)
    except Exception as e:  # noqa: BLE001
        logger.warning("payroll_engine: PDF generation failed for run %s: %s", run.id, e)

    return run


def recompute_draft_run(db: Session, run_id: int, actor_user_id: Optional[int]) -> PayrollRun:
    """M6 — recompute a DRAFT run in place after a rule correction.

    Deletes the run's payslips and re-runs the per-employee compute against
    the current snapshot + overtime rule. Refuses non-draft runs (finalized
    runs are frozen by snapshot). Caller commits.
    """
    run = db.query(PayrollRun).filter(PayrollRun.id == run_id).one_or_none()
    if run is None:
        raise HTTPException(status_code=404, detail=f"PayrollRun {run_id} not found")
    if run.status != "draft":
        raise HTTPException(
            status_code=409,
            detail=f"recompute only allowed on draft runs (run {run_id} is {run.status})",
        )

    company = db.query(Company).filter(Company.company_id == run.company_id).one()
    overtime_rule = payroll_rules.resolve_overtime_rule(db, company.country_code, run.period_start)
    snapshot = payroll_rules.resolve(db, company.country_code, run.period_start)
    company_tz = getattr(company, "timezone", None) or "Indian/Mauritius"
    require_approved = bool(getattr(company, "require_approved_clockins_for_payroll", False))

    # Wipe existing payslips; recreate.
    db.query(Payslip).filter(Payslip.payroll_run_id == run.id).delete()
    db.flush()

    prior_ids = [
        e.private_user_id for e in _eligible_employees(db, run.company_id, run.period_start)
    ]
    run_flags: List[str] = []
    paid_ids: set = set()
    for emp in db.query(PrivateUser).filter(PrivateUser.private_user_id.in_(prior_ids)).all():
        emp_flags: List[str] = []
        resolved = _resolve_full(
            db, emp, run.period_start, run.period_end, company.country_code,
            require_approved_clockins=require_approved,
            overtime_rule=overtime_rule,
            company_timezone=company_tz, flags_out=emp_flags,
        )
        if not resolved.components:
            continue
        leave_summary = _compute_leave_summary(
            db, emp.private_user_id, run.period_start, run.period_end,
            country_code=company.country_code, flags_out=emp_flags,
        )
        loan_repayments = _compute_loan_repayments_for_period(db, emp.private_user_id, run.period_start, run.period_end)
        earnings_gross_basic = sum(
            (c.amount for c in resolved.components if c.kind == "earning" and c.is_basic),
            Decimal("0.00"),
        )
        leave_impact = _compute_leave_impact_for_period(
            db, company.country_code, emp, leave_summary, earnings_gross_basic,
            run.period_start, run.period_end,
        )
        absence_deduction = _compute_salaried_absence_for_period(
            db, company.country_code, emp, earnings_gross_basic,
            run.period_start, run.period_end,
            company_tz, require_approved, flags_out=emp_flags,
        )
        shadow_host = _recompute_shadow_host(db, run, emp.private_user_id)
        computed = compute_for_resolved(
            resolved, snapshot,
            db=db, private_user_id=emp.private_user_id,
            period_start=run.period_start, country_code=company.country_code,
            loan_repayments=loan_repayments, leave_impact=leave_impact,
            absence_deduction=absence_deduction, sdl_applicable=bool(company.sdl_applicable),
            flags_out=emp_flags,
            shadow_country_code=shadow_host,
            fx_rate=_shadow_rate(run.fx_snapshot, shadow_host),
        )
        active_job = (
            db.query(Job).filter(Job.private_user_id == emp.private_user_id)
            .order_by(Job.created_at.desc()).first()
        )
        db.add(Payslip(
            payroll_run_id=run.id,
            private_user_id=emp.private_user_id,
            job_id=active_job.job_id if active_job else None,
            home_geofence_id=emp.home_geofence_id,
            leave_summary=leave_summary,
            **computed,
        ))
        paid_ids.add(emp.private_user_id)
        run_flags.extend(f"u{emp.private_user_id}:{f}" for f in emp_flags)

    run_flags.extend(_pending_period_signals(db, company.company_id, run.period_start, run.period_end))
    run_flags.extend(_worked_but_unpaid_flags(db, company.company_id, run.period_start, run.period_end, paid_ids))
    run_flags.extend(_no_schedule_flags(db, company.company_id, run.period_start, run.period_end, paid_ids, require_approved))
    run.compute_version = 2
    run.compliance_flags = run_flags
    db.flush()
    db.refresh(run)
    return run


def _reverse_loan_repayments_for_run(db: Session, run_id: int) -> None:
    """Undo the loan repayments a run booked on finalize: roll back each
    `Loan.repaid_amount`, un-mark loans that are no longer fully repaid, and
    delete the `Repayment` rows. Keyed on `payroll_run_id` so only this run's
    rows are touched — manual repayments (payroll_run_id IS NULL) are left
    alone. Without this, a redo (cancel + fresh run) would advance the loan
    ledger a second time for the same period.
    """
    rows = (
        db.query(Repayment)
        .filter(Repayment.payroll_run_id == run_id)
        .all()
    )
    for row in rows:
        loan = db.query(Loan).filter(Loan.loan_id == row.loan_id).one_or_none()
        if loan is not None:
            new_repaid = Decimal(str(loan.repaid_amount or 0)) - Decimal(str(row.amount or 0))
            if new_repaid < 0:
                new_repaid = Decimal("0")
            loan.repaid_amount = float(new_repaid.quantize(Decimal("0.01")))
            if loan.status == "paid" and new_repaid < Decimal(str(loan.amount or 0)):
                loan.status = "active"
        db.delete(row)


def cancel_run(db: Session, run_id: int) -> PayrollRun:
    """Mark a run as cancelled. Allowed from draft or finalized.

    Cancelling a finalized run is a destructive admin action — the
    payslips are kept (audit) but the run is no longer the source of
    truth and a new run can be created for the same period. Any loan
    repayments this run booked are reversed so the loan ledger doesn't
    advance twice across a redo.
    """
    run = db.query(PayrollRun).filter(PayrollRun.id == run_id).one_or_none()
    if run is None:
        raise HTTPException(status_code=404, detail=f"PayrollRun {run_id} not found")
    if run.status == "cancelled":
        return run
    _reverse_loan_repayments_for_run(db, run_id)
    run.status = "cancelled"
    db.flush()
    return run
