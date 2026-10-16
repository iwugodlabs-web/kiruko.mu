"""one-time backfill: legacy salaries -> structured salary assignments

Revision ID: payroll_backfill_20260924
Revises: payroll_mkck_20260923
Create Date: 2026-09-24

DATA migration (runs exactly once, tracked by alembic — never re-runs). Converts
every legacy `salaries` row that has no structured EmployeeSalaryAssignment into
one, via the same bootstrap the onboarding/approval endpoints use, so monthly
staff set up the old way stop being silently dropped from payroll runs.

Runs AFTER the payroll schema migrations (member-status, off-payroll, gate,
maker-checker) so every column the ORM touches already exists.

Safety:
  * ADDITIVE ONLY — creates assignment/structure rows; never updates or deletes
    existing pay; the legacy `salaries` table is left untouched.
  * ISOLATED — one SAVEPOINT per employee, so a single bad record is skipped
    (logged) without aborting the whole migration or discarding prior work.
  * IDEMPOTENT — the bootstrap skips anyone already covered, so a fresh DB that
    already creates assignments at onboarding backfills nothing.
  * REVERSIBLE — every row is tagged notes='Backfilled from legacy salaries
    row'; downgrade() deletes exactly those.

Ongoing (post-backlog) coverage is handled at the source: job approval / onboard
already call ensure_assignment_from_legacy, so NEW employees never need this.
"""
from alembic import op
from sqlalchemy.orm import Session


revision = "payroll_backfill_20260924"
down_revision = "payroll_mkck_20260923"
branch_labels = None
depends_on = None

_NOTE = "Backfilled from legacy salaries row"


def upgrade() -> None:
    from core.model import EmployeeSalaryAssignment, Job, Salary
    from services.salary_assignment_bootstrap import ensure_assignment_from_legacy

    session = Session(bind=op.get_bind())

    legacy_rows = session.query(Salary).order_by(Salary.salary_id).all()
    pre_ids = {r[0] for r in session.query(EmployeeSalaryAssignment.id).all()}
    seen: set = set()
    created = 0
    covered = 0
    skipped = 0
    for row in legacy_rows:
        job = session.query(Job).filter(Job.job_id == row.job_id).one_or_none()
        if job is None:
            continue
        pid = job.private_user_id
        if pid in seen:
            continue
        seen.add(pid)
        try:
            # SAVEPOINT per employee — a flush error (e.g. a stray constraint on
            # one company) rolls back just this record, not the whole migration.
            with session.begin_nested():
                asg = ensure_assignment_from_legacy(session, pid, notes=_NOTE)
            if asg is None:
                skipped += 1  # not eligible (no job/salary/company, or onboarding-draft)
            elif asg.id in pre_ids:
                covered += 1  # already had an assignment — idempotent no-op
            else:
                created += 1
        except Exception as exc:  # noqa: BLE001 — one bad record must not abort the backfill
            skipped += 1
            print(f"[backfill 20260924] skip private_user_id={pid}: {exc}")

    # No session.commit() — alembic commits the migration's transaction, which
    # includes these flushed writes.
    print(
        f"[backfill 20260924] {created} assignment(s) created, "
        f"{covered} already covered, {skipped} skipped."
    )


def downgrade() -> None:
    # Remove only what this backfill created (identified by the note). The
    # auto-created per-employee structures are harmless if left behind.
    op.execute(
        "DELETE FROM employee_salary_assignments WHERE notes = 'Backfilled from legacy salaries row'"
    )
