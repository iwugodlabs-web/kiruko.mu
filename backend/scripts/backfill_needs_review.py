"""Backfill needs_review / exception_reasons for existing TimeLog rows.

The schema migration (timelog_review_by_exception_20260917) added the columns
as NULL; this runs the review-by-exception classifier over every row that is
not yet classified and persists the result.

Run from backend/:
    .venv/bin/python -m scripts.backfill_needs_review
    .venv/bin/python -m scripts.backfill_needs_review --apply

Default is DRY-RUN. Pass --apply to commit. Idempotent — rows already
classified (needs_review IS NOT NULL) are skipped.
"""

from __future__ import annotations

import argparse
from collections import Counter

from sqlalchemy.orm import Session, joinedload

from core.config import get_db
from core.model import TimeLog
from services.time_log_classifier import recompute


def find_candidates(db: Session):
    return (
        db.query(TimeLog)
        .options(joinedload(TimeLog.dispute))
        .filter(TimeLog.needs_review.is_(None))
        .order_by(TimeLog.timelog_id.asc())
        .all()
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Commit changes; otherwise dry-run.")
    parser.add_argument("--limit", type=int, default=None, help="Only process the first N rows.")
    args = parser.parse_args()

    db: Session = next(get_db())
    try:
        candidates = find_candidates(db)
        if args.limit is not None:
            candidates = candidates[: args.limit]
        print(f"Found {len(candidates)} unclassified TimeLog row(s).\n")

        reason_counts: Counter = Counter()
        needs_review_count = 0

        for tl in candidates:
            recompute(tl)
            if tl.needs_review:
                needs_review_count += 1
            for r in tl.exception_reasons or []:
                reason_counts[r] += 1

        print(f"needs_review=True: {needs_review_count}")
        print(f"needs_review=False: {len(candidates) - needs_review_count}")
        print("\nReason distribution:")
        for r, n in reason_counts.most_common():
            print(f"  {r:>28}  {n}")

        if not args.apply:
            print("\nDRY-RUN. Re-run with --apply to persist.")
            return

        db.commit()
        print(f"\nAPPLIED: classified {len(candidates)} row(s).")
    finally:
        db.close()


if __name__ == "__main__":
    main()
