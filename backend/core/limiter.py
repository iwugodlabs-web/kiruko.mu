"""
Shared slowapi Limiter instance.
Import from here so all routers share the same rate-limit state
and the exception handler in main.py applies everywhere.
"""
try:
    from slowapi import Limiter
    from slowapi.util import get_remote_address

    limiter = Limiter(key_func=get_remote_address)
    RATE_LIMITING_ENABLED = True
except ImportError:
    limiter = None  # type: ignore[assignment]
    RATE_LIMITING_ENABLED = False
