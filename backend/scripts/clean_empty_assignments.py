"""Delete EmployeeSalaryAssignment rows that have neither a structure nor
any overrides — i.e. assignments the payroll engine can't resolve.

These rows can only exist on databases created before the API guard in
`create_assignment` (added 2026-05-19), or via direct DB writes. They are
useless and confuse the salary-preview UI by surfacing as "Assignment #N
exists but has no structure attached".

Run from backend/:
    .venv/bin/python -m scripts.clean_empty_assignments              # dry-run
    .venv/bin/python -m scripts.clean_empty_assignments --apply       # delete

The dry-run prints what would be deleted but commits nothing. Pass --apply
to actually delete. The script never deletes an assignment that has at
least one override row, even if structure_id is null — that's a valid
"overrides-only" assignment shape.
"""

from __future__ import annotations

import argparse
import sys

from sqlalchemy import func
from sqlalchemy.orm import Session

from core.config import get_db
from core.model import EmployeeSalaryAssignment, EmployeeSalaryOverride


def find_empty_assignments(db: Session) -> list[EmployeeSalaryAssignment]:
    """Assignments with no structure AND no overrides — nothing to resolve."""
    return (
        db.query(EmployeeSalaryAssignment)
        .outerjoin(
            EmployeeSalaryOverride,
            EmployeeSalaryOverride.assignment_id == EmployeeSalaryAssignment.id,
        )
        .filter(EmployeeSalaryAssignment.structure_id.is_(None))
        .group_by(EmployeeSalaryAssignment.id)
        .having(func.count(EmployeeSalaryOverride.id) == 0)
        .all()
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually delete. Without this flag the script only prints what would be deleted.",
    )
    args = parser.parse_args()

    db: Session = next(get_db())
    try:
        rows = find_empty_assignments(db)
        if not rows:
            print("✓ No empty assignments found. Nothing to do.")
            return

        print(f"Found {len(rows)} empty assignment(s):")
        for a in rows:
            print(
                f"  id={a.id}  private_user_id={a.private_user_id}  "
                f"effective_from={a.effective_from}  effective_to={a.effective_to}  "
                f"created_at={a.created_at}"
            )

        if not args.apply:
            print(
                "\nDry-run — nothing deleted. "
                "Re-run with --apply to delete these rows."
            )
            return

        for a in rows:
            db.delete(a)
        db.commit()
        print(f"\n✅ Deleted {len(rows)} empty assignment(s).")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
    sys.exit(0)
