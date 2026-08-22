"""Seed Mauritius overtime + premium-pay rules + 2026 public holidays.

M1 milestone — schema-only. The values here are grounded in:
  * MU Workers' Rights Act 2019 (consolidated 27 July 2024)
  * MU Workers' Rights Regulations (salary cap above which OT not owed)
  * PMO General Notice No. 1195 of 2025 (2026 holidays)

⚠️ PENDING_M0_VERIFICATION items are flagged inline. M0 (legal sign-off
   + 3-payslip reconciliation) resolves them; if any value differs after
   M0, supersede via a new effective_from row — these rule tables are
   append-only.

Run from backend/:
    .venv/bin/python -m scripts.seed_overtime_rules_mu

Idempotent — skips seeding if a rule already exists for MU.
"""

from __future__ import annotations

from datetime import date, time
from decimal import Decimal
from typing import Iterable, Tuple

from sqlalchemy.orm import Session

from core.config import get_db
from core.model import (
    CountryOvertimeRule,
    CountryOvertimeWeekdayTier,
    PublicHoliday,
)


EFFECTIVE_FROM = date(2026, 1, 1)
SOURCE_WRA = "MU Workers' Rights Act 2019 (consolidated 27 Jul 2024) ss.27, 28; PMO GN 1195/2025"


# 2026 MU public holidays, verified against PMO General Notice No. 1195 of 2025
# (https://pmo.govmu.org/Communique/GN_No._1195-Public_Holidays_2026.pdf).
#
# observed_date = date for all entries: per current MU practice, holidays
# falling on a Sunday are NOT shifted to Monday (workers receive the day off
# implicitly since Sunday is the typical rest day). PENDING_M0_VERIFICATION:
# if M0 legal review confirms a substitution rule for any sector, supersede
# the affected rows with observed_date = following Monday.
MU_HOLIDAYS_2026: Iterable[Tuple[str, date, bool]] = (
    # (name, date, is_recurring)
    ("New Year",                                  date(2026, 1, 1),  True),
    ("New Year (Day 2)",                          date(2026, 1, 2),  True),
    ("Abolition of Slavery",                      date(2026, 2, 1),  True),
    ("Thaipoosam Cavadee",                        date(2026, 2, 1),  False),
    ("Maha Shivaratree",                          date(2026, 2, 15), False),
    ("Chinese Spring Festival",                   date(2026, 2, 17), False),
    ("Independence and Republic Day",             date(2026, 3, 12), True),
    ("Ugaadi",                                    date(2026, 3, 19), False),
    ("Eid-Ul-Fitr",                               date(2026, 3, 21), False),  # subject to moon sighting
    ("Labour Day",                                date(2026, 5, 1),  True),
    ("Assumption of the Blessed Virgin Mary",     date(2026, 8, 15), False),  # alternates yearly w/ All Saints
    ("Ganesh Chaturthi",                          date(2026, 9, 16), False),
    ("Arrival of Indentured Labourers",           date(2026, 11, 2), True),
    ("Divali",                                    date(2026, 11, 8), False),
    ("Christmas",                                 date(2026, 12, 25), True),
)


def seed_mu_overtime_rule(db: Session) -> CountryOvertimeRule:
    existing = (
        db.query(CountryOvertimeRule)
        .filter(CountryOvertimeRule.country_code == "MU")
        .filter(CountryOvertimeRule.effective_to.is_(None))
        .one_or_none()
    )
    if existing is not None:
        print(f"  MU overtime rule already exists (id={existing.id}, effective_from={existing.effective_from}). Skipping.")
        return existing

    rule = CountryOvertimeRule(
        country_code="MU",
        effective_from=EFFECTIVE_FROM,
        version=1,
        source_reference=SOURCE_WRA,
        change_reason="Initial MU seed for bucketed overtime engine (M1)",
        notes=(
            "Statutory floor only — sector Remuneration Orders (catering, "
            "tourism, construction, sugar, etc.) deferred to M8. Per WRA ss.27, 28."
        ),
        # Thresholds — WRA s.27: 45 h/wk; 8 h/day commonly per sectoral orders.
        weekly_threshold_h=Decimal("45.00"),
        daily_threshold_h=Decimal("8.00"),
        # Rest-day work: 2× per WRA s.28.
        rest_day_multiplier=Decimal("2.00"),
        # Public holiday: 2× during normal hours, 3× after normal hours.
        # PENDING_M0_VERIFICATION: "after normal hours" boundary — engine
        # currently interprets as "after 8 cumulative daily hours on the
        # holiday" (conservative). Lawyer letter or sample-payslip
        # reconciliation in M0 closes this.
        public_holiday_normal_hours_multiplier=Decimal("2.00"),
        public_holiday_after_hours_multiplier=Decimal("3.00"),
        # Night premium: MU has no universal statutory night multiplier.
        # Some sectoral Remuneration Orders specify 15–25% additive; deferred
        # to M8 sector overlays. Leave NULL at country level.
        night_start=None,
        night_end=None,
        night_multiplier_habitual=None,
        night_multiplier_occasional=None,
        night_mode=None,
        # Caps: 10 h/wk OT soft cap, 55 h/wk total absolute cap (WRA s.24).
        weekly_ot_soft_cap_h=Decimal("10.00"),
        weekly_total_max_h=Decimal("55.00"),
        # MU Workers' Rights Regulations salary cap above which OT not owed.
        # PENDING_M0_VERIFICATION: current cap value as of 2026. Lawyer letter
        # confirms exact figure; provisional MUR 50,000 used here.
        monthly_basic_ot_cap=Decimal("50000.00"),
        # Holiday-on-rest-day: take the higher of the two multipliers (MAX).
        # PENDING_M0_VERIFICATION: MoLHRD has not published a written ruling;
        # MAX is the conservative reading.
        stack_holiday_on_rest_day="MAX",
        # MU is ADDITIVE for night-on-premium at the sector level, but with
        # no country-level night multiplier this setting is currently a no-op.
        stack_night_on_premium="STACK",
        week_start_dow=1,  # ISO Mon
    )
    db.add(rule)
    db.flush()  # need rule.id for child tier

    # MU weekday OT: single tier — 1.5× above weekly_threshold_h, no upper bound.
    tier = CountryOvertimeWeekdayTier(
        overtime_rule_id=rule.id,
        tier_order=1,
        up_to_hours=None,
        multiplier=Decimal("1.50"),
    )
    db.add(tier)

    db.commit()
    print(f"  Seeded MU overtime rule id={rule.id}, 1 weekday tier (1.5×).")
    return rule


def seed_mu_holidays_2026(db: Session) -> int:
    seeded = 0
    skipped = 0
    for name, dt, recurring in MU_HOLIDAYS_2026:
        exists = (
            db.query(PublicHoliday)
            .filter(PublicHoliday.country_code == "MU")
            .filter(PublicHoliday.date == dt)
            .filter(PublicHoliday.name == name)
            .one_or_none()
        )
        if exists:
            # Update observed_date if NULL (backfill from earlier migrations).
            if exists.observed_date is None:
                exists.observed_date = dt
            skipped += 1
            continue
        db.add(
            PublicHoliday(
                country_code="MU",
                name=name,
                date=dt,
                observed_date=dt,  # see seed_mu_overtime_rule notes re Sun→Mon
                year=dt.year,
                is_recurring=recurring,
            )
        )
        seeded += 1
    db.commit()
    print(f"  MU 2026 public holidays — seeded {seeded}, skipped (already present) {skipped}.")
    return seeded


def main() -> None:
    print("Seeding Mauritius overtime engine rules (M1)…")
    db: Session = next(get_db())
    try:
        seed_mu_overtime_rule(db)
        seed_mu_holidays_2026(db)
        print("Done.")
        print()
        print("Next: M0 (3 real MU payslips reconciled + lawyer opinion letter).")
        print("Values marked PENDING_M0_VERIFICATION can be superseded via a new effective_from row once M0 closes.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
