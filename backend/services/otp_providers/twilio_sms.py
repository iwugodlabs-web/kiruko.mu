"""Twilio SMS fallback OTP provider.

Use when WhatsApp template approval is dragging or for users on a phone
without WhatsApp installed. Costs ~Rs 1.50–2.25 per SMS in Mauritius
vs. near-zero for WhatsApp once approved — so this is the backup, not
the default.

Env vars:
  TWILIO_ACCOUNT_SID
  TWILIO_AUTH_TOKEN
  TWILIO_FROM_NUMBER       Twilio-provisioned sender (e.g. +14155551234)
                           or alphanumeric sender ID if supported in MU.
"""

from __future__ import annotations

import logging

import httpx

from core.settings import config as settings_config

from .base import OtpDeliveryError, OtpProvider

logger = logging.getLogger(__name__)


class TwilioSmsProvider(OtpProvider):
    name = "twilio_sms"

    def __init__(self) -> None:
        self.account_sid = settings_config("TWILIO_ACCOUNT_SID", default="")
        self.auth_token = settings_config("TWILIO_AUTH_TOKEN", default="")
        self.from_number = settings_config("TWILIO_FROM_NUMBER", default="")
        self._configured = all([self.account_sid, self.auth_token, self.from_number])

    def send(self, *, phone_e164: str, code: str, locale: str | None = None) -> None:
        if not self._configured:
            raise OtpDeliveryError(
                "not_configured",
                "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER not set",
            )
        url = f"https://api.twilio.com/2010-04-01/Accounts/{self.account_sid}/Messages.json"
        # Plain-text body — Twilio doesn't need template pre-approval.
        # Localized body for FR/MG so users actually read it.
        loc = (locale or "en").lower()[:2]
        if loc == "fr":
            body = f"Votre code Kontokaz est {code}. Ne le partagez pas."
        elif loc == "mg":
            body = f"Ny kaody Kontokaz dia {code}. Aza zaraina."
        else:
            body = f"Your Kontokaz code is {code}. Don't share it."

        try:
            with httpx.Client(timeout=10.0, auth=(self.account_sid, self.auth_token)) as client:
                resp = client.post(
                    url,
                    data={"To": phone_e164, "From": self.from_number, "Body": body},
                )
        except httpx.HTTPError as e:
            logger.error("Twilio send failed (network): %s", e)
            raise OtpDeliveryError("network", str(e))

        if resp.status_code >= 500:
            raise OtpDeliveryError("upstream_5xx", f"{resp.status_code}: {resp.text[:200]}")
        if resp.status_code >= 400:
            logger.warning("Twilio rejected: %s %s", resp.status_code, resp.text[:300])
            raise OtpDeliveryError("rejected", f"{resp.status_code}: {resp.text[:200]}")
        logger.info("Twilio OTP sent to=%s", phone_e164)
