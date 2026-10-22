"""
Shared slowapi Limiter instance.
Import from here so all routers share the same rate-limit state
and the exception handler in main.py applies everywhere.
"""
import ipaddress
import os
from typing import Optional

# Number of trusted reverse proxies in front of the backend that each append
# their downstream peer to X-Forwarded-For. On Railway today the only such hop
# is Railway's edge router (1). Put a WAF/CDN like Cloudflare in front and this
# becomes 2 — bump TRUSTED_PROXY_HOPS to match, otherwise the key resolves to
# the CDN's egress IP instead of the real client.
try:
    TRUSTED_PROXY_HOPS = max(1, int(os.getenv("TRUSTED_PROXY_HOPS", "1")))
except ValueError:
    TRUSTED_PROXY_HOPS = 1


def _is_private_or_loopback(host: Optional[str]) -> bool:
    if not host:
        return False
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_private or ip.is_loopback or ip.is_link_local


def client_ip(request) -> str:
    """Resolve the real client IP behind a reverse proxy.

    Used both as the rate-limit key and as the audit-log IP, so web users are
    not collapsed onto the proxy's address in either place.

    The web app proxies every /api/v1 request through its own Next.js server,
    so the socket peer is the proxy container (a private Railway address) for
    ALL browser users. Keying on that would put every web user in one shared
    bucket — one attacker could exhaust the login limit for everyone. So when
    the peer is private/loopback (proxied or service-to-service traffic) we
    derive the client from X-Forwarded-For.

    X-Forwarded-For is appended left-to-right: each proxy tacks its *downstream*
    peer onto the end. The left-most entries are therefore whatever the original
    client sent and are fully spoofable; the real client IP is the one written
    by the FIRST proxy we trust, counted from the RIGHT. With TRUSTED_PROXY_HOPS
    trusted appenders, that is the Nth-from-last entry. Taking the left-most hop
    (the old behaviour) let an attacker set an arbitrary key per request and
    sidestep the limit entirely, or poison another IP's bucket.

    A client hitting the backend's public domain directly still sits behind the
    same trusted edge, so the right-most trusted hop remains the real client and
    any spoofed left-most entries are ignored.
    """
    peer = request.client.host if request.client else None
    if _is_private_or_loopback(peer):
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            parts = [p.strip() for p in forwarded.split(",") if p.strip()]
            if parts:
                # Index from the right by the number of trusted hops; if the
                # chain is shorter than expected, fall back to the left-most
                # real entry rather than indexing out of range.
                idx = max(0, len(parts) - TRUSTED_PROXY_HOPS)
                return parts[idx]
    return peer or "127.0.0.1"


try:
    from slowapi import Limiter

    # In-memory storage is per-process: with >1 backend replica each worker
    # keeps its own counters, so effective limits multiply by the replica count.
    # Set RATE_LIMIT_STORAGE_URI (e.g. redis://…) to share one bucket across
    # replicas. Unset → in-memory (correct for a single replica). A bad/unreach-
    # able URI falls back to in-memory with a warning rather than failing boot.
    _storage_uri = os.getenv("RATE_LIMIT_STORAGE_URI") or None
    try:
        limiter = Limiter(key_func=client_ip, storage_uri=_storage_uri)
    except Exception as _storage_err:  # pragma: no cover - defensive
        print(
            f"⚠️ Rate-limit storage {_storage_uri!r} unavailable "
            f"({_storage_err}); falling back to in-memory."
        )
        limiter = Limiter(key_func=client_ip)
    RATE_LIMITING_ENABLED = True
except ImportError:
    limiter = None  # type: ignore[assignment]
    RATE_LIMITING_ENABLED = False
