"""Provider contract for sending an OTP code to a phone number."""

from __future__ import annotations

from abc import ABC, abstractmethod


class OtpDeliveryError(Exception):
    """Raised when the provider can't (or won't) deliver. The caller
    translates this into a user-facing 502 — the OTP code is already
    stored in the DB on failure but the user got nothing, so they can
    safely re-request without burning their rate-limit budget unfairly.

    `code` is a short stable token for log filtering ("rate_limited",
    "invalid_phone", "auth_failed", "upstream_5xx"); `message` is
    safe to surface to a developer log but NOT to end users.
    """

    def __init__(self, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


class OtpProvider(ABC):
    """Synchronous-ish (sync `send`, called from FastAPI handler) — the
    Meta + Twilio calls are <500ms typically and the login flow blocks
    on the result anyway. We don't gain from async here.
    """

    name: str = "base"

    @abstractmethod
    def send(self, *, phone_e164: str, code: str, locale: str | None = None) -> None:
        """Deliver `code` to `phone_e164` (`+CCNNNNNNNN`). Raises
        OtpDeliveryError on failure; returns None on success.
        """
        raise NotImplementedError
