"""Unit tests for the attachment scanner.

Pure logic — no DB, no ClamAV daemon. python-magic is optional; tests rely
on the manual signature-table fallback so they pass in any dev env.
"""

import os
import pytest

from services import attachment_scanner as scn


# Tiny but valid fixtures (just enough to pass magic-byte checks).
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG_BYTES = b"\xff\xd8\xff" + b"\x00" * 64
PDF_BYTES = b"%PDF-1.7\n" + b"%%EOF" + b"\x00" * 64
DOCX_BYTES = b"PK\x03\x04" + b"\x00" * 64
TXT_BYTES = b"Hello, this is plain text."


@pytest.fixture(autouse=True)
def _disable_clamav(monkeypatch):
    # All scanner tests run with ClamAV disabled — we're not testing the
    # daemon integration here, only the MIME/magic logic. The scan() result
    # will be 'skipped:clamav_disabled' on the happy path.
    monkeypatch.delenv("ENABLE_CLAMAV", raising=False)
    yield


class TestSizeAndEmpty:
    def test_empty_rejected(self):
        r = scn.scan(b"", "application/pdf")
        assert r.status == "rejected"
        assert r.reason == "empty"

    def test_oversize_rejected(self):
        big = b"\x89PNG\r\n\x1a\n" + b"\x00" * scn.MAX_BYTES
        r = scn.scan(big, "image/png")
        assert r.status == "rejected"
        assert r.reason.startswith("too_large:")


class TestMimeAllowList:
    def test_disallowed_declared_mime_rejected(self):
        r = scn.scan(PDF_BYTES, "application/x-msdownload")  # .exe
        assert r.status == "rejected"
        assert "mime_not_allowed" in r.reason

    def test_missing_declared_mime_rejected(self):
        r = scn.scan(PDF_BYTES, None)
        assert r.status == "rejected"
        assert "mime_not_allowed" in r.reason


class TestMagicMatch:
    def test_exe_renamed_to_pdf_is_caught(self):
        # MZ magic = the classic DOS executable header.
        exe = b"MZ\x90\x00" + b"\x00" * 200
        r = scn.scan(exe, "application/pdf")
        assert r.status == "rejected"
        # Could be "magic_unrecognised" or "magic_mismatch" depending on
        # whether python-magic is installed; both are acceptable.
        assert ("magic_unrecognised" in r.reason) or ("magic_mismatch" in r.reason)

    def test_valid_pdf_passes(self):
        r = scn.scan(PDF_BYTES, "application/pdf")
        # ClamAV is disabled in tests → "skipped" is the happy-path status.
        assert r.status in ("clean", "skipped")
        assert r.detected_mime == "application/pdf"

    def test_valid_png_passes(self):
        r = scn.scan(PNG_BYTES, "image/png")
        assert r.status in ("clean", "skipped")
        assert r.detected_mime == "image/png"

    def test_valid_jpeg_passes(self):
        r = scn.scan(JPEG_BYTES, "image/jpeg")
        assert r.status in ("clean", "skipped")
        assert r.detected_mime == "image/jpeg"

    def test_docx_with_zip_magic_passes(self):
        r = scn.scan(
            DOCX_BYTES,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        # Declared MIME refines the ambiguous ZIP magic.
        assert r.status in ("clean", "skipped")

    def test_plain_text_special_case(self):
        # Plain text has no magic; the scanner accepts it when declared.
        r = scn.scan(TXT_BYTES, "text/plain")
        assert r.status in ("clean", "skipped")
        assert r.detected_mime == "text/plain"


class TestScanResultDbValue:
    def test_clean_db_value(self):
        r = scn.ScanResult(status="clean", reason=None, detected_mime="image/png", size_bytes=10)
        assert r.db_value == "clean"

    def test_skipped_db_value_includes_reason(self):
        r = scn.ScanResult(
            status="skipped", reason="clamav_disabled", detected_mime=None, size_bytes=10,
        )
        assert r.db_value == "skipped:clamav_disabled"

    def test_rejected_db_value_includes_reason(self):
        r = scn.ScanResult(
            status="rejected", reason="too_large:99999999>10485760", detected_mime=None, size_bytes=99999999,
        )
        assert r.db_value.startswith("rejected:too_large:")


class TestClamAvDisabledPath:
    def test_clamav_disabled_returns_skipped(self):
        # ENABLE_CLAMAV is not set (see autouse fixture).
        assert scn._is_clamav_enabled() is False
        r = scn._clamav_scan(PDF_BYTES)
        assert r.status == "skipped"
        assert r.reason == "clamav_disabled"

    def test_clamav_enabled_but_unreachable_returns_skipped(self, monkeypatch):
        # When the env flag is on but the daemon isn't reachable we treat
        # it as a non-fatal "skipped" — fail-open for availability.
        monkeypatch.setenv("ENABLE_CLAMAV", "true")
        monkeypatch.setenv("CLAMAV_HOST", "127.0.0.1")
        monkeypatch.setenv("CLAMAV_PORT", "1")  # nothing listening on port 1
        r = scn._clamav_scan(PDF_BYTES)
        # Either pyclamd is not installed (skipped:clamd_lib_missing) or
        # it's installed but the connection fails (skipped:clamav_unreachable).
        assert r.status == "skipped"
        assert r.reason in ("clamd_lib_missing", "clamav_unreachable")
