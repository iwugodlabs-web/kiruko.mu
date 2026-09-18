"""Server-side PostHog analytics (opt-in, non-blocking).

Reads the project key + host from env at import time. Absent key → disabled
no-op (tests and dev without a key never emit or error). ``capture`` is
fire-and-forget: it queues to the SDK's background flush thread and never
raises into a request path.

Key/host env (set in backend/.env):
  * ``PUBLIC_POSTHOG_API_KEY`` (fallback ``POSTHOG_API_KEY``)
  * ``POSTHOG_HOST`` (default https://eu.i.posthog.com)

Events emitted (see plan doc §6 / §4.4):
  * ``time_log.clock_out_superseded`` / ``time_log.clock_out_deferred``
  * ``time_log.auto_closed``
  * ``time_log.flagged`` (late / out_of_schedule / out_of_geofence)
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

logger = logging.getLogger("kontokaz.analytics")

_API_KEY = os.environ.get("PUBLIC_POSTHOG_API_KEY") or os.environ.get("POSTHOG_API_KEY")
_HOST = os.environ.get("POSTHOG_HOST", "https://eu.i.posthog.com")

_ENABLED = bool(_API_KEY)
_posthog = None

if _ENABLED:
    try:
        import posthog as _ph

        _ph.api_key = _API_KEY
        _ph.host = _HOST
        _ph.disabled = False
        _posthog = _ph
    except Exception as _e:  # pragma: no cover - env-dependent
        logger.warning("posthog SDK unavailable; analytics disabled: %s", _e)
        _ENABLED = False


def capture(event: str, distinct_id: Any, properties: Optional[dict] = None) -> None:
    """Emit one event. Safe no-op when disabled or if the SDK throws."""
    if not _ENABLED or _posthog is None:
        return
    try:
        _posthog.capture(str(distinct_id), event, properties or {})
    except Exception:
        logger.debug("posthog capture failed for %s", event, exc_info=True)


def company_id_of(tl) -> Optional[int]:
    """Best-effort resolve a TimeLog's company_id via its relationships, without
    raising on a missing/unloaded relationship."""
    try:
        job = getattr(tl, "job", None)
        if job is not None and getattr(job, "company_id", None) is not None:
            return int(job.company_id)
    except Exception:
        pass
    try:
        pu = getattr(tl, "private_user", None)
        if pu is not None and getattr(pu, "company_id", None) is not None:
            return int(pu.company_id)
    except Exception:
        pass
    return None


def capture_time_log_flag(event: str, tl, *, reason: str, distinct_id: Any, extra: Optional[dict] = None) -> None:
    """Emit a per-session flag event with the tenant context needed for per-job /
    per-company aggregation."""
    if not _ENABLED:
        return
    props = {
        "reason": reason,
        "timelog_id": getattr(tl, "timelog_id", None),
        "job_id": getattr(tl, "job_id", None),
        "private_user_id": getattr(tl, "private_user_id", None),
        "company_id": company_id_of(tl),
    }
    if extra:
        props.update(extra)
    capture(event, distinct_id, props)
