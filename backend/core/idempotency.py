"""Idempotency-Key middleware + helpers (M6).

Stripe-style idempotency: clients send an `Idempotency-Key` header on
mutating requests; replays with the same key return the cached response
without re-executing. Body-hash mismatch → 409. Required on payroll
finalize, rule supersede, and one-off create; optional everywhere else.

Pieces:
  * `compute_request_hash(body)` — SHA-256 of the raw request body bytes.
  * `lookup_cached(db, key, method, path)` / `store_cached(...)` — DB I/O.
  * `IdempotencyMiddleware` — Starlette middleware. Caches successful
    responses for any POST/PATCH/DELETE with an `Idempotency-Key` header.
  * `require_idempotency_key` — FastAPI dependency. Raises 400 if the
    header is missing on an endpoint that requires it.

Concurrency notes:
  Two simultaneous requests with the same key both miss the cache and
  both execute. The PRIMARY KEY constraint catches the race on the
  second store. For payroll finalize this is safe because the engine's
  status check rejects double-finalize regardless. Stricter locking
  (in-progress markers) is a Phase 2 follow-up.
"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any, Optional

from fastapi import Header, HTTPException, status
from sqlalchemy import text as sql_text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response


logger = logging.getLogger("kontokaz.idempotency")


# Endpoints whose 200/201/204 responses can sometimes be too large to cache
# (or contain non-JSON bodies). Cap size at 256KB.
MAX_CACHED_BODY_BYTES = 256 * 1024


def compute_request_hash(body: bytes) -> str:
    """SHA-256 hex digest of the raw request body."""
    return hashlib.sha256(body or b"").hexdigest()


def lookup_cached(
    db: Session, key: str, method: str, path: str
) -> Optional[dict]:
    """Look up an idempotency entry. Returns dict with `request_hash`,
    `response_status`, `response_body`, or None."""
    row = db.execute(
        sql_text(
            "SELECT request_hash, response_status, response_body "
            "FROM idempotency_keys "
            "WHERE key = :k AND method = :m AND path = :p"
        ),
        {"k": key, "m": method, "p": path},
    ).fetchone()
    if row is None:
        return None
    return {
        "request_hash": row[0],
        "response_status": row[1],
        "response_body": row[2],
    }


def store_cached(
    db: Session,
    *,
    key: str,
    method: str,
    path: str,
    user_id: Optional[int],
    request_hash: str,
    response_status: int,
    response_body: Optional[Any],
) -> None:
    """Insert a cache entry. Silent on PK conflict (concurrent duplicate)."""
    try:
        db.execute(
            sql_text(
                "INSERT INTO idempotency_keys "
                "(key, method, path, user_id, request_hash, response_status, response_body) "
                "VALUES (:k, :m, :p, :uid, :rh, :rs, CAST(:rb AS JSONB))"
            ),
            {
                "k": key,
                "m": method,
                "p": path,
                "uid": user_id,
                "rh": request_hash,
                "rs": response_status,
                "rb": json.dumps(response_body) if response_body is not None else None,
            },
        )
        db.commit()
    except IntegrityError:
        # Concurrent duplicate write — the other request beat us. The
        # response is already cached. Roll back our own session and move on.
        db.rollback()
        logger.info(
            "idempotency: concurrent duplicate write — key=%s method=%s path=%s",
            key, method, path,
        )


# ---------------------------------------------------------------------------
# FastAPI dependency: required-header gate
# ---------------------------------------------------------------------------


def require_idempotency_key(
    idempotency_key: Optional[str] = Header(
        None,
        alias="Idempotency-Key",
        description="Client-supplied unique key. Replays return the cached response.",
    ),
) -> str:
    """Use as `Depends(require_idempotency_key)` on endpoints where the
    header is mandatory (payroll finalize, rule supersede, one-off create).
    Returns the key. The actual caching/replay logic lives in the
    middleware — this dependency only enforces the header is present."""
    if idempotency_key is None or not idempotency_key.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Idempotency-Key header is required for this endpoint. "
                "Generate a unique value per logical operation (e.g. UUIDv4)."
            ),
        )
    if len(idempotency_key) > 80:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Idempotency-Key must be at most 80 characters.",
        )
    return idempotency_key.strip()


# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------


_CACHEABLE_METHODS = {"POST", "PATCH", "DELETE"}


class IdempotencyMiddleware(BaseHTTPMiddleware):
    """Caches successful POST/PATCH/DELETE responses keyed by
    (Idempotency-Key, method, path). Replays return the cached body and
    status. Body-hash mismatch on the same key → 409.

    Pass-through for:
      * GET / HEAD / OPTIONS
      * any request without an `Idempotency-Key` header
      * responses with status >= 400 (errors aren't cached)
    """

    def __init__(self, app, *, session_factory) -> None:
        super().__init__(app)
        self._session_factory = session_factory

    async def dispatch(self, request: Request, call_next):
        if request.method not in _CACHEABLE_METHODS:
            return await call_next(request)

        key = request.headers.get("Idempotency-Key") or request.headers.get(
            "idempotency-key"
        )
        if not key:
            return await call_next(request)
        key = key.strip()
        if not key:
            return await call_next(request)

        # Read body so we can hash + replay it for the handler.
        body = await request.body()
        request_hash = compute_request_hash(body)
        path = request.url.path

        # Cache lookup
        db: Session = self._session_factory()
        try:
            cached = lookup_cached(db, key, request.method, path)
        finally:
            db.close()

        if cached is not None:
            if cached["request_hash"] != request_hash:
                return JSONResponse(
                    status_code=status.HTTP_409_CONFLICT,
                    content={
                        "detail": (
                            "Idempotency-Key reused with a different request body. "
                            "Use a fresh key for a new logical operation."
                        )
                    },
                )
            return JSONResponse(
                status_code=cached["response_status"] or 200,
                content=cached["response_body"],
            )

        # Replay the consumed body for the handler. Starlette receive() is
        # called by the routing layer when it parses the body; we provide
        # a fresh receive callable that yields our cached bytes.
        async def _receive():
            return {"type": "http.request", "body": body, "more_body": False}

        request._receive = _receive  # type: ignore[attr-defined]

        response = await call_next(request)

        # Cache only successful responses with a JSON body.
        if response.status_code < 200 or response.status_code >= 400:
            return response

        response_body_bytes = b""
        async for chunk in response.body_iterator:  # type: ignore[attr-defined]
            response_body_bytes += chunk
            if len(response_body_bytes) > MAX_CACHED_BODY_BYTES:
                # Too large to cache; pass through without storing.
                return Response(
                    content=response_body_bytes,
                    status_code=response.status_code,
                    headers=dict(response.headers),
                    media_type=response.media_type,
                )

        try:
            response_body_obj = (
                json.loads(response_body_bytes.decode("utf-8"))
                if response_body_bytes
                else None
            )
        except (json.JSONDecodeError, UnicodeDecodeError):
            response_body_obj = None  # non-JSON; don't cache, but pass through

        if response_body_obj is not None:
            user_id = _extract_user_id(request)
            db = self._session_factory()
            try:
                store_cached(
                    db,
                    key=key,
                    method=request.method,
                    path=path,
                    user_id=user_id,
                    request_hash=request_hash,
                    response_status=response.status_code,
                    response_body=response_body_obj,
                )
            finally:
                db.close()

        # Return a fresh Response (the body iterator above is exhausted).
        return Response(
            content=response_body_bytes,
            status_code=response.status_code,
            headers=dict(response.headers),
            media_type=response.media_type,
        )


def _extract_user_id(request: Request) -> Optional[int]:
    """Best-effort extract user_id from auth header / cookie. Audit-only."""
    try:
        from core.security import decode_token

        auth = request.headers.get("Authorization", "")
        token = None
        if auth.startswith("Bearer "):
            token = auth.split(" ", 1)[1]
        if not token:
            token = request.cookies.get("access_token")
        if not token:
            return None
        decoded = decode_token(token)
        if not decoded:
            return None
        user = decoded.get("user") or {}
        return user.get("user_id") or user.get("user_uid")
    except Exception:
        return None
