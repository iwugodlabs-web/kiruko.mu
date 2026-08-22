from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, Query as _Query
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel, EmailStr, Field
from datetime import datetime, timedelta
import secrets
import os

from core import config
from core.model import User, PrivateUser, Company
from core.dependencies import get_current_user, get_token_payload
from core.permission_guards import require_platform_permission
from core.security import generate_passwd_hash
from db_models.crud.user import get_user_by_email
from db_models.crud.role import (
    assign_role_to_user, get_roles_for_user, get_all_roles, 
    create_role, update_role, delete_role, get_role_user_count,
    remove_role_from_user
)
import logging

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/admin",
    tags=['Admin']
)

# Pydantic models
class InvitePlatformUserRequest(BaseModel):
    email: EmailStr
    role: str  # platform_admin or company_admin
    first_name: Optional[str] = None
    last_name: Optional[str] = None

class PlatformUserResponse(BaseModel):
    user_id: int
    email: str
    roles: List[str]
    is_active: bool
    created_at: datetime
    last_login: Optional[datetime] = None
    company: Optional[dict] = None

    class Config:
        from_attributes = True

class CreateRoleRequest(BaseModel):
    name: str
    description: Optional[str] = None
    # Phase 2 — optional permission set assigned at creation time.
    # Validated against `core.platform_permissions.all_permissions()`.
    permissions: Optional[List[str]] = None

class UpdateRoleRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class PermissionsUpdate(BaseModel):
    """Replaces a role's permission array wholesale."""
    permissions: List[str]


def require_platform_admin(
    current_user: User = Depends(get_current_user),
    payload: dict = Depends(get_token_payload),
    db: Session = Depends(config.get_db),
):
    """Dependency: token must be web-audience AND user must currently hold the
    platform_admin role in the DB.

    The DB role is authoritative — we deliberately do NOT trust the
    `is_superuser` claim embedded in the JWT at login time, even though it's
    convenient. Why: JWTs live for hours, but role assignments can be
    revoked instantly when a contractor leaves or an account is compromised.
    If the gate trusts the claim, a revoked admin keeps platform-wide
    access until their token expires. Checking the DB on every admin
    request costs one indexed lookup and closes that window.

    Same rule applies to anyone whose `user_type='company'` (employer
    owners) or `user_type='private'` (employees) without an explicit
    platform_admin role row — they are firewalled out of /admin/* regardless
    of what their token says.
    """
    if payload.get("aud") != "web":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin endpoints are web-only.",
        )

    try:
        roles = get_roles_for_user(current_user.user_id, db)
        if "platform_admin" not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Platform admin role required.",
            )
        return current_user
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error checking platform admin role: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Authorization check failed")


@router.post('/invite-platform-user', status_code=status.HTTP_201_CREATED)
async def invite_platform_user(
    invite_data: InvitePlatformUserRequest,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db)
):
    """
    Invite a new platform administrator or company admin.
    Only accessible by platform_admin role.
    """
    try:
        # Check if user already exists
        existing_user = get_user_by_email(invite_data.email, db)
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User with this email already exists"
            )

        # Validate role exists in database
        from db_models.crud.role import get_role_by_name
        role_obj = get_role_by_name(invite_data.role, db)
        if not role_obj:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Role '{invite_data.role}' does not exist"
            )

        # Create invite record
        from db_models.crud.invite import create_invite
        invite = create_invite(
            email=invite_data.email,
            role_name=invite_data.role,
            invited_by=current_user.user_id,
            db=db
        )

        # Send invite email
        from services.email_service import send_platform_invite_email
        try:
            # Get inviter's name if available
            inviter_name = None
            if hasattr(current_user, 'email'):
                inviter_name = current_user.email.split('@')[0]
            
            send_platform_invite_email(
                email=invite_data.email,
                role_name=invite_data.role,
                token=invite.token,
                invited_by_name=inviter_name
            )
            logger.info(f"Platform invite email sent to {invite_data.email}")
        except Exception as e:
            logger.error(f"Failed to send invite email: {e}")
            # Continue even if email fails - invite is created

        logger.info(f"Platform invite created: {invite_data.email} with role {invite_data.role}")

        return {
            "status": "success",
            "message": f"Invitation sent to {invite_data.email}",
            "invite_id": invite.invite_id,
            "email": invite.email,
            "role": invite.role_name,
            "expires_at": invite.expires_at.isoformat()
        }

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error inviting platform user: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create invitation"
        )


@router.get('/platform-users', response_model=dict)
async def get_platform_users(
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db)
):
    """
    Get all platform users (users with platform_admin or company_admin roles).
    Only accessible by platform_admin role.
    """
    try:
        from sqlalchemy.orm import joinedload
        from core.platform_role import UserPlatformRole

        # Only users who hold at least one platform role. Loading the company
        # is enough — we deliberately do NOT eager-load jobs/salaries (as
        # get_all_user does): this endpoint never uses them, the extra joins
        # trip the tenant_guard, and decoding salary numerics has crashed
        # pg8000 with "Unknown PG numeric type" on some rows.
        users = (
            db.query(User)
            .join(UserPlatformRole, UserPlatformRole.user_id == User.user_id)
            .options(joinedload(User.company))
            .distinct()
            .all()
        )

        platform_users = []
        for user in users:
            roles = get_roles_for_user(user.user_id, db)
            if not roles:
                continue
            company_info = None
            if getattr(user.user_type, 'value', user.user_type) == 'company' and getattr(user, 'company', None):
                company_info = {
                    "company_name": user.company.company_name,
                    "brn": user.company.brn,
                }
            platform_users.append({
                "user_id": user.user_id,
                "email": user.email,
                "roles": roles,
                "is_active": user.user_enabled,
                "created_at": user.created_at.isoformat() if user.created_at else None,
                "last_login": None,  # TODO: Track last login
                "company": company_info,
            })

        return {
            "status": "success",
            "data": platform_users
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching platform users: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch platform users"
        )


# ============ ROLE MANAGEMENT ENDPOINTS ============

@router.get('/roles', response_model=dict)
async def get_roles(
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db)
):
    """
    Get all platform roles with user counts and permission arrays.
    Only accessible by platform_admin role.
    """
    try:
        roles = get_all_roles(db)
        roles_data = []

        for role in roles:
            user_count = get_role_user_count(role.role_id, db)
            roles_data.append({
                "role_id": role.role_id,
                "name": role.name,
                "description": role.description,
                "system": role.system,
                "permissions": list(role.permissions or []),
                "user_count": user_count,
                "created_at": role.created_at.isoformat() if role.created_at else None
            })

        return {
            "status": "success",
            "data": roles_data
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching roles: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch roles"
        )


@router.post('/roles', status_code=status.HTTP_201_CREATED)
async def create_new_role(
    role_data: CreateRoleRequest,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db)
):
    """
    Create a new custom platform role. Optionally accepts an initial
    permission set; validated against the platform catalogue.
    Only accessible by platform_admin role.
    """
    try:
        from core.platform_permissions import all_permissions
        permissions = role_data.permissions
        if permissions is not None:
            unknown = set(permissions) - all_permissions()
            if unknown:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Unknown permission codes: {sorted(unknown)}",
                )
        role = create_role(role_data.name, role_data.description, db, permissions=permissions)

        return {
            "status": "success",
            "message": "Role created successfully",
            "data": {
                "role_id": role.role_id,
                "name": role.name,
                "description": role.description,
                "system": role.system,
                "permissions": list(role.permissions or []),
                "created_at": role.created_at.isoformat() if role.created_at else None
            }
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating role: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create role"
        )


@router.put('/roles/{role_id}', response_model=dict)
async def update_existing_role(
    role_id: int,
    role_data: UpdateRoleRequest,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db)
):
    """
    Update a platform role (cannot update system roles).
    Only accessible by platform_admin role.
    """
    try:
        role = update_role(role_id, role_data.name, role_data.description, db)
        
        return {
            "status": "success",
            "message": "Role updated successfully",
            "data": {
                "role_id": role.role_id,
                "name": role.name,
                "description": role.description,
                "system": role.system,
                "created_at": role.created_at.isoformat() if role.created_at else None
            }
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating role: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update role"
        )


@router.delete('/roles/{role_id}', status_code=status.HTTP_204_NO_CONTENT)
async def delete_existing_role(
    role_id: int,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db)
):
    """
    Delete a platform role (cannot delete system roles or roles with users).
    Only accessible by platform_admin role.
    """
    try:
        delete_role(role_id, db)
        return None

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting role: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete role"
        )


# ─── Phase 2 — platform permissions catalogue + role permission editing ─────


@router.get('/permissions', response_model=dict)
async def list_platform_permissions(
    current_user: User = Depends(require_platform_admin),
):
    """Return the full platform permission catalogue, grouped by feature.

    Shape mirrors the company-side `GET /company/{id}/permissions` response
    so the web UI can reuse its grouping/render code.
    """
    from core.platform_permissions import PERMISSION_GROUPS

    groups = [
        {"name": name, "permissions": perms}
        for name, perms in PERMISSION_GROUPS.items()
    ]
    return {
        "status": "success",
        "data": {
            "groups": groups,
            "total": sum(len(p) for p in PERMISSION_GROUPS.values()),
        },
    }


@router.get('/roles/{role_id}/permissions', response_model=dict)
async def get_role_permissions(
    role_id: int,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db),
):
    """Read a single role's permission array."""
    from db_models.crud.role import get_role_by_id
    role = get_role_by_id(role_id, db)
    if role is None:
        raise HTTPException(status_code=404, detail="Role not found")
    return {
        "status": "success",
        "data": {
            "role_id": role.role_id,
            "name": role.name,
            "permissions": list(role.permissions or []),
        },
    }


@router.put('/roles/{role_id}/permissions', response_model=dict)
async def update_role_permissions(
    role_id: int,
    payload: PermissionsUpdate,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db),
):
    """Replace a role's permission array. Validates every code against
    the platform catalogue; unknown codes are rejected wholesale (no
    partial updates) so the caller can fix the typo and re-submit."""
    from core.platform_permissions import all_permissions
    from db_models.crud.role import set_role_permissions, get_role_by_id

    role = get_role_by_id(role_id, db)
    if role is None:
        raise HTTPException(status_code=404, detail="Role not found")
    # System platform roles (platform_admin, …) are code-defined and must stay
    # immutable via the API too — the UI already locks them, but without this an
    # API call could strip the top platform role and lock the platform team out.
    if role.system:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="System platform roles can't be edited (they're defined in code).",
        )

    unknown = set(payload.permissions) - all_permissions()
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown permission codes: {sorted(unknown)}",
        )
    role = set_role_permissions(role_id, payload.permissions, db)
    return {
        "status": "success",
        "data": {
            "role_id": role.role_id,
            "name": role.name,
            "permissions": list(role.permissions or []),
        },
    }


# ============ USER ROLE ASSIGNMENT ENDPOINTS ============

@router.post('/users/{user_id}/roles/{role_name}', response_model=dict)
async def assign_role_to_user_endpoint(
    user_id: int,
    role_name: str,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db)
):
    """
    Assign a role to a user.
    Only accessible by platform_admin role.
    """
    try:
        assign_role_to_user(user_id, role_name, current_user.user_id, db)
        
        return {
            "status": "success",
            "message": f"Role '{role_name}' assigned to user {user_id}"
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error assigning role: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to assign role"
        )


@router.delete('/users/{user_id}/roles/{role_name}', status_code=status.HTTP_204_NO_CONTENT)
async def remove_role_from_user_endpoint(
    user_id: int,
    role_name: str,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db)
):
    """
    Remove a role from a user.
    Only accessible by platform_admin role.
    """
    try:
        success = remove_role_from_user(user_id, role_name, db)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User does not have this role"
            )
        return None
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error removing role: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to remove role"
        )


@router.get('/platform-invites', response_model=dict)
async def get_platform_invites(
    status_filter: str | None = None,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db)
):
    """
    List all platform invites.
    Optional status filter: pending, accepted, expired, revoked
    """
    try:
        from db_models.crud.invite import get_all_invites, check_and_expire_invites
        
        # update expired invites first
        check_and_expire_invites(db)
        
        invites = get_all_invites(db, status_filter)
        
        formatted_invites = []
        for invite in invites:
            formatted_invites.append({
                "invite_id": invite.invite_id,
                "email": invite.email,
                "role": invite.role_name,
                "status": invite.status,
                "invited_by": invite.invited_by,
                "created_at": invite.created_at.isoformat(),
                "expires_at": invite.expires_at.isoformat(),
                "accepted_at": invite.accepted_at.isoformat() if invite.accepted_at else None
            })
            
        return {
            "status": "success",
            "data": formatted_invites
        }
    except Exception as e:
        logger.error(f"Error fetching platform invites: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch invites"
        )


@router.post('/invites/{invite_id}/resend', response_model=dict)
async def resend_invite(
    invite_id: int,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db)
):
    """
    Resend an invitation email.
    Regenerates token if expired.
    """
    try:
        from db_models.crud.invite import get_invite_by_id, generate_invite_token
        from services.email_service import send_platform_invite_email
        from datetime import datetime, timedelta
        import os

        invite = get_invite_by_id(invite_id, db)
        if not invite:
            raise HTTPException(status_code=404, detail="Invite not found")
            
        if invite.status == 'accepted':
            raise HTTPException(status_code=400, detail="Cannot resend accepted invite")
            
        # If expired or revoked, reactive it
        if invite.status in ['expired', 'revoked']:
            invite.status = 'pending'
            invite.token = generate_invite_token()
            expiry_days = int(os.getenv('INVITE_EXPIRY_DAYS', '7'))
            invite.expires_at = datetime.utcnow() + timedelta(days=expiry_days)
            db.commit()
            db.refresh(invite)
            
        # Send email
        inviter_name = None
        if hasattr(current_user, 'email'):
            inviter_name = current_user.email.split('@')[0]
            
        send_platform_invite_email(
            email=invite.email,
            role_name=invite.role_name,
            token=invite.token,
            invited_by_name=inviter_name
        )
        
        return {
            "status": "success",
            "message": f"Invitation resent to {invite.email}"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error resending invite: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to resend invite"
        )


@router.delete('/invites/{invite_id}', status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invite_endpoint(
    invite_id: int,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db)
):
    """
    Revoke a pending invitation.
    """
    try:
        from db_models.crud.invite import revoke_invite
        revoke_invite(invite_id, db)
        return None
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error revoking invite: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to revoke invite"
        )


@router.get('/companies/stats', status_code=200)
async def get_admin_companies_stats(
    country_code: Optional[str] = None,
    current_user: User = Depends(require_platform_permission('view_companies')),
    db: Session = Depends(config.get_db)
):
    """Aggregated company/employee/open-jobs totals, optionally scoped to one
    country. Backs the Employers page's stat cards — computed server-side via
    COUNT so it stays correct regardless of how many companies exist (the
    page's own list fetch is capped/paginated and isn't a safe source for a
    "total" figure). Declared before /companies/{company_id} so FastAPI
    doesn't try to match "stats" as a company_id path param."""
    from db_models.crud.company import get_companies_aggregated_stats
    return get_companies_aggregated_stats(db, country_code=country_code)


@router.get('/companies', status_code=200)
async def list_admin_companies(
    limit: int = 100,
    offset: int = 0,
    country_code: Optional[str] = None,
    current_user: User = Depends(require_platform_permission('view_companies')),
    db: Session = Depends(config.get_db)
):
    """List all companies. Requires the 'view_companies' permission. Includes disabled
    and soft-deleted companies so admins can manage and restore them.
    Optional country_code narrows to one country (the admin Country Switcher)."""
    from db_models.crud.company import get_companies
    companies = get_companies(limit=limit, offset=offset, db=db, include_inactive=True, country_code=country_code)
    return [
        {
            'company_id': c.company_id,
            'company_name': c.company_name,
            'brn': c.brn,
            'email': c.email,
            'address': getattr(c, 'address', None),
            'phone': getattr(c, 'phone', None),
            'annual_leave_budget': getattr(c, 'annual_leave_budget', None),
            'country_code': getattr(c, 'country_code', None),
            # Mirror the single-company endpoint so the listing UI can render
            # the ads_enabled toggle inline without a second round-trip per row.
            'ads_enabled': bool(getattr(c, 'ads_enabled', False)),
            'status': getattr(c, 'status', 'active'),
            'deleted_at': c.deleted_at.isoformat() if getattr(c, 'deleted_at', None) else None,
            'created_at': c.created_at.isoformat() if getattr(c, 'created_at', None) else None,
        }
        for c in companies
    ]


@router.get('/companies/{company_id}', status_code=200)
async def get_admin_company(
    company_id: int,
    current_user: User = Depends(require_platform_permission('view_companies')),
    db: Session = Depends(config.get_db)
):
    """Get a single company by ID. Requires the 'view_companies' permission."""
    from db_models.crud.company import get_company_by_id
    company = get_company_by_id(company_id, db)
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Company not found')
    return {
        'company_id': company.company_id,
        'company_name': company.company_name,
        'brn': company.brn,
        'email': company.email,
        'address': getattr(company, 'address', None),
        'phone': getattr(company, 'phone', None),
        'annual_leave_budget': getattr(company, 'annual_leave_budget', None),
        'country_code': getattr(company, 'country_code', None),
        # M9 — surface the ads master toggle so the admin UI can render the
        # /admin/employers/{id} toggle row without a second round-trip.
        'ads_enabled': bool(getattr(company, 'ads_enabled', False)),
        'status': getattr(company, 'status', 'active'),
        'deleted_at': company.deleted_at.isoformat() if getattr(company, 'deleted_at', None) else None,
        'created_at': company.created_at.isoformat() if getattr(company, 'created_at', None) else None,
    }


class CompanyStatusPayload(BaseModel):
    status: str = Field(..., description="active or disabled")


@router.post('/companies/{company_id}/status', status_code=200)
async def set_admin_company_status(
    company_id: int,
    payload: CompanyStatusPayload,
    current_user: User = Depends(require_platform_permission('manage_companies')),
    db: Session = Depends(config.get_db),
):
    """Enable or disable a company. Requires the 'manage_companies' permission."""
    from db_models.crud.company import set_company_status, log_audit
    if payload.status not in ('active', 'disabled'):
        raise HTTPException(status_code=400, detail="status must be 'active' or 'disabled'")
    company = set_company_status(company_id, payload.status, db)
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Company not found')
    log_audit(company_id, 'company.status_changed', current_user.user_id, f'company:{company_id}', db, metadata={'status': payload.status})
    return {'company_id': company.company_id, 'status': company.status}


@router.post('/companies/{company_id}/restore', status_code=200)
async def restore_admin_company(
    company_id: int,
    current_user: User = Depends(require_platform_permission('manage_companies')),
    db: Session = Depends(config.get_db),
):
    """Restore a disabled or soft-deleted company to active. Requires the 'manage_companies' permission."""
    from db_models.crud.company import restore_company, log_audit
    company = restore_company(company_id, db)
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Company not found')
    log_audit(company_id, 'company.restored', current_user.user_id, f'company:{company_id}', db)
    return {'company_id': company.company_id, 'status': company.status}


class UserEnabledPayload(BaseModel):
    enabled: bool


@router.patch('/users/{user_id}/enabled', status_code=200)
async def set_platform_user_enabled(
    user_id: int,
    payload: UserEnabledPayload,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db),
):
    """Platform-admin: enable or disable ANY user account (employer or employee),
    regardless of company association. A disabled user cannot use the app.
    Unlike PATCH /user/{id}/enable (company-scoped, edit_employee), this is the
    platform-wide control used by the admin All Users directory."""
    from db_models.crud.user import get_user_by_user_id, set_user_enabled
    from db_models.crud.audit import create_audit_log

    target = get_user_by_user_id(user_id, db)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='User not found')
    if target.user_id == current_user.user_id:
        raise HTTPException(status_code=400, detail="You can't disable your own account.")

    updated = set_user_enabled(user_id, payload.enabled, db)
    try:
        create_audit_log(
            db, current_user.user_id, 'platform.user.enabled_changed', 'user', user_id,
            {'enabled': payload.enabled},
        )
    except Exception:
        logger.warning('audit log for user enable/disable failed (non-fatal)')
    return {'user_id': user_id, 'user_enabled': updated.user_enabled}


@router.get('/all-users', status_code=200)
async def list_all_end_users(
    limit: int = 50,
    offset: int = 0,
    country_code: Optional[str] = None,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db),
):
    """Platform-admin directory of every END-user (employers + employees),
    EXCLUDING platform staff (anyone holding a platform role — super admin,
    support, engineer, compliance). Returns just the fields the admin
    All Users page + detail drawer need.

    Paginated ({data, total}, matching /admin/audit-logs) — this previously
    fetched and eager-loaded every user row in one shot, which doesn't scale
    as the user base grows. The staff exclusion happens at the DB level so
    offset/limit apply to the actually-visible rows, not the raw table.
    ``country_code`` (omit, or the switcher set to "All countries", for the
    unscoped view) is applied at the same DB level, so ``total`` and the
    paginated rows stay consistent with each other under a country filter —
    a client-side-only filter on top of server pagination would make the
    displayed total/page-count describe a different set than what's shown."""
    from db_models.crud.user import count_all_user, get_all_user
    from core.platform_role import UserPlatformRole

    staff_ids = {row[0] for row in db.query(UserPlatformRole.user_id).distinct().all()}
    total = count_all_user(db, exclude_user_ids=staff_ids, country_code=country_code)
    out = []
    for u in get_all_user(db, exclude_user_ids=staff_ids, limit=limit, offset=offset, country_code=country_code):
        try:
            pu = getattr(u, 'private_user', None)
            comp = getattr(u, 'company', None)
            dept = getattr(pu, 'department', None) if pu else None
            pu_comp = getattr(pu, 'company', None) if pu else None
            # Company-type users: country comes straight from Company.country_code.
            # Private-type users: effective_country_code resolves company-employee
            # (via their own PrivateUser.company, not the unrelated `comp` above,
            # which is only set for company-type users) vs independent/self-reported.
            out.append({
                'user_id': u.user_id,
                'email': u.email,
                'user_type': u.user_type.value if hasattr(u.user_type, 'value') else u.user_type,
                'onboard_complete': bool(u.onboard_complete),
                'user_verified': bool(u.user_verified),
                'user_enabled': bool(u.user_enabled),
                'created_at': u.created_at.isoformat() if getattr(u, 'created_at', None) else None,
                'country_code': (comp.country_code if comp else None) or (pu.effective_country_code if pu else None),
                'company': {'company_name': comp.company_name, 'country_code': comp.country_code} if comp else None,
                'private_user': ({
                    'private_user_id': pu.private_user_id,
                    'employee_code': getattr(pu, 'employee_code', None),
                    'first_name': pu.first_name,
                    'last_name': pu.last_name,
                    'phone': getattr(pu, 'phone', None),
                    'date_of_birth': pu.date_of_birth.isoformat() if getattr(pu, 'date_of_birth', None) else None,
                    'pass_port_number': getattr(pu, 'pass_port_number', None),
                    'department': {'name': getattr(dept, 'name', None)} if dept else None,
                    'jobs': [{'job_title': j.job_title} for j in (getattr(pu, 'jobs', None) or [])],
                    'company': {'company_name': pu_comp.company_name, 'country_code': pu_comp.country_code} if pu_comp else None,
                    'country_code': pu.effective_country_code,
                } if pu else None),
            })
        except Exception:
            logger.warning('all-users: skipped a row during serialization', exc_info=True)
            continue
    return {'data': out, 'total': total, 'limit': limit, 'offset': offset}


@router.get('/audit', status_code=200)
async def list_audit_logs(
    limit: int = 25,
    offset: int = 0,
    action: str = None,
    target_type: str = None,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db)
):
    """List audit logs with optional filters. Requires platform admin role."""
    from db_models.crud.audit import get_recent_audit_logs
    try:
        # Fetch a larger batch then filter/paginate in Python
        # (raw SQL query in CRUD, so we overfetch)
        batch_limit = (offset + limit) * 2 + 100
        all_logs = get_recent_audit_logs(db, limit=batch_limit)

        if action:
            all_logs = [l for l in all_logs if action.lower() in str(l.get('action', '')).lower()]
        if target_type:
            all_logs = [l for l in all_logs if target_type.lower() in str(l.get('resource_type', '')).lower()]

        total = len(all_logs)
        page = all_logs[offset:offset + limit]
        return {'data': page, 'total': total}
    except Exception as e:
        logger.error(f'Failed to fetch audit logs: {e}')
        return {'data': [], 'total': 0}


@router.get('/kiosks/fleet', status_code=200)
async def list_kiosk_fleet(
    include_inactive: bool = False,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db),
):
    """Fleet-wide kiosk device list across ALL companies (platform admin only).

    Powers the admin fleet-health overview: which tablets are online (recent
    heartbeat), which have gone quiet, and which have tokens nearing expiry.
    Health thresholds are derived client-side from last_seen_at /
    token_expires_at so they live in one place (the UI)."""
    from core.model import KioskDevice
    q = (
        db.query(KioskDevice, Company.company_name)
        .join(Company, Company.company_id == KioskDevice.company_id)
    )
    if not include_inactive:
        q = q.filter(KioskDevice.is_active.is_(True))
    rows = q.order_by(Company.company_name, KioskDevice.device_name).all()
    return {
        'data': [
            {
                'device_id': str(d.device_id),
                'device_name': d.device_name,
                'company_id': d.company_id,
                'company_name': company_name,
                'location': d.location,
                'is_active': d.is_active,
                'last_seen_at': d.last_seen_at.isoformat() if d.last_seen_at else None,
                'last_seen_ip': d.last_seen_ip,
                'token_expires_at': d.token_expires_at.isoformat() if d.token_expires_at else None,
                'created_at': d.created_at.isoformat() if d.created_at else None,
            }
            for d, company_name in rows
        ],
        'total': len(rows),
    }


@router.get('/stats')
async def get_platform_stats(
    country_code: Optional[str] = None,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db)
):
    """
    Get platform-wide statistics for admin dashboard.
    Returns counts, recent companies, and recent activity.

    `country_code` scopes companies/users/pending-verifications to that
    country (omit, or the switcher set to "All countries", for the
    unscoped platform-wide view). `recent_activity` stays platform-wide
    regardless — an audit-log action doesn't cleanly belong to one company
    the way a Job or Company row does (see /admin/audit for the same call).
    """
    try:
        from sqlalchemy import func, desc
        from db_models.crud.audit import get_recent_audit_logs
        from db_models.crud.user import scope_users_to_country

        company_q = db.query(Company)
        if country_code:
            company_q = company_q.filter(Company.country_code == country_code)
        total_companies = company_q.count()

        # Get recent companies (last 5), scoped the same way.
        recent_companies_query = company_q.order_by(desc(Company.company_id)).limit(5).all()
        recent_companies = [
            {
                "company_id": c.company_id,
                "company_name": c.company_name,
                "brn": c.brn,
                "email": c.email,
                "country_code": c.country_code,
                "created_at": None  # Add if timestamp exists
            }
            for c in recent_companies_query
        ]

        # Users with neither a Company nor a PrivateUser row yet (e.g. mid-
        # signup) aren't attributable to any country, so they never appear
        # in a per-country total_users even though the unscoped total counts
        # them — surfaced explicitly instead of leaving the sum of every
        # country's total_users silently short of the "All countries" figure.
        # Always platform-wide (NOT re-scoped by `country_code` below) —
        # these users don't belong to any single country in the first
        # place, so there's no per-country subset of them to report.
        unassigned_users = (
            db.query(User.user_id)
            .outerjoin(Company, Company.user_id == User.user_id)
            .outerjoin(PrivateUser, PrivateUser.user_id == User.user_id)
            .filter(Company.company_id.is_(None), PrivateUser.private_user_id.is_(None))
            .distinct()
            .count()
        )

        if country_code:
            # Same helper /admin/all-users uses — a user who is both a
            # company owner AND has their own PrivateUser row (real data:
            # an owner counted as their own employee) would be double-
            # counted by summing two separate company/private counts, so
            # this scopes+distincts a single User query instead.
            total_users = scope_users_to_country(db.query(User.user_id), db, country_code).distinct().count()
        else:
            total_users = db.query(User).count()

        # Get recent activity from audit logs — always platform-wide.
        try:
            recent_activity = get_recent_audit_logs(db, limit=10)
        except Exception:
            recent_activity = []

        # Get pending verifications count (if Job model has this)
        pending_verifications = 0
        try:
            from core.model import Job
            pending_verifications_q = db.query(Job).filter(
                Job.verification_status == 'pending'
            )
            if country_code:
                pending_verifications_q = pending_verifications_q.join(
                    Company, Company.company_id == Job.company_id
                ).filter(Company.country_code == country_code)
            pending_verifications = pending_verifications_q.count()
        except Exception:
            pass

        return {
            "total_companies": total_companies,
            "total_users": total_users,
            "unassigned_users": unassigned_users,
            "pending_verifications": pending_verifications,
            "recent_companies": recent_companies,
            "recent_activity": recent_activity
        }
    except Exception as e:
        logger.error(f"Error getting platform stats: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get platform statistics"
        )


# ── DB diagnostics ─────────────────────────────────────────────────────────

@router.get('/db-status', status_code=200)
async def db_status(
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db)
):
    """Show live production DB state: alembic version, sector counts, table existence."""
    from sqlalchemy import text
    from core.model import Sector, SectorCategory, SectorGrade, SectorCategorySalary

    result = {}

    # Alembic version
    try:
        row = db.execute(text("SELECT version_num FROM alembic_version")).fetchone()
        result['alembic_version'] = row[0] if row else None
    except Exception as e:
        result['alembic_version'] = f'ERROR: {e}'

    # Sector counts
    try:
        result['sectors'] = db.query(Sector).count()
        result['categories'] = db.query(SectorCategory).count()
        result['grades'] = db.query(SectorGrade).count()
        result['salary_ranges'] = db.query(SectorCategorySalary).count()
    except Exception as e:
        result['sector_counts_error'] = str(e)

    # Check critical columns
    critical = [
        ('time_logs', 'overtime_rejected'),
        ('loans', 'is_recurrent'),
        ('jobs', 'auto_clockin_enabled'),
    ]
    col_status = {}
    for table, col in critical:
        try:
            row = db.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name=:t AND column_name=:c"
            ), {'t': table, 'c': col}).fetchone()
            col_status[f'{table}.{col}'] = 'EXISTS' if row else 'MISSING'
        except Exception as e:
            col_status[f'{table}.{col}'] = f'ERROR: {e}'
    result['columns'] = col_status

    return result


# ── Sector seeder trigger ───────────────────────────────────────────────────

@router.post('/seed-sectors', status_code=202)
async def seed_sectors(
    background_tasks: BackgroundTasks,
    force: bool = False,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db)
):
    """
    Trigger the sector seeder on demand.
    Uses force=true to re-seed even when sectors already exist.
    Returns immediately; seeding runs in the background.
    """
    from core.model import Sector

    count = db.query(Sector).count()
    if count > 0 and not force:
        return {
            'status': 'skipped',
            'message': f'Sectors already seeded ({count} rows). Use ?force=true to re-seed.',
            'sector_count': count,
        }

    def _do_seed():
        import traceback
        from core.config import get_session_local
        SessionLocal = get_session_local()
        if not SessionLocal:
            logger.error('[seed-sectors] No DB session')
            return
        csv_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'mauritius_sector_rates.csv')
        if not os.path.exists(csv_path):
            logger.error(f'[seed-sectors] CSV not found at {csv_path}')
            return
        db2 = SessionLocal()
        try:
            from jobs.seed_sectors_from_excel import SectorExcelSeeder
            seeder = SectorExcelSeeder(db2)
            report = seeder.seed_file(csv_path, dry_run=False, drop_tables=True)
            logger.info(f'[seed-sectors] ✅ Done: {report}')
        except Exception as e:
            logger.error(f'[seed-sectors] ❌ {e}')
            traceback.print_exc()
        finally:
            db2.close()

    background_tasks.add_task(_do_seed)
    return {
        'status': 'started',
        'message': 'Sector seeder running in background. Check server logs for [seed-sectors] output.',
        'existing_sectors': count,
    }


# ─────────────────────────────────────────────────────────────────────────
# Sponsored Content — platform-admin endpoints. M2 shipped house + moderation;
# M10 (Phase 2) added kind='ad' campaigns + per-company ads toggle. Company-
# side employer announcements live in api/v1/announcements.py.
# ─────────────────────────────────────────────────────────────────────────
from db_models.crud import sponsored_content as _sponsored_crud
from schema.sponsored_content_schema import (
    ImageUploadResponse as _SCImageResp,
    SponsoredContentCreate as _SCCreate,
    SponsoredContentOut as _SCOut,
    SponsoredContentPatch as _SCPatch,
    SponsoredContentVersionOut as _SCVersionOut,
)
from core.model import SponsoredContent as _SC  # type: ignore


@router.post('/ads/house', response_model=_SCOut, status_code=status.HTTP_201_CREATED)
def create_house_announcement(
    payload: _SCCreate,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db),
):
    """Create a Kiruko-wide house announcement (kind='house').

    Used to fill the slot when no paid ad or employer announcement is
    eligible — e.g., promoting a new platform feature. The Pydantic body
    accepts the same shape as other kinds for code reuse, but `kind` is
    forced server-side and funding/paid fields must be null.
    """
    return _SCOut.model_validate(
        _sponsored_crud.create_sponsored_content(
            db,
            actor_user_id=current_user.user_id,
            kind='house',
            funding_company_id=None,
            title=payload.title,
            body=payload.body,
            image_url=payload.image_url,
            cta_label=payload.cta_label,
            cta_url=payload.cta_url,
            surfaces=payload.surfaces,
            targeting=payload.targeting,
            start_at=payload.start_at,
            end_at=payload.end_at,
            base_priority=payload.base_priority,
            variant_group=payload.variant_group,
            variant_label=payload.variant_label,
            external_advertiser_name=payload.external_advertiser_name,
        )
    )


@router.get('/sponsored', response_model=List[_SCOut])
def list_sponsored_moderation(
    kind: Optional[str] = None,
    status_filter: Optional[str] = None,
    funding_company_id: Optional[int] = None,
    include_deleted: bool = False,
    limit: int = 100,
    offset: int = 0,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db),
):
    """Cross-kind moderation view across all companies. Used by the platform
    admin Sponsored section. Optional filters narrow the result."""
    # Auto-expire any campaign whose end_at has passed before listing, so the
    # admin never sees stale `Active` on a row that hasn't served in days.
    # /serve doesn't depend on this — it filters end_at directly — but the
    # admin UI does. Idempotent and selective; near-zero cost when nothing
    # has lapsed.
    _sponsored_crud.expire_lapsed_campaigns(db, actor_user_id=current_user.user_id)
    rows = _sponsored_crud.list_all_admin(
        db,
        kind=kind,
        status_filter=status_filter,
        funding_company_id=funding_company_id,
        include_deleted=include_deleted,
        limit=limit,
        offset=offset,
    )
    return [_SCOut.model_validate(r) for r in rows]


# ── Cross-kind moderation actions ───────────────────────────────────────
# The dedicated CRUD routers (`/announcements` and `/admin/ads/campaigns`)
# enforce kind='employer' and kind='ad' respectively, which means rows of
# kind='house' (and any other moderation surface) had no PATCH/DELETE
# path. A platform admin couldn't activate a house draft, edit a
# moderation flag, or take down an abusive employer post — only the
# offending company could.
#
# These two routes close that gap: a platform admin can patch / soft-
# delete ANY sponsored_content row regardless of kind. Audit log records
# the actor and the patch payload.
@router.patch('/sponsored/{content_id}', response_model=_SCOut)
def admin_patch_sponsored(
    content_id: int,
    patch: _SCPatch,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db),
):
    """Cross-kind PATCH for platform admins. Used to:
      - flip a house draft to 'active' (the primary missing capability)
      - take down an employer post that violates the Ad Content Policy
      - pause an ad campaign without going through the dedicated /ads route
    """
    content = _sponsored_crud.get_by_id(db, content_id, include_deleted=False)
    if content is None:
        raise HTTPException(status_code=404, detail='Sponsored content not found')
    updated = _sponsored_crud.patch_sponsored_content(
        db,
        content=content,
        actor_user_id=current_user.user_id,
        patch=patch.model_dump(exclude_unset=True),
    )
    return _SCOut.model_validate(updated)


@router.delete('/sponsored/{content_id}', response_model=_SCOut)
def admin_delete_sponsored(
    content_id: int,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db),
):
    """Cross-kind soft delete for platform admins. Idempotent — sets
    status='ended' + deleted_at on any kind."""
    content = _sponsored_crud.get_by_id(db, content_id, include_deleted=True)
    if content is None:
        raise HTTPException(status_code=404, detail='Sponsored content not found')
    return _SCOut.model_validate(
        _sponsored_crud.soft_delete_sponsored_content(
            db, content=content, actor_user_id=current_user.user_id,
        )
    )


@router.get('/sponsored/{content_id}/eligibility')
def admin_get_sponsored_eligibility(
    content_id: int,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db),
):
    """Diagnostic — "why isn't this campaign serving?"

    Runs every gate the /serve algorithm checks (status, time window,
    ENABLED_KINDS, surfaces, Company.ads_enabled, per-employee consent) and
    returns a structured pass/fail report. The web admin panel renders this
    as a checklist so admins stop having to ask the backend team.
    """
    return _sponsored_crud.compute_eligibility(db, content_id=content_id)


@router.get('/sponsored/{content_id}/stats')
def admin_get_sponsored_stats(
    content_id: int,
    bucket: str = _Query(default="day", pattern="^(day|hour)$"),
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db),
):
    """Cross-kind stats endpoint — works for kind='ad', 'employer', or 'house'.

    The pre-existing /admin/ads/campaigns/{id}/stats endpoint is gated to
    kind='ad'. House admins also need view/click/dismissal counts to gauge
    creative performance, so this route exposes the same `get_stats` CRUD
    without the kind gate."""
    content = _sponsored_crud.get_by_id(db, content_id, include_deleted=True)
    if content is None:
        raise HTTPException(status_code=404, detail='Sponsored content not found')
    return _sponsored_crud.get_stats(db, content_id=content_id, bucket=bucket)


# ─────────────────────────────────────────────────────────────────────────
# Ad campaigns (kind='ad') — M10 / Phase 2.
#
# Same SponsoredContent table as employer announcements + house, but the
# router pins kind='ad' server-side and enforces the per-kind invariants
# (funding_company_id + paid_amount_cents + paid_currency required). Ad
# serving is also gated at /serve by ENABLED_KINDS env var — a draft can
# exist before ops flips that switch.
# ─────────────────────────────────────────────────────────────────────────
import csv as _csv
import io as _io
from fastapi import File as _File, UploadFile as _UploadFile
from fastapi.responses import StreamingResponse as _StreamingResponse
from services.storage_service import get_storage_service as _get_storage

# Mirror constants from announcements.py — keep them inline rather than
# importing across routers to avoid cross-domain coupling.
_AD_ALLOWED_MIMES = {"image/jpeg", "image/png", "image/webp"}
_AD_MAX_IMAGE_BYTES = 2 * 1024 * 1024
_AD_MAX_IMAGE_DIM = 2000


def _load_ad(
    db: Session, content_id: int, *, include_deleted: bool = False
) -> _SC:
    """Fetch a row by id and require kind='ad'. 404s on missing OR on the
    wrong kind — house/employer rows aren't leaked through this router."""
    content = _sponsored_crud.get_by_id(
        db, content_id, include_deleted=include_deleted
    )
    if content is None or content.kind != "ad":
        raise HTTPException(status_code=404, detail="Ad campaign not found")
    return content


@router.post("/ads/upload-image", response_model=_SCImageResp)
async def admin_ads_upload_image(
    file: _UploadFile = _File(...),
    current_user: User = Depends(require_platform_admin),
):
    """Image upload for ad campaigns. Validates mime/size/dimensions, then
    stores via the shared storage backend under `sponsored/ad/staging/{admin}`.
    Returns a URL the admin form submits as `image_url` on create."""
    if file.content_type not in _AD_ALLOWED_MIMES:
        raise HTTPException(
            status_code=400,
            detail=f"image mime must be one of {sorted(_AD_ALLOWED_MIMES)}",
        )
    blob = await file.read()
    if len(blob) > _AD_MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="image exceeds 2 MB")
    try:
        from PIL import Image as _Image
        with _Image.open(_io.BytesIO(blob)) as img:
            w, h = img.size
            if w > _AD_MAX_IMAGE_DIM or h > _AD_MAX_IMAGE_DIM:
                raise HTTPException(
                    status_code=400,
                    detail=f"image must be <= {_AD_MAX_IMAGE_DIM}x{_AD_MAX_IMAGE_DIM}",
                )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="invalid image")

    file.file = _io.BytesIO(blob)
    storage = _get_storage()
    folder = f"sponsored/ad/staging/{current_user.user_id}"
    url = await storage.upload_file(file, folder=folder)
    if not url:
        raise HTTPException(status_code=500, detail="image upload failed")
    return _SCImageResp(url=url)


@router.post(
    "/ads/campaigns",
    response_model=_SCOut,
    status_code=status.HTTP_201_CREATED,
)
def admin_create_ad_campaign(
    payload: _SCCreate,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db),
):
    """Create a kind='ad' campaign. The Pydantic body validates that
    `funding_company_id`, `paid_amount_cents`, `paid_currency` are all
    provided — those are required by per-kind invariants + DB CHECK.

    The campaign is created in status='draft'; the platform admin flips it
    to 'active' via PATCH once it's ready. The Phase-1 kill-switch
    `ENABLED_KINDS` is checked at /serve, not here — drafts can exist
    before ads serving is enabled in this deployment.
    """
    return _SCOut.model_validate(
        _sponsored_crud.create_sponsored_content(
            db,
            actor_user_id=current_user.user_id,
            kind="ad",
            funding_company_id=payload.funding_company_id,
            title=payload.title,
            body=payload.body,
            image_url=payload.image_url,
            cta_label=payload.cta_label,
            cta_url=payload.cta_url,
            surfaces=payload.surfaces,
            targeting=payload.targeting,
            start_at=payload.start_at,
            end_at=payload.end_at,
            base_priority=payload.base_priority,
            paid_amount_cents=payload.paid_amount_cents,
            paid_currency=payload.paid_currency,
            payment_notes=payload.payment_notes,
            variant_group=payload.variant_group,
            variant_label=payload.variant_label,
        )
    )


@router.get("/ads/campaigns", response_model=List[_SCOut])
def admin_list_ad_campaigns(
    status_filter: Optional[str] = _Query(default=None, alias="status"),
    funding_company_id: Optional[int] = None,
    include_deleted: bool = False,
    limit: int = _Query(default=100, le=200),
    offset: int = _Query(default=0, ge=0),
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db),
):
    """List all kind='ad' campaigns, optionally filtered by status / advertiser."""
    # Twin of list_sponsored_moderation — keep the stored status honest on
    # admin reads so the Active filter pill doesn't include rows whose
    # windows have closed.
    _sponsored_crud.expire_lapsed_campaigns(db, actor_user_id=current_user.user_id)
    rows = _sponsored_crud.list_all_admin(
        db,
        kind="ad",
        status_filter=status_filter,
        funding_company_id=funding_company_id,
        include_deleted=include_deleted,
        limit=limit,
        offset=offset,
    )
    return [_SCOut.model_validate(r) for r in rows]


@router.get("/ads/campaigns/{content_id}", response_model=_SCOut)
def admin_get_ad_campaign(
    content_id: int,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db),
):
    return _SCOut.model_validate(_load_ad(db, content_id, include_deleted=True))


@router.patch("/ads/campaigns/{content_id}", response_model=_SCOut)
def admin_patch_ad_campaign(
    content_id: int,
    patch: _SCPatch,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db),
):
    """Partial update. Changing any creative field auto-snapshots a new
    version (so attribution stays locked to what each viewer saw). Status
    transitions (draft→active→paused→ended) also flow through here."""
    content = _load_ad(db, content_id)
    updated = _sponsored_crud.patch_sponsored_content(
        db,
        content=content,
        actor_user_id=current_user.user_id,
        patch=patch.model_dump(exclude_unset=True),
    )
    return _SCOut.model_validate(updated)


@router.delete("/ads/campaigns/{content_id}", response_model=_SCOut)
def admin_delete_ad_campaign(
    content_id: int,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db),
):
    """Soft delete — sets deleted_at + status='ended'. Idempotent."""
    content = _load_ad(db, content_id, include_deleted=True)
    return _SCOut.model_validate(
        _sponsored_crud.soft_delete_sponsored_content(
            db, content=content, actor_user_id=current_user.user_id
        )
    )


@router.get(
    "/ads/campaigns/{content_id}/versions",
    response_model=List[_SCVersionOut],
)
def admin_list_ad_versions(
    content_id: int,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db),
):
    _load_ad(db, content_id, include_deleted=True)
    return [
        _SCVersionOut.model_validate(v)
        for v in _sponsored_crud.list_versions(db, content_id)
    ]


@router.get("/ads/campaigns/{content_id}/stats")
def admin_ad_stats(
    content_id: int,
    bucket: str = _Query(default="day", pattern="^(day|hour)$"),
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db),
):
    _load_ad(db, content_id, include_deleted=True)
    return _sponsored_crud.get_stats(db, content_id=content_id, bucket=bucket)


@router.get("/ads/campaigns/{content_id}/export.csv")
def admin_ad_export_csv(
    content_id: int,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db),
):
    """CSV dump of (views + clicks + dismissals) sorted by timestamp.
    Used for advertiser billing reconciliation."""
    _load_ad(db, content_id, include_deleted=True)
    rows = _sponsored_crud.iter_raw_events_for_csv(db, content_id)

    def _generate():
        buf = _io.StringIO()
        w = _csv.writer(buf)
        w.writerow(["event_type", "timestamp", "private_user_id", "version_id"])
        yield buf.getvalue()
        buf.seek(0); buf.truncate(0)
        for ev_type, ts, pu_id, ver_id in rows:
            w.writerow([ev_type, ts.isoformat() if ts else "", pu_id or "", ver_id or ""])
            yield buf.getvalue()
            buf.seek(0); buf.truncate(0)

    return _StreamingResponse(
        _generate(),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="ad_campaign_{content_id}.csv"'
        },
    )


# ── Per-company ads-enabled master toggle ────────────────────────────────
class _AdsEnabledBody(BaseModel):
    enabled: bool


@router.post("/companies/{company_id}/ads-enabled", response_model=dict)
def admin_set_company_ads_enabled(
    company_id: int,
    body: _AdsEnabledBody,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(config.get_db),
):
    """Flip a company's master ads toggle. Grandfathered customers start at
    False; this is how sales activates ads on the company after a re-signed
    contract. The change is reflected on /serve within the 60s cache TTL.
    AuditLog'd with before/after values."""
    co = _sponsored_crud.set_company_ads_enabled(
        db,
        company_id=company_id,
        enabled=body.enabled,
        actor_user_id=current_user.user_id,
    )
    return {
        "company_id": co.company_id,
        "ads_enabled": co.ads_enabled,
    }
