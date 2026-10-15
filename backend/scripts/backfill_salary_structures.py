"""Backfill the new salary-structure model from legacy `salaries` rows.

Delegates per-employee to `services.salary_assignment_bootstrap.ensure_assignment_from_legacy`
(the same helper the approve/onboard endpoints call), so batch backfill and
online onboarding converge on one implementation.

For each existing `salaries` row with no active assignment:
  * Ensure the company has BASIC and ALLOWANCE SalaryComponents.
  * Create (or reuse) a per-employee SalaryStructure named "Salary <employee_id>".
  * Add structure lines for BASIC=salary, ALLOWANCE=allowance.
  * Create an assignment with effective_from = first_date_of_employment
    (or today when the job has no start date).

Skips (with a reason): missing job/user, no company link, onboarding-draft
job, no legacy salary row, or an assignment already in force.

The legacy `salaries` table is left in place and unchanged.

Run:
    .venv/bin/python -m scripts.backfill_salary_structures
"""

from __future__ import annotations

from core.config import get_db
from core.model import Salary
from services.salary_assignment_bootstrap import ensure_assignment_from_legacy


def main() -> None:
    db = next(get_db())
    try:
        legacy_rows = db.query(Salary).order_by(Salary.salary_id).all()
        print(f"Found {len(legacy_rows)} legacy salary rows.")
        seen: set[int] = set()
        new_count = 0
        for row in legacy_rows:
            from core.model import Job

            job = db.query(Job).filter(Job.job_id == row.job_id).one_or_none()
            if job is None:
                print(f"  skip salary_id={row.salary_id}: job missing")
                continue
            pid = job.private_user_id
            if pid in seen:
                continue
            seen.add(pid)
            try:
                created = ensure_assignment_from_legacy(
                    db, pid, notes="Backfilled from legacy salaries row"
                )
            except Exception as exc:
                db.rollback()
                print(f"  skip private_user_id={pid}: {exc}")
                continue
            if created is None:
                print(f"  skip private_user_id={pid}: already covered or not eligible")
            else:
                new_count += 1
                print(f"  ok private_user_id={pid}: assignment_id={created.id}")
        db.commit()
        print(f"\nBackfill complete: {new_count} new assignment(s) created.")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
