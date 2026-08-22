"""M24 — Payroll calendar enforcement.

Verifies the period-close discipline: a draft for period N is rejected
when period N-1's run is still open (draft/review), but allowed when
prior is finalized, cancelled, or doesn't exist at all (mid-year
onboarding).
"""

from datetime import date

import pytest
from fastapi import HTTPException

from services import payroll_calendar, payroll_engine
from schema.payroll_schema import PayrollRunCreate


class TestPriorPeriodHelpers:
    def test_prior_period_january_wraps_to_previous_december(self):
        s, e = payroll_calendar.prior_period(date(2026, 1, 1))
        assert s == date(2025, 12, 1)
        assert e == date(2025, 12, 31)

    def test_prior_period_mid_year(self):
        s, e = payroll_calendar.prior_period(date(2026, 5, 1))
        assert s == date(2026, 4, 1)
        assert e == date(2026, 4, 30)

    def test_prior_period_march_after_leap_year_february(self):
        # 2024 was a leap year; prior of March 2024 = Feb 2024 (29 days).
        s, e = payroll_calendar.prior_period(date(2024, 3, 1))
        assert s == date(2024, 2, 1)
        assert e == date(2024, 2, 29)

    def test_resolve_calendar_returns_mu_seed(self, db, seed_mu_rules):
        cal = payroll_calendar.resolve_calendar(db, "MU", date(2026, 5, 1))
        assert cal is not None
        assert cal.period_type == "monthly"


class TestAssertPriorPeriodClosed:
    def test_no_prior_run_allowed(self, db, seed_mu_rules, test_company, clean_payroll_state):
        # No runs at all — should pass silently.
        payroll_calendar.assert_prior_period_closed(
            db,
            company_id=test_company.company_id,
            period_start=date(2026, 5, 1),
            country_code="MU",
        )

    def test_prior_finalized_allowed(self, db, seed_mu_rules, test_company, test_employee, clean_payroll_state):
        # Finalize April, then attempt May.
        run = payroll_engine.create_draft_run(
            db,
            PayrollRunCreate(
                company_id=test_company.company_id,
                period_start=date(2026, 4, 1),
                period_end=date(2026, 4, 30),
            ),
            actor_user_id=None,
        )
        db.flush()
        payroll_engine.finalize_run(db, run.id, actor_user_id=None)
        db.flush()

        # Should not raise.
        payroll_calendar.assert_prior_period_closed(
            db,
            company_id=test_company.company_id,
            period_start=date(2026, 5, 1),
            country_code="MU",
        )

    def test_prior_cancelled_allowed(self, db, seed_mu_rules, test_company, test_employee, clean_payroll_state):
        # Cancelled prior is also fine.
        run = payroll_engine.create_draft_run(
            db,
            PayrollRunCreate(
                company_id=test_company.company_id,
                period_start=date(2026, 4, 1),
                period_end=date(2026, 4, 30),
            ),
            actor_user_id=None,
        )
        db.flush()
        run.status = "cancelled"
        db.flush()

        payroll_calendar.assert_prior_period_closed(
            db,
            company_id=test_company.company_id,
            period_start=date(2026, 5, 1),
            country_code="MU",
        )

    def test_prior_open_draft_rejects_with_409(self, db, seed_mu_rules, test_company, test_employee, clean_payroll_state):
        # Leave April as draft (no finalize); try to start May.
        payroll_engine.create_draft_run(
            db,
            PayrollRunCreate(
                company_id=test_company.company_id,
                period_start=date(2026, 4, 1),
                period_end=date(2026, 4, 30),
            ),
            actor_user_id=None,
        )
        db.flush()

        with pytest.raises(HTTPException) as exc:
            payroll_calendar.assert_prior_period_closed(
                db,
                company_id=test_company.company_id,
                period_start=date(2026, 5, 1),
                country_code="MU",
            )
        assert exc.value.status_code == 409
        assert "April 2026" in exc.value.detail
        assert "May 2026" in exc.value.detail


class TestCreateDraftRunIntegration:
    def test_engine_rejects_out_of_order_create(
        self, db, seed_mu_rules, test_company, test_employee, clean_payroll_state,
    ):
        # April still draft.
        payroll_engine.create_draft_run(
            db,
            PayrollRunCreate(
                company_id=test_company.company_id,
                period_start=date(2026, 4, 1),
                period_end=date(2026, 4, 30),
            ),
            actor_user_id=None,
        )
        db.flush()

        # May creation should fail at the engine layer with the calendar's
        # 409 — proves the wiring runs in create_draft_run, not just in
        # the helper.
        with pytest.raises(HTTPException) as exc:
            payroll_engine.create_draft_run(
                db,
                PayrollRunCreate(
                    company_id=test_company.company_id,
                    period_start=date(2026, 5, 1),
                    period_end=date(2026, 5, 31),
                ),
                actor_user_id=None,
            )
        assert exc.value.status_code == 409
