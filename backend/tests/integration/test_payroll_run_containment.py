"""create_draft_run must not let ONE employee's data problem abort payroll
for the whole company.

overtime_engine._assert_no_overlaps (defense-in-depth against overlapping
closed TimeLog rows reaching payroll compute) raises a bare ValueError with
no try/except anywhere above it in the per-employee loop — before this fix,
that exception propagated straight out of create_draft_run, so a single bad
employee record blocked draft-run creation for every other employee in the
company too. This reuses the real import + payroll pipeline (same harness
as test_payroll_scenarios.py) to prove: the run still succeeds, the clean
employee still gets paid, the bad employee is excluded with a flag, and an
admin notification fires.
"""
from datetime import date, datetime, time, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from core.model import Notification, TimeLog
from tests.integration.test_payroll_scenarios import (
    PERIOD_END,
    PERIOD_START,
    _company,
    _import_employee,
    _run,
    _set_hourly,
)


def _overlapping_closed_logs(db: Session, private_user_id: int, job_id: int) -> None:
    """Two CLOSED TimeLog rows that directly overlap, inserted raw via the
    ORM — bypassing create_time_log/update_time_log/patch_time_log's new
    write-time guard entirely, the same way genuinely pre-existing bad data
    (from before the guard existed, or any future path that still writes
    TimeLog directly) would reach payroll compute."""
    d = date(2026, 5, 6)
    db.add(TimeLog(
        job_id=job_id, private_user_id=private_user_id,
        day_of_week=d.strftime("%A"),
        start_time=datetime.combine(d, time(9, 0), tzinfo=timezone.utc),
        end_time=datetime.combine(d, time(17, 0), tzinfo=timezone.utc),
        location={}, admin_approved=True,
    ))
    db.add(TimeLog(
        job_id=job_id, private_user_id=private_user_id,
        day_of_week=d.strftime("%A"),
        start_time=datetime.combine(d, time(12, 0), tzinfo=timezone.utc),
        end_time=datetime.combine(d, time(14, 0), tzinfo=timezone.utc),
        location={}, admin_approved=True,
    ))
    db.commit()


def test_one_bad_employee_does_not_block_the_whole_run(db: Session, seed_mu_rules):
    co = _company(db, require_approved=True)
    pu_good, job_good = _import_employee(db, co.company_id, base_salary="30000")
    pu_bad, job_bad = _import_employee(db, co.company_id, base_salary="30000")
    _set_hourly(db, job_good, "150")
    _set_hourly(db, job_bad, "150")

    # Good employee: one normal closed shift, no overlap.
    db.add(TimeLog(
        job_id=job_good.job_id, private_user_id=pu_good.private_user_id,
        day_of_week="Wednesday",
        start_time=datetime.combine(date(2026, 5, 6), time(9, 0), tzinfo=timezone.utc),
        end_time=datetime.combine(date(2026, 5, 6), time(17, 0), tzinfo=timezone.utc),
        location={}, admin_approved=True,
    ))
    db.commit()

    # Bad employee: pre-existing overlapping closed logs (simulates data that
    # predates the write-time guard, or slipped in some other way).
    _overlapping_closed_logs(db, pu_bad.private_user_id, job_bad.job_id)

    payslips = _run(db, co, [pu_good.private_user_id, pu_bad.private_user_id])

    # The run succeeded at all — this is the headline assertion. Before the
    # fix, create_draft_run raised ValueError here and no run was created.
    assert pu_good.private_user_id in payslips
    assert Decimal(payslips[pu_good.private_user_id].gross) == Decimal("1200.00")  # 8h * 150

    # The bad employee got no payslip, but didn't take the good one down.
    assert pu_bad.private_user_id not in payslips

    from core.model import PayrollRun
    run = (
        db.query(PayrollRun)
        .filter(PayrollRun.company_id == co.company_id)
        .order_by(PayrollRun.id.desc())
        .first()
    )
    flags = run.compliance_flags or []
    assert any(
        f.startswith(f"u{pu_bad.private_user_id}:data_error:") for f in flags
    ), flags

    # Admin notification fired.
    notif = (
        db.query(Notification)
        .filter(
            Notification.company_id == co.company_id,
            Notification.type == "payroll_run_employees_skipped",
        )
        .order_by(Notification.notification_id.desc())
        .first()
    )
    assert notif is not None
    assert str(pu_bad.private_user_id) in str(notif.meta)
