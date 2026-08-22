"""v1.7 — Kiosk selfie storage.

Filesystem-backed for the pilot — same `backend/uploads/` pattern that
already serves payslips and the document vault. Static-mounted at
`/uploads/` in main.py so the saved path is directly fetchable by the
admin time-logs review UI.

If pilot data shows storage growing fast (the bound is ~70GB at
1000 employees × 2/day × 365 days × 100KB), swap the implementation
out for S3-backed storage. The interface stays the same.

Inputs: base64-encoded image bytes (data URL or raw base64) — that's
the natural shape from the browser's `canvas.toDataURL()`. We strip
the data-URL prefix if present, decode, write JPEG, return the relative
URL path.
"""

from __future__ import annotations

import base64
import binascii
import logging
import os
import re
from pathlib import Path
from typing import Optional


logger = logging.getLogger(__name__)


_BACKEND_ROOT = Path(__file__).resolve().parent.parent
_PHOTOS_DIR = _BACKEND_ROOT / "uploads" / "kiosk_photos"

# Cap the image size we accept — defends against a malicious / buggy kiosk
# client posting huge payloads. Both clients now downscale on-device
# (web canvas; mobile via expo-image-manipulator → 480px @ 0.5), so a real
# selfie lands ~50-100 KB. 1 MB is a comfortable ceiling with ~10x margin
# while still rejecting a runaway full-res upload.
# PROD TODO: move storage from local disk to S3/Spaces (see module header).
_MAX_BYTES = 1024 * 1024

_DATA_URL_PREFIX_RE = re.compile(r"^data:image/[a-zA-Z+]+;base64,")


def save_kiosk_photo(timelog_id: int, image_b64: Optional[str]) -> Optional[str]:
    """Decode + persist a kiosk selfie. Returns the relative URL path
    (e.g. ``kiosk_photos/123.jpg``) suitable for storing in
    ``time_logs.kiosk_photo_path``, or None if the input was empty
    / invalid / too large.

    The TimeLog row should be created first (so we have its ID) — pass
    ``timelog_id`` to this helper, then UPDATE the row with the
    returned path. Failures here MUST NOT raise — losing a photo is
    a deterrent regression, but failing the clock-in itself is worse.
    """
    if not image_b64:
        return None
    try:
        # Strip data-URL prefix if the client sent the full data URL.
        cleaned = _DATA_URL_PREFIX_RE.sub("", image_b64.strip())
        raw = base64.b64decode(cleaned, validate=True)
    except (binascii.Error, ValueError):
        logger.warning("kiosk_photo: undecodable b64 for timelog %s", timelog_id)
        return None

    if len(raw) > _MAX_BYTES:
        logger.warning("kiosk_photo: too large (%d bytes) for timelog %s", len(raw), timelog_id)
        return None
    if len(raw) < 200:
        # Anything smaller than ~200 bytes is almost certainly an empty
        # / corrupted canvas dump, not a real image.
        return None

    try:
        os.makedirs(_PHOTOS_DIR, exist_ok=True)
        filename = f"{timelog_id}.jpg"
        path = _PHOTOS_DIR / filename
        with open(path, "wb") as f:
            f.write(raw)
        return f"kiosk_photos/{filename}"
    except OSError:
        logger.exception("kiosk_photo: filesystem write failed for timelog %s", timelog_id)
        return None
