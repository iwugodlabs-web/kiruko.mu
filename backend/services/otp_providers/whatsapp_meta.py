"""WhatsApp Business Platform (Meta Cloud API) OTP delivery.

Setup checklist (one-time, by Kontokaz ops):
  1. Meta Business account + business verification (in Meta Business
     Manager → Business Settings → Business Info → Verify).
  2. Add WhatsApp Business → get a Phone Number ID + a permanent
     System User access token (Settings → System users → Generate token
     with `whatsapp_business_messaging` + `whatsapp_business_management`
     scopes).
  3. Create + submit an OTP-category Message Template, e.g.
       Name: kontokaz_login_otp
       Category: AUTHENTICATION
       Body: "Your Kontokaz code is {{1}}. Don't share it."
       Footer (optional): "Code expires in 10 minutes."
     Wait for Meta to approve (usually < 24h for AUTH templates).
  4. Drop the four env vars below into the backend deployment.

If the template name + version aren't available yet, leave
`OTP_PROVIDER` on `console` — the login flow keeps working with the
dev provider until you flip the switch.

Env vars:
  META_WA_PHONE_NUMBER_ID   numeric Phone Number ID (Meta → WA → API setup)
  META_WA_TOKEN             permanent System User access token
  META_WA_TEMPLATE_NAME     e.g. "kontokaz_login_otp"
  META_WA_API_VERSION       defaults to "v21.0" — bump when Meta deprecates
"""

from __future__ import annotations

import logging

import httpx

from core.settings import config as settings_config

from .base import OtpDeliveryError, OtpProvider

logger = logging.getLogger(__name__)


# Meta requires AUTHENTICATION-category templates to use a button-less,
# code-as-variable body. The locale code in `language.code` follows
# their flavoured BCP-47 (e.g. "en", "en_US", "fr"). Default to "en" if
# we don't have an exact match — Meta returns 400 if the template
# doesn't have that locale, which is a soft signal the template needs a
# fr/mg translation submitted.
_LOCALE_FALLBACK = {
    "en": "en",
    "fr": "fr",
    "mg": "en",  # Malagasy: no native Meta locale; use English template
}


class WhatsAppMetaProvider(OtpProvider):
    name = "whatsapp_meta"

    def __init__(self) -> None:
        self.phone_number_id = settings_config("META_WA_PHONE_NUMBER_ID", default="")
        self.token = settings_config("META_WA_TOKEN", default="")
        self.template_name = settings_config("META_WA_TEMPLATE_NAME", default="")
        self.api_version = settings_config("META_WA_API_VERSION", default="v21.0")
        # Fail loudly on first send if config is missing — we don't want
        # to silently degrade to "no OTP delivered" in production.
        self._configured = all([self.phone_number_id, self.token, self.template_name])

    def send(self, *, phone_e164: str, code: str, locale: str | None = None) -> None:
        if not self._configured:
            raise OtpDeliveryError(
                "not_configured",
                "META_WA_PHONE_NUMBER_ID / META_WA_TOKEN / META_WA_TEMPLATE_NAME not set",
            )

        # Meta wants the recipient phone WITHOUT the leading "+".
        to = phone_e164.lstrip("+")
        wa_locale = _LOCALE_FALLBACK.get((locale or "en").lower()[:2], "en")

        url = f"https://graph.facebook.com/{self.api_version}/{self.phone_number_id}/messages"
        payload = {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "template",
            "template": {
                "name": self.template_name,
                "language": {"code": wa_locale},
                "components": [
                    {
                        "type": "body",
                        "parameters": [{"type": "text", "text": code}],
                    },
                    # AUTHENTICATION templates require the URL button
                    # component to also carry the code so the WA client
                    # can render the "Copy code" CTA. Meta accepts and
                    # ignores this for non-button templates — safe to
                    # include unconditionally.
                    {
                        "type": "button",
                        "sub_type": "url",
                        "index": "0",
                        "parameters": [{"type": "text", "text": code}],
                    },
                ],
            },
        }
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

        try:
            with httpx.Client(timeout=10.0) as client:
                resp = client.post(url, json=payload, headers=headers)
        except httpx.HTTPError as e:
            logger.error("WhatsApp send failed (network): %s", e)
            raise OtpDeliveryError("network", str(e))

        if resp.status_code >= 500:
            logger.error("WhatsApp upstream 5xx: %s %s", resp.status_code, resp.text[:300])
            raise OtpDeliveryError("upstream_5xx", f"{resp.status_code}: {resp.text[:200]}")

        if resp.status_code >= 400:
            # Most common cause: template not approved yet, locale not
            # registered, recipient outside the 24h messaging window
            # (doesn't apply to AUTH templates), or bad token.
            logger.warning(
                "WhatsApp send rejected: %s %s — to=%s template=%s locale=%s",
                resp.status_code, resp.text[:300], to, self.template_name, wa_locale,
            )
            raise OtpDeliveryError("rejected", f"{resp.status_code}: {resp.text[:200]}")

        # 2xx — Meta returns 200 with a message id. Don't bother parsing
        # it; the OTP code is already stored on our side and the user
        # will either receive it or re-request.
        logger.info(
            "WhatsApp OTP sent to=%s template=%s locale=%s",
            to, self.template_name, wa_locale,
        )
