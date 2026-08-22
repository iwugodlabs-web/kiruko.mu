"""Reporter-portal abuse mitigation: per-case + per-IP rate limits, lockouts,
and CAPTCHA-gating on repeated failures.

Layered defense (per the M2 plan checklist):

  Per-case lookups       5 PIN attempts / 15 min, 1h lockout after 10
  Per-IP lookups         10 lookups / 15 min
  CAPTCHA                Required after 3 failed attempts per IP per window
  Burst monitoring       Logger.warning when >100 lookups in 5 min globally,
                         or >5 case lockouts triggered in 1 hour

The state is in-memory (a `dict` guarded by a `threading.Lock`). This is
correct for a single-process deployment but **does not survive restarts and
does not coordinate across processes**. Production with multiple uvicorn
workers should swap the backing store to Redis (TODO documented inline).
The function signatures are designed so a Redis swap is a drop-in.

Sentry/Slack alerting: when burst thresholds are crossed we call
`logger.warning(...)` with structured `extra={...}` keys. Ops can pipe these
to whatever alerting backend exists; Sentry SDK is not currently wired into
the backend (see explore notes in M2 plan).
"""

from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Deque, Dict, Optional

logger = logging.getLogger(__name__)


# ── Tunables ─────────────────────────────────────────────────────────────────
CASE_WINDOW_SECONDS = 15 * 60            # 15 min
CASE_MAX_ATTEMPTS_IN_WINDOW = 5
CASE_LOCKOUT_THRESHOLD_FAILURES = 10
CASE_LOCKOUT_DURATION_SECONDS = 60 * 60  # 1 hour

IP_WINDOW_SECONDS = 15 * 60
IP_MAX_LOOKUPS_IN_WINDOW = 10
IP_FAIL_BEFORE_CAPTCHA = 3

GLOBAL_BURST_WINDOW_SECONDS = 5 * 60
GLOBAL_BURST_LOOKUPS_THRESHOLD = 100
GLOBAL_LOCKOUT_BURST_WINDOW_SECONDS = 60 * 60
GLOBAL_LOCKOUT_BURST_THRESHOLD = 5


# ── Reasons returned to the caller (NEVER leaked to the response body) ──────
REASON_OK = "ok"
REASON_CASE_LOCKED = "case_locked"
REASON_CASE_RATE_LIMITED = "case_rate_limited"
REASON_IP_RATE_LIMITED = "ip_rate_limited"


@dataclass
class CheckResult:
    """Outcome of a pre-verify gate check.

    Callers MUST treat `allowed=False` and `verify failed` identically in
    the HTTP response — same status, same body, same approximate timing.
    `reason` and `captcha_required` are for server-side logic / audit only.
    """
    allowed: bool
    reason: str
    captcha_required: bool


# ── In-memory state (thread-safe; see module docstring on Redis swap) ────────
_lock = threading.Lock()

# right_id → deque[timestamp] of all lookup attempts (success or fail)
_case_attempts: Dict[int, Deque[float]] = defaultdict(deque)

# right_id → deque[timestamp] of failed attempts only (for lockout threshold)
_case_failures: Dict[int, Deque[float]] = defaultdict(deque)

# right_id → unix timestamp when the lockout expires (None / absent if not locked)
_case_locked_until: Dict[int, float] = {}

# ip → deque[timestamp] of lookup attempts
_ip_attempts: Dict[str, Deque[float]] = defaultdict(deque)
# ip → deque[timestamp] of failed attempts (for CAPTCHA gating)
_ip_failures: Dict[str, Deque[float]] = defaultdict(deque)

# Global ring buffer for burst monitoring
_global_attempts: Deque[float] = deque()
_global_lockouts: Deque[float] = deque()


def _evict(buf: Deque[float], now: float, window: float) -> None:
    """Trim entries older than `window` seconds. Cheap because deques are
    contiguous in time order."""
    cutoff = now - window
    while buf and buf[0] < cutoff:
        buf.popleft()


def _evict_lockouts(now: float) -> None:
    """Drop expired lockouts from the dict."""
    expired = [k for k, v in _case_locked_until.items() if v <= now]
    for k in expired:
        _case_locked_until.pop(k, None)


def check_lookup_allowed(case_id: int, ip: str) -> CheckResult:
    """Pre-verify gate. Call BEFORE attempting to verify the PIN.

    Returns whether the lookup should proceed, and whether a CAPTCHA token
    must be supplied alongside the PIN. The caller is responsible for
    actually verifying the captcha (see `services.hcaptcha`).
    """
    now = time.time()
    with _lock:
        _evict_lockouts(now)

        # 1) Hard lockout — case has been brute-forced too many times.
        locked_until = _case_locked_until.get(case_id)
        if locked_until and locked_until > now:
            return CheckResult(False, REASON_CASE_LOCKED, captcha_required=False)

        # 2) Per-case sliding window.
        case_buf = _case_attempts[case_id]
        _evict(case_buf, now, CASE_WINDOW_SECONDS)
        if len(case_buf) >= CASE_MAX_ATTEMPTS_IN_WINDOW:
            return CheckResult(False, REASON_CASE_RATE_LIMITED, captcha_required=False)

        # 3) Per-IP sliding window.
        ip_buf = _ip_attempts[ip]
        _evict(ip_buf, now, IP_WINDOW_SECONDS)
        if len(ip_buf) >= IP_MAX_LOOKUPS_IN_WINDOW:
            return CheckResult(False, REASON_IP_RATE_LIMITED, captcha_required=False)

        # 4) CAPTCHA gating after repeated failures from this IP.
        ip_fails = _ip_failures[ip]
        _evict(ip_fails, now, IP_WINDOW_SECONDS)
        captcha_required = len(ip_fails) >= IP_FAIL_BEFORE_CAPTCHA

        return CheckResult(True, REASON_OK, captcha_required=captcha_required)


def record_attempt(case_id: int, ip: str, success: bool) -> None:
    """Record an attempt outcome. Always call this after `check_lookup_allowed`
    has authorised the lookup, regardless of whether the PIN matched."""
    now = time.time()
    with _lock:
        _case_attempts[case_id].append(now)
        _ip_attempts[ip].append(now)
        _global_attempts.append(now)
        _evict(_global_attempts, now, GLOBAL_BURST_WINDOW_SECONDS)

        if not success:
            _case_failures[case_id].append(now)
            _ip_failures[ip].append(now)
            # Lockout trigger.
            failures_in_window = _case_failures[case_id]
            _evict(failures_in_window, now, CASE_WINDOW_SECONDS)
            if len(failures_in_window) >= CASE_LOCKOUT_THRESHOLD_FAILURES:
                _case_locked_until[case_id] = now + CASE_LOCKOUT_DURATION_SECONDS
                _global_lockouts.append(now)
                _evict(_global_lockouts, now, GLOBAL_LOCKOUT_BURST_WINDOW_SECONDS)
                logger.warning(
                    "concern_portal: case lockout",
                    extra={
                        "right_id": case_id,
                        "ip": ip,
                        "lockout_until": _case_locked_until[case_id],
                        "alert": "concern_portal.case_lockout",
                    },
                )

        # Global burst alerts. Cheap counts; only fire when crossing a threshold.
        if len(_global_attempts) == GLOBAL_BURST_LOOKUPS_THRESHOLD:
            logger.warning(
                "concern_portal: global lookup burst",
                extra={
                    "lookups_in_window": len(_global_attempts),
                    "window_seconds": GLOBAL_BURST_WINDOW_SECONDS,
                    "alert": "concern_portal.lookup_burst",
                },
            )
        if len(_global_lockouts) == GLOBAL_LOCKOUT_BURST_THRESHOLD:
            logger.warning(
                "concern_portal: global lockout burst",
                extra={
                    "lockouts_in_window": len(_global_lockouts),
                    "window_seconds": GLOBAL_LOCKOUT_BURST_WINDOW_SECONDS,
                    "alert": "concern_portal.lockout_burst",
                },
            )


def reset_for_tests() -> None:
    """Wipe all in-memory state. Test-only."""
    with _lock:
        _case_attempts.clear()
        _case_failures.clear()
        _case_locked_until.clear()
        _ip_attempts.clear()
        _ip_failures.clear()
        _global_attempts.clear()
        _global_lockouts.clear()
