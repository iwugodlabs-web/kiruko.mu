from sqlalchemy.orm import Session, joinedload, selectinload
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy import or_, func
from typing import Iterable, List, Optional
from fastapi import HTTPException, status
from core.model import *
from schema import *
from schema.user_schema import UserRight as UserRightSchema, UpdateUser
from core.exceptions import OnbordingDataError

def create_user_right_report(request: UserRightSchema, db: Session) -> UserRight:
    """Create user rights report."""
    user_complain = UserRight(
        **request.model_dump()
    )
    db.add(user_complain)
    db.commit()
    db.refresh(user_complain)
    return user_complain

def get_user_right_history(private_user_id: int, db: Session) -> List[UserRight]:
    """Get all rights history for a specific user."""
    return db.query(UserRight).filter(UserRight.private_user_id == private_user_id).order_by(UserRight.created_at.desc()).all()

def get_all_right_history(db: Session) -> List[UserRight]:
    """Get all rights history."""
    return db.query(UserRight).order_by(UserRight.created_at.desc()).all()

def get_right_history_by_id(right_id: int, db: Session) -> UserRight:
    """Get a specific rights history by ID."""
    return db.query(UserRight).filter(UserRight.right_id == right_id).first()

def update_user_right_history(right_id: int, request: UserRightSchema, db: Session) -> UserRight:
    """Update a user rights history."""
    rightHistory = db.query(UserRight).filter(UserRight.right_id == right_id).first()
    if rightHistory:
        for key, value in request.model_dump(exclude_unset=True).items():
            setattr(rightHistory, key, value)
        db.commit()
        db.refresh(rightHistory)
    return rightHistory

from core.model import User, PrivateUser, Company, UserRight, Transfer, Job, Salary, Schedule
from schema.user_schema import CreateUser, UpdateUser as UpdateUserSchema, CompanySignupRequest, UserRight as UserRightSchema
from core.security import generate_passwd_hash
from core.exceptions import EmailExist
import logging
from fastapi.encoders import jsonable_encoder
from db_models.crud import department as department_crud


logger = logging.getLogger(__name__)


async def register_user(request: CompanySignupRequest, db: Session) -> User:
    """Register a new company user"""
    # Check if user already exists
    existing_user = db.query(User).filter(User.email == request.email).first()
    if existing_user:
        # Raise EmailExist custom exception if email already exists
        raise EmailExist(request.email)

    # Create user
    user = User(
        user_type=request.user_type,
        email=request.email,
        phone=request.phone,
        user_name=request.email,  # Use email for uniqueness
        password_hash=generate_passwd_hash(request.password_hash),
        onboard_complete=False
    )
    db.add(user)
    db.flush()

    if hasattr(request, 'company_data') and request.company_data and getattr(request, 'user_type', None) == 'company':
        company_data = request.company_data

        # Trim BRN to avoid duplicates caused by leading/trailing whitespace
        trimmed_brn = company_data.brn.strip() if company_data.brn else company_data.brn
        # Reject if this BRN is already registered — each BRN must be unique.
        from db_models.crud.company import get_company_by_brn
        existing_company = get_company_by_brn(trimmed_brn, db)
        if existing_company:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"A company with BRN '{trimmed_brn}' is already registered. "
                       "Please use a different BRN or contact your company administrator."
            )

        # Resolve + validate country. Defaults to 'MU' for app builds that
        # don't send country_code yet (backward compatible). Self-signup is
        # stricter than the admin-created-company path here on purpose: an
        # inactive country isn't ready for real customers even though a
        # platform admin can still select it for testing.
        requested_country_code = getattr(company_data, 'country_code', None) or 'MU'
        country = db.query(Country).filter(Country.code == requested_country_code).one_or_none()
        if country is None or not country.is_active:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown or not-yet-available country_code '{requested_country_code}'"
            )

        # Create new company
        company = Company(
            company_name=company_data.company_name,
            email=getattr(company_data, 'email', None) or request.email,
            brn=trimmed_brn,
            address=getattr(company_data, 'address', None),
            phone=getattr(company_data, 'phone', None) or request.phone,
            user_id=user.user_id,
            country_code=country.code,
            timezone=country.default_timezone or 'Indian/Mauritius',
        )
        db.add(company)
        db.flush()

        private_user = PrivateUser(
            user_id=user.user_id,
            first_name=getattr(request, 'first_name', None),
            last_name=getattr(request, 'last_name', None) or getattr(request, 'first_name', None) or "Unknown",
            phone=request.phone,
            gender=None,
            date_of_birth=None,
            pass_port_number=None,
            company_id=company.company_id,
            role='owner'  # company creator is owner
        )
        db.add(private_user)
        from services.employee_code_service import ensure_employee_code
        ensure_employee_code(db, private_user)

        # Seed default departments for the newly created company
        try:
            department_crud.create_department(company.company_id, 'Management', db)
        except Exception:
            pass
        try:
            department_crud.create_department(company.company_id, 'Operations', db)
        except Exception:
            pass
    else:
        private_user = PrivateUser(
            user_id=user.user_id,
            first_name=getattr(request, 'first_name', None),
            last_name=getattr(request, 'last_name', None) or getattr(request, 'first_name', None) or "Unknown",
            phone=request.phone,
            gender=None,
            date_of_birth=None,
            pass_port_number=None,
            company_id=None
        )
        db.add(private_user)
    # Server-authoritative onboarding flag. Company signups already supply
    # company_name/brn/address and we auto-seed Management + Operations
    # departments above, so a well-formed company signup is onboard-complete
    # at commit time — no post-signup wizard needed.
    db.flush()
    try:
        from core.onboarding import refresh_user_onboard_state
        refresh_user_onboard_state(user, db)
    except Exception as ob_err:
        logger.warning(f"refresh_user_onboard_state at signup failed (non-fatal): {ob_err}")
    db.commit()
    db.refresh(user)
    return user


def private_user_ids_for_country(db: Session, country_code: str) -> List[int]:
    """PrivateUser IDs whose effective country matches `country_code`.

    Mirrors `PrivateUser.effective_country_code` (core/model.py): company
    employees inherit their employer's country; independents fall back to
    their own profile setting, defaulting to MU. Done in SQL — a Python
    @property can't run as a filter/count — so every admin view that scopes
    private users by country (stats, all-users, compliance disputes) shares
    this one definition instead of re-deriving the fallback per call site.
    """
    from sqlalchemy import case
    from sqlalchemy.orm import aliased
    pu_company = aliased(Company)
    rows = (
        db.query(PrivateUser.private_user_id)
        .outerjoin(pu_company, pu_company.company_id == PrivateUser.company_id)
        .filter(
            case(
                (
                    PrivateUser.company_id.isnot(None),
                    func.coalesce(pu_company.country_code, PrivateUser.country_code, 'MU'),
                ),
                else_=func.coalesce(PrivateUser.country_code, 'MU'),
            )
            == country_code
        )
        .all()
    )
    return [r[0] for r in rows]


def scope_users_to_country(q, db: Session, country_code: Optional[str]):
    """Shared filter, used by get_all_user/count_all_user and
    /admin/stats: company-type users via their own Company.country_code,
    private-type users via private_user_ids_for_country. Users with neither
    a Company nor a PrivateUser row (e.g. mid-signup) are excluded once a
    country is picked — they don't belong to any country yet.

    A user who is BOTH a company owner and has their own PrivateUser row
    (seen in local data — an owner counted as their own employee) would
    match both branches of the OR; callers doing a COUNT must call
    `.distinct()` on the returned query, not sum two separate counts, or
    that user gets counted twice."""
    if not country_code:
        return q
    matching_pu_ids = private_user_ids_for_country(db, country_code) or [-1]
    return (
        q.outerjoin(Company, Company.user_id == User.user_id)
        .outerjoin(PrivateUser, PrivateUser.user_id == User.user_id)
        .filter(
            or_(
                Company.country_code == country_code,
                PrivateUser.private_user_id.in_(matching_pu_ids),
            )
        )
    )


def get_all_user(
    db: Session,
    *,
    exclude_user_ids: Optional[Iterable[int]] = None,
    limit: Optional[int] = None,
    offset: int = 0,
    country_code: Optional[str] = None,
) -> List[User]:
    """Get all users with related data.

    ``exclude_user_ids``/``limit``/``offset`` are optional and default to
    the original "every user, unpaginated" behavior — existing callers that
    only pass ``db`` are unaffected. ``limit=None`` (the default) skips
    pagination entirely; passing a limit orders by user_id for a stable
    page boundary. ``country_code`` scopes to one country server-side so
    pagination totals stay correct under a country filter.
    """
    q = db.query(User).options(
        joinedload(User.private_user),
        joinedload(User.private_user).subqueryload(PrivateUser.jobs).subqueryload(Job.salaries),
        joinedload(User.company)
    )
    if exclude_user_ids:
        q = q.filter(User.user_id.notin_(exclude_user_ids))
    q = scope_users_to_country(q, db, country_code)
    if country_code:
        # Company.user_id has no uniqueness constraint, so the outer join in
        # scope_users_to_country could in principle fan out one User into
        # multiple rows — distinct() keeps this a true per-user filter.
        q = q.distinct()
    if limit is not None:
        q = q.order_by(User.user_id.asc()).offset(offset).limit(limit)
    return q.all()


def count_all_user(
    db: Session,
    *,
    exclude_user_ids: Optional[Iterable[int]] = None,
    country_code: Optional[str] = None,
) -> int:
    """Row count matching get_all_user's filters, for pagination totals."""
    q = db.query(func.count(func.distinct(User.user_id)))
    if exclude_user_ids:
        q = q.filter(User.user_id.notin_(exclude_user_ids))
    q = scope_users_to_country(q, db, country_code)
    return q.scalar() or 0


def get_users_by_company(company_id: int, db: Session, status: Optional[str] = None, roles_in: Optional[List[str]] = None) -> List[User]:
    """Get users for a company (linked via PrivateUser OR Job).

    By default returns ONLY actual employees (excludes owner/admin). Pass roles_in
    to instead return users holding one of those roles — e.g. ['owner','admin','manager']
    to list the managers/HR/admins a worker can tag on a report.
    """
    from core.model import Company as CompanyModel
    from sqlalchemy.orm import with_loader_criteria
    # Look up the company's BRN so we can also match jobs that only have employer_brn set
    company_obj = db.query(CompanyModel).filter(CompanyModel.company_id == company_id).first()
    company_brn = company_obj.brn.strip() if company_obj and company_obj.brn else None

    link_filter = or_(PrivateUser.company_id == company_id, Job.company_id == company_id)
    if company_brn:
        link_filter = or_(link_filter, func.lower(Job.employer_brn) == company_brn.lower())

    # with_loader_criteria scopes the secondary loader emitted by
    # subqueryload(PrivateUser.jobs) so it filters by Job.company_id. Without
    # this, the inner SELECT pulls every job for the linked private_user_ids
    # regardless of company — both a tenant_guard violation and a real cross-
    # tenant leak vector in shared-DB deployments.
    query = db.query(User).options(
        with_loader_criteria(Job, lambda j: j.company_id == company_id, include_aliases=True),
        joinedload(User.private_user)
        .subqueryload(PrivateUser.jobs)
        .subqueryload(Job.salaries),
        joinedload(User.private_user)
        .joinedload(PrivateUser.department),
        joinedload(User.company)
    ).join(User.private_user)\
     .outerjoin(Job, Job.private_user_id == PrivateUser.private_user_id)\
     .filter(
         link_filter,
         User.user_type == 'private',
         PrivateUser.role.in_(roles_in) if roles_in
         else or_(PrivateUser.role.is_(None), PrivateUser.role.notin_(['owner', 'admin']))
     )

    # Rejected employees are removed from the company. Reject detaches
    # PrivateUser.company_id, but an imported employee's Job still matches
    # Job.company_id (link_filter above), so exclude rejected explicitly — else
    # they keep appearing in the verification/employee lists. (`!= 'rejected'`
    # would also drop NULL-status rows in SQL, so OR in the NULL case.)
    if status != 'rejected':
        query = query.filter(or_(
            User.company_onboarding_status.is_(None),
            User.company_onboarding_status != 'rejected',
        ))

    if status:
        query = query.filter(User.company_onboarding_status == status)

    return query.distinct().all()


def get_company_role_holders(company_id: int, db: Session) -> List[User]:
    """Users a worker can tag/route a report to: everyone assigned a role on the
    company's role-management page (company_user_roles), plus the company owner.

    Every seeded catalogue role (Owner, Company Admin, HR Manager, Department
    Manager, Supervisor) is a management role, so "has any assigned role" cleanly
    identifies the managers/HR/admins — without relying on the legacy scalar role.
    """
    from core.model import Company as CompanyModel
    from core.company_user_role import CompanyUserRole

    holder_ids = {
        row[0]
        for row in db.query(CompanyUserRole.private_user_id)
        .filter(CompanyUserRole.company_id == company_id)
        .distinct()
        .all()
    }

    # The owner holds the role implicitly (via Company.user_id), not always a row.
    company_obj = db.query(CompanyModel).filter(CompanyModel.company_id == company_id).first()
    if company_obj:
        owner_pu = db.query(PrivateUser).filter(PrivateUser.user_id == company_obj.user_id).first()
        if owner_pu:
            holder_ids.add(owner_pu.private_user_id)

    if not holder_ids:
        return []

    return (
        db.query(User)
        .options(
            # Load department so the report's profile-preview card can show it
            # for managers/HR too (not just coworkers from get_users_by_company).
            joinedload(User.private_user).joinedload(PrivateUser.department),
            joinedload(User.company),
        )
        .join(User.private_user)
        .filter(PrivateUser.private_user_id.in_(holder_ids))
        .distinct()
        .all()
    )


def get_users_by_company_search(company_id: int, q: Optional[str], limit: int = 50, offset: int = 0, db: Session = None) -> List[User]:
    """Search users for a company by name, email, or id (server-side typeahead). Only verified users."""
    logger.debug(f"get_users_by_company_search called company_id={company_id} q={q} limit={limit} offset={offset} db={db}")
    try:
        query = db.query(User).options(
            joinedload(User.private_user),
            joinedload(User.company)
        ).join(User.private_user).filter(PrivateUser.company_id == company_id, User.user_verified == True)

        if q:
            q_trim = q.strip()
            # Require at least two characters for typeahead queries to avoid full-table scans
            if len(q_trim) < 2:
                logger.debug("Search q too short, returning empty results to avoid expensive query")
                return []
            q_str = f"%{q_trim}%"
            query = query.filter(
                or_(
                    PrivateUser.first_name.ilike(q_str),
                    PrivateUser.last_name.ilike(q_str),
                    User.email.ilike(q_str),
                    User.user_name.ilike(q_str)
                )
            )

        query = query.order_by(PrivateUser.first_name.asc()).limit(limit).offset(offset)
        results = query.all()
        return results
    except Exception:
        logger.exception("Error in get_users_by_company_search")
        raise


def get_user_by_email(email: str, db: Session) -> Optional[User]:
    """Get user by email with related data"""
    return db.query(User).options(
        joinedload(User.private_user)
        .joinedload(PrivateUser.department),
        joinedload(User.private_user)
        .selectinload(PrivateUser.jobs)
        .selectinload(Job.salaries),
        joinedload(User.company)
    ).filter(User.email == email).first()


def get_user_by_phone(phone: str, db: Session) -> Optional[User]:
    """Look up by phone, tolerating the various stored formats in legacy
    rows. The match is OR'd across canonical (`+23057123456`), digits-only
    (`23057123456`), the bare local part (`57123456`), and the 00-prefixed
    form (`0023057123456`) so a customer who signed up before phone
    normalization landed can still log in with any of them.
    """
    from core.phone_utils import lookup_variants
    variants = lookup_variants(phone)
    if not variants:
        return None
    return db.query(User).options(
        joinedload(User.private_user).joinedload(PrivateUser.department),
        joinedload(User.private_user).selectinload(PrivateUser.jobs).selectinload(Job.salaries),
        joinedload(User.company),
    ).filter(User.phone.in_(variants)).first()


def get_user_by_user_id(user_id: str, db: Session) -> Optional[User]:
    """Get user by user ID with related data"""
    return db.query(User).options(
        # Load private_user and its department and company
        joinedload(User.private_user).joinedload(PrivateUser.department),
        joinedload(User.private_user).joinedload(PrivateUser.company),
        # Load private_user.jobs using selectinload to avoid subquery conflicts
        joinedload(User.private_user).selectinload(PrivateUser.jobs).selectinload(Job.salaries),
        joinedload(User.company)
    ).filter(User.user_id == user_id).first()


def update_user(user_id: str, request: UpdateUserSchema, db: Session) -> Optional[User]:
    """Update user"""
    user = db.query(PrivateUser).filter(PrivateUser.user_id == user_id).first()
    if not user:
        return None

    logger.debug(f"update_user called with request type: {type(request)}")
    try:
        if isinstance(request, dict):
            request_obj = UpdateUser(**request)
        else:
            request_obj = request

        update_data = request_obj.dict(exclude_unset=True)
        if 'password' in update_data:
            update_data['password'] = generate_passwd_hash(update_data['password'])

        # Identify fields belonging to User model vs PrivateUser model.
        # Plan Phase 12.A: `onboard_complete` is NO LONGER client-writable —
        # the server computes it from concrete profile/job/department state
        # via `core.onboarding.refresh_user_onboard_state`. Any field name
        # supplied by the client for `onboard_complete` is silently ignored.
        user_fields = {'company_onboarding_status', 'user_verified', 'user_enabled', 'password_hash', 'preferred_locale'}
        
        # Ensure the relationship is loaded/accessible
        user_account = user.user 

        for field, value in update_data.items():
            if field in user_fields:
                if user_account:
                    setattr(user_account, field, value)
            elif hasattr(user, field):
                setattr(user, field, value)
            else:
                 # Fallback: try setting on user_account if not found on private_user, 
                 # or log warning. For safety, we can check hasattr on user_account too.
                 if user_account and hasattr(user_account, field):
                     setattr(user_account, field, value)

        # Do not commit or refresh here; let the caller manage the transaction
        return user
    except AttributeError as e:
        logger.error(f"AttributeError in update_user: {e}, request type: {type(request)}, request: {request}")
        raise


def delete_user(user_id: str, db: Session) -> bool:
    """Delete user"""
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        return False
    
    db.delete(user)
    db.commit()
    return True


def set_user_verified(user_id: int, verified: bool, db: Session) -> Optional[User]:
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        return None
    user.user_verified = verified
    db.commit()
    db.refresh(user)
    return user


def set_user_enabled(user_id: int, enabled: bool, db: Session) -> Optional[User]:
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        return None
    user.user_enabled = enabled
    db.commit()
    db.refresh(user)
    return user


# ------------------------ Company-User Roles (multi-role support) ------------------------
from core.company_user_role import CompanyUserRole

def get_roles_for_private_user(company_id: int, private_user_id: int, db: Session) -> list:
    """Return list of roles for a private_user in a company"""
    rows = db.query(CompanyUserRole.role).filter(CompanyUserRole.company_id == company_id, CompanyUserRole.private_user_id == private_user_id).all()
    return [r.role if hasattr(r, 'role') else r[0] for r in rows]


def set_roles_for_private_user(company_id: int, private_user_id: int, roles: list, created_by: int | None, db: Session):
    """Set roles for a private_user in a company (replace existing)."""
    # Normalize roles to unique set and ensure valid strings
    desired = set([str(r) for r in (roles or []) if r])

    # Fetch current
    existing = db.query(CompanyUserRole).filter(CompanyUserRole.company_id == company_id, CompanyUserRole.private_user_id == private_user_id).all()
    existing_set = set([e.role for e in existing])

    # Delete roles that are no longer desired
    to_delete = [e for e in existing if e.role not in desired]
    for d in to_delete:
        db.delete(d)

    # Add new roles
    to_add = desired - existing_set
    for r in to_add:
        new = CompanyUserRole(company_id=company_id, private_user_id=private_user_id, role=r, created_by=created_by)
        db.add(new)

    db.commit()


def user_has_role(company_id: int, private_user_id: int, role: str, db: Session) -> bool:
    return db.query(CompanyUserRole).filter(CompanyUserRole.company_id == company_id, CompanyUserRole.private_user_id == private_user_id, CompanyUserRole.role == role).count() > 0

def create_user_complain(user_id: str, request:UserRightSchema, db: Session) -> UserRight:
    """Create a new user complaint"""
    user_complain = UserRight(
       **request.dict()
    )
    db.add(user_complain)
    db.commit()
    db.refresh(user_complain)
    return user_complain

def update_password_by_email(db: Session, email: str, new_password_hash: str) -> bool:
    """Updates a user's password hash by their email."""
    user = db.query(User).filter(User.email == email).first()
    if not user:
        return False
    user.password_hash = new_password_hash
    db.commit()
    return True

async def get_schedules_for_user(private_user_id: int, db: Session) -> List[Schedule]:
    """Get all schedules assigned to a specific user"""
    try:
        # Get the private user first to ensure they exist
        private_user = db.query(PrivateUser).filter(PrivateUser.private_user_id == private_user_id).first()
        if not private_user:
            return []
        
        # Query schedules where this user is in the assigned_employees
        schedules = db.query(Schedule).options(
            joinedload(Schedule.assigned_employees),
            joinedload(Schedule.assignee_statuses)
        ).filter(
            Schedule.assigned_employees.any(PrivateUser.private_user_id == private_user_id)
        ).order_by(Schedule.start_time.desc()).all()
        
        return schedules
    except SQLAlchemyError as e:
        logger.error(f"SQLAlchemyError while fetching schedules for user {private_user_id}: {e}")
        raise
    except Exception as ex:
        logger.error(f"Unexpected Error while fetching schedules for user {private_user_id}: {ex}", exc_info=True)
        raise
