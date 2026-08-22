import logging
import uuid
from datetime import datetime, timedelta
from itsdangerous import URLSafeTimedSerializer
import jwt
from passlib.context import CryptContext

from core.config import get_db_credentials

passwd_context = CryptContext(schemes=["bcrypt"])

ACCESS_TOKEN_EXPIRY = 1800  # 30 minutes in seconds
Config = get_db_credentials()
JWT_SECRET = Config['JWT_SECRET']
JWT_ALGORITHM = Config['JWT_ALGORITHM']

def generate_passwd_hash(password: str) -> str:
    hash = passwd_context.hash(password)
    return hash

def verify_password(password: str, hash: str) -> bool:
    return passwd_context.verify(password, hash)

def create_access_token(
    user_data: dict, expiry: timedelta = None, refresh: bool = False
):
    payload = {}
    payload["user"] = user_data
    payload["exp"] = datetime.utcnow() + (
        expiry if expiry is not None else timedelta(seconds=ACCESS_TOKEN_EXPIRY)
    )
    payload["jti"] = str(uuid.uuid4())
    payload["refresh"] = refresh

    token = jwt.encode(
        payload=payload, key=JWT_SECRET, algorithm=JWT_ALGORITHM
    )
    return token

def decode_token(token: str) -> dict:
    """
    Decode JWT token and return payload
    Returns None if token is invalid or expired
    """
    try:
        token_data = jwt.decode(
            jwt=token, key=JWT_SECRET, algorithms=[JWT_ALGORITHM]
        )
        return token_data
    except jwt.ExpiredSignatureError:
        logging.error("Token has expired")
        return None
    except jwt.InvalidTokenError as e:
        logging.error(f"Invalid token: {e}")
        return None
    except Exception as e:
        logging.error(f"Error decoding token: {e}")
        return None

serializer = URLSafeTimedSerializer(
    secret_key=JWT_SECRET, salt="email-configuration"
)

def create_url_safe_token(data: dict):
    token = serializer.dumps(data)
    return token

def decode_url_safe_token(token: str):
    try:
        token_data = serializer.loads(token)
        return token_data
    except Exception as e:
        logging.error(f"Error decoding URL safe token: {str(e)}")
        return None