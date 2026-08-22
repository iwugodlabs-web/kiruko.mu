"""Seed Madagascar overtime + premium-pay rules + 2026 public holidays.

M7 milestone. Values grounded in MG Loi 2024-014 (Code du Travail)
ss.108-112, 149 + Décret 68-172 (via WageIndicator):
  * 40 h/wk threshold
  * weekday OT: 130% first 8 OT-h, 150% beyond  (two tiers)
  * rest day: 140%
  * public holiday: 150%
  * night (22:00-05:00): 130% habitual / 150% occasional, REPLACE mode
  * bonuses don't stack with each other (NO_STACK); OT stacks with day type
  * 20 OT-h/wk cap → 60 h/wk total

⚠️ PENDING_M0_VERIFICATION: night ADDITIVE vs REPLACE confirmation against a
   real MG payslip; annual OT cap exact figure.

Run from backend/:
    .venv/bin/python -m scripts.seed_overtime_rules_mg

Idempotent — skips if an MG rule already exists.
"""

from __future__ import annotations

from datetime import date, time
from decimal import Decimal

from sqlalchemy.orm import Session

from core.config import get_db
from core.model import (
    Country,
    CountryOvertimeRule,
    CountryOvertimeWeekdayTier,
    PublicHoliday,
)


EFFECTIVE_FROM = date(2026, 1, 1)
SOURCE_MG = "MG Loi 2024-014 ss.108-112, 149; Décret 68-172"


# MG 2026 public holidays (fixed-date subset; movable religious dates would be
# added by the annual seeder). PENDING_M0_VERIFICATION: confirm full list
# against the MG official gazette.
MG_HOLIDAYS_2026 = (
    ("New Year",                     date(2026, 1, 1),  True),
    ("Martyrs' Day",                 date(2026, 3, 29), True),
    ("Labour Day",                   date(2026, 5, 1),  True),
    ("Independence Day",             date(2026, 6, 26), True),
    ("Assumption",                   date(2026, 8, 15), False),
    ("All Saints' Day",              date(2026, 11, 1), True),
    ("Christmas",                    date(2026, 12, 25), True),
)


def ensure_country(db: Session) -> None:
    if not db.query(Country).filter(Country.code == "MG").one_or_none():
        db.add(Country(
            code="MG", name="Madagascar", currency="MGA", locale="mg-MG",
            fiscal_year_start="01-01", date_format="DD/MM/YYYY", is_active=True,
        ))
        db.commit()


def seed_mg_overtime_rule(db: Session) -> CountryOvertimeRule:
    existing = (
        db.query(CountryOvertimeRule)
        .filter(CountryOvertimeRule.country_code == "MG")
        .filter(CountryOvertimeRule.effective_to.is_(None))
        .one_or_none()
    )
    if existing is not None:
        print(f"  MG overtime rule already exists (id={existing.id}). Skipping.")
        return existing

    rule = CountryOvertimeRule(
        country_code="MG",
        effective_from=EFFECTIVE_FROM,
        version=1,
        source_reference=SOURCE_MG,
        change_reason="Initial MG seed for bucketed overtime engine (M7)",
        notes="Statutory floor only. Night premium REPLACE mode; bonuses NO_STACK.",
        weekly_threshold_h=Decimal("40.00"),
        daily_threshold_h=Decimal("8.00"),
        rest_day_multiplier=Decimal("1.40"),
        public_holiday_normal_hours_multiplier=Decimal("1.50"),
        public_holiday_after_hours_multiplier=Decimal("1.50"),
        night_start=time(22, 0),
        night_end=time(5, 0),
        night_multiplier_habitual=Decimal("1.30"),
        night_multiplier_occasional=Decimal("1.50"),
        night_mode="REPLACE",
        weekly_ot_soft_cap_h=Decimal("20.00"),
        weekly_total_max_h=Decimal("60.00"),
        monthly_basic_ot_cap=None,
        stack_holiday_on_rest_day="MAX",
        stack_night_on_premium="NO_STACK",
        week_start_dow=1,
    )
    db.add(rule)
    db.flush()

    # Two-tier weekday OT: 130% first 8 OT-h, 150% beyond.
    db.add(CountryOvertimeWeekdayTier(
        overtime_rule_id=rule.id, tier_order=1,
        up_to_hours=Decimal("8.00"), multiplier=Decimal("1.30"),
    ))
    db.add(CountryOvertimeWeekdayTier(
        overtime_rule_id=rule.id, tier_order=2,
        up_to_hours=None, multiplier=Decimal("1.50"),
    ))
    db.commit()
    print(f"  Seeded MG overtime rule id={rule.id}, 2 weekday tiers (1.30 / 1.50).")
    return rule


def seed_mg_holidays_2026(db: Session) -> int:
    seeded = 0
    for name, dt, recurring in MG_HOLIDAYS_2026:
        exists = (
            db.query(PublicHoliday)
            .filter(PublicHoliday.country_code == "MG")
            .filter(PublicHoliday.date == dt)
            .filter(PublicHoliday.name == name)
            .one_or_none()
        )
        if exists:
            if exists.observed_date is None:
                exists.observed_date = dt
            continue
        db.add(PublicHoliday(
            country_code="MG", name=name, date=dt, observed_date=dt,
            year=dt.year, is_recurring=recurring,
        ))
        seeded += 1
    db.commit()
    print(f"  MG 2026 public holidays — seeded {seeded}.")
    return seeded


def main() -> None:
    print("Seeding Madagascar overtime engine rules (M7)…")
    db: Session = next(get_db())
    try:
        ensure_country(db)
        seed_mg_overtime_rule(db)
        seed_mg_holidays_2026(db)
        print("Done.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
