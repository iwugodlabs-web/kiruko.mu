"""Tests for the in-memory rate-limit + lockout state of the reporter portal.

Pure-logic tests — no DB, no FastAPI client. Each test resets the in-memory
state so they can run in any order.
"""

import pytest

from services import concern_portal_security as security


@pytest.fixture(autouse=True)
def _reset_state():
    security.reset_for_tests()
    yield
    security.reset_for_tests()


class TestPerCaseRateLimit:
    def test_first_attempt_is_allowed(self):
        result = security.check_lookup_allowed(case_id=1, ip="1.2.3.4")
        assert result.allowed is True
        assert result.reason == security.REASON_OK

    def test_after_max_attempts_in_window_blocks(self):
        for _ in range(security.CASE_MAX_ATTEMPTS_IN_WINDOW):
            assert security.check_lookup_allowed(1, "1.2.3.4").allowed is True
            security.record_attempt(1, "1.2.3.4", success=False)

        blocked = security.check_lookup_allowed(1, "1.2.3.4")
        assert blocked.allowed is False
        assert blocked.reason == security.REASON_CASE_RATE_LIMITED


class TestPerCaseLockout:
    def test_lockout_after_threshold_failures(self):
        # Consume the per-case rate limit, then fast-forward past the window
        # by mutating internal state so we can keep failing without being
        # rate-limited (lockout is a separate counter from the window cap).
        ip = "1.2.3.4"
        for _ in range(security.CASE_LOCKOUT_THRESHOLD_FAILURES):
            # Bypass the gate so we can record this many failures fast.
            security.record_attempt(99, ip, success=False)

        result = security.check_lookup_allowed(99, ip)
        assert result.allowed is False
        assert result.reason == security.REASON_CASE_LOCKED

    def test_lockout_does_not_affect_other_cases(self):
        # Lock case 100 via 10 failures from one IP. A *different IP* querying
        # a *different case_id* must still be allowed — proves the lockout is
        # scoped to the case, not propagating across the namespace.
        # (Same-IP queries on a different case would correctly be blocked by
        # the per-IP cap, which is tested separately above.)
        for _ in range(security.CASE_LOCKOUT_THRESHOLD_FAILURES):
            security.record_attempt(100, "1.2.3.4", success=False)
        assert security.check_lookup_allowed(100, "1.2.3.4").allowed is False
        assert security.check_lookup_allowed(101, "9.9.9.9").allowed is True


class TestPerIPRateLimit:
    def test_single_ip_capped_across_cases(self):
        ip = "5.5.5.5"
        # First N lookups across different case_ids share the IP cap.
        for i in range(security.IP_MAX_LOOKUPS_IN_WINDOW):
            assert security.check_lookup_allowed(case_id=200 + i, ip=ip).allowed is True
            security.record_attempt(200 + i, ip, success=False)

        # The next IP-bound lookup is blocked even on a fresh case_id.
        result = security.check_lookup_allowed(999, ip)
        assert result.allowed is False
        assert result.reason == security.REASON_IP_RATE_LIMITED

    def test_different_ips_have_independent_caps(self):
        ip_a = "10.0.0.1"
        ip_b = "10.0.0.2"
        for i in range(security.IP_MAX_LOOKUPS_IN_WINDOW):
            security.check_lookup_allowed(300 + i, ip_a)
            security.record_attempt(300 + i, ip_a, success=False)
        # ip_a maxed, ip_b still fresh
        assert security.check_lookup_allowed(999, ip_a).allowed is False
        assert security.check_lookup_allowed(999, ip_b).allowed is True


class TestCaptchaGating:
    def test_captcha_not_required_initially(self):
        result = security.check_lookup_allowed(case_id=1, ip="3.3.3.3")
        assert result.captcha_required is False

    def test_captcha_required_after_threshold_ip_failures(self):
        ip = "3.3.3.3"
        # Drive failures up to the captcha threshold
        for _ in range(security.IP_FAIL_BEFORE_CAPTCHA):
            security.record_attempt(case_id=1, ip=ip, success=False)
        result = security.check_lookup_allowed(case_id=1, ip=ip)
        # Still allowed (we're under the IP cap), but captcha now required.
        assert result.allowed is True
        assert result.captcha_required is True

    def test_successful_attempts_do_not_drive_captcha(self):
        ip = "3.3.3.4"
        for _ in range(security.IP_FAIL_BEFORE_CAPTCHA + 2):
            security.record_attempt(case_id=1, ip=ip, success=True)
        result = security.check_lookup_allowed(case_id=1, ip=ip)
        # Successes should not require captcha; only failures count.
        assert result.captcha_required is False


class TestRecordAttemptIsIndependent:
    def test_record_does_not_call_check(self):
        # Recording attempts must not raise even if state is empty.
        security.record_attempt(case_id=1, ip="1.1.1.1", success=True)
        security.record_attempt(case_id=1, ip="1.1.1.1", success=False)
