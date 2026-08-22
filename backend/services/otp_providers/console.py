"""Dev / CI provider — never sends a real message; logs the OTP to
stdout so a developer can copy-paste it during manual testing and
pytest can read it from captured logs.

NEVER set OTP_PROVIDER=console in production — it leaks codes to
whatever happens to be reading the backend logs.
"""

from __future__ import annotations

import logging

from .base import OtpProvider

logger = logging.getLogger(__name__)


class ConsoleProvider(OtpProvider):
    name = "console"

    def send(self, *, phone_e164: str, code: str, locale: str | None = None) -> None:
        # The log line is deliberately easy to grep for ("OTP_DEV") in
        # docker-compose logs during manual testing.
        logger.warning(
            "[OTP_DEV] would send code=%s to phone=%s (locale=%s)",
            code,
            phone_e164,
            locale or "default",
        )
