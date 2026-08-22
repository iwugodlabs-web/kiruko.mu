"""hCaptcha siteverify wrapper.

Used by the reporter portal to gate repeated lookup failures (see
`services.concern_portal_security`). When the per-IP failure count exceeds
`IP_FAIL_BEFORE_CAPTCHA`, subsequent lookups must include a captcha token,
which we verify here against hCaptcha's `siteverify` endpoint.

Env-flagged: if `HCAPTCHA_SECRET` is unset (typical in dev), `verify()`
returns True so dev workflows aren't blocked. Production MUST set the secret;
ops monitoring alerts on the absence of CAPTCHA verifications when the
abuse alert is firing.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

import requests

logger = logging.getLogger(__name__)

# hCaptcha endpoint. Public, well-documented, no auth on the URL itself —
# the secret is in the POST body.
_SITEVERIFY_URL = "https://api.hcaptcha.com/siteverify"
_TIMEOUT_SECONDS = 5.0


def _secret() -> Optional[str]:
    """Read the secret each call so test/runtime overrides take effect.
    Returns None when not configured."""
    return os.getenv("HCAPTCHA_SECRET")


def is_configured() -> bool:
    return bool(_secret())


def verify(token: Optional[str], remote_ip: Optional[str] = None) -> bool:
    """Verify a captcha response token. Returns True on pass.

    Behavior:
      - HCAPTCHA_SECRET unset → returns True (dev/staging without captcha).
        Logs a single-line WARNING per call so the gap is visible.
      - Token missing or empty → returns False.
      - hCaptcha API unreachable / timeout → returns False (fail-closed).
        We do not let an outage disable the abuse gate; the reporter sees
        a generic 401 and can retry.
    """
    secret = _secret()
    if not secret:
        logger.warning(
            "hcaptcha.verify: HCAPTCHA_SECRET unset; bypassing captcha check. "
            "Set HCAPTCHA_SECRET in production."
        )
        return True

    if not token:
        return False

    payload = {"secret": secret, "response": token}
    if remote_ip:
        payload["remoteip"] = remote_ip

    try:
        resp = requests.post(_SITEVERIFY_URL, data=payload, timeout=_TIMEOUT_SECONDS)
        resp.raise_for_status()
        body = resp.json() or {}
        success = bool(body.get("success"))
        if not success:
            logger.info(
                "hcaptcha.verify: rejected", extra={"errors": body.get("error-codes")}
            )
        return success
    except requests.RequestException as e:
        logger.warning("hcaptcha.verify: siteverify call failed: %s", e)
        return False
    except ValueError:  # JSON decode error
        logger.warning("hcaptcha.verify: siteverify returned non-JSON")
        return False
