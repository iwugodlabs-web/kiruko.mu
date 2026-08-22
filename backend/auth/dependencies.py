import logging
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from typing import Optional

from schema.user_schema import User
from core.config import get_db
from auth.utils import decode_token
from db_models.crud.user import get_user_by_user_id

logger = logging.getLogger(__name__)

# Make auto_error=False so we can manually handle the cookie fallback
security = HTTPBearer(auto_error=False)

def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    """
    Dependency to get the current authenticated user from JWT token
    """
    token = None

    # 1. Try Authorization Header (bearer)
    # NEVER log request.headers or request.cookies — they carry the bearer
    # token and the session cookie. Past versions of this file printed them
    # to stdout, which landed in DigitalOcean logs (plan P0-5).
    if credentials:
        token = credentials.credentials

    # 2. Try Cookie
    if not token:
        cookie_val = request.cookies.get("access_token")
        if cookie_val:
            if cookie_val.startswith("Bearer "):
                token = cookie_val.split(" ")[1]
            else:
                token = cookie_val

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Decode the token
    token_data = decode_token(token)
    
    if not token_data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Check if token is expired or refresh token
    if token_data.get("refresh", False):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Cannot use refresh token for authentication",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Extract user data from token
    user_data = token_data.get("user", {})
    user_id = user_data.get("user_id")
    
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing user information",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Get user from database
    try:
        user = get_user_by_user_id(user_id, db)
    except Exception:
        logger.exception("Database error fetching user during auth")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error occurred during user fetch",
        )
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Mark as superuser if the user has the platform role 'platform_admin' (DB-backed)
    try:
        from db_models.crud.role import user_has_role_by_user_id
        if user and getattr(user, 'user_id', None) and user_has_role_by_user_id(user.user_id, 'platform_admin', db):
            setattr(user, 'is_superuser', True)
        else:
            setattr(user, 'is_superuser', False)
    except Exception:
        # On any failure default to False (safe), but ROLLBACK to prevent
        # a poisoned transaction. Log so silent role-check failures are
        # visible rather than masking elevation bugs.
        logger.exception("Platform-admin role lookup failed; defaulting to is_superuser=False")
        db.rollback()
        setattr(user, 'is_superuser', False)

    # Session binding / anomaly check (device + IP). No-op unless
    # SESSION_ANOMALY_MODE is 'audit'/'block'.
    from core.session_security import check_session_anomaly
    check_session_anomaly(db, request, token_data)

    return user

def get_current_active_user(
    current_user: User = Depends(get_current_user)
) -> User:
    """
    Dependency to get current active user
    """
    # Add any additional checks here (e.g., if user is active, not banned, etc.)
    return current_user