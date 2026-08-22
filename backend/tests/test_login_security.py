"""Unit tests for services/login_security.py — per-identifier brute-force
lockout. Pure in-memory; no DB/HTTP needed."""

from __future__ import annotations

import pytest

from services.login_security import (
    IDENTIFIER_MAX_FAILURES,
    check_login_allowed,
    record_login_attempt,
    reset_for_tests,
)


@pytest.fixture(autouse=True)
def _reset():
    reset_for_tests()
    yield
    reset_for_tests()


def test_allowed_until_threshold():
    ident = "victim@example.com"
    for _ in range(IDENTIFIER_MAX_FAILURES - 1):
        assert check_login_allowed(ident, "1.2.3.4") is True
        record_login_attempt(ident, "1.2.3.4", success=False)
    # Still allowed on the failure just below threshold.
    assert check_login_allowed(ident, "1.2.3.4") is True


def test_lockout_after_threshold():
    ident = "victim@example.com"
    for _ in range(IDENTIFIER_MAX_FAILURES):
        record_login_attempt(ident, "1.2.3.4", success=False)
    assert check_login_allowed(ident, "9.9.9.9") is False


def test_identifier_normalization_case_insensitive():
    record_login_attempt("Foo@Bar.com", "1.2.3.4", success=False)
    assert check_login_allowed("foo@bar.com", "1.2.3.4") is True  # not locked, but shares counter
    # Lock out via the lowercased form; the mixed-case form must also be locked.
    for _ in range(IDENTIFIER_MAX_FAILURES):
        record_login_attempt("foo@bar.com", "1.2.3.4", success=False)
    assert check_login_allowed("FOO@BAR.COM", "1.2.3.4") is False


def test_success_clears_failures():
    ident = "victim@example.com"
    for _ in range(IDENTIFIER_MAX_FAILURES - 1):
        record_login_attempt(ident, "1.2.3.4", success=False)
    record_login_attempt(ident, "1.2.3.4", success=True)
    # Counter reset: another full window of failures is needed to lock out.
    for _ in range(IDENTIFIER_MAX_FAILURES - 1):
        record_login_attempt(ident, "1.2.3.4", success=False)
    assert check_login_allowed(ident, "1.2.3.4") is True


def test_empty_identifier_always_allowed():
    assert check_login_allowed("", None) is True
    record_login_attempt("", None, success=False)  # should not raise
