"""Backfill employee_code for existing company-scoped PrivateUsers.

New employees get a code at creation time (see
services/employee_code_service.py, wired into signup / bulk import / invite
acceptance / employee approval). This is a one-off for rows that existed
before that wiring went in.

Run from backend/:
    .venv/bin/python -m scripts.backfill_employee_codes
    .venv/bin/python -m scripts.backfill_employee_codes --apply

Default is DRY-RUN (no DB writes). Pass --apply to commit. Idempotent —
rows that already have a code are skipped.
"""

from __future__ import annotations

import argparse

from sqlalchemy.orm import Session

from core.config import get_db
from core.model import PrivateUser
from services.employee_code_service import ensure_employee_code


def find_candidates(db: Session):
    return (
        db.query(PrivateUser)
        .filter(PrivateUser.company_id.isnot(None))
        .filter(PrivateUser.employee_code.is_(None))
        .order_by(PrivateUser.company_id.asc(), PrivateUser.private_user_id.asc())
        .all()
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Commit changes; otherwise dry-run.")
    args = parser.parse_args()

    db: Session = next(get_db())
    try:
        candidates = find_candidates(db)
        print(f"Found {len(candidates)} company-scoped employee(s) without a code.\n")

        if not args.apply:
            print(f"{'private_user_id':>16}  {'company_id':>10}  name")
            print("-" * 60)
            for p in candidates:
                print(f"{p.private_user_id:>16}  {p.company_id:>10}  {p.first_name} {p.last_name}")
            print("\nDRY-RUN. Re-run with --apply to assign codes to the rows above.")
            return

        for p in candidates:
            ensure_employee_code(db, p)
            db.flush()  # so the next row's uniqueness check sees this one
        db.commit()
        print(f"APPLIED: assigned codes to {len(candidates)} row(s).")
    finally:
        db.close()


if __name__ == "__main__":
    main()
