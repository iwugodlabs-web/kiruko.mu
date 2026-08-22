"""seed Tanzania (TZ) fixed-date public holidays for 2026

Revision ID: tanzania_holidays_2026_20260718
Revises: tanzania_activate_20260718
Create Date: 2026-07-18

Adds `public_holidays` rows for country_code='TZ', year=2026 — needed so the
new Salaries earnings endpoint (mobile load-time fix) can classify TZ time
logs against real holiday dates instead of always returning $0 holiday pay.

Only the fixed-Gregorian-date national holidays are seeded here. Islamic
lunar-calendar holidays (Eid-Ul-Fitr, Eid-Ul-Adha, Maulid) are deliberately
excluded: their 2026 dates depend on moon sighting and aren't confirmed by
an authoritative source. A web search attempt during planning surfaced a
~10-day discrepancy against MU's already-seeded Eid-Ul-Fitr date for what
should be the same global lunar event — guessing would put unverified dates
into statutory payroll data, so these three are left for a real source
(government gazette, or whoever supplied MU's dates) rather than estimated.

`observed_date` is set equal to `date` (no weekend-substitution rule applied)
since no such rule has been confirmed for Tanzania, unlike MU's Sunday-to-
Monday custom.
"""
from alembic import op
import sqlalchemy as sa


revision = "tanzania_holidays_2026_20260718"
down_revision = "tanzania_activate_20260718"
branch_labels = None
depends_on = None


_TZ_HOLIDAYS_2026 = [
    ("New Year's Day", "2026-01-01"),
    ("Zanzibar Revolution Day", "2026-01-12"),
    ("Karume Day", "2026-04-07"),
    ("Union Day (Muungano)", "2026-04-26"),
    ("International Workers' Day", "2026-05-01"),
    ("Saba Saba (Peasants' Day)", "2026-07-07"),
    ("Nane Nane (Farmers' Day)", "2026-08-08"),
    ("Nyerere Day", "2026-10-14"),
    ("Independence Day", "2026-12-09"),
    ("Christmas Day", "2026-12-25"),
    ("Boxing Day", "2026-12-26"),
]


def upgrade() -> None:
    conn = op.get_bind()
    for name, iso_date in _TZ_HOLIDAYS_2026:
        conn.execute(
            sa.text(
                """
                INSERT INTO public_holidays
                    (country_code, name, date, observed_date, year, is_recurring)
                VALUES
                    ('TZ', :name, :d, :d, 2026, TRUE)
                """
            ),
            {"name": name, "d": iso_date},
        )


def downgrade() -> None:
    op.execute("DELETE FROM public_holidays WHERE country_code = 'TZ' AND year = 2026")
