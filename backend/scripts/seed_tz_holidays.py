"""Seed Tanzania (TZ) 2026 public holidays.

Full gazetted list (17 public holidays) — including the Islamic lunar holidays
(Eid el Fitri + second day, Eid al-Adha, Maulid) and the moveable Christian
holidays (Good Friday, Easter Monday) that the earlier fixed-date migration
(tanzania_public_holidays_2026_20260718.py) deliberately left out.

Dates verified against the Tanzania 2026 public-holiday calendar (weekdays
match the gazette). Islamic + Easter dates are moveable year-on-year, so they
are marked is_recurring=False; fixed Gregorian-date national holidays are
is_recurring=True.

observed_date = date for every entry: no weekend-substitution rule is applied
for Tanzania (weekend is the typical rest day), consistent with the earlier
TZ migration.

Idempotent — deletes the existing TZ/2026 rows (which may be the older
partial fixed-date set) and re-inserts the full list, so it is safe to run on
every deploy and to run repeatedly.

Run from backend/:
    .venv/bin/python -m scripts.seed_tz_holidays
"""

from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from core.config import get_db
from core.model import PublicHoliday

COUNTRY_CODE = "TZ"
YEAR = 2026

# (name, date, is_recurring)
TZ_HOLIDAYS_2026 = (
    ("New Year's Day", date(2026, 1, 1), True),
    ("Zanzibar Revolution Day", date(2026, 1, 12), True),
    ("Eid el Fitri (End of Ramadan)", date(2026, 3, 20), False),
    ("Eid el Fitri Holiday", date(2026, 3, 21), False),
    ("Good Friday", date(2026, 4, 3), False),
    ("Easter Monday", date(2026, 4, 6), False),
    ("Karume Day", date(2026, 4, 7), True),
    ("Union Day", date(2026, 4, 26), True),
    ("Labour Day", date(2026, 5, 1), True),
    ("Eid al-Adha (Festival of Sacrifice)", date(2026, 5, 27), False),
    ("Saba Saba (International Trade Fair)", date(2026, 7, 7), True),
    ("Nane Nane (Farmers' Day)", date(2026, 8, 8), True),
    ("Maulid (Prophet's Birthday)", date(2026, 8, 25), False),
    ("Mwalimu Nyerere Day", date(2026, 10, 14), True),
    ("Independence and Republic Day", date(2026, 12, 9), True),
    ("Christmas Day", date(2026, 12, 25), True),
    ("Boxing Day", date(2026, 12, 26), True),
)


def seed_tz_holidays_2026(db: Session) -> int:
    # Remove the existing TZ/2026 set (the older migration only seeded the
    # fixed-date subset) so names/dates converge on the full list below.
    deleted = (
        db.query(PublicHoliday)
        .filter(PublicHoliday.country_code == COUNTRY_CODE)
        .filter(PublicHoliday.year == YEAR)
        .delete(synchronize_session=False)
    )

    seeded = 0
    for name, dt, recurring in TZ_HOLIDAYS_2026:
        db.add(
            PublicHoliday(
                country_code=COUNTRY_CODE,
                name=name,
                date=dt,
                observed_date=dt,
                year=dt.year,
                is_recurring=recurring,
            )
        )
        seeded += 1

    db.commit()
    print(
        f"  TZ 2026 public holidays — removed {deleted} stale row(s), "
        f"seeded {seeded}."
    )
    return seeded


def main() -> None:
    print("Seeding Tanzania (TZ) 2026 public holidays…")
    db: Session = next(get_db())
    try:
        seed_tz_holidays_2026(db)
        print("Done.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
