"""Backfill structure_snapshot on every existing EmployeeSalaryAssignment (M3).

Run once after applying the assignment_snapshot_20260428 migration. Safe to
re-run — it only writes the snapshot for rows where
`structure_snapshot IS NULL` and `structure_id IS NOT NULL`.

After this script runs, every assignment has a frozen view of its structure.
The resolver always reads from the snapshot. Future structure edits affect
new assignments only.

Run from backend/:
    .venv/bin/python -m scripts.backfill_assignment_snapshots
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from core.config import get_db
from core.model import EmployeeSalaryAssignment
from services.salary_resolver import build_structure_snapshot


def main() -> None:
    db: Session = next(get_db())
    try:
        rows = (
            db.query(EmployeeSalaryAssignment)
            .filter(
                EmployeeSalaryAssignment.structure_id.isnot(None),
                EmployeeSalaryAssignment.structure_snapshot.is_(None),
            )
            .all()
        )
        print(f"Found {len(rows)} assignments without a snapshot.")
        ok = 0
        for a in rows:
            snap = build_structure_snapshot(db, a.structure_id)
            if snap is None:
                print(f"  skip id={a.id}: structure {a.structure_id} not found")
                continue
            a.structure_snapshot = snap
            ok += 1
        db.commit()
        print(f"✅ Backfilled {ok} snapshot(s).")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
