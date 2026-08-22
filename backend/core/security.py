"""
Centralized security and authentication logic.
Handles JWT generation/decoding and password hashing.
"""

import logging
import os
import uuid
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
import jwt
from passlib.context import CryptContext
from core.config import get_db_credentials

# Password hashing context
passwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Load configuration for JWT
config = get_db_credentials()
JWT_ALGORITHM = config.get('JWT_ALGORITHM', 'HS256')
ACCESS_TOKEN_EXPIRY = 1800  # 30 minutes in seconds

# JWT signing secret. Fail CLOSED in production: a missing/weak secret would let
# anyone forge admin tokens, so we refuse to boot rather than silently sign with
# a publicly-known default. Dev keeps a clearly-labelled fallback for convenience.
_INSECURE_DEFAULT = 'insecure-default-secret'
JWT_SECRET = config.get('JWT_SECRET') or _INSECURE_DEFAULT
_is_prod = os.getenv('ENVIRONMENT', 'development').strip().lower() == 'production'
if _is_prod and (JWT_SECRET == _INSECURE_DEFAULT or len(JWT_SECRET) < 16):
    raise RuntimeError(
        "JWT_SECRET must be set to a strong (>=16 char) value in production. "
        "Refusing to start with a missing or insecure signing key."
    )
if JWT_SECRET == _INSECURE_DEFAULT:
    logging.getLogger(__name__).warning(
        "JWT_SECRET is unset — using the INSECURE dev default. Never run this in production."
    )

def generate_passwd_hash(password: str) -> str:
    """Generate a bcrypt hash for a plain text password."""
    return passwd_context.hash(password)

def verify_password(password: str, hashed_password: str) -> bool:
    """Verify a plain text password against its hash."""
    return passwd_context.verify(password, hashed_password)

VALID_AUDIENCES = ("web", "mobile", "concern_portal")
# `concern_portal` tokens are minted by the public reporter portal (M2). They
# carry only `{"case_id": int}` in the user dict — there is no associated
# User row because anonymous reporters by definition aren't authenticated.
# Routes that accept this audience must scope ALL data access to the case_id
# in the token; never join to a user identity.

def create_access_token(
    user_data: Dict[str, Any],
    expiry: Optional[timedelta] = None,
    refresh: bool = False,
    audience: str = "web",
) -> str:
    """
    Generate a JWT access or refresh token.

    Args:
        user_data: Dictionary of user traits to embed in the payload
        expiry: Custom expiration time (defaults to 30 mins for access tokens)
        refresh: Whether this is a refresh token
        audience: "web" or "mobile". Admin endpoints require "web".
    """
    if audience not in VALID_AUDIENCES:
        raise ValueError(f"Invalid audience: {audience!r}")

    payload = {
        "user": user_data,
        "exp": datetime.utcnow() + (
            expiry if expiry is not None else timedelta(seconds=ACCESS_TOKEN_EXPIRY)
        ),
        "jti": str(uuid.uuid4()),
        "refresh": refresh,
        "aud": audience,
    }

    return jwt.encode(
        payload=payload,
        key=JWT_SECRET,
        algorithm=JWT_ALGORITHM
    )

def decode_token(token: str) -> Optional[Dict[str, Any]]:
    """
    Decode and validate a JWT token.

    Audience is intentionally NOT enforced here — it's a per-route concern
    (admin endpoints require aud='web'). The aud claim is preserved in the
    returned payload for callers that need it.

    Returns:
        The decoded payload if valid, None if expired or invalid.
    """
    try:
        return jwt.decode(
            jwt=token,
            key=JWT_SECRET,
            algorithms=[JWT_ALGORITHM],
            options={"verify_aud": False},
        )
    except jwt.ExpiredSignatureError:
        logging.warning("Token has expired")
        return None
    except jwt.PyJWTError as e:
        logging.error(f"JWT decode error: {e}")
        return None
