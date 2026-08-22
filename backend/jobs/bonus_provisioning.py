"""Monthly cron entry point for bonus liability provisioning (M23).

Iterates every Company and calls services.bonus_provisioning.provision_for_month
for the month-just-ended (or a CLI-supplied year/month). Designed to run on
the first day of each month via a cron-like scheduler — schedule it AFTER
the prior month's payroll runs have been finalized so YTD earnings are
already in `payslips`.

Run from the command line:

    python -m jobs.bonus_provisioning              # last completed month
    python -m jobs.bonus_provisioning 2026 5       # explicit (year, month)

Failure isolation: per-company failures log + continue. Prevents one
company's bad data from blocking provisioning for the rest.
"""

from __future__ import annotations

import logging
import sys
from datetime import date

from sqlalchemy.orm import Session

from core import config
from core.model import Company
from services import bonus_provisioning


logger = logging.getLogger(__name__)


def _last_completed_month_today() -> tuple[int, int]:
    """Return (year, month) for the month before today's date.

    Run on the 1st of the month → returns (this_year, last_month).
    Run mid-month → returns (this_year, current_month - 1).
    """
    today = date.today()
    if today.month == 1:
        return today.year - 1, 12
    return today.year, today.month - 1


def run(year: int | None = None, month: int | None = None) -> dict:
    """Provision liability for one month across all companies.

    When `year`/`month` are None, defaults to the most recently completed
    calendar month. Returns an aggregate report.
    """
    if year is None or month is None:
        year, month = _last_completed_month_today()

    SessionLocal = config.get_session_local()
    if SessionLocal is None:
        raise RuntimeError("No DB session available — check POSTGRES_* env vars")

    db: Session = SessionLocal()
    aggregate = {
        "year": year,
        "month": month,
        "companies": 0,
        "succeeded": 0,
        "failed": 0,
        "total_liability_across_all": "0.00",
        "details": [],
    }
    try:
        companies = db.query(Company.company_id).all()
        aggregate["companies"] = len(companies)

        from decimal import Decimal
        total_across = Decimal("0.00")

        for (cid,) in companies:
            try:
                result = bonus_provisioning.provision_for_month(
                    db, company_id=cid, year=year, month=month
                )
                db.commit()
                total_across += Decimal(result["total_liability"])
                aggregate["succeeded"] += 1
                aggregate["details"].append(result)
                logger.info(
                    "bonus_provisioning: company %s — provisioned %s employees, liability %s",
                    cid, result["processed"], result["total_liability"],
                )
            except Exception as e:  # noqa: BLE001
                db.rollback()
                aggregate["failed"] += 1
                aggregate["details"].append({"company_id": cid, "error": str(e)})
                logger.exception(
                    "bonus_provisioning: company %s failed: %s", cid, e
                )

        aggregate["total_liability_across_all"] = str(total_across.quantize(Decimal("0.01")))
        return aggregate
    finally:
        db.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
    args = sys.argv[1:]
    if len(args) == 2:
        result = run(int(args[0]), int(args[1]))
    elif len(args) == 0:
        result = run()
    else:
        print("Usage: python -m jobs.bonus_provisioning [YEAR MONTH]", file=sys.stderr)
        sys.exit(2)

    import json
    print(json.dumps(result, indent=2))
