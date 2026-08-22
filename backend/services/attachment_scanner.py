"""Attachment hygiene for Concerns v2 (M7).

Validates and scans every file uploaded to `POST /user/user-right` before it
ever reaches the storage layer. Three layers of defence:

  1. **Size cap** — 10 MB, hardcoded.
  2. **MIME allow-list + magic-byte sniffing** — declared `Content-Type`
     must match a small allow-list AND the file's actual magic bytes must
     correspond. Catches the classic `evil.exe.pdf` rename trick.
  3. **Virus scan** — optional ClamAV scan via `pyclamd`, env-flagged
     `ENABLE_CLAMAV=true` + `CLAMAV_HOST`/`CLAMAV_PORT`. When disabled or
     unreachable the scanner records `status='skipped'` with a reason and
     proceeds (the MIME + magic check still ran). Production toggles this
     on; dev environments don't need ClamAV running.

The scanner is **fail-closed for rejection but fail-open for unavailability**:
- A failed scan with a definitive "infected" verdict → `status='rejected'`.
- ClamAV unreachable / library missing → `status='skipped'` with reason
  in the result; the upload still proceeds with MIME + magic results.
- python-magic missing → magic-byte check falls back to a manual signature
  table for the common MIME types in the allow-list.

Optional deps:
  python-magic   for thorough mime detection (falls back to manual table)
  pyclamd        for ClamAV daemon integration (falls back to "skipped")
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)


# ── Allow-list ────────────────────────────────────────────────────────────────
ALLOWED_MIMES: frozenset[str] = frozenset({
    "image/png",
    "image/jpeg",
    "image/heic",   # iPhone photos
    "image/webp",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
})

# Magic-byte signatures for the common allow-listed types. Used when
# python-magic isn't installed (i.e. local dev or minimal prod). The
# detection is best-effort — a sophisticated attacker could still craft a
# file that passes this AND fails ClamAV — but it catches the trivial
# .exe-renamed-to-.pdf case.
_MAGIC_SIGNATURES: tuple[tuple[bytes, str], ...] = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"%PDF-", "application/pdf"),
    (b"PK\x03\x04", "application/zip"),  # DOCX/XLSX/PPTX wrappers
    (b"\xd0\xcf\x11\xe0", "application/msword"),  # legacy .doc
    (b"RIFF", "image/webp"),  # also AVI/WAV — refined below
    (b"ftypheic", "image/heic"),  # appears after the 4-byte size prefix
)

# DOCX/XLSX/PPTX all share the ZIP magic. We pair them with declared MIME
# at higher confidence.
_ZIP_BASED_MIMES = frozenset({
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
})

MAX_BYTES = 10 * 1024 * 1024  # 10 MB


# ── Result shape ──────────────────────────────────────────────────────────────
@dataclass
class ScanResult:
    """Outcome of an attachment scan.

    status:
        'clean'    — all checks passed (or skipped) and the file is safe to store.
        'skipped'  — file passed size + mime + magic; virus scan was skipped
                     (env-flag off or ClamAV unreachable). Still safe to store.
        'rejected' — at least one check failed; the upload must be refused.

    The upload handler should return HTTP 415 with `reason` in the body
    when `status == 'rejected'`. Otherwise persist `db_value` (suitable for
    `user_rights.attachment_scan_result`) and store the file.
    """
    status: str
    reason: Optional[str]
    detected_mime: Optional[str]
    size_bytes: int

    @property
    def db_value(self) -> str:
        """Compact string suitable for the `attachment_scan_result` column.

        Examples: 'clean', 'skipped:clamav_unreachable',
                  'rejected:magic_mismatch', 'rejected:too_large'.
        """
        if self.status == "clean":
            return "clean"
        if self.reason:
            return f"{self.status}:{self.reason}"
        return self.status


# ── Optional-dep probes ───────────────────────────────────────────────────────
def _try_import_magic():
    try:
        import magic  # type: ignore
        return magic
    except Exception:
        return None


def _try_import_clamd():
    try:
        import clamd  # type: ignore
        return clamd
    except Exception:
        return None


def _is_clamav_enabled() -> bool:
    return os.getenv("ENABLE_CLAMAV", "false").strip().lower() in ("1", "true", "yes")


# ── Detection helpers ─────────────────────────────────────────────────────────
def _detect_mime(content: bytes, declared_mime: Optional[str]) -> str:
    """Return the detected MIME. Prefers python-magic when available; falls
    back to a manual signature table for the common allow-listed types.
    Returns the empty string when nothing matches."""
    magic = _try_import_magic()
    if magic is not None:
        try:
            m = magic.Magic(mime=True)
            return m.from_buffer(content[:8192]) or ""
        except Exception:
            logger.exception("python-magic detection failed; falling back to signature table")

    # Manual signature table fallback.
    head = content[:32]
    for prefix, mime in _MAGIC_SIGNATURES:
        if head.startswith(prefix):
            # ZIP magic is ambiguous; refine using the declared MIME.
            if mime == "application/zip" and declared_mime in _ZIP_BASED_MIMES:
                return declared_mime
            return mime
    # HEIC magic appears 4 bytes in.
    if len(content) > 12 and content[4:12] == b"ftypheic":
        return "image/heic"
    return ""


def _clamav_scan(content: bytes) -> ScanResult:
    """Returns a `ScanResult` with status 'clean' or 'rejected:infected:<name>'
    when ClamAV is enabled + reachable; 'skipped:...' otherwise. Used after
    MIME/magic have already passed."""
    if not _is_clamav_enabled():
        return ScanResult(
            status="skipped",
            reason="clamav_disabled",
            detected_mime=None,
            size_bytes=len(content),
        )
    clamd_mod = _try_import_clamd()
    if clamd_mod is None:
        logger.warning("ENABLE_CLAMAV=true but pyclamd not installed; skipping virus scan")
        return ScanResult(
            status="skipped",
            reason="clamd_lib_missing",
            detected_mime=None,
            size_bytes=len(content),
        )

    host = os.getenv("CLAMAV_HOST", "clamav")
    port = int(os.getenv("CLAMAV_PORT", "3310"))
    try:
        cd = clamd_mod.ClamdNetworkSocket(host=host, port=port, timeout=15.0)
        cd.ping()
        result = cd.instream(_BytesReader(content))
        # pyclamd shape: {"stream": ("OK", None)} or ("FOUND", "Eicar-Test-Signature")
        stream = (result or {}).get("stream")
        if stream and stream[0] == "OK":
            return ScanResult(
                status="clean",
                reason=None,
                detected_mime=None,
                size_bytes=len(content),
            )
        if stream and stream[0] == "FOUND":
            return ScanResult(
                status="rejected",
                reason=f"virus:{stream[1] or 'unknown'}",
                detected_mime=None,
                size_bytes=len(content),
            )
        return ScanResult(
            status="skipped",
            reason=f"clamav_unexpected:{stream}",
            detected_mime=None,
            size_bytes=len(content),
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("ClamAV scan failed (non-fatal): %s", e)
        return ScanResult(
            status="skipped",
            reason="clamav_unreachable",
            detected_mime=None,
            size_bytes=len(content),
        )


class _BytesReader:
    """Tiny adapter so `clamd.instream(...)` can read from bytes."""
    def __init__(self, b: bytes):
        self._b = b
        self._pos = 0

    def read(self, n: int = -1) -> bytes:
        if n < 0:
            chunk = self._b[self._pos:]
            self._pos = len(self._b)
            return chunk
        chunk = self._b[self._pos:self._pos + n]
        self._pos += len(chunk)
        return chunk


# ── Public API ────────────────────────────────────────────────────────────────
def scan(content: bytes, declared_mime: Optional[str]) -> ScanResult:
    """Top-level entry point. Pass the file bytes + the declared
    Content-Type (e.g. from `UploadFile.content_type`). Returns a
    `ScanResult`; never raises.
    """
    size = len(content)

    # 1) Size cap.
    if size > MAX_BYTES:
        return ScanResult(
            status="rejected",
            reason=f"too_large:{size}>{MAX_BYTES}",
            detected_mime=None,
            size_bytes=size,
        )
    if size == 0:
        return ScanResult(
            status="rejected",
            reason="empty",
            detected_mime=None,
            size_bytes=0,
        )

    # 2) MIME allow-list (declared).
    declared = (declared_mime or "").strip().lower()
    if declared not in ALLOWED_MIMES:
        return ScanResult(
            status="rejected",
            reason=f"mime_not_allowed:{declared or 'missing'}",
            detected_mime=None,
            size_bytes=size,
        )

    # 3) Magic-byte sniffing — declared MIME must match what the bytes say.
    detected = _detect_mime(content, declared_mime=declared)
    if not detected:
        # No signature matched; could be a plain-text payload, which has no
        # magic. Accept text/plain explicitly; everything else is rejected.
        if declared == "text/plain":
            detected = "text/plain"
        else:
            return ScanResult(
                status="rejected",
                reason="magic_unrecognised",
                detected_mime=None,
                size_bytes=size,
            )
    elif detected not in ALLOWED_MIMES:
        return ScanResult(
            status="rejected",
            reason=f"magic_not_allowed:{detected}",
            detected_mime=detected,
            size_bytes=size,
        )
    elif _normalise_for_match(detected) != _normalise_for_match(declared):
        return ScanResult(
            status="rejected",
            reason=f"magic_mismatch:declared={declared},detected={detected}",
            detected_mime=detected,
            size_bytes=size,
        )

    # 4) ClamAV (optional).
    clamav_result = _clamav_scan(content)
    clamav_result.detected_mime = detected
    clamav_result.size_bytes = size
    return clamav_result


def _normalise_for_match(mime: str) -> str:
    """Treat the three ZIP-based Office MIME types as equivalent to each
    other for the declared-vs-detected comparison — magic-bytes for them
    all start with PK\\x03\\x04, so we can't distinguish docx/xlsx/pptx by
    magic alone."""
    if mime in _ZIP_BASED_MIMES:
        return "application/zip"
    return mime
