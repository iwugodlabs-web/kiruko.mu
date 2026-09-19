"""Authenticated proxy for concern (rights-report) attachments.

Concern evidence and thread-message attachments live on a PRIVATE object
store (Tigris), so their raw object URLs 403 in the browser — the inline
`<img>` preview and the "Open file" link both break. This mirrors the
document-vault proxy (see `serve_vault_file` in api/v1/user.py): instead of
handing the client a private object URL, the API hands out a short-lived,
capability-scoped proxy URL that streams the bytes same-origin. The raw
private URL never reaches the client.

The proxy URL carries a signed, 30-minute token scoped to
(right_id, message_id). It is minted only AFTER the surface's own
authorization has already passed — the company list, the compliance list,
the handler/owner threads, and the reporter portal all authorize the caller
before serialising the response. The serve endpoint re-validates the token
and resolves the object from the DB row; it never trusts a URL supplied by
the client.
"""

from __future__ import annotations

import os
from datetime import timedelta
from typing import Optional
from urllib.parse import quote

from fastapi import Request

from core.security import create_access_token

# Long enough to browse a case and open an attachment minutes later, short
# enough that a leaked proxy URL dies quickly. Single-attachment scoped.
CONCERN_ATTACHMENT_TOKEN_TTL = timedelta(minutes=30)

# Distinguishes these tokens from vault-view / session tokens (all share
# aud="web"; the serve endpoint keys off this purpose claim, not the aud).
PURPOSE = "concern_attachment"


def public_api_origin(request: Optional[Request]) -> str:
    """Public API origin for absolute proxy URLs.

    Mirrors `_vault_proxy_origin`: PUBLIC_API_ORIGIN wins (required behind
    proxies that don't forward the external host), else the request's own
    base URL honoring X-Forwarded-Proto/Host so Railway-style proxies don't
    yield internal http:// URLs.
    """
    env_origin = (os.getenv("PUBLIC_API_ORIGIN") or "").strip().rstrip("/")
    if env_origin:
        return env_origin
    if request is None:
        return ""
    scheme = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip()
    host = (request.headers.get("x-forwarded-host") or "").split(",")[0].strip()
    if host:
        scheme = scheme or request.base_url.scheme
        return f"{scheme}://{host}".rstrip("/")
    base = str(request.base_url).rstrip("/")
    if scheme == "https" and base.startswith("http://"):
        base = "https://" + base[len("http://"):]
    return base


def mint_token(right_id: int, message_id: Optional[int] = None) -> str:
    """Mint a short-lived token scoped to a single concern attachment."""
    return create_access_token(
        user_data={
            "purpose": PURPOSE,
            "right_id": right_id,
            "message_id": message_id,
        },
        expiry=CONCERN_ATTACHMENT_TOKEN_TTL,
    )


def _ext_for(source_url: Optional[str]) -> str:
    """Original file extension (with dot) from a stored object URL, so the
    proxy URL keeps it. Two consumers need it: the web `isImageUrl` check
    (which matches on the URL's trailing extension to decide inline preview)
    and the browser's own content sniffing. Returns "" when absent/odd."""
    if not source_url:
        return ""
    path = source_url.split("?", 1)[0]
    _, ext = os.path.splitext(path)
    return ext if ext.startswith(".") and len(ext) <= 10 else ""


def proxy_url(
    request: Optional[Request],
    right_id: int,
    source_url: Optional[str],
    message_id: Optional[int] = None,
) -> Optional[str]:
    """Swap a private object URL for a same-origin, token-scoped proxy URL.

    Returns the input unchanged when there's no attachment (None/"") or no
    HTTP request context (internal/test callers) so behaviour degrades safely.
    """
    if not source_url:
        return source_url
    if request is None:
        return source_url
    token = mint_token(right_id, message_id)
    ext = _ext_for(source_url)
    return (
        f"{public_api_origin(request)}"
        f"/api/v1/user/concern-attachment/{right_id}/file/attachment{ext}"
        f"?token={quote(token, safe='')}"
    )
