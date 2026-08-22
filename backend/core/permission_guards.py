"""Fine-grained permission guards layered on top of the existing role gates.

The legacy guards (`require_company_admin` in `core.auth_guards`,
`require_platform_admin` in `api.v1.admin`) check whether the caller belongs
to one of a fixed set of admin role *names*. This module checks the caller's
actual permission *array* — the JSONB on CompanyRole and (after Phase 2) on
PlatformRole.

Two factory dependencies:

  require_company_permission(code)
    Asserts that the caller can perform `code` on a company identified by
    the request. Resolution order (each step short-circuits the rest):
      1. Cross-tier bypass — a platform user acting on an employer.
         * Phase 1 (default today): user holds the legacy 'platform_admin'
           role → allow.
         * Phase 2 (when PLATFORM_PERM_ENFORCEMENT=true): user holds the
           'act_on_behalf_of_company' platform permission → allow.
         A successful cross-tier bypass writes one
         AuditLog(action='cross_tier.company_access') row regardless of
         what the underlying endpoint also audits.
      2. Company owner OR seeded 'Owner' / 'Company Admin' role → allow.
         Named bypass: their seeded permission set is intended to be "all"
         and we don't want a forgotten re-seed to silently strip them when
         a new permission is added to the catalogue.
      3. Other CompanyUserRole assignments: union CompanyRole.permissions
         across every role the user holds in this company, check membership.
      4. Else 403 + audit row (action='permission.denied').

  require_platform_permission(code)
    Same shape but operates on PlatformRole.permissions. Reserved for
    Phase 2 — exposed here so the catalogue can declare both guards from
    one import point.
"""

from __future__ import annotations

import os
from typing import Callable, Iterable, Optional

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from core import config
from core.dependencies import get_current_user
from core.model import AuditLog, Company, CompanyRole, User
from core.roles import CompanyRole as CompanyRoleEnum
from db_models.crud.role import get_roles_for_user
from db_models.crud.user import get_roles_for_private_user


# Seeded role names that the company-side guard treats as "all permissions"
# without consulting the JSONB. Two reasons each name is in here:
#
#   - "Owner" / "Company Admin": seeded in SYSTEM_ROLES (api/v1/company_roles.py)
#     with the full permission set. The named bypass means a forgotten re-seed
#     can't silently strip them when a new permission is added to the catalogue.
#
#   - "owner" / "admin" / "manager": legacy CompanyRoleEnum values stored in
#     CompanyUserRole.role rows. These exist on every customer today and
#     `require_company_admin` already treats them as authorised. Including
#     them here keeps the Phase 1 cutover non-breaking — tightening to a
#     strict permission check on Manager is a separate, opt-in change.
_SEEDED_COMPANY_ADMIN_ROLE_NAMES = {
    "Owner", "Company Admin",  # SYSTEM_ROLES seed names
    "owner", "admin", "manager",  # legacy CompanyRoleEnum values
}


def _platform_perm_enforcement_enabled() -> bool:
    """Phase 2 cutover flag — see plan section 2.6."""
    return os.environ.get("PLATFORM_PERM_ENFORCEMENT", "false").lower() in ("1", "true", "yes")


def company_rbac_enabled() -> bool:
    """Delegated-management-roles rollout flag (COMPANY-RBAC-PLAN.md). When OFF
    (default), the web admits owners only and company endpoints use the broad
    require_company_scope gate — i.e. exactly today's behavior. When ON, a private
    user holding a company management role can use the web employer dashboard, and
    company routes enforce fine-grained require_company_permission. Read at request
    time so it can be flipped without a redeploy; surfaced to the web in the
    login/me payload so the client mirrors it."""
    return os.environ.get("COMPANY_RBAC_ENABLED", "false").lower() in ("1", "true", "yes")


def _platform_permissions_for_user(user: User, db: Session) -> set[str]:
    """Union of permissions across every PlatformRole the user holds.

    Returns an empty set if the user has no platform roles or the column
    hasn't been migrated yet (Phase 2 alembic). When the underlying query
    raises (typically: "column platform_roles.permissions does not exist"
    pre-migration), we MUST rollback the session — Postgres aborts the
    whole transaction on a query error, and any later lazy-load in the
    same request will fail with InFailedSqlTransaction.
    """
    if not getattr(user, "user_id", None):
        return set()
    try:
        from core.platform_role import PlatformRole, UserPlatformRole
        rows = (
            db.query(PlatformRole.permissions)
            .join(UserPlatformRole, UserPlatformRole.role_id == PlatformRole.role_id)
            .filter(UserPlatformRole.user_id == user.user_id)
            .all()
        )
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        return set()
    perms: set[str] = set()
    for (raw,) in rows:
        if not raw:
            continue
        try:
            perms.update(str(p) for p in raw)
        except TypeError:
            continue
    return perms


def _write_audit(
    db: Session,
    *,
    actor_user_id: Optional[int],
    action: str,
    target_type: str,
    target_id: Optional[str],
    meta: dict,
) -> None:
    """Best-effort audit row. Never raises — the request the audit
    describes has already been decided; we shouldn't 500 trying to log it.
    """
    try:
        db.add(AuditLog(
            actor_user_id=actor_user_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            meta=meta,
        ))
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass


def _is_legacy_platform_admin(user: User, db: Session) -> bool:
    """True if the user holds the literal 'platform_admin' role (or any
    platform role at all, mirroring `auth_guards.require_company_admin`'s
    current loose check)."""
    if getattr(user, "is_superuser", False):
        return True
    try:
        roles = get_roles_for_user(user.user_id, db)
    except Exception:
        return False
    if not roles:
        return False
    # Match the existing loose check: any platform role membership counts.
    # Phase 2 narrows this via the permission flag (see below).
    return True


def _cross_tier_bypass_allowed(user: User, db: Session) -> bool:
    """Phase 1: any platform role. Phase 2 (flag on):
    requires 'act_on_behalf_of_company' permission."""
    if getattr(user, "is_superuser", False):
        return True
    if not _platform_perm_enforcement_enabled():
        return _is_legacy_platform_admin(user, db)
    return "act_on_behalf_of_company" in _platform_permissions_for_user(user, db)


def _company_permissions_for_user(
    user: User, company_id: int, db: Session,
) -> tuple[set[str], list[str]]:
    """Returns (union of permissions, list of role names) for the user
    on this company. Empty if the user has no company role for this company.

    Owner-by-user-id (`companies.user_id == user.user_id`) is treated as
    having the "Owner" role name so the seeded-admin bypass picks it up.
    """
    role_names: list[str] = []

    # Company owner is implicitly Owner.
    if getattr(user, "company", None) and user.company.company_id == company_id:
        role_names.append("Owner")

    # Multi-role rows via CompanyUserRole.
    if getattr(user, "private_user", None):
        try:
            extra = get_roles_for_private_user(
                company_id, user.private_user.private_user_id, db,
            )
            role_names.extend(extra or [])
        except Exception:
            pass

    if not role_names:
        return (set(), [])

    # Resolve permissions for each named role from the CompanyRole catalogue.
    # CompanyUserRole.role stores a normalized slug ("hr_manager") while
    # CompanyRole.name is the display name ("HR Manager"), so a literal IN match
    # misses every custom role (resolving to ∅ — safe but broken). Match on a
    # normalized form (lower + underscore) on BOTH sides so custom roles resolve
    # their permissions, not just the legacy owner/admin/manager names.
    def _norm(n: str) -> str:
        return str(n).strip().lower().replace(" ", "_")

    wanted = {_norm(n) for n in role_names}
    rows = (
        db.query(CompanyRole.name, CompanyRole.permissions)
        .filter(CompanyRole.company_id == company_id)
        .all()
    )
    perms: set[str] = set()
    for (name, raw) in rows:
        if _norm(name) not in wanted:
            continue
        if not raw:
            continue
        try:
            perms.update(str(p) for p in raw)
        except TypeError:
            continue
    return (perms, role_names)


def company_access_for_user(user: User, db: Session) -> tuple[list[str], list[str]]:
    """Resolve (sorted permissions, role names) for the company the user's session
    is bound to. Resolve it the SAME way the login token / RLS does
    (services/user_service.py): an employee/role-holder's ``private_user.company_id``
    FIRST, then the owner's own ``companies.user_id``. This keeps the surfaced
    ``company_permissions``/``company_roles`` consistent with the tenant the token
    binds — a user who owns one company but is a delegated role-holder in another
    must get THAT company's role, not their owned company's Owner role. Empty when
    the user has no company. Best-effort: returns ([], []) on any error."""
    try:
        cid = None
        if getattr(user, "private_user", None) and user.private_user.company_id:
            cid = user.private_user.company_id
        elif getattr(user, "company", None):
            cid = user.company.company_id
        if cid is None:
            return ([], [])
        perms, role_names = _company_permissions_for_user(user, cid, db)
        return (sorted(perms), list(role_names))
    except Exception:
        return ([], [])


def _company_id_from_request_or_user(request: Request, user: User) -> Optional[int]:
    """Company id from path/query, else the caller's session company. When implicit,
    resolve the SAME way the token / RLS does — employee/role-holder's
    ``private_user.company_id`` first, then the owner's own company — so a dual
    owner+employee account is scoped to the company it's acting in."""
    cid = _resolve_company_id_from_request(request)
    if cid is not None:
        return cid
    if getattr(user, "private_user", None) and user.private_user.company_id:
        return user.private_user.company_id
    if getattr(user, "company", None):
        return user.company.company_id
    return None


def require_company_permission_gated(permission_code: str):
    """Flag-aware company gate for the RBAC migration (COMPANY-RBAC-PLAN.md).

    OFF (default): behaves like require_company_scope — superuser / company admin /
    any member of the company passes. Exactly today's behavior, so adding this is a
    no-op until COMPANY_RBAC_ENABLED is flipped.

    ON: enforces ``permission_code`` via assert_company_permission (owner/admin
    bypass inside), so a delegated management-role employee passes only if their
    role grants it. Resolves company_id from path/query, else the caller's own
    company.
    """
    def _dep(
        request: Request,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(config.get_db),
    ) -> User:
        company_id = _company_id_from_request_or_user(request, current_user)
        if company_id is None:
            raise HTTPException(status_code=400, detail="company_id is required to authorize this action")
        if not company_rbac_enabled():
            from core.roles import is_company_admin_for
            if getattr(current_user, "is_superuser", False):
                return current_user
            if is_company_admin_for(current_user, company_id, db):
                return current_user
            pu = getattr(current_user, "private_user", None)
            if pu and getattr(pu, "company_id", None) == company_id:
                return current_user
            raise HTTPException(status_code=403, detail="Not permitted to access this company")
        assert_company_permission(current_user, company_id, permission_code, db,
                                  endpoint=str(request.url.path), method=request.method)
        return current_user
    return _dep


def _resolve_company_id_from_request(request: Request) -> Optional[int]:
    """Default company_id resolver: look in path_params first, then query
    params. Endpoints that derive company_id from a target resource (e.g.
    /private-users/{id}/...) should pass a custom resolver instead."""
    pp = request.path_params or {}
    if "company_id" in pp:
        try:
            return int(pp["company_id"])
        except (TypeError, ValueError):
            return None
    qp = request.query_params
    raw = qp.get("company_id") if qp else None
    if raw:
        try:
            return int(raw)
        except (TypeError, ValueError):
            return None
    return None


def require_company_permission(
    permission_code: str,
    *,
    resolve_company_id: Callable[[Request, Session, User], Optional[int]] | None = None,
):
    """FastAPI dependency factory — see module docstring for resolution order.

    `resolve_company_id` lets callers plug in a custom company-id extractor
    (e.g. derive from `private_user_id` path param). Defaults to reading
    `company_id` from path_params or query_params.
    """
    resolver = resolve_company_id or (lambda req, _db, _u: _resolve_company_id_from_request(req))

    def _dep(
        request: Request,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(config.get_db),
    ) -> User:
        company_id = resolver(request, db, current_user)
        if company_id is None:
            raise HTTPException(
                status_code=400,
                detail="company_id is required to authorize this action",
            )

        # 1. Cross-tier bypass (platform user acting on employer).
        if _cross_tier_bypass_allowed(current_user, db):
            _write_audit(
                db,
                actor_user_id=current_user.user_id,
                action="cross_tier.company_access",
                target_type="company",
                target_id=str(company_id),
                meta={
                    "permission": permission_code,
                    "endpoint": str(request.url.path),
                    "method": request.method,
                    "phase": "v2" if _platform_perm_enforcement_enabled() else "v1_legacy",
                },
            )
            return current_user

        # 2. Seeded admin bypass (Owner / Company Admin / company owner).
        user_perms, role_names = _company_permissions_for_user(current_user, company_id, db)
        if any(rn in _SEEDED_COMPANY_ADMIN_ROLE_NAMES for rn in role_names):
            return current_user

        # 3. Strict JSONB permission check.
        if permission_code in user_perms:
            return current_user

        # 4. Refuse + audit. Confirm the company exists so we return the
        # more actionable 404 if the path scope is invalid.
        company = (
            db.query(Company).filter(Company.company_id == company_id).one_or_none()
        )
        if company is None:
            raise HTTPException(
                status_code=404, detail=f"Company {company_id} not found",
            )

        _write_audit(
            db,
            actor_user_id=current_user.user_id,
            action="permission.denied",
            target_type="endpoint",
            target_id=str(request.url.path),
            meta={
                "permission": permission_code,
                "company_id": company_id,
                "roles": role_names,
                "method": request.method,
            },
        )
        raise HTTPException(
            status_code=403,
            detail=(
                f"You need the '{permission_code}' permission to perform this action. "
                f"(Your roles on this company: {', '.join(role_names) or '(none)'})"
            ),
        )

    return _dep


def require_company_permission_for_target(
    permission_code: str,
    target_resolver: Callable[[Request, Session], int],
):
    """Variant for endpoints that derive company_id from a target resource
    (e.g. `/private-users/{private_user_id}/salary-assignments` where the
    company is the target employee's `company_id`).

    `target_resolver(request, db) -> company_id` is called once per request
    to convert the path/body context into a company_id.
    """
    return require_company_permission(
        permission_code,
        resolve_company_id=lambda req, db, _u: target_resolver(req, db),
    )


def assert_company_permission(
    user: User,
    company_id: int,
    permission_code: str,
    db: Session,
    *,
    endpoint: str = "",
    method: str = "",
) -> None:
    """Inline check for endpoints where `company_id` lives in the JSON body
    and is therefore unavailable to FastAPI's Depends() at parse time.

    Same resolution order as `require_company_permission`; raises
    HTTPException on denial and writes the same audit rows on bypass and
    denial. Call this AFTER you've parsed the payload and know the
    target company_id.
    """
    # 1. Cross-tier bypass.
    if _cross_tier_bypass_allowed(user, db):
        _write_audit(
            db,
            actor_user_id=user.user_id,
            action="cross_tier.company_access",
            target_type="company",
            target_id=str(company_id),
            meta={
                "permission": permission_code,
                "endpoint": endpoint,
                "method": method,
                "phase": "v2" if _platform_perm_enforcement_enabled() else "v1_legacy",
            },
        )
        return

    # 2. Seeded admin bypass.
    user_perms, role_names = _company_permissions_for_user(user, company_id, db)
    if any(rn in _SEEDED_COMPANY_ADMIN_ROLE_NAMES for rn in role_names):
        return

    # 3. Strict JSONB lookup.
    if permission_code in user_perms:
        return

    # 4. Refuse + audit.
    from core.model import Company as _Company
    company = (
        db.query(_Company).filter(_Company.company_id == company_id).one_or_none()
    )
    if company is None:
        raise HTTPException(status_code=404, detail=f"Company {company_id} not found")

    _write_audit(
        db,
        actor_user_id=user.user_id,
        action="permission.denied",
        target_type="endpoint",
        target_id=endpoint or "(inline)",
        meta={
            "permission": permission_code,
            "company_id": company_id,
            "roles": role_names,
            "method": method,
        },
    )
    raise HTTPException(
        status_code=403,
        detail=(
            f"You need the '{permission_code}' permission to perform this action. "
            f"(Your roles on this company: {', '.join(role_names) or '(none)'})"
        ),
    )


def has_company_permission(user: User, company_id: int, permission_code: str, db: Session) -> bool:
    """Non-raising sibling of `assert_company_permission`. True if the user may
    perform `permission_code` on `company_id`. Same resolution: platform
    cross-tier bypass → seeded owner/admin role-name fallback → strict DB
    permission lookup. Use for flag-style branching (e.g. self-OR-admin) where a
    boolean is needed instead of a 403. The DB permission set is the primary
    signal; the role-name set is only the fallback for unseeded companies."""
    try:
        if _cross_tier_bypass_allowed(user, db):
            return True
        user_perms, role_names = _company_permissions_for_user(user, company_id, db)
        if any(rn in _SEEDED_COMPANY_ADMIN_ROLE_NAMES for rn in role_names):
            return True
        return permission_code in user_perms
    except Exception:
        return False


def require_platform_permission(permission_code: str):
    """Fine-grained gate for platform-admin endpoints (Phase 2).

    Inherits the web-audience constraint from the legacy
    `api.v1.admin.require_platform_admin`: tokens issued for mobile clients
    cannot pass this gate even if their user happens to hold the right
    permissions. Admin endpoints are intentionally web-only.

    Resolution order (after the audience check):
      1. is_superuser → allow.
      2. Legacy 'platform_admin' role assignment → allow (named bypass,
         keeps existing deployments working when the catalogue grows).
      3. Otherwise: check `permission_code` against the union of
         PlatformRole.permissions for the user.
      4. Else 403 + audit row.
    """

    def _dep(
        request: Request,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(config.get_db),
    ) -> User:
        # Web-only audience — mirrors require_platform_admin semantics.
        try:
            from core.dependencies import get_token_payload  # local import to avoid cycles
            payload = get_token_payload(request)
        except Exception:
            payload = {}
        if payload.get("aud") and payload.get("aud") != "web":
            raise HTTPException(
                status_code=403, detail="Admin endpoints are web-only.",
            )

        if getattr(current_user, "is_superuser", False):
            return current_user

        # Legacy platform_admin name remains a bypass — it's the closest
        # thing to "root" the system has and removing it would brick
        # existing deployments. Phase 2 catalogue still seeds it with
        # the full permission set as defense in depth.
        try:
            from db_models.crud.role import user_has_role_by_user_id
            if user_has_role_by_user_id(current_user.user_id, "platform_admin", db):
                return current_user
        except Exception:
            pass

        perms = _platform_permissions_for_user(current_user, db)
        if permission_code in perms:
            return current_user

        _write_audit(
            db,
            actor_user_id=current_user.user_id,
            action="permission.denied",
            target_type="endpoint",
            target_id=str(request.url.path),
            meta={
                "permission": permission_code,
                "tier": "platform",
                "method": request.method,
            },
        )
        raise HTTPException(
            status_code=403,
            detail=f"You need the platform '{permission_code}' permission to perform this action.",
        )

    return _dep
