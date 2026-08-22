"""M0 — payslip reconciliation harness.

Feed this script the structured fields from a real MU payslip; it produces
the bucketed expected output we'd compute, and reports any difference.

Used in M0 to ground-truth the seeded MU statutory floor against three real
payslips from established firms (Datapay / Ascend / PeoplePay). Discrepancies
surface as PENDING_M0_VERIFICATION items in the seeder that need superseding.

USAGE

    # 1. Open `_PAYSLIP_INPUTS` below and fill in the fields from a real
    #    payslip. Sources: public employer postings, sample contracts,
    #    ex-employee shares (anonymized).
    # 2. Run:
    #       .venv/bin/python -m scripts.reconcile_mu_payslip
    # 3. Read the diff. If the actual payslip differs from our compute,
    #    investigate which seeded value needs adjustment.

As of M3 this drives the REAL `services/overtime_engine.bucket()` against the
LIVE seeded MU rule + public holidays (loaded from the DB), so reconciliation
exercises the exact code path that pays workers — not a parallel copy. Run the
seeders first (`python -m scripts.seed_overtime_rules_mu`). If the seed is
wrong, this agrees with the seed (reproduces the same error); cross-check the
decree text and supersede the seed if a real payslip disagrees.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, time, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Optional


# ---------------------------------------------------------------------------
# Fill these in for a real payslip you want to reconcile.
# ---------------------------------------------------------------------------


@dataclass
class ClockIn:
    """One worked interval (already minus breaks)."""
    day: date
    start: time
    end: time
    is_overtime_flagged: bool = False
    is_overtime_confirmed: bool = False

    @property
    def hours(self) -> Decimal:
        s = datetime.combine(self.day, self.start)
        e = datetime.combine(self.day, self.end)
        if e <= s:
            e += timedelta(days=1)
        seconds = (e - s).total_seconds()
        return Decimal(seconds) / Decimal(3600)


@dataclass
class PayslipInput:
    """Fields you'd transcribe from a real payslip."""
    employee_name: str
    period_start: date
    period_end: date
    hourly_rate: Decimal
    weekly_rest_day_dow: int  # ISO 1=Mon … 7=Sun
    overtime_eligibility: str  # 'HOURLY' | 'MONTHLY_ELIGIBLE' | 'EXEMPT'
    monthly_basic: Optional[Decimal]  # for MONTHLY_ELIGIBLE
    contracted_hours_per_week: Optional[Decimal]  # NULL → use statutory 45
    clock_ins: List[ClockIn]
    actual_payslip_components: dict  # {component_name: amount}, transcribed verbatim


# ---------------------------------------------------------------------------
# Sample input — REPLACE with a real one before running.
# Single 45-hr week, no OT, no rest-day or holiday work. Trivial case.
# ---------------------------------------------------------------------------

_PAYSLIP_INPUTS: List[PayslipInput] = [
    PayslipInput(
        employee_name="SAMPLE — replace with real payslip",
        period_start=date(2026, 5, 4),   # Mon
        period_end=date(2026, 5, 10),    # Sun
        hourly_rate=Decimal("200.00"),
        weekly_rest_day_dow=7,
        overtime_eligibility="HOURLY",
        monthly_basic=None,
        contracted_hours_per_week=None,
        clock_ins=[
            ClockIn(date(2026, 5, 4), time(9, 0), time(18, 0)),  # 9 hours
            ClockIn(date(2026, 5, 5), time(9, 0), time(18, 0)),
            ClockIn(date(2026, 5, 6), time(9, 0), time(18, 0)),
            ClockIn(date(2026, 5, 7), time(9, 0), time(18, 0)),
            ClockIn(date(2026, 5, 8), time(9, 0), time(18, 0)),
        ],
        actual_payslip_components={
            # Use the engine's bucket codes (REG / OT_WEEKDAY_T1 / OT_REST_DAY
            # / OT_HOLIDAY_NORMAL / OT_HOLIDAY_AFTER) when transcribing so the
            # per-line diff lines up; the GROSS row cross-checks regardless.
            "REG": Decimal("9000.00"),  # 45h × 200
        },
    ),
]


# ---------------------------------------------------------------------------
# Real-engine reconciliation — drives services/overtime_engine.bucket() with
# the live seeded MU rule + holidays from the DB.
# ---------------------------------------------------------------------------


def quantize(x: Decimal) -> Decimal:
    return x.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def expected_components(p: PayslipInput, db) -> dict:
    """Bucket this payslip with the production engine against the live MU rule.

    Clock-in wall-clock times are treated as UTC and the engine runs with
    company_timezone='Etc/UTC' so the input dates classify directly (no tz
    shift) — matching how the test-suite fixtures pin behavior.
    """
    from services import overtime_engine, payroll_rules
    from core.model import PublicHoliday

    rule = payroll_rules.resolve_overtime_rule(db, "MU", p.period_start)

    logs = []
    for i, ci in enumerate(p.clock_ins):
        start = datetime.combine(ci.day, ci.start, tzinfo=timezone.utc)
        end = datetime.combine(ci.day, ci.end, tzinfo=timezone.utc)
        if end <= start:
            end += timedelta(days=1)
        logs.append(overtime_engine.BucketerTimeLog(
            timelog_id=i, start_utc=start, end_utc=end,
            is_overtime=ci.is_overtime_flagged,
            overtime_confirmed=ci.is_overtime_confirmed,
        ))

    holidays = frozenset(
        (h.observed_date or h.date)
        for h in db.query(PublicHoliday)
        .filter(PublicHoliday.country_code == "MU")
        .filter(PublicHoliday.date >= p.period_start - timedelta(days=7))
        .filter(PublicHoliday.date <= p.period_end + timedelta(days=1))
        .all()
    )

    monthly_basic = p.monthly_basic if p.overtime_eligibility == "MONTHLY_ELIGIBLE" else None
    buckets, flags = overtime_engine.bucket(
        logs=logs, breaks_by_log={}, rule=rule,
        holidays_by_observed_date=holidays,
        period_start=p.period_start, period_end=p.period_end,
        weekly_rest_day_dow=p.weekly_rest_day_dow,
        contracted_hours_per_week=p.contracted_hours_per_week,
        overtime_eligibility=p.overtime_eligibility,
        monthly_basic=monthly_basic,
        company_timezone="Etc/UTC",
    )
    if flags:
        print(f"  compliance_flags: {flags}")

    # MONTHLY_ELIGIBLE derives an hourly rate from monthly_basic; HOURLY/EXEMPT
    # use the transcribed hourly_rate.
    if p.overtime_eligibility == "MONTHLY_ELIGIBLE":
        if p.monthly_basic is None or p.contracted_hours_per_week is None:
            raise ValueError("MONTHLY_ELIGIBLE requires monthly_basic + contracted_hours_per_week")
        rate = p.monthly_basic / (p.contracted_hours_per_week * Decimal(52) / Decimal(12))
    else:
        rate = p.hourly_rate

    out: dict = {}
    for b in buckets:
        out[b.code] = out.get(b.code, Decimal("0")) + b.amount(rate)
    return {k: quantize(v) for k, v in out.items()}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    from core.config import get_db

    print("M0 — MU payslip reconciliation (real engine + live seeded rule)\n")
    db = next(get_db())
    try:
        for i, p in enumerate(_PAYSLIP_INPUTS, start=1):
            print(f"=== Payslip {i}: {p.employee_name} ({p.period_start} → {p.period_end}) ===")
            expected = expected_components(p, db)
            actual = {k: quantize(Decimal(str(v))) for k, v in p.actual_payslip_components.items()}

            all_keys = sorted(set(expected) | set(actual))
            print(f"  {'Component':<24} {'Expected':>14} {'Actual':>14} {'Δ':>14}")
            print("  " + "-" * 70)
            total_delta = Decimal(0)
            for k in all_keys:
                e = expected.get(k, Decimal(0))
                a = actual.get(k, Decimal(0))
                d = a - e
                total_delta += abs(d)
                marker = "" if abs(d) <= Decimal("0.01") else "  <-- MISMATCH"
                print(f"  {k:<24} {e:>14} {a:>14} {d:>14}{marker}")
            # Gross-total cross-check — robust even when line-item names differ
            # between the real payslip and the engine's bucket codes.
            exp_gross = sum(expected.values(), Decimal("0"))
            act_gross = sum(actual.values(), Decimal("0"))
            print("  " + "-" * 70)
            print(f"  {'GROSS (sum)':<24} {exp_gross:>14} {act_gross:>14} {act_gross - exp_gross:>14}")
            print(f"  total abs line delta: {total_delta}\n")
            if total_delta <= Decimal("1.00"):
                print("  ✅ Within MUR 1.00 tolerance — seed values look correct for this payslip.\n")
            else:
                print("  ❌ Mismatch — investigate which seeded value differs, or remap "
                      "the real payslip's line names to the engine's bucket codes "
                      "(REG / OT_WEEKDAY_T1 / OT_REST_DAY / OT_HOLIDAY_*).\n")
    finally:
        db.close()


if __name__ == "__main__":
    main()
