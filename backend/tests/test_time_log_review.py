"""M3 — admin time-log review + dispute path + payroll wiring.

Coverage:
  * Bulk approve writes ONE AuditLog row covering all ids.
  * Reject without ≥20-char reason returns 422 (Pydantic validation).
  * Reject persists reason + emits a Notification per affected employee.
  * Employee can dispute only their own rejected log; ≥20-char comment.
  * Admin resolves dispute → 'approved' flips log back to admin_approved.
  * Engine: when company.require_approved_clockins_for_payroll=true,
    proration.sum_hours_worked_in_period(require_approved=True) excludes
    unapproved hours.
"""

from __future__ import annotations

from datetime import datetime, timezone, time, date
from decimal import Decimal as D

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _setup(db: Session) -> dict:
    """Owner + employee + job + 3 time-logs for the same week.
    Two of the logs are unapproved-pending; one is unapproved-rejected
    (set up by the dispute test which expects this state)."""
    from core.model import (
        Company,
        Job,
        PrivateUser,
        TimeLog,
        User,
    )

    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    db.commit()

    suffix = datetime.utcnow().strftime("%H%M%S%f")

    owner = User(
        user_type="company",
        email=f"tl-owner-{suffix}@kontokaz.test",
        user_name=f"tl-owner-{suffix}",
        password_hash="x",
    )
    db.add(owner)
    db.flush()

    co = Company(
        user_id=owner.user_id,
        company_name=f"TL Co {suffix}",
        email=f"tl-{suffix}@kontokaz.test",
        brn=f"TL_BRN_{suffix}",
        country_code="MU",
    )
    db.add(co)
    db.flush()

    emp_user = User(
        user_type="private",
        email=f"tl-emp-{suffix}@kontokaz.test",
        user_name=f"tl-emp-{suffix}",
        password_hash="x",
    )
    db.add(emp_user)
    db.flush()

    priv = PrivateUser(
        user_id=emp_user.user_id,
        first_name="Time",
        last_name="Logger",
        company_id=co.company_id,
        role="employee",
    )
    db.add(priv)
    db.flush()

    job = Job(
        private_user_id=priv.private_user_id,
        company_id=co.company_id,
        job_title="Tester",
        employer_name="TL Co",
        employer_brn=co.brn,
        has_contract=True,
        has_permission_to_work=True,
        working_on_tourist_visa=False,
        is_salary_deducted=False,
        is_accommodation_covered_by_employer=False,
        is_accommodation_a_dormitory=False,
        is_accommodation_decent=True,
        is_passport_retained=False,
        is_job_execution_same_as_description=True,
        doubts_about_compensation=False,
    )
    db.add(job)
    db.flush()

    # Three logs in early April 2026 — fresh rows default admin_approved=false.
    # Day 2 is flagged late with an employee-submitted reason (mirrors the
    # mobile late-start modal) so tests can assert it's surfaced on review.
    logs = []
    for day in (1, 2, 3):
        tl = TimeLog(
            job_id=job.job_id,
            private_user_id=priv.private_user_id,
            day_of_week="Wednesday",
            start_time=datetime(2026, 4, day, 9, 0, tzinfo=timezone.utc),
            end_time=datetime(2026, 4, day, 17, 0, tzinfo=timezone.utc),
            location={"lat": 0, "lng": 0},
            hours_worked=D("8.00"),
            admin_approved=False,
            is_late=(day == 2),
            late_reason="Bus was delayed" if day == 2 else None,
        )
        db.add(tl)
        logs.append(tl)
    db.commit()

    return {
        "owner_user_id": owner.user_id,
        "owner_email": owner.email,
        "company_id": co.company_id,
        "emp_user_id": emp_user.user_id,
        "emp_email": emp_user.email,
        "priv_id": priv.private_user_id,
        "job_id": job.job_id,
        "tl_ids": [tl.timelog_id for tl in logs],
        "suffix": suffix,
    }


def _cleanup(db: Session, ctx: dict) -> None:
    db.rollback()
    db.execute(
        sql_text(
            "DELETE FROM time_log_disputes WHERE time_log_id = ANY(:ids)"
        ),
        {"ids": ctx["tl_ids"]},
    )
    db.execute(
        sql_text("DELETE FROM time_logs WHERE timelog_id = ANY(:ids)"),
        {"ids": ctx["tl_ids"]},
    )
    db.execute(
        sql_text("DELETE FROM jobs WHERE job_id=:j"),
        {"j": ctx["job_id"]},
    )
    db.execute(
        sql_text(
            "DELETE FROM notifications WHERE notification_id IN "
            "(SELECT notification_id FROM notification_recipients WHERE user_id=:u)"
        ),
        {"u": ctx["emp_user_id"]},
    )
    # audit_logs has WORM triggers (audit_log_indexes_20260512). The whole
    # remainder of teardown runs inside the unlock context because
    # DELETE FROM users cascades an ON DELETE SET NULL update to
    # audit_logs.actor_user_id, which hits the BEFORE UPDATE trigger.
    from tests.conftest import audit_logs_unlocked
    with audit_logs_unlocked(db):
        db.execute(
            sql_text("DELETE FROM audit_logs WHERE actor_user_id=:u"),
            {"u": ctx["owner_user_id"]},
        )
        db.execute(
            sql_text("DELETE FROM private_users WHERE user_id=:u"),
            {"u": ctx["emp_user_id"]},
        )
        db.execute(
            sql_text("DELETE FROM companies WHERE company_id=:c"),
            {"c": ctx["company_id"]},
        )
        db.execute(
            sql_text("DELETE FROM users WHERE email IN (:e1, :e2)"),
            {"e1": ctx["owner_email"], "e2": ctx["emp_email"]},
        )
        db.commit()


def _client(_engine, current_user_id: int) -> TestClient:
    from fastapi import Depends as _Depends
    from sqlalchemy.orm import Session, sessionmaker
    from core import config as core_config
    from core.dependencies import get_current_user
    from core.model import User
    from main import app

    SessionFactory = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

    def _override_db():
        s = SessionFactory()
        try:
            yield s
        finally:
            s.close()

    def _override_user(db: Session = _Depends(core_config.get_db)) -> User:
        return db.query(User).filter(User.user_id == current_user_id).one()

    app.dependency_overrides[core_config.get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_user
    return TestClient(app, raise_server_exceptions=False)


def _clear() -> None:
    from main import app
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestLateReasonSurfaced:
    """The employee's late-start reason (collected via a mobile modal, saved
    to TimeLog.late_reason) must reach the Clock-in review list — this was
    the actual bug: the field existed in the DB but the review endpoint
    never returned it, so HR never saw what the employee wrote."""

    def test_list_surfaces_is_late_and_reason(self, db: Session, _engine):
        ctx = _setup(db)
        try:
            client = _client(_engine, ctx["owner_user_id"])
            try:
                resp = client.get(
                    f"/api/v1/companies/{ctx['company_id']}/time-logs",
                    params={"month": "2026-04"},
                )
                assert resp.status_code == 200, resp.text
                rows = {r["timelog_id"]: r for r in resp.json()}
                late_row = rows[ctx["tl_ids"][1]]  # day 2, flagged late
                assert late_row["is_late"] is True
                assert late_row["late_reason"] == "Bus was delayed"

                normal_row = rows[ctx["tl_ids"][0]]  # day 1, not late
                assert normal_row["is_late"] is False
                assert normal_row["late_reason"] is None
            finally:
                _clear()
        finally:
            _cleanup(db, ctx)


class TestBulkApproveAuditVolume:
    def test_bulk_approve_writes_single_audit_row(self, db: Session, _engine):
        ctx = _setup(db)
        try:
            client = _client(_engine, ctx["owner_user_id"])
            try:
                resp = client.post(
                    f"/api/v1/companies/{ctx['company_id']}/time-logs/approve",
                    json={"time_log_ids": ctx["tl_ids"]},
                )
                assert resp.status_code == 200, resp.text
                body = resp.json()
                assert body["approved_count"] == 3
                assert body["audit_log_id"] is not None
            finally:
                _clear()

            n = db.execute(
                sql_text(
                    "SELECT COUNT(*) FROM audit_logs "
                    "WHERE action='time_log.bulk_approve' "
                    "AND actor_user_id=:u"
                ),
                {"u": ctx["owner_user_id"]},
            ).scalar()
            assert n == 1, "expected exactly one audit row for the bulk approve"
        finally:
            _cleanup(db, ctx)


class TestRejectValidation:
    def test_reject_without_long_reason_422(self, db: Session, _engine):
        ctx = _setup(db)
        try:
            client = _client(_engine, ctx["owner_user_id"])
            try:
                resp = client.post(
                    f"/api/v1/companies/{ctx['company_id']}/time-logs/reject",
                    json={"time_log_ids": ctx["tl_ids"], "reason": "too short"},
                )
                # Pydantic rejects min_length violations with 422.
                assert resp.status_code == 422, resp.text
            finally:
                _clear()
        finally:
            _cleanup(db, ctx)

    def test_reject_persists_reason_and_notifies(self, db: Session, _engine):
        ctx = _setup(db)
        try:
            client = _client(_engine, ctx["owner_user_id"])
            try:
                resp = client.post(
                    f"/api/v1/companies/{ctx['company_id']}/time-logs/reject",
                    json={
                        "time_log_ids": [ctx["tl_ids"][0]],
                        "reason": "Hours not consistent with shift schedule today",
                    },
                )
                assert resp.status_code == 200, resp.text
                body = resp.json()
                assert body["rejected_count"] == 1
                assert body["notifications_sent"] == 1
            finally:
                _clear()

            row = db.execute(
                sql_text(
                    "SELECT admin_rejected, admin_rejected_reason "
                    "FROM time_logs WHERE timelog_id=:i"
                ),
                {"i": ctx["tl_ids"][0]},
            ).fetchone()
            assert row[0] is True
            assert "shift schedule" in row[1]

            n = db.execute(
                sql_text(
                    "SELECT COUNT(*) FROM notification_recipients r "
                    "JOIN notifications n ON n.notification_id = r.notification_id "
                    "WHERE r.user_id=:u AND n.type='time_log.rejected'"
                ),
                {"u": ctx["emp_user_id"]},
            ).scalar()
            assert n == 1
        finally:
            _cleanup(db, ctx)


class TestDispute:
    def test_employee_can_dispute_rejected_log(self, db: Session, _engine):
        ctx = _setup(db)
        try:
            # Reject one log first (as admin)
            client = _client(_engine, ctx["owner_user_id"])
            try:
                resp = client.post(
                    f"/api/v1/companies/{ctx['company_id']}/time-logs/reject",
                    json={
                        "time_log_ids": [ctx["tl_ids"][0]],
                        "reason": "Hours not consistent with shift schedule today",
                    },
                )
                assert resp.status_code == 200
            finally:
                _clear()

            # Employee disputes
            client = _client(_engine, ctx["emp_user_id"])
            try:
                resp = client.post(
                    f"/api/v1/time-logs/{ctx['tl_ids'][0]}/dispute",
                    json={"comment": "I worked the full shift; my clock-out failed mid-shift due to bad signal."},
                )
                assert resp.status_code == 200, resp.text
                assert resp.json()["resolution"] == "pending"
            finally:
                _clear()
        finally:
            _cleanup(db, ctx)

    def test_admin_resolves_dispute_approved_flips_log(self, db: Session, _engine):
        ctx = _setup(db)
        try:
            client = _client(_engine, ctx["owner_user_id"])
            try:
                client.post(
                    f"/api/v1/companies/{ctx['company_id']}/time-logs/reject",
                    json={
                        "time_log_ids": [ctx["tl_ids"][0]],
                        "reason": "Hours not consistent with shift schedule today",
                    },
                )
            finally:
                _clear()

            client = _client(_engine, ctx["emp_user_id"])
            try:
                client.post(
                    f"/api/v1/time-logs/{ctx['tl_ids'][0]}/dispute",
                    json={"comment": "I worked the full shift; my clock-out failed mid-shift due to bad signal."},
                )
            finally:
                _clear()

            client = _client(_engine, ctx["owner_user_id"])
            try:
                resp = client.post(
                    f"/api/v1/time-logs/{ctx['tl_ids'][0]}/dispute/resolve",
                    json={
                        "decision": "approved",
                        "admin_response": "Verified with site supervisor",
                    },
                )
                assert resp.status_code == 200, resp.text
                assert resp.json()["resolution"] == "approved"
            finally:
                _clear()

            row = db.execute(
                sql_text(
                    "SELECT admin_approved, admin_rejected "
                    "FROM time_logs WHERE timelog_id=:i"
                ),
                {"i": ctx["tl_ids"][0]},
            ).fetchone()
            assert row[0] is True, "admin_approved should be true after dispute approved"
            assert row[1] is False, "admin_rejected should be cleared"
        finally:
            _cleanup(db, ctx)


class TestPatchTimeLog:
    def test_patch_recomputes_hours_worked_when_times_change(self, db: Session, _engine):
        ctx = _setup(db)
        try:
            client = _client(_engine, ctx["owner_user_id"])
            try:
                # Original log is 09:00-17:00 (8.00h). Move end_time to 18:30
                # without sending hours_worked — the server should recompute it.
                resp = client.patch(
                    f"/api/v1/time-logs/{ctx['tl_ids'][0]}",
                    json={"end_time": "2026-04-01T18:30:00Z"},
                )
                assert resp.status_code == 200, resp.text
                assert resp.json()["hours_worked"] == 9.5
            finally:
                _clear()
        finally:
            _cleanup(db, ctx)

    def test_patch_rejects_end_before_start(self, db: Session, _engine):
        ctx = _setup(db)
        try:
            client = _client(_engine, ctx["owner_user_id"])
            try:
                resp = client.patch(
                    f"/api/v1/time-logs/{ctx['tl_ids'][0]}",
                    json={"end_time": "2026-04-01T08:00:00Z"},
                )
                assert resp.status_code == 400, resp.text
            finally:
                _clear()
        finally:
            _cleanup(db, ctx)

    def test_patch_resets_approved_log_to_pending(self, db: Session, _engine):
        ctx = _setup(db)
        try:
            client = _client(_engine, ctx["owner_user_id"])
            try:
                approve = client.post(
                    f"/api/v1/companies/{ctx['company_id']}/time-logs/approve",
                    json={"time_log_ids": [ctx["tl_ids"][0]]},
                )
                assert approve.status_code == 200, approve.text

                resp = client.patch(
                    f"/api/v1/time-logs/{ctx['tl_ids'][0]}",
                    json={"end_time": "2026-04-01T18:00:00Z"},
                )
                assert resp.status_code == 200, resp.text
                assert resp.json()["admin_approved"] is False
            finally:
                _clear()

            n = db.execute(
                sql_text(
                    "SELECT COUNT(*) FROM audit_logs "
                    "WHERE action='time_log.edit' AND target_id=:t"
                ),
                {"t": str(ctx["tl_ids"][0])},
            ).scalar()
            assert n == 1
        finally:
            _cleanup(db, ctx)

    def test_patch_rejects_overlap_with_another_log(self, db: Session, _engine):
        """The actual gap this guards: an admin hand-correcting one log's
        times must not be allowed to land it on top of another closed log
        for the same employee. Day 1 is 09:00-17:00; edit day 2 (also
        09:00-17:00) to start at 08:00 the same day as day 1 ends — no
        overlap there, so instead push day 2's start back to overlap day
        1 directly by moving it onto day 1's date."""
        ctx = _setup(db)
        try:
            client = _client(_engine, ctx["owner_user_id"])
            try:
                resp = client.patch(
                    f"/api/v1/time-logs/{ctx['tl_ids'][1]}",
                    json={
                        "start_time": "2026-04-01T12:00:00Z",
                        "end_time": "2026-04-01T14:00:00Z",
                    },
                )
                assert resp.status_code == 409, resp.text
                assert str(ctx["tl_ids"][0]) in resp.text
            finally:
                _clear()
        finally:
            _cleanup(db, ctx)

    def test_patch_allows_adjacent_edit(self, db: Session, _engine):
        """Regression guard: back-to-back logs (one ends exactly when the
        other starts) are a normal pattern, not an overlap."""
        ctx = _setup(db)
        try:
            client = _client(_engine, ctx["owner_user_id"])
            try:
                resp = client.patch(
                    f"/api/v1/time-logs/{ctx['tl_ids'][1]}",
                    json={
                        "start_time": "2026-04-01T17:00:00Z",
                        "end_time": "2026-04-01T20:00:00Z",
                    },
                )
                assert resp.status_code == 200, resp.text
            finally:
                _clear()
        finally:
            _cleanup(db, ctx)

    def test_patch_blocks_edit_inside_finalized_period(self, db: Session, _engine):
        from core.model import PayrollRun

        ctx = _setup(db)
        run = PayrollRun(
            company_id=ctx["company_id"],
            period_start=date(2026, 4, 1),
            period_end=date(2026, 4, 30),
            status="finalized",
        )
        db.add(run)
        db.commit()
        try:
            client = _client(_engine, ctx["owner_user_id"])
            try:
                resp = client.patch(
                    f"/api/v1/time-logs/{ctx['tl_ids'][0]}",
                    json={"end_time": "2026-04-01T18:00:00Z"},
                )
                assert resp.status_code == 409, resp.text
            finally:
                _clear()
        finally:
            db.execute(sql_text("DELETE FROM payroll_runs WHERE id=:i"), {"i": run.id})
            db.commit()
            _cleanup(db, ctx)


class TestProrationApprovalGate:
    def test_require_approved_filters_unapproved_hours(self, db: Session):
        ctx = _setup(db)
        try:
            from services.proration import sum_hours_worked_in_period

            # Logs default admin_approved=false. With the gate off:
            total_off = sum_hours_worked_in_period(
                db,
                private_user_id=ctx["priv_id"],
                period_start=date(2026, 4, 1),
                period_end=date(2026, 4, 30),
                require_approved=False,
            )
            assert total_off == D("24.00"), f"expected 24h, got {total_off}"

            # With the gate on but no approvals yet:
            total_on = sum_hours_worked_in_period(
                db,
                private_user_id=ctx["priv_id"],
                period_start=date(2026, 4, 1),
                period_end=date(2026, 4, 30),
                require_approved=True,
            )
            assert total_on == D("0.00"), f"expected 0h, got {total_on}"

            # Approve one log → gate-on returns 8h.
            db.execute(
                sql_text(
                    "UPDATE time_logs SET admin_approved=true, admin_approved_at=NOW() "
                    "WHERE timelog_id=:i"
                ),
                {"i": ctx["tl_ids"][0]},
            )
            db.commit()

            total_partial = sum_hours_worked_in_period(
                db,
                private_user_id=ctx["priv_id"],
                period_start=date(2026, 4, 1),
                period_end=date(2026, 4, 30),
                require_approved=True,
            )
            assert total_partial == D("8.00")
        finally:
            _cleanup(db, ctx)


class TestProrationOvertimeGate:
    """Pending or rejected overtime must not feed payroll. Only OT rows where
    the employer has explicitly confirmed are summed."""

    def test_unapproved_overtime_excluded_from_payroll_hours(self, db: Session):
        ctx = _setup(db)
        try:
            from services.proration import sum_hours_worked_in_period

            # Baseline: 3x 8h logs = 24h, all admin-approved (gate off so we
            # isolate the overtime axis from the admin-approval axis).
            db.execute(
                sql_text(
                    "UPDATE time_logs SET admin_approved=true, admin_approved_at=NOW() "
                    "WHERE timelog_id = ANY(:ids)"
                ),
                {"ids": ctx["tl_ids"]},
            )
            db.commit()

            base = sum_hours_worked_in_period(
                db,
                private_user_id=ctx["priv_id"],
                period_start=date(2026, 4, 1),
                period_end=date(2026, 4, 30),
            )
            assert base == D("24.00")

            # Flag log #2 as pending overtime (is_overtime=true, no confirmation).
            # Expected: drops out of the sum entirely → 16h.
            db.execute(
                sql_text(
                    "UPDATE time_logs SET is_overtime=true, marked_as_overtime_at=NOW() "
                    "WHERE timelog_id=:i"
                ),
                {"i": ctx["tl_ids"][1]},
            )
            db.commit()

            pending = sum_hours_worked_in_period(
                db,
                private_user_id=ctx["priv_id"],
                period_start=date(2026, 4, 1),
                period_end=date(2026, 4, 30),
            )
            assert pending == D("16.00"), f"pending OT must be excluded; got {pending}"

            # Reject log #3's overtime → still excluded.
            db.execute(
                sql_text(
                    "UPDATE time_logs SET is_overtime=true, overtime_rejected=true, "
                    "marked_as_overtime_at=NOW() WHERE timelog_id=:i"
                ),
                {"i": ctx["tl_ids"][2]},
            )
            db.commit()

            after_reject = sum_hours_worked_in_period(
                db,
                private_user_id=ctx["priv_id"],
                period_start=date(2026, 4, 1),
                period_end=date(2026, 4, 30),
            )
            assert after_reject == D("8.00"), f"rejected OT must be excluded; got {after_reject}"

            # Confirm log #2's overtime → now back in the sum.
            db.execute(
                sql_text(
                    "UPDATE time_logs SET overtime_confirmed_by_employer=true "
                    "WHERE timelog_id=:i"
                ),
                {"i": ctx["tl_ids"][1]},
            )
            db.commit()

            after_confirm = sum_hours_worked_in_period(
                db,
                private_user_id=ctx["priv_id"],
                period_start=date(2026, 4, 1),
                period_end=date(2026, 4, 30),
            )
            assert after_confirm == D("16.00"), f"confirmed OT must be included; got {after_confirm}"
        finally:
            _cleanup(db, ctx)
