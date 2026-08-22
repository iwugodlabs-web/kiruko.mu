from fastapi import APIRouter, Depends, status, HTTPException
from typing import List
from sqlalchemy.orm import Session
from sqlalchemy import func
from core import config
from db_models.crud import company as company_crud
from core.dependencies import get_current_user, assert_company_access
from core.model import Company, CompanyGeofence
from core.roles import is_company_admin_for, has_platform_permission, can_read_company

router = APIRouter(prefix="/company", tags=["Companies"])


@router.get('/', status_code=200)
async def list_companies(limit: int = 50, offset: int = 0, db: Session = Depends(config.get_db), current_user = Depends(get_current_user)):
    # Only platform admins / superusers can list all companies
    if not getattr(current_user, 'is_superuser', False):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Only platform administrators can list all companies')
    try:
        companies = company_crud.get_companies(limit=limit, offset=offset, db=db)
        simplified = [
            {
                'company_id': c.company_id,
                'company_name': c.company_name,
                'brn': c.brn,
                'email': c.email,
                'country_code': c.country_code,
                'created_at': c.created_at.isoformat() if getattr(c, 'created_at', None) else None
            }
            for c in companies
        ]
        return simplified
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get('/stats', status_code=200)
async def get_companies_stats(db: Session = Depends(config.get_db), current_user = Depends(get_current_user)):
    # Aggregated totals are admin-only
    if not getattr(current_user, 'is_superuser', False):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Only platform administrators can view aggregated company stats')
    try:
        stats = company_crud.get_companies_aggregated_stats(db)
        return stats
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


# NOTE: `/invites` must be declared before `/{company_id}` because FastAPI
# matches in order. Otherwise GET /company/invites tries to coerce "invites"
# to an int via the {company_id} path parameter and returns a 422.
@router.get('/invites', status_code=200)
async def list_invites_route(limit: int = 50, offset: int = 0, email: str | None = None, role: str | None = None, company_id: int | None = None, db: Session = Depends(config.get_db), current_user = Depends(get_current_user)):
    """List pending invites with pagination and optional filters (platform administrators only)."""
    if not getattr(current_user, 'is_superuser', False) and not ((getattr(current_user, 'roles', None) or []) and 'platform_admin' in current_user.roles):
        raise HTTPException(status_code=403, detail='Only platform administrators can list invites')
    res = company_crud.get_all_invites(db, limit=limit, offset=offset, email=email, role=role, company_id=company_id)
    return {'status': 'success', 'data': res['data'], 'total': res['total']}


@router.get('/{company_id}', status_code=200)
async def get_company(company_id: int, db: Session = Depends(config.get_db), current_user = Depends(get_current_user)):
    company = company_crud.get_company_by_id(company_id, db)
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Company not found')

    # Allow if platform admin
    if getattr(current_user, 'is_superuser', False):
        pass
    else:
        # Allow if the current user belongs to this company (company user or private user linked)
        allowed = False
        try:
            if getattr(current_user, 'company', None) and getattr(current_user.company, 'company_id', None) == company_id:
                allowed = True
        except Exception:
            pass
        try:
            if getattr(current_user, 'private_user', None) and getattr(current_user.private_user, 'company_id', None) == company_id:
                allowed = True
        except Exception:
            pass
        # Company owner
        if current_user.user_id == company.user_id:
            allowed = True

        if not allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Not permitted to view this company')

    return {
        'company_id': company.company_id,
        'company_name': company.company_name,
        'brn': company.brn,
        'email': company.email,
        'address': company.address,
        'phone': company.phone,
        'vat': getattr(company, 'vat', None),
        'created_at': company.created_at.isoformat() if getattr(company, 'created_at', None) else None
    }


@router.get('/{company_id}/stats', status_code=200)
async def get_company_stats(
    company_id: int,
    db: Session = Depends(config.get_db),
    current_user=Depends(get_current_user),
):
    # Tenant gate (plan P0-2): only platform admins or company admins of THIS
    # company may read stats. Prior to this check the endpoint was anonymous.
    company = company_crud.get_company_by_id(company_id, db)
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Company not found')
    # Company dashboard read: any member of this company (owner/admin/delegated
    # role/employee) or a platform read-operator. Was admin-only.
    assert_company_access(current_user, company_id, db)

    return company_crud.get_company_stats(company_id, db)


# ---------------------- Admin CRUD for companies ----------------------
from pydantic import BaseModel, Field
from fastapi import BackgroundTasks
from services.email_service import send_invite_email

class CompanyCreate(BaseModel):
    company_name: str = Field(..., min_length=1)
    brn: str = Field(..., min_length=1)
    email: str | None = None
    address: str | None = None
    phone: str | None = None
    vat: str | None = None
    # Defaults to 'MU' (matching companies.country_code's DB default) when
    # omitted, preserving today's behavior for every existing caller.
    country_code: str | None = None

class CompanyUpdate(BaseModel):
    company_name: str | None = None
    brn: str | None = None
    email: str | None = None
    address: str | None = None
    phone: str | None = None
    vat: str | None = None
    annual_leave_budget: int | None = None
    # M26 / kiosk v1.5 — company-wide fallback for the missed-clockout
    # auto-close chain (Job → PrivateUser → Company → 12h). Float for
    # half-hour granularity (e.g. 10.5h shifts). Nullable: NULL means
    # "fall through to the 12h system default".
    default_max_shift_hours: float | None = None
    # Clock-driven payroll switch: when true, payroll adjusts pay by attendance
    # (absences dock; only approved clock-ins / confirmed OT / verified task pay
    # feed the run). When false, salaries are paid in full regardless of the clock.
    require_approved_clockins_for_payroll: bool | None = None
    # Geofencing v3 — master switch for location-based clock-in/out
    # enforcement. 'off' = record only (existing behaviour); 'block' = reject
    # punches outside every fence; 'flag' = allow but mark for review.
    geofence_default_mode: str | None = None

class GeofenceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    address: str | None = Field(None, max_length=255)
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    radius_meters: int = Field(200, ge=10, le=5000)
    mode: str = Field('block', pattern='^(block|flag)$')
    active: bool = True
    ip_country_required: bool = False
    anchor_qr_token: str | None = Field(None, max_length=64)
    anchor_wifi_bssids: List[str] | None = None

class GeofenceUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    address: str | None = Field(None, max_length=255)
    latitude: float | None = Field(None, ge=-90, le=90)
    longitude: float | None = Field(None, ge=-180, le=180)
    radius_meters: int | None = Field(None, ge=10, le=5000)
    mode: str | None = Field(None, pattern='^(block|flag)$')
    active: bool | None = None
    ip_country_required: bool | None = None
    anchor_qr_token: str | None = Field(None, max_length=64)
    anchor_wifi_bssids: List[str] | None = None

class PayrollRecord(BaseModel):
    month: int
    amount: float

class PayrollUpdatePayload(BaseModel):
    year: int
    payrolls: List[PayrollRecord]

# ----------------- Payroll Routes -----------------

@router.get('/{company_id}/payroll', status_code=200)
async def get_company_payroll(
    company_id: int,
    year: int,
    db: Session = Depends(config.get_db),
    current_user=Depends(get_current_user),
):
    # Tenant gate (plan P0-2): the previous `pass` skip allowed any
    # authenticated user to read any company's payroll. Read-tier: company
    # admins/members plus platform operators with read_any_company_data.
    if not can_read_company(current_user, company_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='Not authorized to read payroll for this company',
        )

    payrolls = company_crud.get_company_payrolls(company_id, year, db)
    return [
        {'id': p.id, 'month': p.month, 'total_amount': p.total_amount, 'currency': p.currency}
        for p in payrolls
    ]


@router.post('/{company_id}/payroll', status_code=200)
async def update_company_payroll(
    company_id: int,
    payload: PayrollUpdatePayload,
    db: Session = Depends(config.get_db),
    current_user=Depends(get_current_user),
):
    # Permission-gated: writing payroll → manage_payroll (owner/Company Admin via
    # fallback). Was admin-only / previously an open `pass`.
    from core.permission_guards import assert_company_permission
    assert_company_permission(current_user, company_id, 'manage_payroll', db)

    try:
        company_crud.update_company_payrolls(company_id, payload.year, [p.dict() for p in payload.payrolls], db)
        return {'status': 'success'}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/', status_code=201)
async def create_company(payload: CompanyCreate, db: Session = Depends(config.get_db), current_user = Depends(get_current_user)):
    """Create a new company (platform admin only)."""
    if not getattr(current_user, 'is_superuser', False):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Only platform administrators can create companies')
    try:
        new_c = company_crud.create_company(payload.dict(), db)
        return {'company_id': new_c.company_id, 'company_name': new_c.company_name, 'brn': new_c.brn, 'email': new_c.email, 'created_at': new_c.created_at.isoformat() if new_c.created_at else None}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


class InviteCompanyUser(BaseModel):
    email: str = Field(..., min_length=3)
    role: str = Field('employee')  # allowed: owner/admin/manager/employee

class TransferOwnershipPayload(BaseModel):
    new_owner_user_id: int

class AcceptInvitePayload(BaseModel):
    token: str = Field(..., min_length=8)

@router.put('/{company_id}', status_code=200)
async def update_company(company_id: int, payload: CompanyUpdate, db: Session = Depends(config.get_db), current_user = Depends(get_current_user)):
    """Update a company (platform admin or company owner)."""
    try:
        company = company_crud.get_company_by_id(company_id, db)
        if not company:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Company not found')

        # Allow company owner, or a platform user with manage_companies.
        if not (current_user.user_id == company.user_id or has_platform_permission(current_user, 'manage_companies', db)):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You need the 'manage_companies' permission or company ownership to update this company")

        data = payload.dict(exclude_unset=True)
        # Capture the BRN before update so we can audit a change to the
        # company's legal/tax identity (a fraud vector — see UI warning).
        old_brn = company.brn
        new_brn = data.get('brn')
        brn_is_changing = 'brn' in data and new_brn is not None and str(new_brn).strip() != (old_brn or '')

        updated = company_crud.update_company(company_id, data, db)
        if not updated:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Company not found')

        if brn_is_changing:
            company_crud.log_audit(
                company_id, 'company.brn_changed', current_user.user_id, f'company:{company_id}', db,
                metadata={'old_brn': old_brn, 'new_brn': updated.brn},
            )
        return {'company_id': updated.company_id, 'company_name': updated.company_name, 'brn': updated.brn, 'email': updated.email, 'address': updated.address, 'phone': updated.phone, 'vat': getattr(updated, 'vat', None), 'require_approved_clockins_for_payroll': getattr(updated, 'require_approved_clockins_for_payroll', False), 'updated_at': updated.updated_at.isoformat() if updated.updated_at else None}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post('/{company_id}/invite', status_code=201)
async def invite_company_user(company_id: int, payload: InviteCompanyUser, background_tasks: BackgroundTasks, db: Session = Depends(config.get_db), current_user = Depends(get_current_user)):
    """Invite a user to a company (company owner/admin or platform superuser)."""
    company = company_crud.get_company_by_id(company_id, db)
    if not company:
        raise HTTPException(status_code=404, detail='Company not found')

    # permission: company owner/admin/manager, or a platform user with
    # cross-tier write authority. is_company_admin_for covers all of these
    # (owner by FK, CompanyUserRole admin/manager, act_on_behalf_of_company,
    # and superuser).
    # Inviting/onboarding a staff member → onboard_employee (owner/Company Admin
    # pass via their DB role/fallback; a delegated role passes if granted).
    from core.permission_guards import assert_company_permission, _SEEDED_COMPANY_ADMIN_ROLE_NAMES
    assert_company_permission(current_user, company.company_id, 'onboard_employee', db)

    # Anti-escalation: a non-admin onboarder may NOT invite someone INTO an
    # admin-level role (the invite's role is granted on acceptance). Only an
    # admin/owner can mint another admin.
    from core.roles import CompanyRole
    def _norm(n: str) -> str:
        return str(n).strip().lower().replace(' ', '_')
    _admin_slugs = {_norm(r) for r in (CompanyRole.admin_roles() | _SEEDED_COMPANY_ADMIN_ROLE_NAMES)}
    if _norm(payload.role or '') in _admin_slugs and not is_company_admin_for(current_user, company.company_id, db):
        raise HTTPException(status_code=403, detail='Only a company admin can invite a user into an admin role.')

    # Employees live in the MOBILE app, not the web dashboard. Route an employee
    # invite through the account-claim flow (a "set your password" link) instead
    # of a web /invite link they can't use: direct-create a shell account and
    # email a /claim link. The employee sets a password, then completes their
    # own profile on mobile. Non-employee roles (owner/admin/manager/member/
    # viewer) keep the web invite → accept flow.
    if _norm(payload.role or '') == 'employee':
        from api.v1.account_claim import generate_claim_token
        from services.email_service import send_account_claim_email
        try:
            new_user = company_crud.create_claimable_company_employee(
                company_id, payload.email, current_user.user_id, db)
        except ValueError as e:
            raise HTTPException(status_code=409, detail=str(e))
        token = generate_claim_token(db, new_user)
        db.commit()
        try:
            background_tasks.add_task(
                send_account_claim_email, payload.email, None, token, company.company_name)
        except Exception:
            pass
        return {'company_id': company_id, 'email': payload.email, 'role': 'employee', 'claim': True, 'user_id': new_user.user_id}

    invite = company_crud.invite_company_user(company_id, payload.email, payload.role, current_user.user_id, db)
    # schedule background email send (mock)
    try:
        token = invite.get('token') if isinstance(invite, dict) else getattr(invite, 'token', None)
        background_tasks.add_task(send_invite_email, payload.email, token, company.company_name, payload.role)
    except Exception:
        pass

    return {'company_id': company_id, 'email': payload.email, 'role': payload.role, 'invite_id': invite.get('invite_id') if isinstance(invite, dict) else getattr(invite, 'invite_id', None)}


# GET /invites is now declared above /{company_id} (see top of this file) to
# avoid the FastAPI route-ordering collision. /invites/{invite_id} below is
# unambiguous because its 2-segment shape doesn't match /{company_id}.
@router.delete('/invites/{invite_id}', status_code=204)
async def revoke_invite_route(invite_id: int, db: Session = Depends(config.get_db), current_user = Depends(get_current_user)):
    """Revoke an invite (platform administrators only)."""
    if not getattr(current_user, 'is_superuser', False) and not ((getattr(current_user, 'roles', None) or []) and 'platform_admin' in current_user.roles):
        raise HTTPException(status_code=403, detail='Only platform administrators can revoke invites')
    ok = company_crud.revoke_invite(invite_id, db)
    if not ok:
        raise HTTPException(status_code=404, detail='Invite not found')
    return None


@router.post('/invites/{invite_id}/resend', status_code=200)
async def resend_invite(invite_id: int, background_tasks: BackgroundTasks, db: Session = Depends(config.get_db), current_user = Depends(get_current_user)):
    """Resend an invite email (platform administrators only)."""
    if not getattr(current_user, 'is_superuser', False) and not ((getattr(current_user, 'roles', None) or []) and 'platform_admin' in current_user.roles):
        raise HTTPException(status_code=403, detail='Only platform administrators can resend invites')
    from core.model import CompanyInvite, Company
    invite = db.query(CompanyInvite).filter(CompanyInvite.invite_id == invite_id).first()
    if not invite:
        raise HTTPException(status_code=404, detail='Invite not found')
    company = db.query(Company).filter(Company.company_id == invite.company_id).first()
    token = invite.token
    # schedule background email send
    try:
        background_tasks.add_task(send_invite_email, invite.email, token, company.company_name if company else None, invite.role)
        # audit
        company_crud.log_audit(invite.company_id, 'invite_resent', current_user.user_id, f'invite:{invite_id}', db, metadata={'email': invite.email, 'role': invite.role})
    except Exception:
        raise HTTPException(status_code=500, detail='Failed to schedule resend')
    return {'status': 'success'}


@router.get('/admin/audit', status_code=200)
async def list_audit_logs(limit: int = 50, offset: int = 0, action: str | None = None, target_type: str | None = None, db: Session = Depends(config.get_db), current_user = Depends(get_current_user)):
    """List audit logs (platform administrators only)."""
    if not getattr(current_user, 'is_superuser', False) and not ((getattr(current_user, 'roles', None) or []) and 'platform_admin' in current_user.roles):
        raise HTTPException(status_code=403, detail='Only platform administrators can view audit logs')
    res = company_crud.get_audit_logs(db, limit=limit, offset=offset, action=action, target_type=target_type)
    return {'status': 'success', 'data': res['data'], 'total': res['total']}


@router.patch('/{company_id}/transfer-ownership', status_code=200)
async def transfer_company_ownership(company_id: int, payload: TransferOwnershipPayload, db: Session = Depends(config.get_db), current_user = Depends(get_current_user)):
    """Transfer company ownership to another user. Only current owner or superuser allowed."""
    company = company_crud.get_company_by_id(company_id, db)
    if not company:
        raise HTTPException(status_code=404, detail='Company not found')

    if not (getattr(current_user, 'is_superuser', False) or current_user.user_id == company.user_id):
        raise HTTPException(status_code=403, detail='Only current owner or superuser can transfer ownership')

    # Validate new owner is a member of this company
    from db_models.crud.user import get_user_by_user_id, get_private_user_by_user_id
    target_user = get_user_by_user_id(payload.new_owner_user_id, db)
    if not target_user or not getattr(target_user, 'private_user', None):
        raise HTTPException(status_code=400, detail='New owner must be an existing company user')
    if target_user.private_user.company_id != company_id:
        raise HTTPException(status_code=400, detail='New owner must belong to the company')

    updated_company = company_crud.transfer_company_ownership(company_id, payload.new_owner_user_id, current_user.user_id, db)
    # TODO: add audit entry/logging here
    return {'company_id': company_id, 'new_owner_user_id': payload.new_owner_user_id}


@router.post('/invite/accept', status_code=200)
async def accept_invite(payload: AcceptInvitePayload, db: Session = Depends(config.get_db), current_user = Depends(get_current_user)):
    """Accept a company invite using token (authenticated user)."""
    try:
        accepted = company_crud.accept_invite_by_token(payload.token, current_user.user_id, db)
        return accepted
    except HTTPException:
        raise
    except Exception as e:
        # The CRUD raises plain business errors ('Invite expired', etc.) that are
        # safe to show. A DB error, however, would leak raw SQL — let it fall
        # through to the generic 5xx handler instead of surfacing str(e) at 400.
        from sqlalchemy.exc import SQLAlchemyError
        if isinstance(e, SQLAlchemyError):
            raise
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/lookup/{brn}", status_code=status.HTTP_200_OK)
def lookup_company_by_brn(brn: str, db: Session = Depends(config.get_db)):
    """
    Lookup a company by its BRN.
    Public endpoint — used during signup to pre-fill company information.

    Returns `{status: "not_found", data: null}` with HTTP 200 when no company
    matches. "BRN doesn't exist yet" is the expected case during real-time
    typing in the signup form — surfacing it as 404 was log noise (mobile
    fires this on every keystroke). Real errors still raise 500.
    """
    try:
        company = company_crud.get_company_by_brn(brn, db)
        if not company:
            return {"status": "not_found", "data": None}
        return {
            "status": "success",
            "data": {
                "company_id": company.company_id,
                "company_name": company.company_name,
                "brn": company.brn,
                "email": company.email,
                "phone": getattr(company, 'phone', None),
                "address": getattr(company, 'address', None),
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Company lookup failed: {str(e)}"
        )


@router.get("/invite/preview/{token}")
async def preview_invite(token: str, db: Session = Depends(config.get_db)):
    """Return a preview of an invite by token (company name, role, expires_at)."""
    try:
        invite = company_crud.get_invite_by_token(token, db)
        if not invite:
            raise HTTPException(status_code=404, detail='Invite not found')
        return invite
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete('/{company_id}', status_code=204)
async def delete_company(company_id: int, db: Session = Depends(config.get_db), current_user = Depends(get_current_user)):
    """Soft-delete a company. Requires the 'delete_company' permission. Marks
    status='deleted' rather than destroying the row, so it can be restored."""
    if not has_platform_permission(current_user, 'delete_company', db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You need the 'delete_company' permission to delete companies")
    try:
        ok = company_crud.delete_company(company_id, db)
        if not ok:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Company not found')
        company_crud.log_audit(company_id, 'company.soft_deleted', current_user.user_id, f'company:{company_id}', db)
        return None
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


# ─────────────────────────────────────────────────────────────────────────────
# Company Holiday Rates  (company-scoped, with pay multiplier)
# ─────────────────────────────────────────────────────────────────────────────

class HolidayRateCreate(BaseModel):
    name: str
    date: str                     # YYYY-MM-DD
    recurrent: bool = False
    multiplier: float = 2.0
    note: str | None = None

class HolidayRateUpdate(BaseModel):
    name: str | None = None
    date: str | None = None
    recurrent: bool | None = None
    multiplier: float | None = None
    note: str | None = None


def _require_company_member(company_id: int, current_user, db):
    """Raise 403 if current_user is not an admin/owner/superuser of this company."""
    if getattr(current_user, 'is_superuser', False):
        return
    company = db.query(Company).filter(Company.company_id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail='Company not found')
    allowed = (current_user.user_id == company.user_id)
    if not allowed:
        try:
            if getattr(current_user, 'company', None) and current_user.company.company_id == company_id:
                allowed = True
        except Exception:
            pass
        try:
            if getattr(current_user, 'private_user', None) and current_user.private_user.company_id == company_id:
                allowed = True
        except Exception:
            pass
    if not allowed:
        raise HTTPException(status_code=403, detail='Not permitted')


def _assert_holiday_multiplier_above_floor(company_id: int, multiplier: float, db) -> None:
    """M6 — reject a CompanyHolidayRate multiplier below the country's
    statutory public-holiday floor. A company may pay MORE than statutory
    (e.g. 2.5× on Christmas) but never less."""
    from datetime import date as _date
    from decimal import Decimal as _Dec
    from services import payroll_rules
    company = db.query(Company).filter(Company.company_id == company_id).first()
    if company is None:
        return
    rule = payroll_rules.get_overtime_rule(db, company.country_code, _date.today())
    if rule is None:
        return  # no floor configured yet — allow (M2 fail-safe blocks payroll anyway)
    floor = rule.public_holiday_normal_hours_multiplier
    if _Dec(str(multiplier)) < floor:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "HOLIDAY_MULTIPLIER_BELOW_STATUTORY_FLOOR",
                "message": f"Multiplier {multiplier} is below the statutory floor {floor} for {company.country_code}.",
                "floor": str(floor),
            },
        )


def _serialize_rate(r) -> dict:
    return {
        'id': r.id,
        'company_id': r.company_id,
        'name': r.name,
        'date': r.date,
        'recurrent': r.recurrent,
        'multiplier': float(r.multiplier),
        'note': r.note,
        'created_at': r.created_at.isoformat() if r.created_at else None,
        'updated_at': r.updated_at.isoformat() if r.updated_at else None,
    }


@router.get('/{company_id}/holiday-rates', status_code=200)
async def list_company_holiday_rates(
    company_id: int,
    db: Session = Depends(config.get_db),
    current_user=Depends(get_current_user),
):
    """List all holiday pay rates for a company."""
    from core.model import CompanyHolidayRate
    _require_company_member(company_id, current_user, db)
    rates = db.query(CompanyHolidayRate).filter(
        CompanyHolidayRate.company_id == company_id
    ).order_by(CompanyHolidayRate.date).all()
    return [_serialize_rate(r) for r in rates]


@router.post('/{company_id}/holiday-rates', status_code=201)
async def create_company_holiday_rate(
    company_id: int,
    payload: HolidayRateCreate,
    db: Session = Depends(config.get_db),
    current_user=Depends(get_current_user),
):
    """Create a new holiday pay rate for a company."""
    from core.model import CompanyHolidayRate
    _require_company_member(company_id, current_user, db)
    _assert_holiday_multiplier_above_floor(company_id, payload.multiplier, db)
    rate = CompanyHolidayRate(
        company_id=company_id,
        name=payload.name.strip(),
        date=payload.date,
        recurrent=payload.recurrent,
        multiplier=payload.multiplier,
        note=payload.note,
    )
    db.add(rate)
    try:
        db.commit()
        db.refresh(rate)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f'Failed to create holiday rate: {e}')
    company_crud.log_audit(
        company_id, 'holiday_rate_created', current_user.user_id,
        f'holiday_rate:{rate.id}', db,
        metadata={'date': str(rate.date), 'multiplier': str(rate.multiplier), 'name': rate.name},
    )
    return _serialize_rate(rate)


@router.put('/{company_id}/holiday-rates/{rate_id}', status_code=200)
async def update_company_holiday_rate(
    company_id: int,
    rate_id: int,
    payload: HolidayRateUpdate,
    db: Session = Depends(config.get_db),
    current_user=Depends(get_current_user),
):
    """Update a holiday pay rate."""
    from core.model import CompanyHolidayRate
    _require_company_member(company_id, current_user, db)
    rate = db.query(CompanyHolidayRate).filter(
        CompanyHolidayRate.id == rate_id,
        CompanyHolidayRate.company_id == company_id,
    ).first()
    if not rate:
        raise HTTPException(status_code=404, detail='Holiday rate not found')
    if payload.multiplier is not None:
        _assert_holiday_multiplier_above_floor(company_id, payload.multiplier, db)
    changed = payload.dict(exclude_unset=True)
    for field, value in changed.items():
        setattr(rate, field, value)
    try:
        db.commit()
        db.refresh(rate)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f'Failed to update: {e}')
    company_crud.log_audit(
        company_id, 'holiday_rate_updated', current_user.user_id,
        f'holiday_rate:{rate.id}', db,
        metadata={'changed_fields': {k: str(v) for k, v in changed.items()}},
    )
    return _serialize_rate(rate)


@router.delete('/{company_id}/holiday-rates/{rate_id}', status_code=204)
async def delete_company_holiday_rate(
    company_id: int,
    rate_id: int,
    db: Session = Depends(config.get_db),
    current_user=Depends(get_current_user),
):
    """Delete a holiday pay rate."""
    from core.model import CompanyHolidayRate
    _require_company_member(company_id, current_user, db)
    rate = db.query(CompanyHolidayRate).filter(
        CompanyHolidayRate.id == rate_id,
        CompanyHolidayRate.company_id == company_id,
    ).first()
    if not rate:
        raise HTTPException(status_code=404, detail='Holiday rate not found')
    rate_meta = {'date': str(rate.date), 'multiplier': str(rate.multiplier), 'name': rate.name}
    db.delete(rate)
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f'Failed to delete: {e}')
    company_crud.log_audit(
        company_id, 'holiday_rate_deleted', current_user.user_id,
        f'holiday_rate:{rate_id}', db, metadata=rate_meta,
    )
    return None

@router.get('/{company_id}/notifications', status_code=200)
async def get_company_notifications(
    company_id: int,
    unread_only: bool = False,
    notification_type: str = None,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(config.get_db),
    current_user=Depends(get_current_user),
):
    """Return the caller's own notifications in the company dashboard's
    `{total, unread, data[]}` shape.

    With the normalized model + permission-based write-side fan-out, every
    member receives their own copy of what they're entitled to (their area's
    actionable events + their personal notifications), so "your own" is the
    complete, de-duplicated, leak-free feed — no cross-user aggregation, and
    whistleblower/personal notifications are never exposed to other members.
    """
    from core.model import Notification, NotificationRecipient

    _require_company_member(company_id, current_user, db)

    try:
        q = (
            db.query(Notification, NotificationRecipient)
            .join(NotificationRecipient, NotificationRecipient.notification_id == Notification.notification_id)
            .filter(NotificationRecipient.user_id == current_user.user_id)
        )
        if unread_only:
            q = q.filter(NotificationRecipient.is_read == False)
        if notification_type:
            q = q.filter(Notification.type == notification_type)

        total = q.count()
        unread = total if unread_only else (
            db.query(NotificationRecipient)
            .filter(
                NotificationRecipient.user_id == current_user.user_id,
                NotificationRecipient.is_read == False,
            )
            .count()
        )
        rows = (
            q.order_by(Notification.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )

        return {
            "total": total,
            "unread": unread,
            "data": [
                {
                    "notification_id": n.notification_id,
                    "user_id": r.user_id,
                    "title": n.title,
                    "message": n.message,
                    "type": n.type,
                    "is_read": bool(r.is_read),
                    "meta": n.meta,
                    "created_at": n.created_at.isoformat() if n.created_at else None,
                }
                for (n, r) in rows
            ],
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch notifications: {e}")


# ---------------------------------------------------------------------------
# Geofencing v3 — per-site fence CRUD + company default mode
# ---------------------------------------------------------------------------


def _can_manage_company(current_user, company_id: int, db: Session) -> Company:
    """Resolve + authorize a company for geofence management. Owner/Company
    Admin via assert_company_permission (seeded admin bypass); delegated
    roles need 'manage_company_settings'."""
    from core.permission_guards import assert_company_permission
    company = company_crud.get_company_by_id(company_id, db)
    if not company:
        raise HTTPException(status_code=404, detail='Company not found')
    assert_company_permission(current_user, company_id, 'manage_company_settings', db)
    return company


def _geofence_out(f: CompanyGeofence, db: Session = None) -> dict:
    from core.model import PrivateUser
    employee_count = 0
    if db is not None:
        employee_count = db.query(PrivateUser).filter(
            PrivateUser.company_id == f.company_id,
            PrivateUser.home_geofence_id == f.geofence_id,
        ).count()
    return {
        'geofence_id': f.geofence_id,
        'company_id': f.company_id,
        'name': f.name,
        'address': f.address,
        'latitude': f.latitude,
        'longitude': f.longitude,
        'radius_meters': f.radius_meters,
        'mode': f.mode,
        'active': bool(f.active),
        'ip_country_required': bool(f.ip_country_required),
        'anchor_qr_token': f.anchor_qr_token,
        'anchor_wifi_bssids': f.anchor_wifi_bssids,
        'employee_count': employee_count,
    }


@router.get('/{company_id}/geofences', status_code=200)
async def list_company_geofences(company_id: int, db: Session = Depends(config.get_db), current_user = Depends(get_current_user)):
    """List the company's geofences plus the company default mode, so the
    web settings UI (and mobile pre-check) can render the full config."""
    company = _can_manage_company(current_user, company_id, db)
    from services.geofence_service import get_company_geofences
    fences = get_company_geofences(company_id, db)
    return {
        'geofence_default_mode': company.geofence_default_mode,
        'geofences': [_geofence_out(f, db) for f in fences],
    }


@router.post('/{company_id}/geofences', status_code=201)
async def create_company_geofence(company_id: int, payload: GeofenceCreate, db: Session = Depends(config.get_db), current_user = Depends(get_current_user)):
    """Create a geofence for a company site."""
    _can_manage_company(current_user, company_id, db)
    from core.model import CompanyGeofence
    from core.tenant_context import bypass_tenant_guard
    with bypass_tenant_guard("create company_geofence"):
        fence = CompanyGeofence(
            company_id=company_id,
            name=payload.name,
            address=payload.address or None,
            latitude=payload.latitude,
            longitude=payload.longitude,
            radius_meters=payload.radius_meters,
            mode=payload.mode,
            active=payload.active,
            ip_country_required=payload.ip_country_required,
            anchor_qr_token=payload.anchor_qr_token or None,
            anchor_wifi_bssids=payload.anchor_wifi_bssids or None,
        )
        db.add(fence)
        db.commit()
        db.refresh(fence)
    return _geofence_out(fence)


@router.put('/{company_id}/geofences/{geofence_id}', status_code=200)
async def update_company_geofence(company_id: int, geofence_id: int, payload: GeofenceUpdate, db: Session = Depends(config.get_db), current_user = Depends(get_current_user)):
    """Update a geofence."""
    _can_manage_company(current_user, company_id, db)
    from core.model import CompanyGeofence
    from core.tenant_context import bypass_tenant_guard
    with bypass_tenant_guard("update company_geofence"):
        fence = db.query(CompanyGeofence).filter(
            CompanyGeofence.geofence_id == geofence_id,
            CompanyGeofence.company_id == company_id,
        ).first()
        if not fence:
            raise HTTPException(status_code=404, detail='Geofence not found')
        data = payload.dict(exclude_unset=True)
        for k, v in data.items():
            setattr(fence, k, v)
        db.commit()
        db.refresh(fence)
    return _geofence_out(fence)


@router.delete('/{company_id}/geofences/{geofence_id}', status_code=200)
async def delete_company_geofence(company_id: int, geofence_id: int, db: Session = Depends(config.get_db), current_user = Depends(get_current_user)):
    """Soft-delete a geofence. Hides it from lists + punch enforcement while
    preserving employee home-site assignments and historical payslip snapshots."""
    _can_manage_company(current_user, company_id, db)
    from core.model import CompanyGeofence
    from core.tenant_context import bypass_tenant_guard
    with bypass_tenant_guard("delete company_geofence"):
        fence = db.query(CompanyGeofence).filter(
            CompanyGeofence.geofence_id == geofence_id,
            CompanyGeofence.company_id == company_id,
        ).first()
        if not fence:
            raise HTTPException(status_code=404, detail='Geofence not found')
        fence.deleted_at = func.now()
        db.commit()
    return {'status': 'deleted', 'geofence_id': geofence_id}


@router.post('/{company_id}/geofences/{geofence_id}/reassign', status_code=200)
async def reassign_and_delete_geofence(company_id: int, geofence_id: int, payload: dict, db: Session = Depends(config.get_db), current_user = Depends(get_current_user)):
    """Soft-delete a geofence, first moving its assigned employees to a
    replacement site (or leaving them unassigned when ``to_geofence_id`` is
    null). Keeps employee assignments + payslip snapshots consistent."""
    _can_manage_company(current_user, company_id, db)
    from core.model import CompanyGeofence, PrivateUser
    from core.tenant_context import bypass_tenant_guard
    to_geofence_id = payload.get('to_geofence_id')
    with bypass_tenant_guard("reassign company_geofence"):
        fence = db.query(CompanyGeofence).filter(
            CompanyGeofence.geofence_id == geofence_id,
            CompanyGeofence.company_id == company_id,
        ).first()
        if not fence:
            raise HTTPException(status_code=404, detail='Geofence not found')
        if fence.deleted_at is not None:
            raise HTTPException(status_code=400, detail='Geofence already deleted')

        target = None
        if to_geofence_id is not None:
            target = db.query(CompanyGeofence).filter(
                CompanyGeofence.geofence_id == int(to_geofence_id),
                CompanyGeofence.company_id == company_id,
                CompanyGeofence.deleted_at.is_(None),
            ).first()
            if target is None:
                raise HTTPException(status_code=400, detail='Replacement site not found')
            if target.geofence_id == fence.geofence_id:
                raise HTTPException(status_code=400, detail='Replacement site must differ')

        users = db.query(PrivateUser).filter(
            PrivateUser.company_id == company_id,
            PrivateUser.home_geofence_id == geofence_id,
        ).all()
        for u in users:
            u.home_geofence_id = target.geofence_id if target else None

        fence.deleted_at = func.now()
        db.commit()
        from api.v1.user import _log_company_audit
        _log_company_audit(
            company_id, 'company.geofence_reassigned', current_user.user_id,
            f'geofence:{geofence_id}', db,
            {'reassigned': len(users), 'to_geofence_id': target.geofence_id if target else None},
        )
    return {
        'status': 'deleted',
        'geofence_id': geofence_id,
        'reassigned': len(users),
        'to_geofence_id': target.geofence_id if target else None,
    }
