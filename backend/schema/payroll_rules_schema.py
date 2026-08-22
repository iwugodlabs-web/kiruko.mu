"""Pydantic schemas for the country payroll rules engine.

Three flavors per rule:
  * Read   — what reads/lists return (includes all temporal columns).
  * Create — what supersede() accepts when introducing a new version. Only
             value fields + provenance (source_reference, change_reason); the
             temporal columns are filled in by the service.
  * Resolved — a flat snapshot suitable for embedding in payroll_runs JSONB.
"""

from datetime import date, datetime, time
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Tax brackets
# ---------------------------------------------------------------------------


class TaxBracketLine(BaseModel):
    order_index: int
    lower_bound: Decimal
    upper_bound: Optional[Decimal] = None
    rate: Decimal
    description: Optional[str] = None

    class Config:
        from_attributes = True


class TaxBracketLineRead(TaxBracketLine):
    id: int
    bracket_set_id: int


class TaxBracketSetCreate(BaseModel):
    country_code: str = Field(min_length=2, max_length=2)
    fiscal_year: int
    label: Optional[str] = None
    effective_from: date
    source_reference: Optional[str] = None
    change_reason: Optional[str] = None
    # CUMULATIVE_YTD (MU's WRA model) or FLAT_PERIODIC (TZ's TRA model) — see
    # TaxBracketSet.tax_computation_mode. Defaults to MU's existing behavior.
    tax_computation_mode: str = Field(default="CUMULATIVE_YTD", pattern="^(CUMULATIVE_YTD|FLAT_PERIODIC)$")
    brackets: List[TaxBracketLine]


class TaxBracketSetRead(BaseModel):
    id: int
    country_code: str
    fiscal_year: int
    label: Optional[str]
    effective_from: date
    effective_to: Optional[date]
    superseded_by_id: Optional[int]
    version: int
    source_reference: Optional[str]
    change_reason: Optional[str]
    created_by_user_id: Optional[int]
    created_at: Optional[datetime]
    tax_computation_mode: str = "CUMULATIVE_YTD"
    brackets: List[TaxBracketLineRead] = []

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Statutory deductions
# ---------------------------------------------------------------------------


class StatutoryDeductionCreate(BaseModel):
    country_code: str = Field(min_length=2, max_length=2)
    code: str = Field(max_length=40)
    label: str
    rate: Decimal
    threshold_low: Optional[Decimal] = None
    threshold_high: Optional[Decimal] = None
    taxable_base: str = "gross"
    employer_or_employee: str  # 'employer' | 'employee'
    # This deduction's own computed employee amount reduces the named base
    # code (e.g. "PAYE") before that code is used elsewhere — see
    # StatutoryDeduction.reduces_base_code. None for MU today.
    reduces_base_code: Optional[str] = Field(default=None, max_length=40)
    # None = unspecified, falls back to a legacy heuristic — see
    # StatutoryDeduction.applies_to_overtime/applies_to_bonus. Set both
    # explicitly for any new country's rows.
    applies_to_overtime: Optional[bool] = None
    applies_to_bonus: Optional[bool] = None
    effective_from: date
    source_reference: Optional[str] = None
    change_reason: Optional[str] = None


class StatutoryDeductionRead(StatutoryDeductionCreate):
    id: int
    effective_to: Optional[date] = None
    superseded_by_id: Optional[int] = None
    version: int
    created_by_user_id: Optional[int] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Country leave defaults
# ---------------------------------------------------------------------------


class CountryLeaveDefaultCreate(BaseModel):
    country_code: str = Field(min_length=2, max_length=2)
    leave_type_code: str = Field(max_length=40)
    label: str
    days_per_year: int
    accrual_method: str = "annual"
    carry_forward_max: Optional[int] = None
    encashable: bool = False
    min_service_months: int = 0
    # Entitlement window in months (e.g. Tanzania sick leave: 36, not the
    # annual default) — see CountryLeaveDefault.cycle_months.
    cycle_months: int = 12
    # Reduced-pay tail within days_per_year — both None means the whole
    # entitlement is full pay (every leave type today). See
    # CountryLeaveDefault.reduced_pay_days/reduced_pay_rate. No engine logic
    # consumes these yet as of 2026-07-16 — schema only.
    reduced_pay_days: Optional[int] = None
    reduced_pay_rate: Optional[Decimal] = None
    effective_from: date
    source_reference: Optional[str] = None
    change_reason: Optional[str] = None


class CountryLeaveDefaultRead(CountryLeaveDefaultCreate):
    id: int
    effective_to: Optional[date] = None
    superseded_by_id: Optional[int] = None
    version: int
    created_by_user_id: Optional[int] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Country bonus rules
# ---------------------------------------------------------------------------


class CountryBonusRuleCreate(BaseModel):
    country_code: str = Field(min_length=2, max_length=2)
    bonus_code: str = Field(max_length=40)
    label: str
    formula: str  # twelfth_of_annual | fixed | percent_of_basic | custom
    eligibility_min_service_months: int = 0
    payable_month: int = Field(ge=1, le=12)
    prorate_on_partial_year: bool = True
    taxable: bool = True
    fixed_amount: Optional[Decimal] = None
    rate: Optional[Decimal] = None
    effective_from: date
    source_reference: Optional[str] = None
    change_reason: Optional[str] = None


class CountryBonusRuleRead(CountryBonusRuleCreate):
    id: int
    effective_to: Optional[date] = None
    superseded_by_id: Optional[int] = None
    version: int
    created_by_user_id: Optional[int] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Overtime rules (M2 — bucketed overtime + premium-pay engine)
# ---------------------------------------------------------------------------


# --- M0 payslip reconciliation tool (platform-admin) ---


class ReconcileClockIn(BaseModel):
    date: date
    start_hhmm: str  # "HH:MM" local wall-clock
    end_hhmm: str
    is_overtime: bool = False
    overtime_confirmed: bool = False


class OvertimeReconcileRequest(BaseModel):
    period_start: date
    period_end: date
    hourly_rate: Decimal
    weekly_rest_day_dow: int = 7
    overtime_eligibility: str = "HOURLY"  # HOURLY | MONTHLY_ELIGIBLE | EXEMPT
    monthly_basic: Optional[Decimal] = None
    contracted_hours_per_week: Optional[Decimal] = None
    company_timezone: str = "Etc/UTC"
    clock_ins: List[ReconcileClockIn] = []


class OvertimeReconcileBucket(BaseModel):
    code: str
    label: str
    hours: Decimal
    multiplier: Decimal
    amount: Decimal


class OvertimeReconcileResponse(BaseModel):
    buckets: List[OvertimeReconcileBucket] = []
    total: Decimal
    rule_version: int
    rule_effective_from: date
    compliance_flags: List[str] = []


class CountryOvertimeWeekdayTierRead(BaseModel):
    id: int
    tier_order: int
    up_to_hours: Optional[Decimal] = None  # NULL = "and beyond"
    multiplier: Decimal

    class Config:
        from_attributes = True


class CountryOvertimeRuleRead(BaseModel):
    id: int
    country_code: str
    effective_from: date
    effective_to: Optional[date] = None
    superseded_by_id: Optional[int] = None
    version: int
    source_reference: Optional[str] = None
    change_reason: Optional[str] = None
    notes: Optional[str] = None
    created_by_user_id: Optional[int] = None
    created_at: Optional[datetime] = None

    weekly_threshold_h: Decimal
    daily_threshold_h: Optional[Decimal] = None

    rest_day_multiplier: Decimal
    public_holiday_normal_hours_multiplier: Decimal
    public_holiday_after_hours_multiplier: Decimal

    night_start: Optional[time] = None
    night_end: Optional[time] = None
    night_multiplier_habitual: Optional[Decimal] = None
    night_multiplier_occasional: Optional[Decimal] = None
    night_mode: Optional[str] = None

    weekly_ot_soft_cap_h: Optional[Decimal] = None
    weekly_total_max_h: Optional[Decimal] = None

    monthly_basic_ot_cap: Optional[Decimal] = None

    # None falls back to 195 (WRA s.25) in _apply_salaried_overtime — see
    # CountryOvertimeRule.notional_hourly_divisor.
    notional_hourly_divisor: Optional[Decimal] = None

    stack_holiday_on_rest_day: str
    stack_night_on_premium: str
    week_start_dow: int

    weekday_tiers: List[CountryOvertimeWeekdayTierRead] = []

    class Config:
        from_attributes = True


class PublicHolidayRead(BaseModel):
    holiday_id: int
    country_code: str
    name: str
    date: date
    observed_date: Optional[date] = None
    year: int
    is_recurring: bool

    class Config:
        from_attributes = True


class PublicHolidayCreate(BaseModel):
    name: str
    date: date
    observed_date: Optional[date] = None
    is_recurring: bool = False


class PublicHolidayUpdate(BaseModel):
    name: Optional[str] = None
    date: Optional[date] = None
    observed_date: Optional[date] = None
    is_recurring: Optional[bool] = None


# ---------------------------------------------------------------------------
# Resolved bundle — what payroll_engine consumes and payroll_runs snapshots.
# ---------------------------------------------------------------------------


class CountryRulesSnapshot(BaseModel):
    """All resolved rules for one country at one point in time.

    Embedded into payroll_runs.country_rules_snapshot JSONB on finalize so
    historical payslips reproduce byte-for-byte even if rules are later
    superseded.
    """

    country_code: str
    resolved_for_period_start: date
    resolved_at: datetime
    tax_bracket_set: Optional[TaxBracketSetRead] = None
    statutory_deductions: List[StatutoryDeductionRead] = []
    leave_defaults: List[CountryLeaveDefaultRead] = []
    bonus_rules: List[CountryBonusRuleRead] = []
    # M2 — country overtime rule. NULL is allowed (the pre-approval estimate's
    # no-rule-configured fallback doesn't need it) but the engine raises
    # MissingOvertimeRule when a real payroll run is created without one.
    overtime: Optional[CountryOvertimeRuleRead] = None
