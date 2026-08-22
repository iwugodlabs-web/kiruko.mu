"""
Centralized FastAPI dependencies for authentication and database access.
"""

from typing import Optional, Any, Dict
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
import logging

from core.config import get_db
from core.security import decode_token
from db_models.crud.user import get_user_by_user_id

# Security handler for bearer tokens
# auto_error=False to allow fallback to HttpOnly cookies for web browsers
bearer_auth = HTTPBearer(auto_error=False)

def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_auth),
    db: Session = Depends(get_db)
) -> Any:
    """
    Get the current user from JWT token, supporting both 
    Authorization headers and HttpOnly cookies.
    """
    token = None
    
    # 1. Check Authorization header (Bearer)
    if credentials:
        token = credentials.credentials
    
    # 2. Check HttpOnly access_token cookie
    if not token:
        token = request.cookies.get("access_token")
        
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session has expired or you are not logged in. Please log in to continue."
        )

    # Decode and validate token
    token_data = decode_token(token)
    if not token_data or token_data.get("refresh", False):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Valid authentication token required."
        )

    # Retrieve user ID from payload
    # Note: Structure here must match create_access_token payload
    user_payload = token_data.get("user")
    if not user_payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token structure."
        )
        
    user_id = user_payload.get("user_id") or user_payload.get("user_uid")
    if not user_id:
         raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Token missing identifiable user data."
        )

    # Fetch user from DB
    user = get_user_by_user_id(user_id, db)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The account associated with this session no longer exists."
        )
        
    if not getattr(user, 'user_enabled', True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been disabled by an administrator."
        )

    # Hydrate `is_superuser` from the DB-backed platform_admin role so the
    # downstream gates (is_company_admin_for, require_company_scope) that
    # check `getattr(user, 'is_superuser', False)` actually see the role.
    # Twin to the same block in `auth/dependencies.py:get_current_user` —
    # we used to have only that one, and routes importing from this module
    # silently lost superuser status, 403ing platform admins on per-company
    # endpoints. Keep these two in sync (or consolidate).
    try:
        from db_models.crud.role import user_has_role_by_user_id
        if user_has_role_by_user_id(user.user_id, 'platform_admin', db):
            setattr(user, 'is_superuser', True)
        else:
            setattr(user, 'is_superuser', False)
    except Exception:
        db.rollback()
        setattr(user, 'is_superuser', False)

    # Session binding / anomaly check (device + IP). No-op unless
    # SESSION_ANOMALY_MODE is 'audit'/'block'.
    from core.session_security import check_session_anomaly
    check_session_anomaly(db, request, token_data)

    return user

def require_company_scope(
    company_id: int,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
):
    """Authorize `company_id` access for the caller AND set tenant context for
    the request lifetime. Yields the resolved `Company` row so the endpoint
    can use it without a second fetch.

    Replaces the inline 25-line permission block copy-pasted across many
    company-scoped endpoints. Pair with this dependency to:
      - 403 unauthorized callers before any data is read
      - populate the tenant_guard contextvar so subsequent multi-tenant
        queries don't log warnings
    """
    from core.model import Company
    from core.roles import is_company_admin_for
    from core.tenant_context import with_tenant

    company = db.query(Company).filter(Company.company_id == company_id).first()
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")

    allowed = False
    if getattr(current_user, "is_superuser", False):
        allowed = True
    elif is_company_admin_for(current_user, company_id, db):
        allowed = True
    else:
        pu = getattr(current_user, "private_user", None)
        if pu and getattr(pu, "company_id", None) == company_id:
            allowed = True

    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not permitted to access this company",
        )

    # Lifecycle gate: disabled/deleted companies are off-limits to everyone
    # except platform operators (who need access to manage and restore them).
    from core.roles import is_platform_operator
    if getattr(company, "status", "active") != "active" and not is_platform_operator(current_user, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This company is currently unavailable.",
        )

    with with_tenant(company_id):
        yield company


def require_company_read_access(
    company_id: int,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
):
    """Read-tier sibling of `require_company_scope`. Authorizes READ access to
    a company's data for company admins/members AND platform operators holding
    `read_any_company_data` (or write authority, which implies read). Use for
    endpoints that only expose data (employee lists, payroll figures) so a
    read-only platform role can view without gaining the write access that
    `require_company_scope` confers.
    """
    from core.model import Company
    from core.roles import can_read_company, is_platform_operator
    from core.tenant_context import with_tenant

    company = db.query(Company).filter(Company.company_id == company_id).first()
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")

    if not can_read_company(current_user, company_id, db):
        pu = getattr(current_user, "private_user", None)
        if not (pu and getattr(pu, "company_id", None) == company_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not permitted to access this company",
            )

    if getattr(company, "status", "active") != "active" and not is_platform_operator(current_user, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This company is currently unavailable.",
        )

    with with_tenant(company_id):
        yield company


def assert_company_access(current_user, company_id, db) -> None:
    """Plain-function sibling of `require_company_read_access`, for endpoints
    whose company_id is resolved from an entity (a job/schedule/leave row) rather
    than the URL path. Raises 403/404 unless the caller can read that company's
    data (company member/admin or a platform read-operator)."""
    from core.model import Company
    from core.roles import can_read_company
    if company_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    company = db.query(Company).filter(Company.company_id == company_id).first()
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    if not can_read_company(current_user, company_id, db):
        pu = getattr(current_user, "private_user", None)
        if not (pu and getattr(pu, "company_id", None) == company_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not permitted to access this data",
            )


def get_optional_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_auth),
    db: Session = Depends(get_db)
) -> Optional[Any]:
    """
    Attempt to get the user if a token is present, but do not raise 401 if it's missing.
    """
    try:
        return get_current_user(request, credentials, db)
    except HTTPException:
        return None


async def bind_tenant_context(
    request: Request,
    db: Session = Depends(get_db),
):
    """GLOBAL dependency (registered on the app) that resolves this request's
    tenant from the JWT and sets `app.company_id` for Postgres RLS (M5b).

    Runs in the ASYNC request context so the tenant ContextVar PROPAGATES to the
    (threadpool) route — which lets the after_begin bridge re-apply the GUC on
    EVERY transaction, including after a route commits mid-handler. No DB lookup:
    reads the `company_id` claim baked into the access token at login. Public /
    unauthenticated requests (no or invalid token) set no tenant. Inert until RLS
    policies exist.
    """
    from core.tenant_context import (
        push_request_tenant, pop_request_tenant,
        _resolve_pg_setting_value, _resolve_pg_private_user_value,
    )
    from sqlalchemy import text

    company_id = None
    private_user_id = None
    bypass = False

    # Extract bearer token (header) or access_token cookie — mirror get_current_user.
    token = None
    auth = request.headers.get("Authorization")
    if auth and auth.startswith("Bearer "):
        token = auth.split(" ", 1)[1]
    if not token:
        cookie_val = request.cookies.get("access_token")
        if cookie_val:
            token = cookie_val.split(" ", 1)[1] if cookie_val.startswith("Bearer ") else cookie_val

    if token:
        try:
            data = decode_token(token)
            if data and not data.get("refresh", False):
                claims = data.get("user") or {}
                if claims.get("is_superuser"):
                    bypass = True
                else:
                    if claims.get("company_id") is not None:
                        company_id = int(claims["company_id"])
                    if claims.get("private_user_id") is not None:
                        private_user_id = int(claims["private_user_id"])
        except Exception:
            pass  # bad/expired token → no tenant; auth deps will 401 where required

    handle = push_request_tenant(company_id=company_id,
                                 private_user_id=private_user_id, bypass=bypass)
    if handle:
        for setting, value in (
            ("app.company_id", _resolve_pg_setting_value()),
            ("app.private_user_id", _resolve_pg_private_user_value()),
        ):
            if value is not None:
                try:
                    db.execute(text("SELECT set_config(:k, :v, true)"),
                               {"k": setting, "v": value})
                except Exception:
                    logging.getLogger(__name__).warning(
                        "bind_tenant_context: set_config failed", exc_info=True)
    try:
        yield
    finally:
        pop_request_tenant(handle)


def get_token_payload(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_auth),
) -> Dict[str, Any]:
    """
    Return the decoded JWT payload for the current request.

    Used by guards that need claims like `aud` which are not exposed on the
    User object — e.g. `require_platform_admin` enforcing aud='web'.
    """
    token = credentials.credentials if credentials else request.cookies.get("access_token")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )

    payload = decode_token(token)
    if not payload or payload.get("refresh", False):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Valid authentication token required.",
        )
    return payload


# ---------------------------------------------------------------------------
# M26 — Kiosk authentication
# ---------------------------------------------------------------------------

# In-memory sliding-window per-device rate limit (100 req/min). Single-instance
# only; swap for Redis when the backend horizontally scales. The naive deque
# pattern is sufficient for the pilot (10–20 tablets) and avoids adding a
# Redis dependency for v1. State: device_id → deque[unix_ts].
from collections import deque
from time import monotonic as _monotonic
from threading import Lock as _Lock

_KIOSK_RATE_LIMIT_PER_MIN = 100
_KIOSK_RATE_WINDOW_SEC = 60.0
_kiosk_request_log: Dict[str, deque] = {}
_kiosk_rate_lock = _Lock()


def _kiosk_rate_check(device_id_str: str) -> bool:
    """Returns True if the request is within budget. Trims the per-device
    deque to the rolling window. Thread-safe because uvicorn's worker pool
    can call concurrently within one process."""
    now = _monotonic()
    cutoff = now - _KIOSK_RATE_WINDOW_SEC
    with _kiosk_rate_lock:
        timestamps = _kiosk_request_log.setdefault(device_id_str, deque())
        while timestamps and timestamps[0] < cutoff:
            timestamps.popleft()
        if len(timestamps) >= _KIOSK_RATE_LIMIT_PER_MIN:
            return False
        timestamps.append(now)
        return True


def get_kiosk_context(
    request: Request,
    db: Session = Depends(get_db),
):
    """FastAPI dependency for `/kiosk/*` routes.

    Reads ``X-Kiosk-Token`` from the request, validates via KioskService,
    sets the tenant ContextVar so multi-tenant queries inside the handler
    honor RLS, applies the per-device rate limit, and yields a frozen
    ``KioskContext(device_id, company_id, device)``.

    Raises:
      * 401 on missing token
      * 403 on invalid/expired/inactive/wrong token
      * 429 on per-device rate limit exceeded
    """
    from core.tenant_context import with_tenant
    from services.kiosk_service import KioskService, KioskContext

    token = request.headers.get("X-Kiosk-Token")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-Kiosk-Token header",
        )

    # X-Forwarded-For takes precedence so a reverse proxy can convey the
    # true client IP for stolen-tablet detection. Strip to the first hop.
    fwd = request.headers.get("X-Forwarded-For")
    request_ip = (fwd.split(",")[0].strip() if fwd else None) or (
        request.client.host if request.client else None
    )

    device, reason = KioskService.validate_kiosk_token_verbose(db, token, request_ip=request_ip)
    if device is None:
        # Stable, machine-readable detail codes so the kiosk setup screen can
        # surface a specific, actionable message instead of a generic 403.
        detail = {
            "malformed": "kiosk_token_malformed",
            "not_found": "kiosk_token_not_found",
            "deactivated": "kiosk_token_deactivated",
            "expired": "kiosk_token_expired",
            "wrong_secret": "kiosk_token_invalid",
        }.get(reason, "kiosk_token_invalid")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail,
        )

    if not _kiosk_rate_check(str(device.device_id)):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests from this device",
        )

    ctx = KioskContext(
        device_id=device.device_id,
        company_id=device.company_id,
        device=device,
    )
    with with_tenant(device.company_id):
        yield ctx
