from datetime import datetime, timedelta
import random
import logging
import sys
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError
from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder

from core import config
from core.roles import is_company_admin, is_company_admin_for
from core.security import create_access_token, verify_password, ACCESS_TOKEN_EXPIRY
from core.exceptions import EmailExist, InvalidCredentials, UserNotFound

from db_models.crud.user import (
    register_user, get_user_by_email, get_all_user
)
from db_models.crud.role import get_roles_for_user
from schema.user_schema import (
    CreateUser, CompanySignupRequest, UserLoginModel, showUser
)

from services.email_service import send_password_reset_otp, send_signup_otp_email
from api.v1.verification import _issue_otp

logger = logging.getLogger(__name__)

REFRESH_TOKEN_EXPIRY = 7

class UserService:
    @staticmethod
    async def signup_user(request: CreateUser, db: Session):
        try:
            user = await register_user(request, db)

            # Issue OTP via DB-backed store (invalidates any previous code)
            otp = _issue_otp(user.email, "signup", 10, db)
            send_signup_otp_email(user.email, otp)
            logger.info(f"Signup OTP issued for {user.email}")

            return user
        except EmailExist as e:
            raise HTTPException(status_code=e.status_code, detail=e.message)
        except HTTPException:
            # register_user() raises HTTPException directly for validation
            # failures it can give a precise status/message for (duplicate
            # BRN -> 409, unknown/inactive country_code -> 400). Without this
            # clause the bare `except Exception` below caught those too and
            # flattened them into an opaque 500 — the client never saw the
            # real reason, just "An unexpected error occurred".
            raise
        except SQLAlchemyError as e:
            logger.error(e)
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database query error")
        except Exception as e:
            logger.error(f"Unexpected signup error: {e}")
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="An unexpected error occurred")

    @staticmethod
    async def login_user(
        login_data: UserLoginModel,
        db: Session,
        client_platform: str = "web",
        client_ip: Optional[str] = None,
        device_id: Optional[str] = None,
    ):
        # `identifier` is the new field accepting either email or phone;
        # legacy clients still send `email`. Falling back means a mobile
        # app shipped before this change keeps working unchanged.
        from core.phone_utils import looks_like_phone
        from db_models.crud.user import get_user_by_phone
        raw_identifier = (login_data.identifier or login_data.email or "").strip()
        password = login_data.password

        if not raw_identifier:
            raise InvalidCredentials("Email or phone is required.")

        # Per-identifier brute-force lockout (complements the per-IP slowapi
        # limit on the route). A distributed attack against one account slips
        # past a per-IP cap; this closes that gap.
        from services.login_security import check_login_allowed, record_login_attempt
        lockout_key = raw_identifier.strip().lower()
        if not check_login_allowed(lockout_key, client_ip):
            logger.warning("Login blocked (lockout): identifier=%s ip=%s", lockout_key, client_ip)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many failed login attempts. Please try again later.",
            )

        if looks_like_phone(raw_identifier):
            user = get_user_by_phone(raw_identifier, db)
            lookup_label = f"phone={raw_identifier}"
        else:
            user = get_user_by_email(raw_identifier, db)
            lookup_label = f"email={raw_identifier}"

        if not user:
            logger.info("Login attempt with unknown identifier: %s", lookup_label)
            record_login_attempt(lockout_key, client_ip, success=False)
            raise UserNotFound()
        email = user.email  # downstream code (audit, super-admin check) still wants email

        if not user.password_hash:
            logger.warning("Login attempt for user without password hash: %s", email)
            record_login_attempt(lockout_key, client_ip, success=False)
            raise InvalidCredentials("Account exists but no password is set. Please use password reset.")

        if not verify_password(password, user.password_hash):
            record_login_attempt(lockout_key, client_ip, success=False)
            raise InvalidCredentials()

        record_login_attempt(lockout_key, client_ip, success=True)

        # Disabled accounts cannot obtain a session. Checked AFTER password
        # verification (don't reveal account state to an unauthenticated caller)
        # and BEFORE the verification/OTP branch. get_current_user already blocks
        # disabled users on every request; this closes the login path too.
        if not getattr(user, "user_enabled", True):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This account has been disabled. Please contact your administrator.",
            )

        if not user.user_verified:
            # Reissue a fresh OTP so the user doesn't have to click "Resend"
            try:
                otp = _issue_otp(user.email, "signup", 10, db)
                send_signup_otp_email(user.email, otp)
                logger.info(f"Reissued signup OTP for unverified user {user.email}")
            except Exception as otp_err:
                logger.warning(f"Could not reissue OTP for {user.email}: {otp_err}")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="EMAIL_NOT_VERIFIED"
            )

        # Compute superuser status. Strip surrounding quotes so a .env line like
        # SUPER_ADMIN_EMAILS="foo@bar.com" doesn't compare literal quotes.
        try:
            from core.settings import config as settings_config
            super_emails = settings_config("SUPER_ADMIN_EMAILS", default="") or ""
            super_list = [
                e.strip().strip('"').strip("'").lower()
                for e in super_emails.split(",")
                if e.strip()
            ]
            is_super = user.email.lower() in super_list
        except Exception:
            is_super = False

        # Get roles
        try:
            roles = get_roles_for_user(user.user_id, db)
        except Exception:
            roles = []

        # Resolve company RBAC access BEFORE minting the token. The web
        # middleware (src/middleware.ts) is a real security boundary and reads
        # ONLY the JWT — so a delegated management-role employee (HR etc.) must be
        # distinguishable there, not just in the response body. We bake a single
        # boolean into the token; the RBAC on/off decision stays server-side.
        #
        # M5b RLS: resolve the user's company FIRST — employee/role-holder's
        # private_user.company_id, then the owner's own Company. This is the tenant
        # the token binds RLS to, and everything below (admin check, dashboard) must
        # agree with it.
        _company_id = None
        if user.private_user and getattr(user.private_user, "company_id", None):
            _company_id = user.private_user.company_id
        elif getattr(user, "company", None):
            _company_id = user.company.company_id

        # Admin status is scoped to the RESOLVED company (not global ownership).
        # is_company_admin_for(user, cid, db) returns True for the OWNER of that
        # company OR a holder of an admin-tier company role in it. This matters for
        # an account that owns one company but is a delegated role-holder in
        # another: the old global is_company_admin(user) reported them as admin
        # everywhere (leaking owner-only web UI into a company they merely work in).
        # Genuine owners have no private_user, so _company_id is their own company
        # and they still qualify. Fall back to the global check only when no company
        # resolves (e.g. a not-yet-linked account).
        if _company_id is not None:
            _is_company_admin = is_company_admin_for(user, _company_id, db)
        else:
            _is_company_admin = is_company_admin(user)
        try:
            from core.permission_guards import company_access_for_user, company_rbac_enabled
            _cperms, _croles = company_access_for_user(user, db)
            _rbac_on = company_rbac_enabled()
        except Exception:
            _cperms, _croles, _rbac_on = [], [], False
        # A private user may use the web dashboard when RBAC is on AND they hold a
        # company management role (admin tier or any delegated role). Owners are
        # user_type='company' and bypass the private-user block; platform admins
        # are handled separately. Mirrors AuthContext.isPrivateUserBlocked.
        company_web_access = bool(_rbac_on and (_is_company_admin or _croles))

        # private_user_id drives person-scoped RLS (the worker's own personal-
        # finance rows: loans/budget/etc.).
        _private_user_id = user.private_user.private_user_id if user.private_user else None

        # Session binding claims (device + IP) so a leaked token can't be
        # replayed silently from another device. Only minted when the feature
        # is enabled (see core/session_security.session_anomaly_mode).
        from core.session_security import session_anomaly_mode, session_binding_claims
        _binding = {}
        if session_anomaly_mode() != "off":
            _binding = session_binding_claims(device=device_id, ip=client_ip)

        # Create tokens (audience-bound: admin endpoints require aud='web')
        access_token = create_access_token(
            user_data={
                "email": user.email,
                "user_id": user.user_id,
                "user_name": user.user_name,
                "is_superuser": is_super,
                "user_type": user.user_type.value if hasattr(user.user_type, 'value') else user.user_type,
                "roles": roles,
                "company_web_access": company_web_access,
                "company_id": _company_id,
                "private_user_id": _private_user_id,
                **_binding,
            },
            audience=client_platform,
        )

        refresh_token = create_access_token(
            user_data={"email": user.email, "user_uid": str(user.user_id)},
            refresh=True,
            expiry=timedelta(days=REFRESH_TOKEN_EXPIRY),
            audience=client_platform,
        )

        # Self-heal `onboard_complete` on login. It is otherwise only
        # recomputed on POST /user/onboard, so any account whose flag drifted
        # stale-false (data completed via admin edit / invite / CSV import, or
        # a pre-Phase-12 row) would bounce to the profile screen on EVERY login
        # forever. Recomputing here from concrete state makes the stored column
        # a cache rather than an untrusted source of truth.
        try:
            from core.onboarding import refresh_user_onboard_state
            refresh_user_onboard_state(user, db)
            db.commit()
        except Exception as ob_err:
            logger.warning(f"login onboard self-heal failed (non-fatal): {ob_err}")
            db.rollback()

        # Prepare response data. Validate directly from the ORM object (not a
        # pre-encoded dict) so nested relationships — notably private_user.company,
        # which a delegated role-holder relies on to see their company name — are
        # traversed and serialized. jsonable_encoder then makes it JSON-safe.
        user_data = jsonable_encoder(showUser.model_validate(user))
        
        if user.private_user:
            user_data["private_user_id"] = user.private_user.private_user_id

        user_data["roles"] = roles
        user_data["is_superuser"] = is_super
        user_data["is_company_admin"] = _is_company_admin

        # Company RBAC — fine-grained permissions for delegated management-role
        # employees (and owners). Surfaced so the web can scope navigation/access.
        # (Resolved above for the token; reuse here.)
        user_data["company_permissions"] = _cperms
        user_data["company_roles"] = _croles
        user_data["company_rbac_enabled"] = _rbac_on

        return {
            "status": "success",
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "user": user_data
        }
