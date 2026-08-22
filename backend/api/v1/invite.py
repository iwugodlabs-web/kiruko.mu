from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, constr

from core import config
from core.model import User, PrivateUser
from core.security import generate_passwd_hash
from db_models.crud.invite import validate_invite_token, mark_invite_accepted, get_invite_by_token
from db_models.crud.role import assign_role_to_user, get_role_by_name
import logging

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/invite",
    tags=['Invite']
)


class InviteValidateResponse(BaseModel):
    valid: bool
    email: str | None = None
    role: str | None = None
    error: str | None = None


class InviteAcceptRequest(BaseModel):
    token: str
    password: constr(min_length=8)
    first_name: str | None = None
    last_name: str | None = None


@router.get('/validate/{token}', response_model=InviteValidateResponse)
async def validate_invite(
    token: str,
    db: Session = Depends(config.get_db)
):
    """
    Validate an invitation token.
    Public endpoint.
    """
    try:
        is_valid, error, invite = validate_invite_token(token, db)
        
        if not is_valid:
            return {
                "valid": False,
                "error": error
            }
            
        return {
            "valid": True,
            "email": invite.email,
            "role": invite.role_name
        }
        
    except Exception as e:
        logger.error(f"Error validating invite token: {e}")
        return {
            "valid": False,
            "error": "Failed to validate token"
        }


@router.post('/accept', status_code=status.HTTP_201_CREATED)
async def accept_invite(
    accept_data: InviteAcceptRequest,
    db: Session = Depends(config.get_db)
):
    """
    Accept an invitation and create user account.
    Public endpoint.
    """
    try:
        # 1. Validate token again
        is_valid, error, invite = validate_invite_token(accept_data.token, db)
        if not is_valid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error
            )
            
        # 2. Check if user already exists (double check)
        from db_models.crud.user import get_user_by_email
        if get_user_by_email(invite.email, db):
             raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User with this email already exists"
            )

        # 3. Create User
        password_hash = generate_passwd_hash(accept_data.password)
        
        new_user = User(
            user_type='private',
            email=invite.email,
            user_name=invite.email,
            password_hash=password_hash,
            onboard_complete=True, # Considered complete as they set password
            user_verified=True,     # Verified via email token
            user_enabled=True
        )
        db.add(new_user)
        db.flush()
        
        # 4. Create PrivateUser profile
        # Use provided name or fallback to email parts
        email_parts = invite.email.split('@')[0]
        first_name = accept_data.first_name or email_parts
        last_name = accept_data.last_name or ''
        
        # Determine role for PrivateUser table (internal role, not platform role)
        # Usually 'admin' or 'owner' depending on significance, but for platform users 
        # 'admin' is appropriate for PrivateUser.role
        private_user_role = 'owner' if invite.role_name == 'platform_admin' else 'admin'
        
        private_user = PrivateUser(
            user_id=new_user.user_id,
            first_name=first_name,
            last_name=last_name,
            role=private_user_role
        )
        db.add(private_user)
        db.flush()
        
        # 5. Assign Platform Role
        assign_role_to_user(new_user.user_id, invite.role_name, invite.invited_by, db)
        
        # 6. Mark invite as accepted
        mark_invite_accepted(invite.invite_id, db)
        
        db.commit()
        db.refresh(new_user)
        
        logger.info(f"Invite accepted: {invite.email} joined as {invite.role_name}")
        
        return {
            "status": "success",
            "message": "Account created successfully",
            "user_id": new_user.user_id,
            "email": new_user.email
        }
        
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error accepting invite: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to accept invitation"
        )
