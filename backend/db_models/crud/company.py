import logging
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import func
from core.model import Company, Country, Job, PrivateUser, Salary


def get_companies(
    limit: int, offset: int, db: Session, include_inactive: bool = False,
    country_code: Optional[str] = None,
) -> List[Company]:
    """Return a paginated list of companies.

    By default soft-deleted companies are hidden. Pass include_inactive=True
    (admin listing) to see disabled and deleted companies too. Optional
    country_code narrows to one country — used by the admin Employers page's
    Country Switcher.
    """
    q = db.query(Company)
    if not include_inactive:
        q = q.filter(Company.status != 'deleted')
    if country_code:
        q = q.filter(Company.country_code == country_code)
    return q.order_by(Company.created_at.desc()).limit(limit).offset(offset).all()


def count_companies(db: Session, include_inactive: bool = False, country_code: Optional[str] = None) -> int:
    """Row count matching get_companies' filters, for pagination totals and
    the Employers page's stat cards (which must reflect the true total, not
    just however many rows happened to be on the fetched page)."""
    q = db.query(func.count(Company.company_id))
    if not include_inactive:
        q = q.filter(Company.status != 'deleted')
    if country_code:
        q = q.filter(Company.country_code == country_code)
    return int(q.scalar() or 0)


def get_company_by_id(company_id: int, db: Session) -> Company:
    """Return company by id"""
    return db.query(Company).filter(Company.company_id == company_id).first()


def get_company_by_brn(brn: str, db: Session) -> Company:
    """Return company by BRN (trims whitespace before lookup)"""
    return db.query(Company).filter(Company.brn == brn.strip()).first()


def get_company_stats(company_id: int, db: Session) -> dict:
    """Return aggregated stats for a company: verified_headcount, pending_verifications, total_employees"""
    from core.model import User
    
    # Count verified employees - users with job.company_id matching AND user.user_verified = true
    verified_count_q = (
        db.query(func.count(func.distinct(Job.private_user_id)))
        .join(PrivateUser, Job.private_user_id == PrivateUser.private_user_id)
        .join(User, PrivateUser.user_id == User.user_id)
        .filter(Job.company_id == company_id, User.user_verified == True)
    )
    verified_headcount = int(verified_count_q.scalar() or 0)

    # Pending verifications — unverified employees linked to THIS company. Scope
    # by company_id (via PrivateUser OR Job), consistent with verified_headcount
    # above and get_users_by_company. The old BRN match both missed employees
    # linked only by company_id and risked inflating across a shared BRN.
    from sqlalchemy import or_
    pending_count_q = (
        db.query(func.count(func.distinct(PrivateUser.private_user_id)))
        .join(User, PrivateUser.user_id == User.user_id)
        .outerjoin(Job, Job.private_user_id == PrivateUser.private_user_id)
        .filter(
            or_(PrivateUser.company_id == company_id, Job.company_id == company_id),
            User.user_verified == False,
        )
    )
    pending_verifications = int(pending_count_q.scalar() or 0)

    # Total employees linked to company (either via job.company_id or
    # private_user.company_id). Exclude owner/admin so the count matches the
    # Team Members list — the owner is not a headcount entry.
    _not_mgmt = or_(PrivateUser.role.is_(None), PrivateUser.role.notin_(['owner', 'admin']))
    total_from_jobs = (
        db.query(func.count(func.distinct(Job.private_user_id)))
        .join(PrivateUser, PrivateUser.private_user_id == Job.private_user_id)
        .filter(Job.company_id == company_id, _not_mgmt)
        .scalar() or 0
    )
    total_from_private = (
        db.query(PrivateUser)
        .filter(PrivateUser.company_id == company_id, _not_mgmt)
        .count()
    )
    total_employees = max(int(total_from_jobs), total_from_private)

    # Role breakdown: employees vs admins/managers/owners
    employee_count = db.query(PrivateUser).filter(
        PrivateUser.company_id == company_id,
        PrivateUser.role == 'employee'
    ).count()
    admin_count = db.query(PrivateUser).filter(
        PrivateUser.company_id == company_id,
        PrivateUser.role.in_(['owner', 'admin', 'manager'])
    ).count()

    # Open (vacant) positions — a Job row with no assigned employee yet.
    # CompanyStats.open_jobs_count has been declared on the frontend type
    # since it was written, but this key never actually existed in this
    # dict — the Employers page's "Open Jobs" stat has always read as 0.
    open_jobs_count = db.query(Job).filter(
        Job.company_id == company_id,
        Job.private_user_id.is_(None),
    ).count()

    return {
        'verified_headcount': verified_headcount,
        'pending_verifications': pending_verifications,
        'total_employees': total_employees,
        'employee_count': int(employee_count),
        'admin_count': int(admin_count),
        'open_jobs_count': int(open_jobs_count),
    }


def get_companies_aggregated_stats(db: Session, country_code: Optional[str] = None) -> dict:
    """Return aggregated totals across all companies: total_companies,
    total_verified_headcount, total_pending_verifications, total_open_jobs.

    Optional country_code narrows every sub-count to one country (via a Job
    join for the employee-based counts, direct on Company for the company
    count) — used by the admin Employers page so its stat cards actually
    reflect the Country Switcher instead of always showing the platform-wide
    total regardless of the selected country.
    """
    from core.model import User

    total_companies_q = db.query(func.count(Company.company_id))
    if country_code:
        total_companies_q = total_companies_q.filter(Company.country_code == country_code)
    total_companies = int(total_companies_q.scalar() or 0)

    # Count verified employees - users with job.company_id set AND user.user_verified = true
    total_verified_q = (
        db.query(func.count(func.distinct(Job.private_user_id)))
        .join(PrivateUser, Job.private_user_id == PrivateUser.private_user_id)
        .join(User, PrivateUser.user_id == User.user_id)
        .filter(Job.company_id != None, User.user_verified == True)
    )
    if country_code:
        total_verified_q = total_verified_q.join(Company, Company.company_id == Job.company_id) \
            .filter(Company.country_code == country_code)
    total_verified_headcount = int(total_verified_q.scalar() or 0)

    # Count pending verifications - users with job but not verified
    total_pending_q = (
        db.query(func.count(func.distinct(Job.private_user_id)))
        .join(PrivateUser, Job.private_user_id == PrivateUser.private_user_id)
        .join(User, PrivateUser.user_id == User.user_id)
        .filter(Job.employer_brn != None, User.user_verified == False)
    )
    if country_code:
        total_pending_q = total_pending_q.join(Company, Company.company_id == Job.company_id) \
            .filter(Company.country_code == country_code)
    total_pending_verifications = int(total_pending_q.scalar() or 0)

    # Open (vacant) positions across every company in scope.
    total_open_jobs_q = db.query(func.count(Job.job_id)).filter(Job.private_user_id.is_(None))
    if country_code:
        total_open_jobs_q = total_open_jobs_q.join(Company, Company.company_id == Job.company_id) \
            .filter(Company.country_code == country_code)
    total_open_jobs = int(total_open_jobs_q.scalar() or 0)

    return {
        'total_companies': total_companies,
        'total_verified_headcount': total_verified_headcount,
        'total_pending_verifications': total_pending_verifications,
        'total_open_jobs': total_open_jobs,
    }

# ----------------- Payroll & Financials -----------------

def get_company_payrolls(company_id: int, year: int, db: Session):
    """Return list of monthly payrolls for a company year."""
    from core.model import CompanyMonthlyPayroll
    return db.query(CompanyMonthlyPayroll).filter(
        CompanyMonthlyPayroll.company_id == company_id,
        CompanyMonthlyPayroll.year == year
    ).order_by(CompanyMonthlyPayroll.month).all()

def update_company_payrolls(company_id: int, year: int, payrolls: List[dict], db: Session):
    """
    Update or create payroll records for a given year.
    payrolls is a list of dicts: {'month': 1, 'amount': 1000.0}
    """
    from core.model import CompanyMonthlyPayroll
    
    # Process each month
    for p in payrolls:
        month = p.get('month')
        amount = p.get('amount')
        if month is None or amount is None:
            continue
            
        record = db.query(CompanyMonthlyPayroll).filter(
            CompanyMonthlyPayroll.company_id == company_id,
            CompanyMonthlyPayroll.year == year,
            CompanyMonthlyPayroll.month == month
        ).first()

        if record:
            record.total_amount = amount
        else:
            record = CompanyMonthlyPayroll(
                company_id=company_id,
                year=year,
                month=month,
                total_amount=amount
            )
            db.add(record)
    
    db.commit()
    return True


# ----------------- CRUD: Create / Update / Delete -----------------

def create_company(data: dict, db: Session) -> Company:
    """Create a new company with the provided data and return the created instance."""
    from fastapi import HTTPException
    from starlette import status as http_status
    # Trim BRN to avoid duplicates caused by leading/trailing whitespace
    raw_brn = data.get('brn')
    brn = raw_brn.strip() if raw_brn else raw_brn
    # Uniqueness check
    if brn:
        existing = get_company_by_brn(brn, db)
        if existing:
            raise HTTPException(
                status_code=http_status.HTTP_409_CONFLICT,
                detail=f"A company with BRN '{brn}' is already registered."
            )
    # country_code is set once at creation and never exposed on update —
    # changing it later would corrupt fiscal-year-keyed PAYE state and
    # timezone-classified overtime history for anything already run.
    country_code = data.get('country_code') or 'MU'
    country = db.query(Country).filter(Country.code == country_code).one_or_none()
    if country is None:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown country_code '{country_code}'"
        )
    raw_name = data.get('company_name')
    company = Company(
        company_name=raw_name.strip() if raw_name else raw_name,
        email=data.get('email'),
        brn=brn,
        address=data.get('address'),
        phone=data.get('phone'),
        vat=data.get('vat'),
        annual_leave_budget=data.get('annual_leave_budget', 0),
        country_code=country_code,
        timezone=country.default_timezone or 'Indian/Mauritius',
    )
    db.add(company)
    db.commit()
    db.refresh(company)
    return company


def update_company(company_id: int, data: dict, db: Session) -> Company | None:
    """Update an existing company and return it, or None if not found."""
    from fastapi import HTTPException
    from starlette import status as http_status
    company = get_company_by_id(company_id, db)
    if not company:
        return None
    # Trim company_name and BRN before applying update
    if 'company_name' in data and data['company_name'] is not None:
        data['company_name'] = data['company_name'].strip()
    if 'brn' in data and data['brn'] is not None:
        data['brn'] = data['brn'].strip()
        # Uniqueness check — exclude the current company
        existing = get_company_by_brn(data['brn'], db)
        if existing and existing.company_id != company_id:
            raise HTTPException(
                status_code=http_status.HTTP_409_CONFLICT,
                detail=f"A company with BRN '{data['brn']}' is already registered."
            )
    # Update allowed fields. `default_max_shift_hours` added in kiosk v1.5
    # — drives the missed-clockout cron's resolution chain (see
    # TimeLogService.resolve_max_shift_hours, M27).
    for field in ['company_name', 'email', 'brn', 'address', 'phone', 'vat', 'annual_leave_budget', 'default_max_shift_hours', 'require_approved_clockins_for_payroll']:
        if field in data:
            setattr(company, field, data[field])
    db.add(company)
    db.commit()
    db.refresh(company)
    return company


def delete_company(company_id: int, db: Session) -> bool:
    """Soft-delete a company: mark status='deleted' and stamp deleted_at.
    The row (and all its history) is preserved so a platform admin can
    restore it. Returns True if found, False otherwise."""
    from datetime import datetime, timezone
    company = get_company_by_id(company_id, db)
    if not company:
        return False
    now = datetime.now(timezone.utc)
    company.status = 'deleted'
    company.deleted_at = now
    company.status_changed_at = now
    db.add(company)
    db.commit()
    return True


def set_company_status(company_id: int, new_status: str, db: Session) -> Company | None:
    """Set a company's lifecycle status to 'active' or 'disabled'. Clears
    deleted_at when re-activating. Returns the company, or None if not found."""
    from datetime import datetime, timezone
    company = get_company_by_id(company_id, db)
    if not company:
        return None
    company.status = new_status
    company.status_changed_at = datetime.now(timezone.utc)
    if new_status == 'active':
        company.deleted_at = None
    db.add(company)
    db.commit()
    db.refresh(company)
    return company


def restore_company(company_id: int, db: Session) -> Company | None:
    """Restore a disabled or soft-deleted company back to 'active'."""
    return set_company_status(company_id, 'active', db)


def invite_company_user(company_id: int, email: str, role: str, invited_by_user_id: int, db: Session):
    """Create an invite record and return invite dict including token.
    Creates a CompanyInvite row and returns invite details.
    """
    import secrets
    from datetime import datetime, timedelta, timezone
    from core.model import CompanyInvite

    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)

    invite = CompanyInvite(
        company_id=company_id,
        email=email,
        role=role,
        token=token,
        invited_by=invited_by_user_id,
        expires_at=expires_at
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)

    # Create audit log entry
    try:
        from db_models.crud.company import log_audit
        log_audit(company_id, f"invite_created", invited_by_user_id, f"invite:{invite.invite_id}", db, metadata={"email": email, "role": role})
    except Exception:
        pass

    return {
        'invite_id': invite.invite_id,
        'company_id': invite.company_id,
        'email': invite.email,
        'role': invite.role,
        'token': invite.token,
        'expires_at': invite.expires_at.isoformat() if invite.expires_at else None,
        'invited_by': invite.invited_by,
    }


def create_claimable_company_employee(company_id: int, email: str, invited_by_user_id: int, db: Session):
    """Create a MINIMAL claimable employee account for a company and return the User.

    Used by the invite flow when role == 'employee'. Employees live in the mobile
    app, not the web dashboard, so instead of a web /invite record we direct-create
    a shell account (blank profile) and let the caller mint a claim token + send
    the /claim email. The employee sets a password, then completes their own
    profile (names, job, salary) via mobile onboarding — which is why
    onboard_complete stays False and the names are seeded empty.

    Does NOT commit (caller commits after minting the claim token). Raises
    ValueError if an account with this email already exists.
    """
    import secrets
    from core.model import User, PrivateUser, UserType
    from core.security import generate_passwd_hash

    email = (email or "").strip().lower()
    if not email:
        raise ValueError("Email is required.")
    if db.query(User).filter(func.lower(User.email) == email).first() is not None:
        raise ValueError("An account with this email already exists.")

    user = User(
        user_type=UserType.private,
        email=email,
        user_name=email,
        password_hash=generate_passwd_hash(secrets.token_urlsafe(24)),
        onboard_complete=False,
        user_verified=False,
        user_enabled=True,
        company_onboarding_status="approved",
    )
    db.add(user)
    db.flush()

    # first_name/last_name are NOT NULL — seed empty strings; the employee fills
    # real values during mobile profile completion (the onboarding gate treats
    # empty names as "incomplete").
    emp = PrivateUser(
        user_id=user.user_id,
        first_name="",
        last_name="",
        company_id=company_id,
        role="employee",
    )
    db.add(emp)
    db.flush()
    try:
        from services.employee_code_service import ensure_employee_code
        ensure_employee_code(db, emp)
    except Exception:
        pass

    try:
        log_audit(company_id, "employee_invite_claim_created", invited_by_user_id,
                  f"user:{user.user_id}", db, metadata={"email": email})
    except Exception:
        pass

    return user


def get_invite_by_token(token: str, db: Session):
    """Return invite record (dict) for previewing by token or None."""
    from core.model import CompanyInvite, Company
    invite = db.query(CompanyInvite).filter(CompanyInvite.token == token).first()
    if not invite:
        return None
    company = db.query(Company).filter(Company.company_id == invite.company_id).first()
    return {
        'invite_id': invite.invite_id,
        'company_id': invite.company_id,
        'company_name': company.company_name if company else None,
        'email': invite.email,
        'role': invite.role,
        'token': invite.token,
        'expires_at': invite.expires_at.isoformat() if invite.expires_at else None,
        'accepted': bool(invite.accepted)
    }


def get_all_invites(db: Session, limit: int = 50, offset: int = 0, email: str | None = None, role: str | None = None, company_id: int | None = None):
    """Return paginated outstanding invites with optional filters."""
    from core.model import CompanyInvite
    q = db.query(CompanyInvite).filter(CompanyInvite.accepted == False)
    if email:
        q = q.filter(CompanyInvite.email.ilike(f"%{email}%"))
    if role:
        q = q.filter(CompanyInvite.role == role)
    if company_id:
        q = q.filter(CompanyInvite.company_id == company_id)
    total = q.count()
    invites = q.order_by(CompanyInvite.created_at.desc()).limit(limit).offset(offset).all()
    return {
        'total': total,
        'data': [
            {
                'invite_id': i.invite_id,
                'company_id': i.company_id,
                'email': i.email,
                'role': i.role,
                'token': i.token,
                'expires_at': i.expires_at.isoformat() if i.expires_at else None,
                'invited_by': i.invited_by
            }
            for i in invites
        ]
    }


def revoke_invite(invite_id: int, db: Session):
    """Revoke (delete) an invite by id."""
    from core.model import CompanyInvite
    invite = db.query(CompanyInvite).filter(CompanyInvite.invite_id == invite_id).first()
    if not invite:
        return False
    db.delete(invite)
    db.commit()
    try:
        log_audit(invite.company_id, 'invite_revoked', None, f'invite:{invite_id}', db, metadata={'email': invite.email, 'role': invite.role})
    except Exception:
        pass
    return True


def get_audit_logs(db: Session, limit: int = 50, offset: int = 0, action: str | None = None, target_type: str | None = None):
    """Return paginated audit logs, optionally filtered by action or target_type."""
    from core.model import AuditLog
    q = db.query(AuditLog).order_by(AuditLog.created_at.desc())
    if action:
        q = q.filter(AuditLog.action == action)
    if target_type:
        q = q.filter(AuditLog.target_type == target_type)
    total = q.count()
    logs = q.limit(limit).offset(offset).all()
    results = [
        {
            'id': l.id,
            'actor_user_id': l.actor_user_id,
            'action': l.action,
            'target_type': l.target_type,
            'target_id': l.target_id,
            'meta': getattr(l, 'meta', None),
            'created_at': l.created_at.isoformat() if getattr(l, 'created_at', None) else None,
        }
        for l in logs
    ]
    return {'total': total, 'data': results}



def log_audit(target_company_id: int, action: str, actor_user_id: int | None, target_id: str | None, db: Session, metadata: dict | None = None):
    """Create a simple audit log entry. Best-effort, does not raise — but
    logs the exception (plan P1-3) so silent audit-log failures stop being
    invisible the way the historical `metadata` vs `meta` column-name bug
    was."""
    try:
        from core.model import AuditLog
        audit = AuditLog(actor_user_id=actor_user_id, action=action, target_type='company', target_id=str(target_id), meta=metadata)
        db.add(audit)
        db.commit()
        return audit
    except Exception:
        logging.exception("log_audit failed for action=%s target_id=%s", action, target_id)
        try:
            db.rollback()
        except Exception:
            pass
        return None


def accept_invite_by_token(token: str, user_id: int, db: Session):
    """Accept an invite by token: associate the accepting user's PrivateUser with the company and set role.
    Returns dict with company_id and user_id on success.
    """
    from datetime import datetime, timezone
    from core.model import CompanyInvite, PrivateUser
    invite = db.query(CompanyInvite).filter(CompanyInvite.token == token).first()
    if not invite:
        raise Exception('Invite token not found')

    # check expiry and accepted
    if invite.accepted:
        raise Exception('Invite already accepted')
    if invite.expires_at and invite.expires_at < datetime.now(timezone.utc):
        raise Exception('Invite expired')

    # find private user record for accepting user
    priv = db.query(PrivateUser).filter(PrivateUser.user_id == user_id).first()
    if not priv:
        raise Exception('Accepting user must have a private_user profile')

    # Assign company and role. Link the role through the catalogue
    # (company_user_roles) — not just the legacy scalar — so an invited catalogue
    # role (e.g. "HR Manager") actually resolves its permissions, mirroring the
    # role-assignment endpoint. The scalar is then kept in sync as a legacy tier.
    role_name = invite.role or 'employee'
    priv.company_id = invite.company_id
    invite.accepted = True
    db.add(priv)
    db.add(invite)
    db.flush()
    from services.employee_code_service import ensure_employee_code
    ensure_employee_code(db, priv)
    try:
        from db_models.crud.user import set_roles_for_private_user
        set_roles_for_private_user(invite.company_id, priv.private_user_id, [role_name], user_id, db)
    except Exception:
        pass
    n = role_name.lower().replace(' ', '_')
    if n == 'owner':
        priv.role = 'owner'
    elif 'admin' in n:
        priv.role = 'admin'
    elif ('manager' in n) or ('supervisor' in n):
        priv.role = 'manager'
    else:
        priv.role = 'employee'
    db.add(priv)
    db.commit()
    db.refresh(invite)

    # audit the acceptance
    try:
        log_audit(invite.company_id, 'invite_accepted', user_id, f'invite:{invite.invite_id}', db, metadata={'email': invite.email, 'role': invite.role})
    except Exception:
        pass

    return {'company_id': invite.company_id, 'user_id': user_id}


def transfer_company_ownership(company_id: int, new_owner_user_id: int, performed_by_user_id: int, db: Session):
    """Transfer company.user_id to new_owner_user_id. Return updated company instance."""
    company = get_company_by_id(company_id, db)
    if not company:
        raise Exception('Company not found')
    # Optionally adjust roles: set previous owner's private_user.role to 'admin' and new owner to 'owner'
    from db_models.crud.user import get_private_user_by_user_id
    old_owner_user_id = company.user_id
    company.user_id = new_owner_user_id
    db.add(company)

    # Update PrivateUser roles if present
    try:
        new_owner_priv = get_private_user_by_user_id(new_owner_user_id, db)
        if new_owner_priv:
            new_owner_priv.role = 'owner'
            db.add(new_owner_priv)
        old_owner_priv = get_private_user_by_user_id(old_owner_user_id, db)
        if old_owner_priv:
            old_owner_priv.role = 'admin'
            db.add(old_owner_priv)
    except Exception:
        pass

    db.commit()
    db.refresh(company)

    # Audit log for ownership transfer
    try:
        log_audit(company_id, 'transfer_ownership', performed_by_user_id, f'company:{company_id}', db, metadata={'old_owner': old_owner_user_id, 'new_owner': new_owner_user_id})
    except Exception:
        pass

    return company