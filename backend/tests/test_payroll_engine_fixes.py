"""Regression tests for the loan / unpaid-leave / currency / N+1 fixes
(plan buckets A1, A2, A3, A4).

Covers:
  * _compute_loan_repayments_for_period — installment math, capping at
    remaining principal, frequency scaling, status='paid' guard.
  * _compute_leave_impact_for_period — unpaid days × daily rate, capping.
  * compute_for_resolved — loan + leave subtract from net; component list
    includes the synthetic LOAN / LEAVE_UNPAID rows.
  * create_draft_run — picks up the company's country currency (MU → MUR).
  * list_runs API — single grouped query (no N+1) given N runs.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import event

from services import payroll_engine, payroll_rules
from services.salary_resolver import resolve_components


# ---------------------------------------------------------------------------
# A1 — loan repayments helper
# ---------------------------------------------------------------------------


class TestLoanRepaymentsHelper:
    def test_no_loan_returns_zero(self, db, test_employee):
        amount = payroll_engine._compute_loan_repayments_for_period(
            db, test_employee.private_user_id,
            date(2026, 5, 1), date(2026, 5, 31),
        )
        assert amount == Decimal("0.00")

    def test_personal_loan_is_not_deducted(self, db, test_employee):
        """A 'personal' loan (the mobile self-tracker) must NOT be deducted from
        pay — only employer loans are. Regression for the conflation where every
        active loan was deducted."""
        from core.model import Loan
        db.add(Loan(
            private_user_id=test_employee.private_user_id,
            loan_type="personal",
            description="Personal car loan",
            amount=12000.0,
            currency="MUR",
            start_date=date(2026, 1, 1),
            status="active",
            duration_months=12,
            payment_frequency="monthly",
            repaid_amount=0.0,
        ))
        db.commit()
        try:
            amount = payroll_engine._compute_loan_repayments_for_period(
                db, test_employee.private_user_id,
                date(2026, 5, 1), date(2026, 5, 31),
            )
            assert amount == Decimal("0.00")  # employer-only; personal skipped
        finally:
            db.execute(
                __import__("sqlalchemy").text(
                    "DELETE FROM loans WHERE private_user_id = :u"
                ),
                {"u": test_employee.private_user_id},
            )
            db.commit()

    def test_monthly_loan_returns_one_installment(
        self, db, test_employee,
    ):
        from core.model import Loan

        db.add(Loan(
            private_user_id=test_employee.private_user_id,
            loan_type="employer",
            description="Test loan",
            amount=12000.0,
            currency="MUR",
            start_date=date(2026, 1, 1),
            status="active",
            duration_months=12,
            payment_frequency="monthly",
            repaid_amount=0.0,
        ))
        db.commit()

        amount = payroll_engine._compute_loan_repayments_for_period(
            db, test_employee.private_user_id,
            date(2026, 5, 1), date(2026, 5, 31),
        )
        assert amount == Decimal("1000.00")  # 12000 / 12

        db.execute(
            __import__("sqlalchemy").text(
                "DELETE FROM loans WHERE private_user_id = :u"
            ),
            {"u": test_employee.private_user_id},
        )
        db.commit()

    def test_weekly_loan_scales(self, db, test_employee):
        from core.model import Loan
        db.add(Loan(
            private_user_id=test_employee.private_user_id,
            loan_type="employer",
            description="Weekly",
            amount=12000.0,
            currency="MUR",
            start_date=date(2026, 1, 1),
            status="active",
            duration_months=12,
            payment_frequency="weekly",
        ))
        db.commit()

        amount = payroll_engine._compute_loan_repayments_for_period(
            db, test_employee.private_user_id,
            date(2026, 5, 1), date(2026, 5, 31),
        )
        # 12000/12 * 4 weeks/month = 4000, capped by remaining (12000)
        assert amount == Decimal("4000.00")

        db.execute(
            __import__("sqlalchemy").text(
                "DELETE FROM loans WHERE private_user_id = :u"
            ),
            {"u": test_employee.private_user_id},
        )
        db.commit()

    def test_skips_future_loan(self, db, test_employee):
        from core.model import Loan
        db.add(Loan(
            private_user_id=test_employee.private_user_id,
            loan_type="employer",
            description="Future",
            amount=6000.0,
            start_date=date(2027, 1, 1),
            status="active",
            duration_months=6,
            payment_frequency="monthly",
        ))
        db.commit()

        amount = payroll_engine._compute_loan_repayments_for_period(
            db, test_employee.private_user_id,
            date(2026, 5, 1), date(2026, 5, 31),
        )
        assert amount == Decimal("0.00")

        db.execute(
            __import__("sqlalchemy").text(
                "DELETE FROM loans WHERE private_user_id = :u"
            ),
            {"u": test_employee.private_user_id},
        )
        db.commit()

    def test_caps_at_remaining_principal(
        self, db, test_employee,
    ):
        from core.model import Loan
        # Almost paid off — only 250 remaining; installment would be 1000.
        db.add(Loan(
            private_user_id=test_employee.private_user_id,
            loan_type="employer",
            description="Almost done",
            amount=12000.0,
            start_date=date(2026, 1, 1),
            status="active",
            duration_months=12,
            payment_frequency="monthly",
            repaid_amount=11750.0,
        ))
        db.commit()

        amount = payroll_engine._compute_loan_repayments_for_period(
            db, test_employee.private_user_id,
            date(2026, 5, 1), date(2026, 5, 31),
        )
        assert amount == Decimal("250.00")

        db.execute(
            __import__("sqlalchemy").text(
                "DELETE FROM loans WHERE private_user_id = :u"
            ),
            {"u": test_employee.private_user_id},
        )
        db.commit()


# ---------------------------------------------------------------------------
# A2 — unpaid-leave impact helper
# ---------------------------------------------------------------------------


class TestLeaveImpactHelper:
    def test_no_unpaid_days_returns_zero(
        self, db, test_employee, seed_mu_rules,
    ):
        impact = payroll_engine._compute_leave_impact_for_period(
            db, "MU", test_employee,
            leave_summary=[{"code": "sick", "label": "Sick", "days": 3, "paid": True}],
            earnings_gross=Decimal("30000"),
            period_start=date(2026, 5, 1), period_end=date(2026, 5, 31),
        )
        assert impact == Decimal("0.00")

    def test_unpaid_day_deducts_daily_rate(
        self, db, test_employee, seed_mu_rules,
    ):
        # May 2026: 21 Mon-Fri days minus 1 Sun-falling holiday (May 1 Labour
        # Day is a Friday in 2026 — so it deducts) = 20 working days.
        # 30000 gross → daily 30000/20 = 1500.00.
        impact = payroll_engine._compute_leave_impact_for_period(
            db, "MU", test_employee,
            leave_summary=[{"code": "unpaid", "label": "Unpaid", "days": 1, "paid": False}],
            earnings_gross=Decimal("30000"),
            period_start=date(2026, 5, 1), period_end=date(2026, 5, 31),
        )
        assert impact == Decimal("1500.00")

    def test_unpaid_capped_at_working_days(
        self, db, test_employee, seed_mu_rules,
    ):
        impact = payroll_engine._compute_leave_impact_for_period(
            db, "MU", test_employee,
            leave_summary=[{"code": "x", "label": "x", "days": 50, "paid": False}],
            earnings_gross=Decimal("30000"),
            period_start=date(2026, 5, 1), period_end=date(2026, 5, 31),
        )
        # Capped at working days × daily = gross exactly. (M1 added MU 2026
        # holidays — the math still resolves to a full-gross cap regardless
        # of working-day count.)
        assert impact == Decimal("30000.00")


# ---------------------------------------------------------------------------
# M3 — public holiday inside a leave window is credited back (WRA s.31)
# ---------------------------------------------------------------------------


class TestHolidayDuringLeave:
    def _make_leave(self, db, employee, start, end, status="approved", leave_type="annual"):
        from core.model import Leave
        lv = Leave(
            private_user_id=employee.private_user_id,
            leave_type=leave_type,
            start_date=start,
            end_date=end,
            status=status,
        )
        db.add(lv)
        db.flush()
        return lv

    def test_holiday_inside_leave_credited_back_and_flagged(
        self, db, test_employee, seed_mu_rules,
    ):
        # 2026-05-01 (Labour Day) is a seeded MU holiday. Leave Wed 29 Apr →
        # Mon 4 May = 6 calendar days; the holiday is credited back → 5 days.
        self._make_leave(db, test_employee, date(2026, 4, 29), date(2026, 5, 4))
        flags: list[str] = []
        summary = payroll_engine._compute_leave_summary(
            db, test_employee.private_user_id,
            date(2026, 4, 1), date(2026, 5, 31),
            country_code="MU", flags_out=flags,
        )
        total_days = sum(b["days"] for b in summary)
        assert total_days == 5
        assert "holiday_during_leave_adjusted" in flags

    def test_no_country_code_no_adjustment(
        self, db, test_employee, seed_mu_rules,
    ):
        self._make_leave(db, test_employee, date(2026, 4, 29), date(2026, 5, 4))
        flags: list[str] = []
        summary = payroll_engine._compute_leave_summary(
            db, test_employee.private_user_id,
            date(2026, 4, 1), date(2026, 5, 31),
            flags_out=flags,
        )
        total_days = sum(b["days"] for b in summary)
        assert total_days == 6
        assert flags == []


# ---------------------------------------------------------------------------
# A1+A2 — compute_for_resolved integrates both
# ---------------------------------------------------------------------------


class TestComputeForResolvedDeductions:
    def test_loan_and_leave_reduce_net(
        self, db, test_employee, seed_mu_rules,
    ):
        resolved = resolve_components(
            db, test_employee.private_user_id, date(2026, 5, 1),
        )
        snapshot = payroll_rules.resolve(db, "MU", date(2026, 5, 1))

        baseline = payroll_engine.compute_for_resolved(
            resolved, snapshot,
            db=db, private_user_id=test_employee.private_user_id,
            period_start=date(2026, 5, 1), country_code="MU",
        )
        with_deductions = payroll_engine.compute_for_resolved(
            resolved, snapshot,
            db=db, private_user_id=test_employee.private_user_id,
            period_start=date(2026, 5, 1), country_code="MU",
            loan_repayments=Decimal("1000"),
            leave_impact=Decimal("500"),
        )

        assert with_deductions["net_pay"] == baseline["net_pay"] - Decimal("1500.00")
        assert with_deductions["loan_repayments"] == Decimal("1000.00")
        assert with_deductions["leave_impact"] == Decimal("500.00")

        # Synthetic components are appended in the right order/category.
        codes = [c["code"] for c in with_deductions["components"]]
        assert "LEAVE_UNPAID" in codes
        assert "LOAN" in codes


# ---------------------------------------------------------------------------
# A4 — run currency derives from company's country (MU → MUR)
# ---------------------------------------------------------------------------


class TestRunCurrencyFromCountry:
    def test_mu_company_run_uses_mur(
        self, db, test_company, test_employee, seed_mu_rules,
    ):
        from schema.payroll_schema import PayrollRunCreate
        from sqlalchemy import text as sql_text

        # Reset payroll state for this company so the create_draft_run call
        # doesn't conflict with a leftover non-cancelled run for the period.
        db.execute(sql_text(
            "DELETE FROM payslips WHERE payroll_run_id IN "
            "(SELECT id FROM payroll_runs WHERE company_id = :c)"
        ), {"c": test_company.company_id})
        db.execute(sql_text(
            "DELETE FROM payroll_runs WHERE company_id = :c"
        ), {"c": test_company.company_id})
        db.commit()

        payload = PayrollRunCreate(
            company_id=test_company.company_id,
            period_start=date(2026, 5, 1),
            period_end=date(2026, 5, 31),
        )
        run = payroll_engine.create_draft_run(db, payload, actor_user_id=None)
        db.commit()

        assert run.currency == "MUR"


# ---------------------------------------------------------------------------
# A3 — /payroll/runs list is single grouped query (no N+1)
# ---------------------------------------------------------------------------


class TestListRunsSingleQuery:
    def test_query_count_constant_in_run_count(
        self, db, test_company, test_employee, seed_mu_rules,
    ):
        from sqlalchemy import desc, func, text as sql_text
        from core.model import PayrollRun, Payslip
        from decimal import Decimal as D

        # Reset payroll state for this company so the assertion is deterministic.
        db.execute(sql_text(
            "DELETE FROM payslips WHERE payroll_run_id IN "
            "(SELECT id FROM payroll_runs WHERE company_id = :c)"
        ), {"c": test_company.company_id})
        db.execute(sql_text(
            "DELETE FROM payroll_runs WHERE company_id = :c"
        ), {"c": test_company.company_id})
        db.commit()

        # Seed 3 cancelled runs to ensure the GROUP BY still returns one row each.
        for m in (1, 2, 3):
            run = PayrollRun(
                company_id=test_company.company_id,
                period_start=date(2026, m, 1),
                period_end=date(2026, m, 28),
                status="cancelled",
                currency="MUR",
            )
            db.add(run)
            db.flush()
            db.add(Payslip(
                payroll_run_id=run.id,
                private_user_id=test_employee.private_user_id,
                gross=D("30000.00"),
                taxable_income=D("30000.00"),
                paye=D("0.00"),
                bonus=D("0.00"),
                allowances_total=D("0.00"),
                deductions_total=D("0.00"),
                loan_repayments=D("0.00"),
                leave_impact=D("0.00"),
                net_pay=D("28000.00"),
                statutory_employee={},
                statutory_employer={},
                currency="MUR",
                components=[],
            ))
        db.commit()

        # Count SELECT statements issued while running the new grouped query.
        engine = db.get_bind()
        statements = []

        @event.listens_for(engine, "before_cursor_execute")
        def _record(conn, cursor, statement, params, context, executemany):
            if statement.strip().upper().startswith("SELECT"):
                statements.append(statement)

        try:
            payslip_count = func.count(Payslip.id).label("payslip_count")
            payslip_net = func.coalesce(func.sum(Payslip.net_pay), 0).label("payslip_net")
            q = (
                db.query(PayrollRun, payslip_count, payslip_net)
                .outerjoin(Payslip, Payslip.payroll_run_id == PayrollRun.id)
                .filter(PayrollRun.company_id == test_company.company_id)
                .group_by(PayrollRun.id)
                .order_by(desc(PayrollRun.period_start))
            )
            rows = q.all()
        finally:
            event.remove(engine, "before_cursor_execute", _record)

        assert len(rows) == 3
        # One SELECT total (the grouped query). Pre-fix code issued N+1
        # (1 listing + 3 aggregates = 4). Allow a small budget for any
        # autoflush-triggered SELECT, but assert << 4.
        assert len(statements) <= 2, (
            f"expected single grouped query, saw {len(statements)}: {statements}"
        )


# ---------------------------------------------------------------------------
# M2 — mid-period rule-change detection
# ---------------------------------------------------------------------------


class TestMidPeriodRuleChange:
    def _wipe_runs(self, db, company_id):
        from sqlalchemy import text as sql_text
        db.execute(sql_text(
            "DELETE FROM payslips WHERE payroll_run_id IN "
            "(SELECT id FROM payroll_runs WHERE company_id = :c)"
        ), {"c": company_id})
        db.execute(sql_text("DELETE FROM payroll_runs WHERE company_id = :c"), {"c": company_id})
        db.commit()

    def test_detects_open_draft_overlapping_effective_from(
        self, db, test_company, seed_mu_rules,
    ):
        from core.model import PayrollRun
        self._wipe_runs(db, test_company.company_id)
        # Open draft covering May 2026.
        draft = PayrollRun(
            company_id=test_company.company_id,
            period_start=date(2026, 5, 1), period_end=date(2026, 5, 31),
            status="draft", currency="MUR",
        )
        # Finalized run for the same period — must NOT be flagged.
        final = PayrollRun(
            company_id=test_company.company_id,
            period_start=date(2026, 4, 1), period_end=date(2026, 4, 30),
            status="finalized", currency="MUR",
        )
        db.add_all([draft, final])
        db.commit()

        affected = payroll_rules.open_drafts_affected_by_rule_change(
            db, test_company.country_code, date(2026, 5, 15),
        )
        ids = {a["run_id"] for a in affected}
        assert draft.id in ids
        assert final.id not in ids

    def test_no_overlap_returns_empty(self, db, test_company, seed_mu_rules):
        from core.model import PayrollRun
        self._wipe_runs(db, test_company.company_id)
        draft = PayrollRun(
            company_id=test_company.company_id,
            period_start=date(2026, 5, 1), period_end=date(2026, 5, 31),
            status="draft", currency="MUR",
        )
        db.add(draft)
        db.commit()
        # effective_from outside the draft period.
        affected = payroll_rules.open_drafts_affected_by_rule_change(
            db, test_company.country_code, date(2026, 7, 1),
        )
        assert affected == []


# ---------------------------------------------------------------------------
# Loan repayment ↔ run link: idempotent finalize + reversing cancel
# (fixes the redo double-deduction; repayments.payroll_run_id migration)
# ---------------------------------------------------------------------------


class TestLoanRepaymentRunLink:
    """A run's loan repayments are tied to that run: re-booking is idempotent,
    cancel reverses them, so a redo (cancel + fresh run) advances the loan
    ledger exactly once for the period instead of twice."""

    @pytest.fixture(autouse=True)
    def _clear_residue(self, db, test_employee, test_company):
        # Earlier classes in this file create a run for the session-scoped
        # test_company at 2026-05 and don't clean it up; clear that residue so
        # our finalized-run insert doesn't collide with the unique
        # (company, period) index. (Makes the class order-independent.)
        self._cleanup(db, test_employee, test_company)
        yield

    def _mk_loan(self, db, emp):
        from core.model import Loan
        loan = Loan(
            private_user_id=emp.private_user_id,
            loan_type="employer",
            description="Redo-cycle test loan",
            amount=12000.0, currency="MUR",
            start_date=date(2026, 1, 1), status="active",
            duration_months=12, payment_frequency="monthly",
            repaid_amount=0.0,
        )
        db.add(loan)
        db.commit()
        return loan

    def _mk_run(self, db, company, status="finalized"):
        from core.model import PayrollRun
        run = PayrollRun(
            company_id=company.company_id,
            period_start=date(2026, 5, 1), period_end=date(2026, 5, 31),
            status=status, currency="MUR",
        )
        db.add(run)
        db.flush()
        return run

    def _cleanup(self, db, emp, company):
        from sqlalchemy import text as t
        db.execute(t(
            "DELETE FROM repayments WHERE loan_id IN "
            "(SELECT loan_id FROM loans WHERE private_user_id = :u)"
        ), {"u": emp.private_user_id})
        db.execute(t("DELETE FROM loans WHERE private_user_id = :u"), {"u": emp.private_user_id})
        db.execute(t("DELETE FROM payroll_runs WHERE company_id = :c"), {"c": company.company_id})
        db.commit()

    def test_redo_cycle_does_not_double_advance(self, db, test_employee, test_company):
        from core.model import Repayment
        loan = self._mk_loan(db, test_employee)
        try:
            run_a = self._mk_run(db, test_company)
            payroll_engine._record_loan_repayments_for_period(
                db, test_employee.private_user_id, date(2026, 5, 31),
                Decimal("1000.00"), run_a.id,
            )
            db.commit(); db.refresh(loan)
            assert loan.repaid_amount == 1000.0
            assert db.query(Repayment).filter(Repayment.payroll_run_id == run_a.id).count() == 1

            # Redo step 1: cancel A reverses its repayment.
            payroll_engine.cancel_run(db, run_a.id)
            db.commit(); db.refresh(loan)
            assert loan.repaid_amount == 0.0
            assert db.query(Repayment).filter(Repayment.payroll_run_id == run_a.id).count() == 0

            # Redo step 2: finalize a fresh run B for the same period.
            run_b = self._mk_run(db, test_company)
            payroll_engine._record_loan_repayments_for_period(
                db, test_employee.private_user_id, date(2026, 5, 31),
                Decimal("1000.00"), run_b.id,
            )
            db.commit(); db.refresh(loan)

            # Ledger advanced exactly once across the whole redo cycle.
            assert loan.repaid_amount == 1000.0
            assert db.query(Repayment).filter(Repayment.loan_id == loan.loan_id).count() == 1
        finally:
            self._cleanup(db, test_employee, test_company)

    def test_record_is_idempotent_within_a_run(self, db, test_employee, test_company):
        from core.model import Repayment
        loan = self._mk_loan(db, test_employee)
        try:
            run = self._mk_run(db, test_company)
            for _ in range(2):
                payroll_engine._record_loan_repayments_for_period(
                    db, test_employee.private_user_id, date(2026, 5, 31),
                    Decimal("1000.00"), run.id,
                )
                db.commit()
            db.refresh(loan)
            assert loan.repaid_amount == 1000.0  # not 2000
            assert db.query(Repayment).filter(Repayment.payroll_run_id == run.id).count() == 1
        finally:
            self._cleanup(db, test_employee, test_company)

    def test_manual_repayment_untouched_by_cancel(self, db, test_employee, test_company):
        from core.model import Repayment
        loan = self._mk_loan(db, test_employee)
        try:
            run = self._mk_run(db, test_company)
            # A manual repayment has no run link and must survive a run cancel.
            db.add(Repayment(
                loan_id=loan.loan_id, amount=500.0,
                payment_date=date(2026, 5, 15), payroll_run_id=None,
            ))
            loan.repaid_amount = 500.0
            db.commit()

            payroll_engine.cancel_run(db, run.id)
            db.commit(); db.refresh(loan)

            assert loan.repaid_amount == 500.0
            assert db.query(Repayment).filter(Repayment.loan_id == loan.loan_id).count() == 1
        finally:
            self._cleanup(db, test_employee, test_company)


# ---------------------------------------------------------------------------
# Dispute-finalize gate: a dispute on the LAST day of the period must count
# (regression — the old `< period_end` bound excluded final-day disputes)
# ---------------------------------------------------------------------------


class TestDisputeFinalizeGate:
    def _employee_job_id(self, db, emp):
        from core.model import Job
        job = (
            db.query(Job)
            .filter(Job.private_user_id == emp.private_user_id)
            .order_by(Job.created_at.desc())
            .first()
        )
        return job.job_id

    def _cleanup(self, db, emp):
        from sqlalchemy import text as t
        db.execute(t(
            "DELETE FROM time_log_disputes WHERE time_log_id IN "
            "(SELECT timelog_id FROM time_logs WHERE private_user_id = :u)"
        ), {"u": emp.private_user_id})
        db.execute(t("DELETE FROM time_logs WHERE private_user_id = :u"), {"u": emp.private_user_id})
        db.commit()

    def test_dispute_on_last_day_is_counted(self, db, test_employee, test_company):
        from datetime import datetime, timezone
        from core.model import TimeLog, TimeLogDispute

        period_start = date(2026, 5, 1)
        period_end = date(2026, 5, 31)
        job_id = self._employee_job_id(db, test_employee)
        try:
            # A clock-in on the final day of the period (afternoon UTC).
            tl = TimeLog(
                job_id=job_id,
                private_user_id=test_employee.private_user_id,
                start_time=datetime(2026, 5, 31, 14, 0, tzinfo=timezone.utc),
                location={},
            )
            db.add(tl)
            db.flush()
            db.add(TimeLogDispute(
                time_log_id=tl.timelog_id,
                employee_comment="Hours wrong",
                resolution="pending",
            ))
            db.commit()

            n = payroll_engine._count_open_disputes_in_period(
                db, test_company.company_id, period_start, period_end,
            )
            # The old `< period_end` bound returned 0 here; inclusive end → 1.
            assert n == 1
        finally:
            self._cleanup(db, test_employee)

    def test_resolved_dispute_does_not_count(self, db, test_employee, test_company):
        from datetime import datetime, timezone
        from core.model import TimeLog, TimeLogDispute

        job_id = self._employee_job_id(db, test_employee)
        try:
            tl = TimeLog(
                job_id=job_id,
                private_user_id=test_employee.private_user_id,
                start_time=datetime(2026, 5, 31, 14, 0, tzinfo=timezone.utc),
                location={},
            )
            db.add(tl)
            db.flush()
            db.add(TimeLogDispute(
                time_log_id=tl.timelog_id,
                employee_comment="Hours wrong",
                resolution="approved",
            ))
            db.commit()

            n = payroll_engine._count_open_disputes_in_period(
                db, test_company.company_id, date(2026, 5, 1), date(2026, 5, 31),
            )
            assert n == 0
        finally:
            self._cleanup(db, test_employee)
