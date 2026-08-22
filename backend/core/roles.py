"""
Company role definitions and utilities.

This module provides centralized management of company-level roles
to ensure consistency across the backend.
"""

from enum import Enum
from typing import Set


class CompanyRole(str, Enum):
    """
    Enumeration of roles that a user can have within a company.
    
    These roles determine what actions a user can perform within 
    a company's context (managing employees, departments, etc.).
    """
    OWNER = "owner"      # Company owner (full access)
    ADMIN = "admin"      # Administrator (near-full access)
    MANAGER = "manager"  # Manager (team/department management)
    MEMBER = "member"    # Regular member (limited access)
    VIEWER = "viewer"    # Read-only access
    
    @classmethod
    def admin_roles(cls) -> Set[str]:
        """Roles that grant company admin privileges."""
        return {cls.OWNER.value, cls.ADMIN.value, cls.MANAGER.value}
    
    @classmethod
    def is_admin_role(cls, role: str) -> bool:
        """Check if a role grants company admin privileges."""
        return role in cls.admin_roles()
    
    @classmethod
    def all_roles(cls) -> Set[str]:
        """All available company roles."""
        return {r.value for r in cls}


def is_company_admin(user) -> bool:
    """
    Check if a user has company admin privileges.
    
    A user is considered a company admin if:
    1. They are a company owner (user_type == 'company' and have a company)
    2. They have an admin-level role in their PrivateUser record
    
    Args:
        user: The User model instance to check
        
    Returns:
        bool: True if user has company admin privileges
    """
    # Company owner is automatically an admin. NB: user.user_type is a plain
    # enum.Enum (core.model.UserType), so `== 'company'` is ALWAYS False — the
    # historic root cause of owners being reported as non-admins. Normalize to
    # the enum's string value before comparing (handles both the enum and any
    # already-serialized string form).
    _ut = getattr(user.user_type, 'value', user.user_type)
    if _ut == 'company' and user.company:
        return True
    
    # PrivateUser with admin role
    if user.private_user and CompanyRole.is_admin_role(user.private_user.role):
        return True
    
    return False


def has_platform_permission(user, code: str, db) -> bool:
    """True if the user holds platform permission `code`.

    Resolution: superuser (platform_admin) → True; otherwise check `code`
    against the union of the user's PlatformRole.permissions. Returns False
    for non-platform users or pre-migration schemas (the underlying lookup
    swallows the missing-column case)."""
    if getattr(user, 'is_superuser', False):
        return True
    if not getattr(user, 'user_id', None):
        return False
    try:
        from core.permission_guards import _platform_permissions_for_user
        return code in _platform_permissions_for_user(user, db)
    except Exception:
        return False


def is_platform_operator(user, db) -> bool:
    """True if the user is a platform operator able to reach into employer
    data — i.e. holds any cross-tier permission (read or write). Used to let
    support/engineering/compliance roles see a company even when it's
    disabled or soft-deleted."""
    if getattr(user, 'is_superuser', False):
        return True
    return (
        has_platform_permission(user, 'read_any_company_data', db)
        or has_platform_permission(user, 'act_on_behalf_of_company', db)
    )


def can_read_company(user, company_id: int, db) -> bool:
    """Read-tier access to a specific company's data: company admins/members
    plus platform operators holding `read_any_company_data` (or write
    authority, which implies read)."""
    if is_company_admin_for(user, company_id, db):
        return True
    return (
        has_platform_permission(user, 'read_any_company_data', db)
        or has_platform_permission(user, 'act_on_behalf_of_company', db)
    )


def is_company_admin_for(user, company_id: int, db) -> bool:
    """
    Check if a user has company admin privileges for a specific company.

    Uses the multi-role CompanyUserRole system to check if user has
    any admin-level role (owner, admin, manager) for the specified company.

    Args:
        user: The User model instance to check
        company_id: The target company ID
        db: Database session for querying roles

    Returns:
        bool: True if user has admin privileges for the specified company
    """
    # Superuser can manage any company
    if getattr(user, 'is_superuser', False):
        return True

    # Platform operator with cross-tier WRITE authority can administer any
    # company. Only platform_admin holds this today (already caught above);
    # this branch future-proofs custom platform roles granted the permission
    # without making them full superusers.
    if has_platform_permission(user, 'act_on_behalf_of_company', db):
        return True

    # Company owner — query by both company_id and the owner FK so the check
    # is exact and the tenant_guard sees a company_id-filtered statement
    # (vs. the user.company lazy-load, which filters only on user_id).
    from core.model import Company
    owns = (
        db.query(Company.company_id)
        .filter(Company.company_id == company_id, Company.user_id == user.user_id)
        .first()
    )
    if owns:
        return True

    # Check multi-role system via database. A role grants company-admin if it is
    # one of the platform-SEEDED admin roles. Use the SAME canonical set the
    # permission guard uses (_SEEDED_COMPANY_ADMIN_ROLE_NAMES — includes the
    # seeded "Company Admin"), unioned with the legacy admin_roles() enum
    # {owner,admin,manager} which is now just an additional fallback. Both sides
    # normalized, since a role may be stored as a slug ("company_admin") or a
    # display name ("Company Admin"). This is the *fallback* for permission-less
    # admin endpoints; permission-gated endpoints use assert_company_permission.
    if user.private_user:
        try:
            from db_models.crud.user import get_roles_for_private_user
            from core.permission_guards import _SEEDED_COMPANY_ADMIN_ROLE_NAMES
            roles = get_roles_for_private_user(company_id, user.private_user.private_user_id, db)

            def _norm(n: str) -> str:
                return str(n).strip().lower().replace(" ", "_")

            admin_set = {_norm(r) for r in (CompanyRole.admin_roles() | _SEEDED_COMPANY_ADMIN_ROLE_NAMES)}
            return any(_norm(role) in admin_set for role in roles)
        except Exception:
            pass

    return False


# Platform-level role names (rows in the `platform_roles` table, seeded at deploy).
PLATFORM_ROLE_COMPLIANCE_OFFICER = "compliance_officer"
PLATFORM_ROLE_ADMIN = "platform_admin"


def is_compliance_officer(user, db) -> bool:
    """Check whether the user holds the `compliance_officer` platform role.

    Platform admins are NOT compliance officers — they're separate roles. Use
    `is_compliance_or_platform_admin` if either role should pass.
    """
    if not getattr(user, "user_id", None):
        return False
    try:
        from db_models.crud.role import user_has_role_by_user_id
        return user_has_role_by_user_id(user.user_id, PLATFORM_ROLE_COMPLIANCE_OFFICER, db)
    except Exception:
        return False


def is_company_admin_by_user_id(user_id: int, company_id: int, db) -> bool:
    """Like `is_company_admin_for` but takes a raw user_id instead of a
    User instance. Used by the conflict-of-interest gate on POST /user-right
    where we have a `named_parties` list of {user_id, label} entries and
    need to check each against admin status without an extra User load round-trip.

    Returns False on any error rather than raising — the caller treats a
    "we don't know" as "not an admin" (safer default: case stays internal).
    """
    if not user_id or not company_id:
        return False
    try:
        from core.model import User as UserModel
        u = db.query(UserModel).filter(UserModel.user_id == user_id).first()
        if u is None:
            return False
        return is_company_admin_for(u, company_id, db)
    except Exception:
        return False


def is_compliance_or_platform_admin(user, db) -> bool:
    """True if the user can act on Kiruko Compliance cases.

    Mirrors the gate already in place on `GET /user/disputes/compliance`
    (api/v1/user.py around line 1640) so the PATCH gate stays consistent.
    """
    if getattr(user, "is_superuser", False):
        return True
    if not getattr(user, "user_id", None):
        return False
    try:
        from db_models.crud.role import user_has_role_by_user_id
        return (
            user_has_role_by_user_id(user.user_id, PLATFORM_ROLE_ADMIN, db)
            or user_has_role_by_user_id(user.user_id, PLATFORM_ROLE_COMPLIANCE_OFFICER, db)
        )
    except Exception:
        return False
