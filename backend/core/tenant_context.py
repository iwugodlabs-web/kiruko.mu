"""Tenant context for the multi-tenant guard (M5a).

A ContextVar holds the company_id for the active request. The event
listener in `core.tenant_guard` reads from here when deciding whether to
flag a query that touches multi-tenant tables without a `company_id`
filter.

Public API:
    get_current_tenant() -> Optional[int]
    set_current_tenant(company_id) -> Token
    with_tenant(company_id)            — context manager
    bypass_tenant_guard(reason)        — escape hatch for platform admins
    TenantIsolationError               — raised by the guard in 'raise' mode

Usage in a FastAPI route:

    @router.get("/companies/{company_id}/something")
    def my_endpoint(
        company_id: int,
        _ = Depends(require_tenant_for_company),
        ...
    ):
        # current tenant is set on the ContextVar for the duration of the request
        ...
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from contextvars import ContextVar, Token
from typing import Iterator, Optional

logger = logging.getLogger("kontokaz.tenant")


class TenantIsolationError(RuntimeError):
    """Raised by the SQL guard when a multi-tenant query lacks a
    `company_id` filter and TENANT_GUARD_MODE='raise'.
    """


# Sentinel meaning "this request explicitly has NO tenant" (anonymous / public).
# Distinct from None: None means "no context was set at all" (e.g. a raw Session
# in a test or a maintenance script) and the RLS bridge LEAVES the existing
# app.company_id alone; NO_TENANT means "a real request bound no tenant" and the
# bridge FORCE-RESETS app.company_id to '' so a value bled in from a preceding
# authenticated request on a pooled connection can't poison this transaction.
class _NoTenant:
    __slots__ = ()

    def __repr__(self) -> str:  # pragma: no cover - debug aid
        return "NO_TENANT"


NO_TENANT = _NoTenant()

# ContextVar values:
#   None              — no tenant context set at all (leave app.company_id alone)
#   NO_TENANT         — request explicitly has no tenant (force app.company_id='')
#   int               — the company_id this request is scoped to
_current_tenant: ContextVar[object] = ContextVar(
    "kontokaz_current_tenant", default=None
)

# Independent flag — when True, the SQL guard skips its check entirely.
# Set via bypass_tenant_guard() for platform admins or maintenance scripts.
_bypass_active: ContextVar[bool] = ContextVar(
    "kontokaz_tenant_bypass", default=False
)

# The authenticated request's own private_user_id, for PERSON-scoped RLS on the
# personal-finance tables (the worker's own loans/budget/etc.). Drives the
# `app.private_user_id` GUC alongside `app.company_id`.
_current_private_user: ContextVar[object] = ContextVar(
    "kiruko_current_private_user", default=None
)


def get_current_tenant() -> Optional[int]:
    """Return the current tenant's company_id, or None if not set.

    The NO_TENANT sentinel (an explicit "no tenant" binding) is normalized to
    None here so callers keep seeing a plain Optional[int]."""
    tid = _current_tenant.get()
    if tid is None or isinstance(tid, _NoTenant):
        return None
    return tid


def is_bypass_active() -> bool:
    return _bypass_active.get()


def set_current_tenant(company_id: Optional[int]) -> Token[Optional[int]]:
    """Set the current tenant directly. Caller is responsible for resetting.
    Prefer `with_tenant()` for scoped use."""
    return _current_tenant.set(company_id)


@contextmanager
def with_tenant(company_id: int) -> Iterator[int]:
    """Bind a tenant for the duration of the `with` block."""
    if not isinstance(company_id, int):
        raise TypeError(f"with_tenant requires int company_id, got {type(company_id)}")
    token = _current_tenant.set(company_id)
    try:
        yield company_id
    finally:
        # When called from a FastAPI generator-dependency (e.g.
        # `require_company_scope`), setup runs in the request's task
        # context but the `finally` cleanup is dispatched onto a worker
        # thread via `anyio.to_thread.run_sync`, which copies the Context.
        # The `Token` was issued against the setup Context, so calling
        # `.reset(token)` from the teardown Context raises ValueError.
        # The state is still self-correcting — the next caller sets its
        # own value before reading — so we recover by clearing the var
        # in the current Context instead.
        try:
            _current_tenant.reset(token)
        except ValueError:
            logger.debug(
                "tenant_context: token reset across Contexts; clearing instead",
            )
            try:
                _current_tenant.set(None)
            except Exception:
                pass


@contextmanager
def bypass_tenant_guard(reason: str) -> Iterator[None]:
    """Disable the tenant guard for the duration of the block.

    `reason` must be a non-empty string and is logged for audit. Use only
    for explicit platform-admin operations or one-off maintenance scripts.
    """
    if not isinstance(reason, str) or not reason.strip():
        raise ValueError(
            "bypass_tenant_guard requires a non-empty reason string for audit"
        )
    logger.info(
        "tenant_guard.bypass",
        extra={"reason": reason, "tenant": _current_tenant.get()},
    )
    token = _bypass_active.set(True)
    try:
        yield
    finally:
        # See note on `with_tenant` above — same cross-Context risk when
        # used as a FastAPI generator-dependency.
        try:
            _bypass_active.reset(token)
        except ValueError:
            logger.debug(
                "tenant_context: bypass token reset across Contexts; clearing instead",
            )
            try:
                _bypass_active.set(False)
            except Exception:
                pass


# ---------------------------------------------------------------------------
# M5b: bridge to Postgres RLS via app.company_id session setting.
# ---------------------------------------------------------------------------


def _resolve_pg_setting_value() -> Optional[str]:
    """Compute the value to send to `SET LOCAL app.company_id` based on the
    current ContextVar state:
        bypass active → '*'
        tenant set    → str(tenant)
        otherwise     → None   (don't override session setting)

    Returning None means "leave the existing app.company_id alone" so
    callers that explicitly set the session-wide value (e.g. tests using
    `SELECT set_config(..., is_local=false)`) aren't clobbered on every
    new transaction.

    NO_TENANT returns '' so a request that bound no tenant force-resets the
    GUC to the permissive-empty state instead of inheriting a stale value.
    """
    if _bypass_active.get():
        return "*"
    tid = _current_tenant.get()
    if tid is None:
        return None
    if isinstance(tid, _NoTenant):
        return ""
    return str(tid)


def _resolve_pg_private_user_value() -> Optional[str]:
    """Value for `SET LOCAL app.private_user_id` (person-scoped RLS). Bypass → '*',
    set → str(id), NO_TENANT → '' (force-reset), otherwise None (leave alone)."""
    if _bypass_active.get():
        return "*"
    pid = _current_private_user.get()
    if pid is None:
        return None
    if isinstance(pid, _NoTenant):
        return ""
    return str(pid)


def install_session_listener() -> None:
    """Wire a SQLAlchemy `after_begin` listener so every transaction
    started through any Session sets `app.company_id` based on the
    M5a ContextVar.

    This connects the application-layer guard (M5a) with the database-
    layer Postgres RLS (M5b): one source of truth for tenant context,
    enforced twice.

    Idempotent — safe to call multiple times.
    """
    from sqlalchemy import event, text
    from sqlalchemy.orm import Session

    if getattr(install_session_listener, "_installed", False):
        return

    @event.listens_for(Session, "after_begin")
    def _after_begin(session, transaction, connection):
        for setting, value in (
            ("app.company_id", _resolve_pg_setting_value()),
            ("app.private_user_id", _resolve_pg_private_user_value()),
        ):
            if value is None:
                continue  # ContextVar not set — leave existing session setting alone
            try:
                # is_local=true so the setting is scoped to this transaction.
                connection.execute(
                    text("SELECT set_config(:k, :v, true)"),
                    {"k": setting, "v": value},
                )
            except Exception as exc:
                # Don't break the request if the setting can't be applied —
                # the app-layer guard still applies. Log loudly instead.
                logger.error(
                    "tenant_context.set_config failed",
                    extra={"setting": setting, "error": str(exc)},
                )

    install_session_listener._installed = True  # type: ignore[attr-defined]


def push_request_tenant(*, company_id: Optional[int] = None,
                         private_user_id: Optional[int] = None, bypass: bool = False):
    """Set the request's tenant (company) AND person (private_user) in the CURRENT
    context; return a list of reset handles. Called by the global async dependency
    `bind_tenant_context`, which runs in the request's ASYNC context so the values
    PROPAGATE to the (threadpool) route — letting the after_begin bridge re-apply
    the GUCs on every transaction, even after a mid-handler commit.

    `bypass=True` (platform admins) → '*' sentinel. Returns [] when nothing is set.

    For a non-bypass request the tenant and person ContextVars are ALWAYS bound —
    to the id when present, otherwise to NO_TENANT. Binding NO_TENANT (rather than
    leaving them unset) overwrites any value that leaked from a previous request's
    context on this thread/connection, so the RLS bridge force-resets the GUCs to
    '' and an anonymous request can't inherit a stale tenant.
    """
    if bypass:
        return [("bypass", _bypass_active.set(True))]
    handles = [
        ("tenant", _current_tenant.set(
            int(company_id) if company_id is not None else NO_TENANT)),
        ("person", _current_private_user.set(
            int(private_user_id) if private_user_id is not None else NO_TENANT)),
    ]
    return handles


_RESET = {
    "bypass": (_bypass_active, False),
    "tenant": (_current_tenant, None),
    "person": (_current_private_user, None),
}


def pop_request_tenant(handles) -> None:
    """Reset what push_request_tenant set (call in the dependency's finally)."""
    for kind, reset_token in (handles or []):
        var, cleared = _RESET[kind]
        try:
            var.reset(reset_token)
        except ValueError:
            # Token created in a different Context (threadpool boundary) — clear.
            var.set(cleared)
