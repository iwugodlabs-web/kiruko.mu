"""Login brute-force lockout: per-identifier failure window + lockout.

Complements the slowapi per-IP rate limit on POST /user/login. slowapi caps
request volume per source IP, but a distributed attacker (many IPs, one
account) slips through a per-IP cap. This adds a per-identifier failure
counter + lockout so a single account can't be brute-forced from anywhere.

State is in-memory (thread-safe), single-process only — swap to Redis when the
backend horizontally scales (same caveat as concern_portal_security.py). The
function signatures are written so a Redis swap is a drop-in.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Optional

logger = logging.getLogger(__name__)

IDENTIFIER_WINDOW_SECONDS = 15 * 60  # 15 min
IDENTIFIER_MAX_FAILURES = 10
IDENTIFIER_LOCKOUT_SECONDS = 15 * 60  # 15 min

_lock = threading.Lock()
_identifier_failures: Dict[str, Deque[float]] = defaultdict(deque)
_identifier_locked_until: Dict[str, float] = {}


def _norm_identifier(identifier: str) -> str:
    """Normalize so a case variation ('Foo@Bar.com' vs 'foo@bar.com') can't
    defeat the counter."""
    return (identifier or "").strip().lower()


def _evict(buf: Deque[float], now: float, window: float) -> None:
    cutoff = now - window
    while buf and buf[0] < cutoff:
        buf.popleft()


def check_login_allowed(identifier: str, ip: Optional[str]) -> bool:
    """Pre-verify gate. Call BEFORE attempting to verify the password.
    Returns False when this identifier is currently locked out."""
    key = _norm_identifier(identifier)
    if not key:
        return True
    now = time.time()
    with _lock:
        locked_until = _identifier_locked_until.get(key)
        if locked_until is not None and locked_until > now:
            return False
        if locked_until is not None and locked_until <= now:
            _identifier_locked_until.pop(key, None)
        return True


def record_login_attempt(identifier: str, ip: Optional[str], success: bool) -> None:
    """Record a login outcome. On success, clear the failure buffer (correct
    password proves the account holder). On failure, increment and lock out
    once the threshold is crossed within the window."""
    key = _norm_identifier(identifier)
    if not key:
        return
    now = time.time()
    with _lock:
        if success:
            _identifier_failures.pop(key, None)
            return
        buf = _identifier_failures[key]
        buf.append(now)
        _evict(buf, now, IDENTIFIER_WINDOW_SECONDS)
        if len(buf) >= IDENTIFIER_MAX_FAILURES:
            _identifier_locked_until[key] = now + IDENTIFIER_LOCKOUT_SECONDS
            _identifier_failures[key].clear()
            logger.warning(
                "login_security: account lockout",
                extra={
                    "identifier": key,
                    "ip": ip,
                    "lockout_until": _identifier_locked_until[key],
                    "alert": "login.account_lockout",
                },
            )


def reset_for_tests() -> None:
    """Wipe all in-memory state. Test-only."""
    with _lock:
        _identifier_failures.clear()
        _identifier_locked_until.clear()
