"""OTP delivery providers — pluggable so the login flow doesn't care
whether the code lands via WhatsApp, SMS, or the developer's stdout.

The active provider is picked by the `OTP_PROVIDER` env var:
  * `console`       — logs the OTP to backend stdout. Dev default. Also
                      what we run in CI / pytest.
  * `whatsapp_meta` — Meta WhatsApp Business Platform. Requires META_*
                      env vars (see whatsapp_meta.py).
  * `twilio_sms`    — Twilio SMS. Requires TWILIO_* env vars.

Callers go through `get_provider()` so we can swap the active provider
at runtime (tests do this).
"""

from __future__ import annotations

from core.settings import config as settings_config
from .base import OtpProvider


def get_provider() -> OtpProvider:
    name = (settings_config("OTP_PROVIDER", default="console") or "console").strip().lower()
    if name == "whatsapp_meta":
        from .whatsapp_meta import WhatsAppMetaProvider
        return WhatsAppMetaProvider()
    if name == "twilio_sms":
        from .twilio_sms import TwilioSmsProvider
        return TwilioSmsProvider()
    # Fall through (including unknown values) to the console provider —
    # safer than raising at import time and crashing the app on a typo.
    # But the console provider logs OTP codes in plaintext, so refuse to
    # hand it out in production: fail closed rather than silently leak
    # every login code to whatever reads the backend logs.
    if (settings_config("ENVIRONMENT", default="development") or "").strip().lower() == "production":
        raise RuntimeError(
            f"OTP_PROVIDER={name!r} resolves to the console provider, which logs "
            "OTP codes in plaintext and must never run in production. Set "
            "OTP_PROVIDER to 'whatsapp_meta' or 'twilio_sms'."
        )
    from .console import ConsoleProvider
    return ConsoleProvider()


__all__ = ["OtpProvider", "get_provider"]
