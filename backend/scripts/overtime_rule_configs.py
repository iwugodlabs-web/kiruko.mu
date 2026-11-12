"""Per-country overtime-rule configuration for the generic seeder.

Add a new country here to make it available to:
    python -m scripts.seed_overtime_rules --country XX

Values are statutory *floors* only — sector overlays are out of scope. Legal
rates must be verified before `verified=True`; unverified configs are skipped
by default and require `--allow-placeholder` (or
ALLOW_PLACEHOLDER_OVERTIME=true) to seed.

TZ is currently a placeholder from doc/TANZANIA-ONBOARDING-PLAN.md §5.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, time
from decimal import Decimal
from typing import Optional


@dataclass(frozen=True)
class OvertimeTierConfig:
    tier_order: int
    up_to_hours: Optional[Decimal]
    multiplier: Decimal


@dataclass(frozen=True)
class CountryOvertimeConfig:
    country_code: str
    effective_from: date
    weekly_threshold_h: Decimal
    rest_day_multiplier: Decimal
    public_holiday_normal_hours_multiplier: Decimal
    public_holiday_after_hours_multiplier: Decimal
    tiers: tuple[OvertimeTierConfig, ...]
    verified: bool
    source_reference: str
    change_reason: str
    notes: Optional[str] = None
    daily_threshold_h: Optional[Decimal] = None
    night_start: Optional[time] = None
    night_end: Optional[time] = None
    night_multiplier_habitual: Optional[Decimal] = None
    night_multiplier_occasional: Optional[Decimal] = None
    night_mode: Optional[str] = None
    weekly_ot_soft_cap_h: Optional[Decimal] = None
    weekly_total_max_h: Optional[Decimal] = None
    monthly_basic_ot_cap: Optional[Decimal] = None
    notional_hourly_divisor: Optional[Decimal] = None
    stack_holiday_on_rest_day: str = "MAX"
    stack_night_on_premium: str = "NO_STACK"
    week_start_dow: int = 1
    # Country-row metadata, used only if the countries row is missing.
    country_name: Optional[str] = None
    currency: Optional[str] = None
    locale: Optional[str] = None
    fiscal_year_start: Optional[str] = None
    date_format: Optional[str] = None
    default_timezone: Optional[str] = None

    def rule_payload(self) -> dict:
        """Columns for CountryOvertimeRule (child tiers passed separately)."""
        return {
            "country_code": self.country_code,
            "effective_from": self.effective_from,
            "source_reference": self.source_reference,
            "change_reason": self.change_reason,
            "notes": self.notes,
            "weekly_threshold_h": self.weekly_threshold_h,
            "daily_threshold_h": self.daily_threshold_h,
            "rest_day_multiplier": self.rest_day_multiplier,
            "public_holiday_normal_hours_multiplier": self.public_holiday_normal_hours_multiplier,
            "public_holiday_after_hours_multiplier": self.public_holiday_after_hours_multiplier,
            "night_start": self.night_start,
            "night_end": self.night_end,
            "night_multiplier_habitual": self.night_multiplier_habitual,
            "night_multiplier_occasional": self.night_multiplier_occasional,
            "night_mode": self.night_mode,
            "weekly_ot_soft_cap_h": self.weekly_ot_soft_cap_h,
            "weekly_total_max_h": self.weekly_total_max_h,
            "monthly_basic_ot_cap": self.monthly_basic_ot_cap,
            "notional_hourly_divisor": self.notional_hourly_divisor,
            "stack_holiday_on_rest_day": self.stack_holiday_on_rest_day,
            "stack_night_on_premium": self.stack_night_on_premium,
            "week_start_dow": self.week_start_dow,
        }


COUNTRY_CONFIGS: dict[str, CountryOvertimeConfig] = {
    "TZ": CountryOvertimeConfig(
        country_code="TZ",
        effective_from=date(2026, 1, 1),
        weekly_threshold_h=Decimal("45.00"),
        daily_threshold_h=Decimal("9.00"),
        rest_day_multiplier=Decimal("2.00"),
        public_holiday_normal_hours_multiplier=Decimal("2.00"),
        public_holiday_after_hours_multiplier=Decimal("2.00"),
        tiers=(
            OvertimeTierConfig(tier_order=1, up_to_hours=None, multiplier=Decimal("1.50")),
        ),
        # 50 h/month OT cap approximated as 11.5 h/week (schema caps are weekly).
        weekly_ot_soft_cap_h=Decimal("11.50"),
        weekly_total_max_h=None,
        monthly_basic_ot_cap=None,
        notional_hourly_divisor=None,
        # Night premium deliberately unset: REPLACE-vs-ADDITIVE is an open M2
        # legal question (doc/TANZANIA-ONBOARDING-PLAN.md §5).
        night_start=None,
        night_end=None,
        night_multiplier_habitual=None,
        night_multiplier_occasional=None,
        night_mode=None,
        stack_holiday_on_rest_day="MAX",
        stack_night_on_premium="NO_STACK",
        week_start_dow=1,
        verified=False,
        source_reference=(
            "TZ Employment and Labour Relations Act 2004 (as amended); "
            "PLACEHOLDER — verify with TZ HR/tax consultant before production"
        ),
        change_reason=(
            "Initial TZ seed to unblock employer payroll — placeholder pending "
            "M2 verification"
        ),
        notes=(
            "Statutory floor only. Values from doc/TANZANIA-ONBOARDING-PLAN.md §5. "
            "50 h/month OT cap approximated as 11.5 h/week (schema caps are weekly). "
            "Night premium intentionally unset until the REPLACE-vs-ADDITIVE "
            "question is answered by counsel."
        ),
        country_name="Tanzania",
        currency="TZS",
        locale="sw-TZ",
        fiscal_year_start="07-01",
        date_format="DD/MM/YYYY",
        default_timezone="Africa/Dar_es_Salaam",
    ),
}


def get_config(country_code: str) -> Optional[CountryOvertimeConfig]:
    return COUNTRY_CONFIGS.get(country_code.upper())
