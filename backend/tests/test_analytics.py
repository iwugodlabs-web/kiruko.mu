"""core.analytics — server-side PostHog client must be a safe no-op when the
key is unset (tests/dev), and never raise into a request path."""

from __future__ import annotations

import core.analytics as analytics


class TestAnalyticsNoop:
    def test_capture_is_safe_when_disabled(self):
        # No key in the test env → capture is a no-op and must not raise.
        analytics.capture("some.event", "user-1", {"a": 1})

    def test_capture_time_log_flag_noop(self):
        analytics.capture_time_log_flag(
            "time_log.flagged", object(), reason="late", distinct_id=123,
        )


class TestCompanyIdOf:
    def test_returns_none_for_unrelated_object(self):
        class X:
            pass

        assert analytics.company_id_of(X()) is None

    def test_reads_job_company_id(self):
        class Job:
            company_id = 42

        class TL:
            job = Job()

        assert analytics.company_id_of(TL()) == 42

    def test_falls_back_to_private_user_company(self):
        class PU:
            company_id = 7

        class TL:
            job = None
            private_user = PU()

        assert analytics.company_id_of(TL()) == 7
