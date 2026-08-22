"""Best-effort backfill: flag managerial/director/head-of jobs as EXEMPT.

M1 milestone — admin reviews the report afterwards and corrects via the
admin UI (or follow-up SQL) before M4 production cutover.

Heuristic: matches `Job.job_title` against common managerial patterns.
False positives ("Project Manager" → exempt) are expected. The report
print-out lists every affected row so an HR/admin can override.

Run from backend/:
    .venv/bin/python -m scripts.backfill_overtime_eligibility
    .venv/bin/python -m scripts.backfill_overtime_eligibility --apply

Default is DRY-RUN (no DB writes). Pass --apply to commit.
"""

from __future__ import annotations

import argparse

from sqlalchemy.orm import Session
from sqlalchemy import or_

from core.config import get_db
from core.model import Job


# Title patterns commonly indicating managerial/exempt roles in MU.
EXEMPT_PATTERNS = (
    "%manager%",
    "%director%",
    "%head of%",
    "%chief executive%",
    "%chief financial%",
    "%chief operating%",
    "%chief technology%",
    "%CEO%",
    "%CFO%",
    "%COO%",
    "%CTO%",
    "%general manager%",
    "%vice president%",
    "% VP %",  # padded with spaces to avoid matching e.g. "TVP"
)


def find_candidates(db: Session):
    filters = [Job.job_title.ilike(pat) for pat in EXEMPT_PATTERNS]
    return (
        db.query(Job)
        .filter(Job.overtime_eligibility == "HOURLY")
        .filter(or_(*filters))
        .order_by(Job.company_id.asc(), Job.job_title.asc())
        .all()
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Commit changes; otherwise dry-run.")
    args = parser.parse_args()

    db: Session = next(get_db())
    try:
        candidates = find_candidates(db)
        print(f"Found {len(candidates)} HOURLY job(s) matching managerial title patterns.\n")
        print(f"{'job_id':>8}  {'company_id':>10}  {'job_title'}")
        print("-" * 80)
        for j in candidates:
            print(f"{j.job_id:>8}  {j.company_id or '-':>10}  {j.job_title}")
        print()

        if not args.apply:
            print("DRY-RUN. Re-run with --apply to set overtime_eligibility='EXEMPT' on the rows above.")
            return

        for j in candidates:
            j.overtime_eligibility = "EXEMPT"
        db.commit()
        print(f"APPLIED: {len(candidates)} job(s) set to EXEMPT.")
        print("Admin should review and correct any false positives via the admin UI.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
