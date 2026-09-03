from db_models.crud.purchase import create_purchase, get_purchase_by_id, get_all_purchases, update_purchase, delete_purchase
from db_models.crud.subscription import create_subscription, get_subscription_by_id, get_all_subscriptions, update_subscription, delete_subscription
from db_models.crud.loan import create_loan, get_loan_by_id, get_all_loans, update_loan, delete_loan
from db_models.crud.transfer import create_transfer_transaction, get_transfer_by_id, get_all_transfers, update_transfer, delete_transfer
from db_models.crud.leaves import create_leave, get_leave_by_id, get_leaves_by_user, get_all_leaves, get_leaves_by_company, get_leaves_by_company_with_requester, update_leave, delete_leave, approve_or_reject_leave
from db_models.crud.job import create_job, create_salary
from db_models.crud.user import create_user_right_report, delete_user, get_all_user, get_users_by_company, get_company_role_holders, get_users_by_company_search, get_user_by_email, get_user_by_user_id, register_user, update_user, get_schedules_for_user as get_schedules_for_user_crud, get_user_right_history, get_all_right_history, get_right_history_by_id, set_user_enabled, set_user_verified, get_roles_for_private_user, set_roles_for_private_user, user_has_role
from db_models.crud.repayment import get_repayments_by_loan
from db_models.crud.audit import create_audit_log
from db_models.crud.rent import create_rent, get_rent_by_id, get_rents_by_user, update_rent, delete_rent
from db_models.crud.budget import create_budget_goal, get_budget_goals_by_user, update_budget_goal, delete_budget_goal
from db_models.crud.leave_quota import create_leave_quota, get_leave_quotas_by_user, update_leave_quota

from schema.user_schema import (
    Purchase as PurchaseSchema, CreatePurchase, Subscription, CreateSubscription, Loan, CreateLoan, Transfer, CreateTransfer, CreateLeave, ShowLeave, Repayment,
    CompanySignupRequest, CreateUser, User as UserSchema, UserLoginModel, showUser, MeResponse, LoanWithRepayments, UserRight as UserRightSchema, RefreshToken, UpdateUser,
    CreateRent, CreateBudgetGoal, CreateLeaveQuota, CreatePublicHoliday,
)
from schema.job_schema import CreateSalary, OnboardJob, ShowJob, CreateJob, ShowSchedule, ApproveLeaveRequest
from services.storage_service import get_storage_service
from services.user_service import UserService
from datetime import date
from fastapi import UploadFile, File, Form

from core import config
from core.model import User, PrivateUser, Company, Job, Salary, Department, DocumentVault, DocumentAccessLog, VerificationToken, Notification, Purchase, StepUpToken
from fastapi import APIRouter, Depends, status, HTTPException, Request, Body, Query
import fastapi as _fastapi
import sys
import os
from sqlalchemy.exc import SQLAlchemyError
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session
from sqlalchemy import text, func
from core import exceptions as onbording_exceptions
from typing import List, Optional
from core.security import create_access_token, verify_password, decode_token, ACCESS_TOKEN_EXPIRY
from core.dependencies import get_current_user, require_company_scope, require_company_read_access
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
import json
import logging


from core.limiter import limiter, RATE_LIMITING_ENABLED

logger = logging.getLogger()
file_handler = logging.FileHandler("backend.log")
stream_handler = logging.StreamHandler(sys.stdout)
formatter = logging.Formatter('%(asctime)s %(levelname)s %(message)s')
file_handler.setFormatter(formatter)
stream_handler.setFormatter(formatter)
logger.addHandler(file_handler)
logger.addHandler(stream_handler)
logger.setLevel(logging.INFO)

REFRESH_TOKEN_EXPIRY = 7

router = APIRouter(
    prefix="/user",
    tags=['User']
)




# --- Subscription CRUD Routes ---
@router.post('/subscription', status_code=201)
async def create_subscription_route(subscription_data: CreateSubscription, db: Session = Depends(config.get_db)):
    try:
        subscription = create_subscription(subscription_data, db)
        return JSONResponse(status_code=201, content={"status": "success", "data": jsonable_encoder(subscription)})
    except Exception as e:
        logger.error(f"Create subscription error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create subscription")

@router.get('/subscription/{subscription_id}', status_code=200)
async def get_subscription_route(subscription_id: int, db: Session = Depends(config.get_db)):
    subscription = get_subscription_by_id(subscription_id, db)
    if not subscription:
        raise HTTPException(status_code=404, detail="Subscription not found")
    return JSONResponse(status_code=200, content={"status": "success", "data": jsonable_encoder(subscription)})

@router.get('/subscriptions', status_code=200)
async def get_all_subscriptions_route(db: Session = Depends(config.get_db)):
    subscriptions = get_all_subscriptions(db)
    return JSONResponse(status_code=200, content={"status": "success", "data": jsonable_encoder(subscriptions)})

@router.put('/subscription/{subscription_id}', status_code=200)
async def update_subscription_route(subscription_id: int, update_data: dict, db: Session = Depends(config.get_db)):
    subscription = update_subscription(subscription_id, update_data, db)
    if not subscription:
        raise HTTPException(status_code=404, detail="Subscription not found")
    return JSONResponse(status_code=200, content={"status": "success", "data": jsonable_encoder(subscription)})

@router.delete('/subscription/{subscription_id}', status_code=204)
async def delete_subscription_route(subscription_id: int, db: Session = Depends(config.get_db)):
    success = delete_subscription(subscription_id, db)
    if not success:
        raise HTTPException(status_code=404, detail="Subscription not found")
    return _fastapi.Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Transfer CRUD Routes ---
@router.post('/transfer', status_code=201)
async def create_transfer_route(transfer_data: CreateTransfer, db: Session = Depends(config.get_db)):
    try:
        transfer = create_transfer_transaction(transfer_data, db)
        return JSONResponse(status_code=201, content={"status": "success", "data": jsonable_encoder(transfer)})
    except Exception as e:
        logger.error(f"Create transfer error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create transfer")

@router.get('/transfer/{transfer_id}', status_code=200)
async def get_transfer_route(transfer_id: int, db: Session = Depends(config.get_db)):
    transfer = get_transfer_by_id(transfer_id, db)
    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer not found")
    return JSONResponse(status_code=200, content={"status": "success", "data": jsonable_encoder(transfer)})

@router.get('/transfers', status_code=200)
async def get_all_transfers_route(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(config.get_db),
):
    # Global cross-tenant dump (was unauthenticated). No app caller — restrict to
    # platform admins.
    from db_models.crud.role import get_roles_for_user
    if not get_roles_for_user(current_user.user_id, db):
        raise HTTPException(status_code=403, detail="Not permitted")
    transfers = get_all_transfers(db)
    return JSONResponse(status_code=200, content={"status": "success", "data": jsonable_encoder(transfers)})

@router.put('/transfer/{transfer_id}', status_code=200)
async def update_transfer_route(transfer_id: int, update_data: dict, db: Session = Depends(config.get_db)):
    transfer = update_transfer(transfer_id, update_data, db)
    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer not found")
    return JSONResponse(status_code=200, content={"status": "success", "data": jsonable_encoder(transfer)})

@router.delete('/transfer/{transfer_id}', status_code=204)
async def delete_transfer_route(transfer_id: int, db: Session = Depends(config.get_db)):
    success = delete_transfer(transfer_id, db)
    if not success:
        raise HTTPException(status_code=404, detail="Transfer not found")
    return _fastapi.Response(status_code=status.HTTP_204_NO_CONTENT)

# --- Loan CRUD Routes ---
@router.post('/loan', status_code=201)
async def create_loan_route(loan_data: CreateLoan, db: Session = Depends(config.get_db)):
    try:
        loan = create_loan(loan_data, db)
        return JSONResponse(status_code=201, content={"status": "success", "data": jsonable_encoder(loan)})
    except Exception as e:
        logger.error(f"Create loan error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create loan")

@router.get('/loan/{loan_id}', status_code=200)
async def get_loan_route(loan_id: int, db: Session = Depends(config.get_db)):
    loan = get_loan_by_id(loan_id, db)
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    repayments = get_repayments_by_loan(loan_id, db)
    loan_data = LoanWithRepayments.model_validate(loan)
    loan_data.repayments = repayments
    return JSONResponse(status_code=200, content={"status": "success", "data": jsonable_encoder(loan_data)})

@router.get('/loans', status_code=200)
async def get_all_loans_route(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(config.get_db),
):
    # Global cross-tenant dump (was unauthenticated). No app caller — restrict to
    # platform admins.
    from db_models.crud.role import get_roles_for_user
    if not get_roles_for_user(current_user.user_id, db):
        raise HTTPException(status_code=403, detail="Not permitted")
    loans = get_all_loans(db)
    result = []
    for loan in loans:
        repayments = get_repayments_by_loan(loan.loan_id, db)
        loan_data = LoanWithRepayments.model_validate(loan)
        loan_data.repayments = repayments
        result.append(loan_data)
    return JSONResponse(status_code=200, content={"status": "success", "data": jsonable_encoder(result)})

@router.put('/loan/{loan_id}', status_code=200)
async def update_loan_route(loan_id: int, update_data: dict, db: Session = Depends(config.get_db)):
    loan = update_loan(loan_id, update_data, db)
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    return JSONResponse(status_code=200, content={"status": "success", "data": jsonable_encoder(loan)})

@router.delete('/loan/{loan_id}', status_code=204)
async def delete_loan_route(loan_id: int, db: Session = Depends(config.get_db)):
    success = delete_loan(loan_id, db)
    if not success:
        raise HTTPException(status_code=404, detail="Loan not found")
    return _fastapi.Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Leave CRUD Routes ---
@router.post('/leave', status_code=201, response_model=ShowLeave)
async def create_leave_route(leave_data: CreateLeave, db: Session = Depends(config.get_db)):
    try:
        leave = create_leave(leave_data, db)
        # Notify company admin about the new leave request (fire-and-forget)
        try:
            from services.notification_service import NotificationService
            NotificationService.notify_employer_leave_request(db, leave)
        except Exception as notify_err:
            logger.warning(f"Leave employer notification failed (non-fatal): {notify_err}")
        return JSONResponse(status_code=201, content={"status": "success", "data": jsonable_encoder(leave)})
    except Exception as e:
        logger.error(f"Create leave error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create leave request")

@router.get('/leave/{leave_id}', status_code=200, response_model=ShowLeave)
async def get_leave_route(leave_id: int, db: Session = Depends(config.get_db)):
    leave = get_leave_by_id(leave_id, db)
    if not leave:
        raise HTTPException(status_code=404, detail="Leave request not found")
    return JSONResponse(status_code=200, content={"status": "success", "data": jsonable_encoder(leave)})

@router.get('/leaves/user/{private_user_id}', status_code=200, response_model=List[ShowLeave])
async def get_user_leaves_route(private_user_id: int, db: Session = Depends(config.get_db)):
    leaves = get_leaves_by_user(private_user_id, db)
    return JSONResponse(status_code=200, content={"status": "success", "data": jsonable_encoder(leaves)})


@router.get('/me/leave-balance', status_code=200)
async def get_my_leave_balance(
    year: Optional[int] = None,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """The authenticated employee's own leave balance (entitlement / taken /
    remaining) per paid leave type, for the given year (default: current)."""
    from datetime import date as _date
    from services.leave_balance import compute_leave_balance

    priv = db.query(PrivateUser).filter(PrivateUser.user_id == current_user.user_id).first()
    if priv is None:
        return {"year": year or _date.today().year, "balances": []}
    return compute_leave_balance(db, priv.private_user_id, year or _date.today().year)

@router.get('/leaves', status_code=200, response_model=List[ShowLeave])
async def get_all_leaves_route(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(config.get_db),
):
    # Global cross-tenant dump (was unauthenticated). No app caller — restrict to
    # platform admins. Company leave lists use /leaves/company/{company_id}.
    from db_models.crud.role import get_roles_for_user
    if not get_roles_for_user(current_user.user_id, db):
        raise HTTPException(status_code=403, detail="Not permitted")
    from db_models.crud.leaves import get_all_leaves_with_requester
    leaves = get_all_leaves_with_requester(db)
    return JSONResponse(status_code=200, content={"status": "success", "data": jsonable_encoder(leaves)})

@router.get('/leaves/company/{company_id}', status_code=200, response_model=List[ShowLeave])
async def get_leaves_by_company_route(company_id: int, db: Session = Depends(config.get_db), _=Depends(require_company_read_access)):
    # Scoped: caller must belong to the company (was an open cross-tenant read).
    leaves = get_leaves_by_company_with_requester(company_id, db)
    return JSONResponse(status_code=200, content={"status": "success", "data": jsonable_encoder(leaves)})

@router.put('/leave/{leave_id}', status_code=200, response_model=ShowLeave)
async def update_leave_route(leave_id: int, update_data: dict, db: Session = Depends(config.get_db)):
    leave = update_leave(leave_id, update_data, db)
    if not leave:
        raise HTTPException(status_code=404, detail="Leave request not found")
    return JSONResponse(status_code=200, content={"status": "success", "data": jsonable_encoder(leave)})

@router.delete('/leave/{leave_id}', status_code=204)
async def delete_leave_route(leave_id: int, db: Session = Depends(config.get_db)):
    success = delete_leave(leave_id, db)
    if not success:
        raise HTTPException(status_code=404, detail="Leave request not found")
    return _fastapi.Response(status_code=status.HTTP_204_NO_CONTENT)

@router.put('/leave/{leave_id}/approve', status_code=200, response_model=ShowLeave)
async def approve_or_reject_leave_route(leave_id: int, approval_data: ApproveLeaveRequest, current_user: User = Depends(get_current_user), db: Session = Depends(config.get_db)):
    # Authorize BEFORE mutating: approving/rejecting leave requires the
    # 'approve_leave' company permission (Owner / Company Admin bypass via
    # assert_company_permission). Resolve the leave's company from the requester.
    from db_models.crud.leaves import get_leave_by_id
    from core.permission_guards import assert_company_permission
    existing = get_leave_by_id(leave_id, db)
    if not existing:
        raise HTTPException(status_code=404, detail="Leave request not found")
    pu = getattr(existing, 'private_user', None)
    company_id = None
    if pu is not None:
        job = next((j for j in (pu.jobs or []) if j.company_id), None)
        company_id = (job.company_id if job else None) or pu.company_id
    if company_id is None:
        raise HTTPException(status_code=400, detail="Cannot resolve company for this leave request")
    assert_company_permission(
        current_user, company_id, 'approve_leave', db,
        endpoint='/user/leave/{leave_id}/approve', method='PUT',
    )

    try:
        leave = approve_or_reject_leave(leave_id, approval_data.action, approval_data.rejection_reason, approval_data.approver_comments, current_user.user_id, db)
        if not leave:
            raise HTTPException(status_code=404, detail="Leave request not found")
        # Notify employee of status change
        try:
            from services.notification_service import NotificationService
            NotificationService.notify_leave_status_change(db, leave, approval_data.action)
        except Exception as notify_err:
            logger.error(f"Leave notification failed (non-fatal): {notify_err}")
        return JSONResponse(status_code=200, content={"status": "success", "data": jsonable_encoder(leave)})
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Approve/reject leave error: {e}")
        raise HTTPException(status_code=500, detail="Failed to approve/reject leave request")

# --- Rent CRUD Routes ---
@router.post('/rent', status_code=201)
async def create_rent_route(rent_data: CreateRent, db: Session = Depends(config.get_db)):
    try:
        rent = create_rent(rent_data, db)
        return JSONResponse(status_code=201, content={"status": "success", "data": jsonable_encoder(rent)})
    except Exception as e:
        logger.error(f"Create rent error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create rent")

@router.get('/rent/{rent_id}', status_code=200)
async def get_rent_route(rent_id: int, db: Session = Depends(config.get_db)):
    rent = get_rent_by_id(rent_id, db)
    if not rent:
        raise HTTPException(status_code=404, detail="Rent not found")
    return JSONResponse(status_code=200, content={"status": "success", "data": jsonable_encoder(rent)})

@router.get('/rents/{private_user_id}', status_code=200)
async def get_user_rents_route(private_user_id: int, db: Session = Depends(config.get_db)):
    rents = get_rents_by_user(private_user_id, db)
    return JSONResponse(status_code=200, content={"status": "success", "data": jsonable_encoder(rents)})

@router.put('/rent/{rent_id}', status_code=200)
async def update_rent_route(rent_id: int, update_data: dict, db: Session = Depends(config.get_db)):
    rent = update_rent(rent_id, update_data, db)
    if not rent:
        raise HTTPException(status_code=404, detail="Rent not found")
    return JSONResponse(status_code=200, content={"status": "success", "data": jsonable_encoder(rent)})

@router.delete('/rent/{rent_id}', status_code=204)
async def delete_rent_route(rent_id: int, db: Session = Depends(config.get_db)):
    success = delete_rent(rent_id, db)
    if not success:
        raise HTTPException(status_code=404, detail="Rent not found")
    return _fastapi.Response(status_code=status.HTTP_204_NO_CONTENT)

# --- Budget Goal CRUD Routes ---
@router.post('/budget', status_code=201)
async def create_budget_goal_route(data: CreateBudgetGoal, db: Session = Depends(config.get_db)):
    try:
        goal = create_budget_goal(data, db)
        return JSONResponse(status_code=201, content={"status": "success", "data": jsonable_encoder(goal)})
    except Exception as e:
        logger.error(f"Create budget goal error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create budget goal")

@router.get('/budgets/{private_user_id}', status_code=200)
async def get_user_budget_goals_route(private_user_id: int, db: Session = Depends(config.get_db)):
    goals = get_budget_goals_by_user(private_user_id, db)
    return JSONResponse(status_code=200, content={"status": "success", "data": jsonable_encoder(goals)})

@router.put('/budget/{budget_id}', status_code=200)
async def update_budget_goal_route(budget_id: int, update_data: dict, db: Session = Depends(config.get_db)):
    goal = update_budget_goal(budget_id, update_data, db)
    if not goal:
        raise HTTPException(status_code=404, detail="Budget goal not found")
    return JSONResponse(status_code=200, content={"status": "success", "data": jsonable_encoder(goal)})

@router.delete('/budget/{budget_id}', status_code=204)
async def delete_budget_goal_route(budget_id: int, db: Session = Depends(config.get_db)):
    success = delete_budget_goal(budget_id, db)
    if not success:
        raise HTTPException(status_code=404, detail="Budget goal not found")
    return _fastapi.Response(status_code=status.HTTP_204_NO_CONTENT)

# --- Leave Quota Routes ---
@router.post('/leave-quota', status_code=201)
async def create_leave_quota_route(data: CreateLeaveQuota, db: Session = Depends(config.get_db)):
    try:
        quota = create_leave_quota(data, db)
        return JSONResponse(status_code=201, content={"status": "success", "data": jsonable_encoder(quota)})
    except Exception as e:
        logger.error(f"Create leave quota error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create leave quota")

@router.get('/leave-quotas/{private_user_id}', status_code=200)
async def get_user_leave_quotas_route(private_user_id: int, year: int = None, db: Session = Depends(config.get_db)):
    if year is None:
        year = datetime.now().year
    quotas = get_leave_quotas_by_user(private_user_id, year, db)
    return JSONResponse(status_code=200, content={"status": "success", "data": jsonable_encoder(quotas)})

@router.put('/leave-quota/{quota_id}', status_code=200)
async def update_leave_quota_route(quota_id: int, update_data: dict, db: Session = Depends(config.get_db)):
    quota = update_leave_quota(quota_id, update_data, db)
    if not quota:
        raise HTTPException(status_code=404, detail="Leave quota not found")
    return JSONResponse(status_code=200, content={"status": "success", "data": jsonable_encoder(quota)})

# --- Public Holidays Routes ---
@router.post('/holiday', status_code=201)
async def create_holiday_route(data: CreatePublicHoliday, db: Session = Depends(config.get_db)):
    try:
        from core.model import PublicHoliday
        holiday = PublicHoliday(
            country_code=data.country_code,
            name=data.name,
            date=data.date,
            year=data.year,
            is_recurring=data.is_recurring,
        )
        db.add(holiday)
        db.commit()
        db.refresh(holiday)
        return JSONResponse(status_code=201, content={"status": "success", "data": jsonable_encoder(holiday)})
    except Exception as e:
        logger.error(f"Create holiday error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create holiday")

@router.get('/holidays/{country_code}', status_code=200)
async def get_holidays_route(country_code: str, year: int = None, db: Session = Depends(config.get_db)):
    from core.model import PublicHoliday
    if year is None:
        year = datetime.now().year
    holidays = db.query(PublicHoliday).filter(
        PublicHoliday.country_code == country_code,
        PublicHoliday.year == year,
    ).order_by(PublicHoliday.date).all()
    return JSONResponse(status_code=200, content={"status": "success", "data": jsonable_encoder(holidays)})


@router.post('/sign-up', status_code=201, response_model=showUser)
async def create_sign_up(request: CreateUser, db: Session = Depends(config.get_db)):
    user = await UserService.signup_user(request, db)
    
    return JSONResponse(
        status_code=200,
        content={
            "status": "success",
            "message": "User created successfully. Please verify your email.",
            "data": jsonable_encoder(showUser.model_validate(user))
        }
    )

@router.post('/company-sign-up', status_code=201, response_model=showUser)
async def create_company_sign_up(request: CompanySignupRequest, db: Session = Depends(config.get_db)):
    user = await UserService.signup_user(request, db)

    return JSONResponse(
        status_code=200,
        content={
            "status": "success",
            "message": "User created successfully. Please verify your email.",
            "data": jsonable_encoder(showUser.model_validate(user))
        }
    )

@router.get('/users', status_code=200, response_model=List[showUser])
async def get_users(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(config.get_db),
):
    """List users. Was UNAUTHENTICATED and returned EVERY user across ALL
    companies (cross-tenant leak + tenant_guard warning). Now requires auth and
    scopes non-admins to their own company; platform admins still see all."""
    try:
        if getattr(current_user, 'is_superuser', False):
            return get_all_user(db)
        company_id = None
        if getattr(current_user, 'company', None):
            company_id = current_user.company.company_id
        elif getattr(current_user, 'private_user', None) and current_user.private_user.company_id:
            company_id = current_user.private_user.company_id
        if company_id is None:
            return []
        return get_users_by_company(company_id, db)
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"something is wrong with your query")
    except Exception:
        logger.error("Unexpected Error: %s", sys.exc_info())
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)

@router.get('/users/company/{company_id}', status_code=200, response_model=List[showUser])
async def get_users_by_company_endpoint(
    company_id: int,
    status: Optional[str] = None,
    roles: Optional[str] = None,
    db: Session = Depends(config.get_db),
    company = Depends(require_company_read_access),
):
    # require_company_scope already verified access AND set tenant context for
    # the request — downstream eager loaders on multi-tenant tables run under
    # that context.
    # `roles` is an optional comma-separated allow-list (e.g. "owner,admin,manager")
    # used to fetch the managers/HR a worker can tag on a report, instead of staff.
    roles_in = [r.strip() for r in roles.split(',') if r.strip()] if roles else None
    try:
        users = get_users_by_company(company_id, db, status=status, roles_in=roles_in)
        # Enrich each user with their company management roles. The CompanyUserRole
        # lookup must run OUTSIDE the request's tenant scope (set by
        # require_company_read_access) — under that scope the company_user_roles
        # query comes back empty, which is why the employees list showed no role
        # badges. bypass_tenant_guard is safe: we still filter by this company_id.
        from core.tenant_context import bypass_tenant_guard
        with bypass_tenant_guard("resolve company roles for employees list"):
            for u in users:
                if getattr(u, 'private_user', None):
                    try:
                        roles = get_roles_for_private_user(company_id, u.private_user.private_user_id, db)
                        # Top-level company_roles (display names) — what the web reads.
                        setattr(u, 'company_roles', roles or [])
                        # Attach a roles property on private_user for legacy consumers.
                        setattr(u.private_user, 'roles', roles)
                        # Back-compat: set single role property to first role if not set.
                        if roles and (not getattr(u.private_user, 'role', None) or getattr(u.private_user, 'role') == 'employee'):
                            setattr(u.private_user, 'role', roles[0])
                    except Exception:
                        # ignore roles enrichment errors
                        pass
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"something is wrong with your query")
    except:
        logger.error("Unexpected Error:", sys.exc_info())
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)

    # Serialize each employee defensively. A single record with dirty data (a
    # null value in a field the output schema marks required — e.g. an imported
    # job missing employer_name, or a legacy row) would otherwise make FastAPI's
    # List[showUser] response validation fail ATOMICALLY, 500-ing the WHOLE list
    # and leaving the schedule/task assignee pickers unable to load ANY employee.
    # Skip (and log) the offending record instead so the rest of the roster
    # still loads.
    serialized: list[showUser] = []
    for u in users:
        try:
            serialized.append(showUser.model_validate(u))
        except Exception as e:
            logger.error(
                f"Skipping employee user_id={getattr(u, 'user_id', '?')} in "
                f"company {company_id} list — output serialization failed: {e}"
            )
    return serialized


@router.get('/users/company/{company_id}/role-holders', status_code=200, response_model=List[showUser])
async def get_company_role_holders_endpoint(
    company_id: int,
    db: Session = Depends(config.get_db),
    company = Depends(require_company_read_access),
):
    """Managers/HR/admins (anyone assigned a role on the company's role page, plus
    the owner) — the people a worker can tag/route a report to."""
    try:
        users = get_company_role_holders(company_id, db)
        for u in users:
            if getattr(u, 'private_user', None):
                try:
                    roles = get_roles_for_private_user(company_id, u.private_user.private_user_id, db)
                    setattr(u.private_user, 'roles', roles)
                    if roles and (not getattr(u.private_user, 'role', None) or getattr(u.private_user, 'role') == 'employee'):
                        setattr(u.private_user, 'role', roles[0])
                except Exception:
                    pass
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=500, detail="something is wrong with your query")
    except Exception:
        logger.error("Unexpected Error:", sys.exc_info())
        raise HTTPException(status_code=500)
    return users


@router.get('/users/company/{company_id}/search', status_code=200, response_model=List[showUser])
async def search_users_by_company_endpoint(
    company_id: int,
    q: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(config.get_db),
    company = Depends(require_company_scope),
):
    """Search users within a company for typeahead. Respects same permissions as the full list endpoint."""
    try:
        logger.debug(f"Searching users for company_id={company_id} q={q} limit={limit} offset={offset}")
        try:
            users = get_users_by_company_search(company_id, q, limit, offset, db)
            logger.debug(f"get_users_by_company_search returned {len(users)} users")
        except Exception as e:
            logger.exception("Error calling get_users_by_company_search")
            raise

        for u in users:
            if getattr(u, 'private_user', None):
                try:
                    roles = get_roles_for_private_user(company_id, u.private_user.private_user_id, db)
                    setattr(u.private_user, 'roles', roles)
                    if roles and (not getattr(u.private_user, 'role', None) or getattr(u.private_user, 'role') == 'employee'):
                        setattr(u.private_user, 'role', roles[0])
                except Exception:
                    logger.debug(f"roles enrichment failed for user {getattr(u,'user_id',None)}; continuing")
                    pass
        logger.debug("roles enrichment complete")
    except SQLAlchemyError as e:
        logger.exception("SQLAlchemyError in search_users_by_company_endpoint")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"something is wrong with your query")
    except Exception as e:
        logger.exception("Unexpected Error in search_users_by_company_endpoint")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)

    # Serialize users into JSON-able structures to avoid lazy-loading / serialization errors later
    try:
        from fastapi.responses import JSONResponse
        serialized = [jsonable_encoder(showUser.model_validate(u)) for u in users]
        logger.debug(f"serialized {len(serialized)} users, returning response")
        return JSONResponse(status_code=200, content=serialized)
    except Exception:
        logger.exception("Failed to serialize users in search endpoint")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error serializing user results")


@router.get('/company/{company_id}/users/{user_id}/roles', status_code=200)
async def get_company_user_roles(company_id: int, user_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(config.get_db)):
    """Get a user's roles within a company"""
    company = db.query(Company).filter(Company.company_id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail='Company not found')

    # Accept either private_user_id (what the web Permission Manager sends) or
    # user_id, like set_company_user_role.
    private = (
        db.query(PrivateUser).filter(PrivateUser.private_user_id == user_id).first()
        or db.query(PrivateUser).filter(PrivateUser.user_id == user_id).first()
    )
    if not private:
        raise HTTPException(status_code=404, detail='User not found')

    # Ensure the user belongs to company
    if private.company_id != company_id:
        job = db.query(Job).filter(Job.private_user_id == private.private_user_id, Job.company_id == company_id).first()
        if not job:
            raise HTTPException(status_code=400, detail='User not found in company')

    roles = get_roles_for_private_user(company_id, private.private_user_id, db)
    return {'user_id': user_id, 'roles': roles}

@router.get('/me', status_code=200, response_model=MeResponse)
async def get_current_user_info(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(config.get_db)
):
    """Get current authenticated user information"""
    try:
        # Refresh user data from database to get latest info
        user = get_user_by_user_id(current_user.user_id, db)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        # Self-heal `onboard_complete` (same rationale as login_user). This is
        # the endpoint the mobile app polls to re-evaluate navigation, so a
        # stale-false flag here is exactly what strands a fully-onboarded user
        # on the profile screen. Recompute + persist from concrete state.
        try:
            from core.onboarding import refresh_user_onboard_state
            refresh_user_onboard_state(user, db)
            db.commit()
        except Exception as ob_err:
            logger.warning(f"/me onboard self-heal failed (non-fatal): {ob_err}")
            db.rollback()

        # Attach platform roles and superuser flag for frontend convenience
        try:
            from db_models.crud.role import get_roles_for_user
            roles = get_roles_for_user(user.user_id, db)
            setattr(user, 'roles', roles)
            setattr(user, 'is_superuser', 'platform_admin' in roles)
        except Exception as e:
            logger.error(f"Error fetching roles for user {user.user_id}: {e}")
            db.rollback()
            setattr(user, 'roles', [])
            setattr(user, 'is_superuser', False)

        # Phase 2 — surface the union of platform-permissions for sidebar gating.
        # The rollback is critical: if the alembic migration that adds
        # platform_roles.permissions hasn't run on this DB yet, the query
        # below errors with "column does not exist" and Postgres aborts the
        # whole transaction. Subsequent lazy loads (time_logs, leaves during
        # response serialization) then fail with InFailedSqlTransaction.
        # Rolling back here restores the session so the response can finish.
        try:
            from core.permission_guards import _platform_permissions_for_user
            setattr(user, 'platform_permissions', sorted(_platform_permissions_for_user(user, db)))
        except Exception as e:
            logger.error(f"Error fetching platform permissions for user {user.user_id}: {e}")
            try:
                db.rollback()
            except Exception:
                pass
            setattr(user, 'platform_permissions', [])

        # Add is_company_admin flag for frontend consistency
        try:
            from core.roles import is_company_admin
            setattr(user, 'is_company_admin', is_company_admin(user))
        except Exception as e:
            logger.error(f"Error determining company admin for user {user.user_id}: {e}")
            # No db operation here usually (it works on user object), but if it did triggers lazy load:
            # db.rollback() 
            setattr(user, 'is_company_admin', False)

        # Company RBAC — fine-grained company permissions for the web sidebar/access.
        try:
            from core.permission_guards import company_access_for_user, company_rbac_enabled
            cperms, croles = company_access_for_user(user, db)
            setattr(user, 'company_permissions', cperms)
            setattr(user, 'company_roles', croles)
            setattr(user, 'company_rbac_enabled', company_rbac_enabled())
        except Exception as e:
            logger.error(f"Error fetching company permissions for user {user.user_id}: {e}")
            setattr(user, 'company_permissions', [])
            setattr(user, 'company_roles', [])
            setattr(user, 'company_rbac_enabled', False)

        return user
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Database error occurred")
    except Exception as e:
        logger.error("Unexpected Error:", sys.exc_info())
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)

@router.get('/by-email/{email}', status_code=200)
async def get_user_by_email_endpoint(email: str, db: Session = Depends(config.get_db)):
    """Check whether a user with this email exists (signup availability probe).

    Intentionally unauthenticated — the mobile signup flow calls this before the
    user has a session. Because it's public, it must NOT return user data; the
    previous `response_model=showUser` leaked full PII (passport, DOB, salary,
    employer details) to anyone who knew an email. Returns a bare presence
    signal only.
    """
    try:
        user = get_user_by_email(email, db)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return {"email": email, "exists": True}
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Database error occurred")
    except Exception as e:
        logger.error("Unexpected Error:", sys.exc_info())
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)

@router.get('/by_user_id/{user_id}', status_code=200, response_model=showUser)
async def get_user_by_id(user_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(config.get_db)):
    try:
        user = get_user_by_user_id(user_id, db)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        # Authorization — previously unauthenticated (IDOR): anyone could fetch
        # any user's full showUser (passport, DOB, gender, jobs, salaries,
        # employer PII) by guessing an id. Allow self, platform admins, and a
        # company admin/manager who may view this employee.
        is_self = current_user.user_id == user_id
        is_platform_admin = getattr(current_user, 'is_superuser', False)

        is_company_admin = False
        company_id = None
        try:
            company_id = _resolve_employee_company(user, db).company_id
        except HTTPException:
            company_id = user.company.company_id if user.company else None
        if company_id:
            from core.permission_guards import has_company_permission
            is_company_admin = has_company_permission(current_user, company_id, 'view_employee', db)

        if not (is_self or is_platform_admin or is_company_admin):
            raise HTTPException(status_code=403, detail="Not permitted to view this user")
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"something is wrong with your query")
    except:
        logger.error("Unexpected Error:", sys.exc_info())
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
    return user


@router.delete('/me', status_code=status.HTTP_200_OK)
async def delete_my_account(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(config.get_db),
):
    """Self-service account deletion (GDPR + App Store / Google Play requirement).

    Soft-deletes and anonymizes the authenticated user: login is disabled and all
    personal identifiers are scrubbed. Sensitive uploads (documents, receipt
    images) and their stored files are removed; notifications and sessions are
    purged. Employment, payroll and audit records the employer must retain by law
    are KEPT but de-identified (they link only to an anonymized user record).

    Blocked when the caller owns a company that still has other members — they
    must transfer ownership or offboard their team first, so no workforce is
    orphaned.
    """
    user = db.query(User).filter(User.user_id == current_user.user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    private = db.query(PrivateUser).filter(PrivateUser.user_id == user.user_id).first()
    my_private_id = private.private_user_id if private else None

    # Guard: never orphan a workforce.
    owned_companies = db.query(Company).filter(Company.user_id == user.user_id).all()
    for company in owned_companies:
        q = db.query(PrivateUser).filter(PrivateUser.company_id == company.company_id)
        if my_private_id is not None:
            q = q.filter(PrivateUser.private_user_id != my_private_id)
        if q.count() > 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "You own a company with other members. Please transfer ownership "
                    "or remove your team before deleting your account."
                ),
            )

    original_email = user.email
    storage = get_storage_service()

    try:
        # 1) Scrub sensitive uploaded files + their rows/refs.
        if my_private_id is not None:
            for d in db.query(DocumentVault).filter(DocumentVault.private_user_id == my_private_id).all():
                try:
                    storage.delete_file(getattr(d, "file_url", None))
                except Exception:
                    pass
            db.query(DocumentVault).filter(DocumentVault.private_user_id == my_private_id).delete(synchronize_session=False)

            for p in db.query(Purchase).filter(
                Purchase.private_user_id == my_private_id, Purchase.receipt_image_url.isnot(None)
            ).all():
                try:
                    storage.delete_file(p.receipt_image_url)
                except Exception:
                    pass
                p.receipt_image_url = None

        # 2) Delete this user's notification deliveries (recipient rows). Shared
        #    event rows are left for other recipients; orphans are swept by
        #    retention. (Legacy single-recipient event rows also cascade via the
        #    notifications.user_id FK if the user row itself is removed.)
        from core.model import NotificationRecipient
        db.query(NotificationRecipient).filter(
            NotificationRecipient.user_id == user.user_id
        ).delete(synchronize_session=False)

        # 3) Revoke sessions / tokens.
        db.query(StepUpToken).filter(StepUpToken.user_id == user.user_id).delete(synchronize_session=False)
        if original_email:
            db.query(VerificationToken).filter(VerificationToken.email == original_email).delete(synchronize_session=False)
        try:
            with db.begin_nested():
                db.execute(text("DELETE FROM trusted_devices WHERE user_id = :uid"), {"uid": user.user_id})
        except Exception:
            pass

        # 4) Anonymize the PrivateUser PII (employment record retained, de-identified).
        if private is not None:
            private.first_name = "Deleted"
            private.last_name = "User"
            private.phone = None
            private.date_of_birth = None
            private.pass_port_number = None
            private.kiosk_pin_hash = None

        # 5) Anonymize the User + disable login.
        user.user_enabled = False
        user.user_verified = False
        user.email = f"deleted+{user.user_id}@deleted.invalid"
        user.phone = None
        user.user_name = None
        user.password_hash = "ACCOUNT_DELETED"
        user.expo_push_token = None

        # 6) Audit (append-only INSERT; no PII in the payload).
        create_audit_log(db, user.user_id, "account_deleted", "users", user.user_id, {"self_service": True}, commit=False)

        db.commit()
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"Account deletion failed for user {current_user.user_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not delete your account. Please try again or contact hello@kiruko.mu.",
        )

    return {"message": "Your account has been deleted."}


# Allow a user to leave their company (disable membership and remove company association)
@router.post('/me/leave', status_code=200)
async def leave_my_company(current_user: User = Depends(get_current_user), db: Session = Depends(config.get_db)):
    """Current user leaves their company and disables their membership"""
    # fetch private user record
    private = db.query(PrivateUser).filter(PrivateUser.user_id == current_user.user_id).first()
    if not private:
        raise HTTPException(status_code=404, detail='Private user not found')

    # Remove company association and department
    private.company_id = None
    private.department_id = None

    # disable the main user account for company membership
    user = db.query(User).filter(User.user_id == current_user.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail='User not found')
    user.user_enabled = False

    db.commit()
    return { 'success': True, 'user_id': user.user_id }


# Owner endpoint: set a user's department
@router.patch('/{user_id}/department', status_code=200)
async def patch_user_department(user_id: int, payload: dict, current_user: User = Depends(get_current_user), db: Session = Depends(config.get_db)):
    """Set or clear the department for a user (company owner only)"""
    # Fetch target user and private_user
    target = get_user_by_user_id(user_id, db)
    if not target:
        raise HTTPException(status_code=404, detail='User not found')

    if not target.private_user:
        raise HTTPException(status_code=400, detail='Target user has no company association')

    company_id = target.private_user.company_id
    if company_id is None:
        # If private_user has no company recorded, check for a job linking them to a company
        job = db.query(Job).filter(Job.private_user_id == target.private_user.private_user_id, Job.company_id != None).first()
        if job:
            company_id = job.company_id
        else:
            raise HTTPException(status_code=400, detail='Target user has no company association')

    company = db.query(Company).filter(Company.company_id == company_id).first()
    if not company:
        raise HTTPException(status_code=400, detail='Target user has no company association')

    # Check admin privileges using centralized helper
    from core.permission_guards import assert_company_permission
    assert_company_permission(current_user, company.company_id, 'edit_employee', db)
    dept_id = payload.get('department_id')
    # Allow clearing department (null)
    if dept_id is None:
        target.private_user.department_id = None
        db.commit()
        _log_company_audit(company.company_id, 'employee.department_changed', current_user.user_id, f'user:{user_id}', db, {'department_id': None})
        return { 'user_id': user_id, 'department_id': None }

    # Validate department belongs to the same company
    dept = db.query(Department).filter(Department.department_id == int(dept_id), Department.company_id == company.company_id).first()
    if not dept:
        raise HTTPException(status_code=400, detail='Invalid department for this company')

    target.private_user.department_id = dept.department_id
    db.commit()
    _log_company_audit(company.company_id, 'employee.department_changed', current_user.user_id, f'user:{user_id}', db, {'department_id': dept.department_id})
    return { 'user_id': user_id, 'department_id': dept.department_id }


# Owner endpoint: set an employee's home site (branch)
@router.patch('/{user_id}/home-site', status_code=200)
async def patch_user_home_site(user_id: int, payload: dict, current_user: User = Depends(get_current_user), db: Session = Depends(config.get_db)):
    """Set or clear the home site (geofence/branch) for a user (company owner only).

    Mirrors patch_user_department: the geofence must belong to the SAME
    company as the employee. The site is administrative metadata shown on
    payslips — clock-in enforcement never narrows to this fence.
    """
    from core.model import CompanyGeofence
    target = get_user_by_user_id(user_id, db)
    if not target:
        raise HTTPException(status_code=404, detail='User not found')

    if not target.private_user:
        raise HTTPException(status_code=400, detail='Target user has no company association')

    company_id = target.private_user.company_id
    if company_id is None:
        job = db.query(Job).filter(Job.private_user_id == target.private_user.private_user_id, Job.company_id != None).first()
        if job:
            company_id = job.company_id
        else:
            raise HTTPException(status_code=400, detail='Target user has no company association')

    company = db.query(Company).filter(Company.company_id == company_id).first()
    if not company:
        raise HTTPException(status_code=400, detail='Target user has no company association')

    from core.permission_guards import assert_company_permission
    assert_company_permission(current_user, company.company_id, 'edit_employee', db)
    site_id = payload.get('home_geofence_id')
    if site_id is None:
        target.private_user.home_geofence_id = None
        db.commit()
        _log_company_audit(company.company_id, 'employee.home_site_changed', current_user.user_id, f'user:{user_id}', db, {'home_geofence_id': None})
        return { 'user_id': user_id, 'home_geofence_id': None }

    site = db.query(CompanyGeofence).filter(
        CompanyGeofence.geofence_id == int(site_id),
        CompanyGeofence.company_id == company.company_id,
    ).first()
    if not site:
        raise HTTPException(status_code=400, detail='Invalid site for this company')

    target.private_user.home_geofence_id = site.geofence_id
    db.commit()
    _log_company_audit(company.company_id, 'employee.home_site_changed', current_user.user_id, f'user:{user_id}', db, {'home_geofence_id': site.geofence_id, 'site': site.name})
    return { 'user_id': user_id, 'home_geofence_id': site.geofence_id }


# Admin endpoints to update user flags (company owner only)
@router.patch('/{user_id}/enable', status_code=200)
async def patch_user_enable(user_id: int, payload: dict, current_user: User = Depends(get_current_user), db: Session = Depends(config.get_db)):
    """Enable or disable a user's membership"""
    logger.info(f"patch_user_enable called for user_id={user_id} by current_user={getattr(current_user, 'user_id', None)} payload={payload}")
    try:
        # Fetch target user and private user
        target = get_user_by_user_id(user_id, db)
        if not target:
            raise HTTPException(status_code=404, detail='User not found')

        # Determine the company for the target user. Prefer PrivateUser.company_id, fall back to Job.company_id
        if not target.private_user:
            raise HTTPException(status_code=400, detail='Target user has no company association')

        company_id = target.private_user.company_id
        if company_id is None:
            # If private_user has no company, check their job records for a linked company
            job = db.query(Job).filter(Job.private_user_id == target.private_user.private_user_id, Job.company_id != None).first()
            if job:
                company_id = job.company_id
            else:
                raise HTTPException(status_code=400, detail='Target user has no company association')

        company = db.query(Company).filter(Company.company_id == company_id).first()
        if not company:
            raise HTTPException(status_code=400, detail='Target user has no company association')

        # Check admin privileges using centralized helper
        from core.permission_guards import assert_company_permission
        assert_company_permission(current_user, company_id, 'edit_employee', db)

        enabled = payload.get('enabled')
        if enabled is None:
            raise HTTPException(status_code=400, detail='enabled boolean is required')

        updated = set_user_enabled(user_id, bool(enabled), db)
        _log_company_audit(company_id, 'employee.enabled_changed', current_user.user_id, f'user:{user_id}', db, {'enabled': bool(enabled)})
        return { 'user_id': user_id, 'user_enabled': updated.user_enabled }

    except HTTPException:
        # Re-raise known HTTP errors
        raise
    except Exception as e:
        logger.error(f"Error in patch_user_enable for user {user_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.patch('/{user_id}', status_code=200, response_model=showUser)
async def update_user_profile(
    user_id: int,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(config.get_db)
):
    """
    Update user profile.
    - Users can update their own personal info.
    - Company Admins can update 'company_onboarding_status' for their employees.
    """
    target = get_user_by_user_id(user_id, db)
    if not target:
        raise HTTPException(status_code=404, detail='User not found')

    # Raw payload (may contain fields not in UpdateUser schema, e.g. verification_note)
    raw_update = payload or {}

    # Validate known fields against UpdateUser schema but keep raw payload for extras
    allowed = set(UpdateUser.__fields__.keys())
    validated_payload = {k: v for k, v in raw_update.items() if k in allowed}
    try:
        validated_obj = UpdateUser(**validated_payload)
        update_data = validated_obj.dict(exclude_unset=True)
    except Exception:
        update_data = {}

    # 1. Check permissions
    is_self = (current_user.user_id == user_id)
    is_platform_admin = getattr(current_user, 'is_superuser', False)
    
    # Determine if current user is admin of the target's company.
    # Use the same 3-tier resolution as _resolve_employee_company so pending employees
    # (whose PrivateUser.company_id and Job.company_id are both NULL) can still be
    # acted on (rejected / sent back) by the correct company admin.
    is_company_admin = False
    can_onboard = False
    company_id = None

    if target.private_user:
        if target.private_user.company_id:
            company_id = target.private_user.company_id

        if not company_id:
            job = db.query(Job).filter(
                Job.private_user_id == target.private_user.private_user_id,
                Job.company_id != None
            ).first()
            if job:
                company_id = job.company_id

        if not company_id:
            job = db.query(Job).filter(
                Job.private_user_id == target.private_user.private_user_id,
                Job.employer_brn != None
            ).first()
            if job and job.employer_brn:
                brn_company = db.query(Company).filter(
                    func.lower(Company.brn) == job.employer_brn.strip().lower()
                ).first()
                if brn_company:
                    company_id = brn_company.company_id

    if company_id:
        from core.permission_guards import has_company_permission
        # "can manage this employee" — edit_employee perm, owner/admin via fallback.
        is_company_admin = has_company_permission(current_user, company_id, 'edit_employee', db)
        # Onboarding decisions (approve/reject) are gated on onboard_employee, to
        # match POST /user/{id}/approve. Owner/Company Admin pass via fallback.
        can_onboard = has_company_permission(current_user, company_id, 'onboard_employee', db)

    # 2. Logic checks
    if 'company_onboarding_status' in update_data:
        if not (can_onboard or is_platform_admin):
             raise HTTPException(status_code=403, detail="You need the 'onboard_employee' permission to approve or reject employees")

    # An onboarder (onboard_employee) may proceed when the ONLY change is the
    # onboarding decision (approve/reject); any broader profile edit still needs
    # edit_employee (is_company_admin) or self.
    is_onboarding_only = set(update_data.keys()) <= {'company_onboarding_status'}
    if not (is_self or is_company_admin or is_platform_admin or (can_onboard and is_onboarding_only)):
        raise HTTPException(status_code=403, detail='Not permitted to update this user')

    # Profile lock: two semantically distinct gates over the self-edit path.
    #   * is_locked        → COMPANY_FIELDS (employment_type, fte, salary_assignments, jobs)
    #   * identity_verified → IDENTITY_FIELDS (first_name, last_name, dob, passport, gender)
    # Admins (company / platform) bypass both. Non-gated fields (phone,
    # address, onboard_complete, schedule) stay editable in any state.
    if target.private_user is not None:
        from api.v1.profile_lock import require_unlocked_or_admin
        from core.profile_lock import COMPANY_FIELDS, auto_lock_on_admin_company_edit
        require_unlocked_or_admin(
            target_private_user_id=target.private_user.private_user_id,
            fields_being_edited=set(update_data.keys()),
            db=db,
            current_user=current_user,
        )
        # Auto-lock the company segment when an admin (not the employee
        # themselves) edits a COMPANY_FIELDS value. Idempotent.
        admin_acting_on_other = (is_company_admin or is_platform_admin) and not is_self
        if admin_acting_on_other and (set(update_data.keys()) & COMPANY_FIELDS):
            auto_lock_on_admin_company_edit(target.private_user, current_user, db)

    # 2b. country_code is only meaningful for independent users (see schema
    # comment) but is validated regardless of who submits it — same rigor
    # as company signup, so nobody can land on an unknown/inactive country.
    if update_data.get('country_code'):
        from core.model import Country
        country = db.query(Country).filter(Country.code == update_data['country_code']).one_or_none()
        if country is None or not country.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown or not-yet-available country_code '{update_data['country_code']}'"
            )

    # 3. Update known fields via existing CRUD
    update_user(user_id, validated_payload, db)

    # 3b. When a company admin explicitly rejects/removes an employee, do the
    #     whole reject ATOMICALLY here (one call, one commit): clear verification
    #     AND detach PrivateUser.company_id so they stop appearing in lists /
    #     typeahead / search. The client no longer needs a second /verify call
    #     (which used to 400 once company_id was gone, in the wrong order).
    if update_data.get('company_onboarding_status') == 'rejected' and (can_onboard or is_platform_admin):
        target.user_verified = False
        if target.private_user and target.private_user.company_id == company_id:
            target.private_user.company_id = None
            logger.info(f"Cleared company_id for private_user {target.private_user.private_user_id} on rejection by user {current_user.user_id}")

    # 3c. If a verification_note was provided, ensure the users table has the column
    # and persist the note directly to the User row. This avoids a blocking alembic migration
    # during development while keeping behavior backwards-compatible.
    verification_note = raw_update.get('verification_note') if isinstance(raw_update, dict) else None
    if verification_note is not None:
        try:
            db.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_note TEXT;"))
        except Exception:
            # Best-effort: ignore if DB doesn't support IF NOT EXISTS
            try:
                db.execute(text("ALTER TABLE users ADD COLUMN verification_note TEXT;"))
            except Exception:
                pass

        # Attach the field to the user row
        user_row = db.query(User).filter(User.user_id == user_id).first()
        if user_row:
            setattr(user_row, 'verification_note', verification_note)

    db.commit()
    
    # 4. Fetch updated User object to return (matching showUser schema)
    updated_full_user = get_user_by_user_id(user_id, db)
    return updated_full_user

def _log_company_audit(company_id, action, actor_user_id, target_id, db, metadata=None):
    """Best-effort audit row for company-scoped employee mutations. Never raises."""
    try:
        from db_models.crud.company import log_audit
        log_audit(company_id, action, actor_user_id, target_id, db, metadata=metadata)
    except Exception:
        logger.exception('audit log failed for action=%s target=%s', action, target_id)


def _resolve_employee_company(target: User, db: Session) -> Company:
    """
    Resolve the Company for a pending or approved employee.
    Checks (in order): PrivateUser.company_id → Job.company_id → Job.employer_brn.
    Returns the Company or raises HTTPException 400 if none found.
    """
    if not target.private_user:
        raise HTTPException(status_code=400, detail='Target user has no private_user record')

    company = None

    if target.private_user.company_id:
        company = db.query(Company).filter(Company.company_id == target.private_user.company_id).first()

    if not company:
        job = db.query(Job).filter(
            Job.private_user_id == target.private_user.private_user_id,
            Job.company_id != None
        ).first()
        if job:
            company = db.query(Company).filter(Company.company_id == job.company_id).first()

    if not company:
        job = db.query(Job).filter(
            Job.private_user_id == target.private_user.private_user_id,
            Job.employer_brn != None
        ).first()
        if job and job.employer_brn:
            company = db.query(Company).filter(
                func.lower(Company.brn) == job.employer_brn.strip().lower()
            ).first()

    if not company:
        raise HTTPException(status_code=400, detail='Target user has no company association')

    return company


@router.post('/{user_id}/approve', status_code=200)
async def approve_employee(
    user_id: int,
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(config.get_db)
):
    """
    Atomically approve an employee: sets company_onboarding_status, user_verified,
    links PrivateUser.company_id and any unlinked Jobs, then writes an audit entry.
    Single endpoint replaces the previous 3-call sequence from the web modal.
    """
    from core.roles import is_company_admin_for

    target = get_user_by_user_id(user_id, db)
    if not target:
        raise HTTPException(status_code=404, detail='User not found')

    company = _resolve_employee_company(target, db)

    from core.permission_guards import assert_company_permission
    assert_company_permission(current_user, company.company_id, 'onboard_employee', db)

    checklist = payload.get('checklist') if isinstance(payload, dict) else None
    note = payload.get('note') if isinstance(payload, dict) else None

    # --- all writes in a single transaction ---
    # 1. Flip verified flag
    target.user_verified = True
    target.company_onboarding_status = 'approved'

    # 2. Link PrivateUser to company (conscious admin decision)
    if not target.private_user.company_id:
        target.private_user.company_id = company.company_id
        from services.employee_code_service import ensure_employee_code
        ensure_employee_code(db, target.private_user)

    # 3. Link any jobs that only had employer_brn set
    jobs_to_link = db.query(Job).filter(
        Job.private_user_id == target.private_user.private_user_id,
        func.lower(Job.employer_brn) == company.brn.lower(),
        Job.company_id == None
    ).all()
    for job in jobs_to_link:
        job.company_id = company.company_id

    db.commit()
    logger.info(
        f"Employee {user_id} approved by {current_user.user_id} for company {company.company_id}. "
        f"Linked {len(jobs_to_link)} job(s)."
    )

    # 4. Audit — best-effort, outside the main transaction so a failure doesn't roll back the approval
    try:
        details = json.dumps({'checklist': checklist, 'note': note})
    except Exception:
        details = str({'checklist': checklist, 'note': note})
    try:
        create_audit_log(db, current_user.user_id, 'approved', 'user_verification', user_id, details)
    except Exception as e:
        logger.warning(f'Audit log write failed for user {user_id} approval, continuing: {e}')

    return {'user_id': user_id, 'user_verified': True, 'company_onboarding_status': 'approved'}


@router.patch('/{user_id}/verify', status_code=200)
async def patch_user_verify(user_id: int, payload: dict, current_user: User = Depends(get_current_user), db: Session = Depends(config.get_db)):
    """Set or clear user verification status (generic toggle — prefer /approve for the full approval flow)"""
    from core.roles import is_company_admin_for

    target = get_user_by_user_id(user_id, db)
    if not target:
        raise HTTPException(status_code=404, detail='User not found')

    company = _resolve_employee_company(target, db)

    from core.permission_guards import assert_company_permission
    assert_company_permission(current_user, company.company_id, 'onboard_employee', db)

    verified = payload.get('verified')
    if verified is None:
        raise HTTPException(status_code=400, detail='verified boolean is required')

    # Link any unlinked jobs when verifying
    if bool(verified):
        jobs_to_update = db.query(Job).filter(
            Job.private_user_id == target.private_user.private_user_id,
            func.lower(Job.employer_brn) == company.brn.lower(),
            Job.company_id == None
        ).all()
        for job in jobs_to_update:
            job.company_id = company.company_id
        if jobs_to_update:
            db.commit()
            logger.info(f"Linked {len(jobs_to_update)} job(s) to company {company.company_id} for user {user_id}")

    updated = set_user_verified(user_id, bool(verified), db)
    _log_company_audit(company.company_id, 'employee.verified_changed', current_user.user_id, f'user:{user_id}', db, {'verified': bool(verified)})
    return {'user_id': user_id, 'user_verified': updated.user_verified}


@router.post('/{user_id}/verification-audit', status_code=201)
async def create_verification_audit(user_id: int, payload: dict, current_user: User = Depends(get_current_user), db: Session = Depends(config.get_db)):
    """Record a verification audit entry for a user."""
    # payload expected: { action: 'approved'|'rejected'|'sent_back', checklist: {...}, note: 'optional' }
    action = payload.get('action') if isinstance(payload, dict) else None
    checklist = payload.get('checklist') if isinstance(payload, dict) else None
    note = payload.get('note') if isinstance(payload, dict) else None

    if not action:
        raise HTTPException(status_code=400, detail='action is required')

    try:
        details = json.dumps({ 'checklist': checklist, 'note': note })
    except Exception:
        details = str({ 'checklist': checklist, 'note': note })

    try:
        create_audit_log(db, current_user.user_id, action, 'user_verification', user_id, details)
    except Exception as e:
        # Audit log is best-effort — log the failure but don't 500 the caller
        logger.warning(f'Audit log write failed for user {user_id} action {action}, continuing: {e}')

    return { 'status': 'success' }


@router.get('/{user_id}/verification-audit', status_code=200)
async def list_verification_audit(user_id: int, db: Session = Depends(config.get_db), current_user: User = Depends(get_current_user)):
    """List verification audit entries for a user."""
    try:
        result = db.execute(
            text(
                """
            SELECT id, actor_user_id, action, target_type, target_id, meta, created_at
            FROM audit_logs
            WHERE target_type = 'user_verification' AND target_id = :tid
            ORDER BY created_at DESC
            LIMIT 50
            """
            ),
            {"tid": str(user_id)}
        )

        logs = []
        for row in result:
            logs.append({
                'id': row[0],
                'actor_user_id': row[1],
                'action': row[2],
                'target_type': row[3],
                'target_id': row[4],
                'details': row[5],
                'created_at': row[6].isoformat() if row[6] else None
            })

        return {'status': 'success', 'data': logs}
    except Exception as e:
        logger.exception('Failed to query verification audit logs')
        raise HTTPException(status_code=500, detail='Failed to fetch audit logs')


@router.patch('/company/{company_id}/users/{user_id}/role', status_code=200)
async def set_company_user_role(company_id: int, user_id: int, payload: dict, current_user: User = Depends(get_current_user), db: Session = Depends(config.get_db)):
    """Set the role(s) of a company user (owner only) - accepts 'role' (single) or 'roles' (list)"""
    company = db.query(Company).filter(Company.company_id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail='Company not found')

    # Authorization. Role assignment is an owner/admin function — NOT something a
    # manager/HR/supervisor should do. Allowing 'manager' here was a privilege-
    # escalation path: a manager could PATCH their own row to 'owner'. We return
    # both whether the caller may assign at all, and whether they are "owner-level"
    # (the real company owner via Company.user_id, an assigned 'owner', or a
    # superuser). Owner-level gates assigning elevated (owner/admin) roles below.
    def caller_authority(user_obj: User) -> tuple[bool, bool]:
        """Returns (can_assign_roles, is_owner_level)."""
        if getattr(user_obj, 'is_superuser', False):
            return True, True
        if user_obj.user_id == company.user_id:
            return True, True  # the real company owner (FK), not a role
        cur_priv = db.query(PrivateUser).filter(PrivateUser.user_id == user_obj.user_id).first()
        if cur_priv and cur_priv.company_id == company.company_id:
            if cur_priv.role == 'owner':
                return True, True
            if cur_priv.role == 'admin':
                return True, False  # admin may assign, but not elevated roles
        return False, False

    can_assign, is_owner_level = caller_authority(current_user)
    if not can_assign:
        raise HTTPException(status_code=403, detail='Only the company owner or a company admin can change user roles')

    # Accept either single role or list of roles
    roles = None
    if 'roles' in payload:
        roles = payload.get('roles') or []
    elif 'role' in payload:
        roles = [payload.get('role')]
    else:
        raise HTTPException(status_code=400, detail='Provide "role" or "roles" in payload')

    # Pull valid role names from the permission manager (the company role catalogue),
    # so any custom role defined there ("HR Manager", "Supervisor", …) can be assigned —
    # not just the 4 hard-coded legacy strings. Names normalize to the scalar convention
    # (lower-case, spaces -> underscores), the same mapping list_roles uses.
    from core.model import CompanyRole as CompanyRoleCatalogue
    catalogue_names = {
        c.name.lower().replace(" ", "_")
        for c in db.query(CompanyRoleCatalogue).filter(CompanyRoleCatalogue.company_id == company_id).all()
    }
    legacy_roles = {'owner', 'admin', 'manager', 'employee'}
    allowed = legacy_roles | catalogue_names
    norm_roles = [str(r).lower().replace(" ", "_") for r in roles]
    for original, norm in zip(roles, norm_roles):
        if norm not in allowed:
            raise HTTPException(status_code=400, detail=f'Invalid role "{original}". Allowed: {sorted(allowed)}')

    # The web Permission Manager passes the PrivateUser id in this path segment,
    # while older callers pass the User id. Accept either — prefer private_user_id,
    # fall back to user_id — so the role change resolves the right person and
    # doesn't 404. (Was: only matched PrivateUser.user_id, so the web UI 404'd.)
    private = (
        db.query(PrivateUser).filter(PrivateUser.private_user_id == user_id).first()
        or db.query(PrivateUser).filter(PrivateUser.user_id == user_id).first()
    )
    if not private:
        raise HTTPException(status_code=404, detail='User not found')

    # Ensure private_user belongs to company (fall back to job checks if necessary)
    if private.company_id != company_id:
        # check job link
        job = db.query(Job).filter(Job.private_user_id == private.private_user_id, Job.company_id == company_id).first()
        if not job:
            raise HTTPException(status_code=400, detail='User not found in company')

    # Self-service guard — you cannot change your OWN role. This closes the
    # self-escalation path (a user promoting themselves). Superuser (platform
    # support) is exempt so they can still repair accounts.
    if not getattr(current_user, 'is_superuser', False) and private.user_id == current_user.user_id:
        raise HTTPException(status_code=403, detail="You can't change your own role")

    # Derive the legacy tier being requested so we can (a) enforce a privilege
    # ceiling and (b) keep the scalar PrivateUser.role in sync below.
    def _legacy_tier(names: list[str]) -> str:
        if any(n == 'owner' for n in names):
            return 'owner'
        if any('admin' in n for n in names):
            return 'admin'
        if any(('manager' in n) or ('supervisor' in n) for n in names):
            return 'manager'
        return 'employee'

    requested_tier = _legacy_tier(norm_roles)

    # Privilege ceiling — only owner-level callers may mint owners or admins. A
    # company admin can assign manager/employee/custom roles but cannot create
    # new owners or admins (which would let them clone their own authority).
    if requested_tier in ('owner', 'admin') and not is_owner_level:
        raise HTTPException(status_code=403, detail='Only the company owner can assign owner or admin roles')

    # Set roles using CRUD helper (store created_by as current_user.user_id).
    # This writes the multi-role join table (company_user_roles), which the modern
    # permission system reads.
    set_roles_for_private_user(company_id, private.private_user_id, roles, current_user.user_id, db)

    # Keep the legacy scalar PrivateUser.role in sync. Many auth checks (this endpoint's
    # own admin gate, register/onboard, user listing) still read this single column, so
    # leaving it stale was a real consistency bug. Reuse the tier derived above.
    private.role = requested_tier
    db.add(private)
    db.commit()

    _log_company_audit(company_id, 'employee.role_changed', current_user.user_id, f'user:{user_id}', db, {'roles': roles})

    return {'user_id': user_id, 'roles': roles}


@router.delete('/company/{company_id}/users/{user_id}', status_code=200)
async def remove_company_user(company_id: int, user_id: int, db: Session = Depends(config.get_db), company = Depends(require_company_scope), current_user: User = Depends(get_current_user)):
    """Soft-remove an employee from a company.

    Detaches the membership (clears company_id/department_id, disables the
    membership, clears company roles) WITHOUT destroying the user account or
    their history, so they can be re-invited later. Authorized via
    require_company_scope (platform admin or company admin)."""
    target = get_user_by_user_id(user_id, db)
    if not target:
        raise HTTPException(status_code=404, detail='User not found')
    private = getattr(target, 'private_user', None)
    if not private or (private.company_id != company_id and not db.query(Job).filter(Job.private_user_id == private.private_user_id, Job.company_id == company_id).first()):
        raise HTTPException(status_code=400, detail='User is not a member of this company')

    # Soft detach: clear association, disable membership, clear company roles.
    private.company_id = None
    private.department_id = None
    target.user_enabled = False
    try:
        set_roles_for_private_user(company_id, private.private_user_id, [], None, db)
    except Exception:
        logger.exception('Failed clearing company roles during remove_company_user')
    # Burn any outstanding account-claim link so a "set your password" email sent
    # at onboarding can't activate this account after it's been removed (e.g. an
    # employee onboarded to a mis-typed email that reaches a stranger).
    try:
        from api.v1.account_claim import invalidate_claim_tokens
        invalidate_claim_tokens(db, target.email)
    except Exception:
        logger.exception('Failed invalidating claim tokens during remove_company_user')
    db.commit()
    _log_company_audit(company_id, 'employee.removed', current_user.user_id, f'user:{user_id}', db)
    return {'success': True, 'user_id': user_id}

@router.post('/onboard', status_code=status.HTTP_201_CREATED, response_model=showUser)
async def onboard_job(job_info: OnboardJob, db: Session = Depends(config.get_db), current_user: User = Depends(get_current_user)):
    try:
        from fastapi.encoders import jsonable_encoder

        private_user_id = job_info.user_data.private_user_id
        if not private_user_id:
            raise HTTPException(status_code=400, detail="private_user_id is required in user_data")

        # Fetch the PrivateUser to find the main User
        private_user = db.query(PrivateUser).filter(PrivateUser.private_user_id == private_user_id).first()
        if not private_user:
            raise HTTPException(status_code=404, detail="Private user not found")

        main_user = db.query(User).filter(User.user_id == private_user.user_id).first()
        if not main_user:
            raise HTTPException(status_code=404, detail="Main user account not found")

        # Determine target company for permission check
        target_company_id = None
        if private_user.company_id:
            target_company_id = private_user.company_id
        elif getattr(job_info, 'job_data', None) and getattr(job_info.job_data, 'company_id', None):
            target_company_id = job_info.job_data.company_id
        else:
            # Check existing job record for company link
            existing_job = db.query(Job).filter(Job.private_user_id == private_user_id, Job.company_id != None).first()
            if existing_job:
                target_company_id = existing_job.company_id

        # Allow updates if:
        # - current_user is the same as the user being updated (self-edit)
        # - current_user is global superuser
        # - current_user is company owner or has role admin/manager/owner for target company
        def is_company_admin_user_for(company_id: int, user_obj: User) -> bool:
            if not company_id:
                return False
            if getattr(user_obj, 'is_superuser', False):
                return True
            company = db.query(Company).filter(Company.company_id == company_id).first()
            if not company:
                return False
            if user_obj.user_id == company.user_id:
                return True
            cur_priv = db.query(PrivateUser).filter(PrivateUser.user_id == user_obj.user_id, PrivateUser.company_id == company_id).first()
            if cur_priv and cur_priv.role in ('admin', 'manager', 'owner'):
                return True
            return False

        if not (current_user.user_id == main_user.user_id or getattr(current_user, 'is_superuser', False) or is_company_admin_user_for(target_company_id, current_user)):
            raise HTTPException(status_code=403, detail='Not permitted to onboard or edit this user')

        # Plan Phase 12.A — the flag is now server-authoritative. We
        # compute it after the profile and job rows are persisted below,
        # so legitimate completion of this endpoint still flips it (and
        # incomplete state never gets a false-positive flip).

        # --- Profile lock enforcement -------------------------------------
        # This endpoint (used by the mobile "Update Profile" screen) must honor
        # the same locks as PATCH /user. Admins bypass; a self-editing employee
        # cannot mutate frozen fields. We STRIP frozen-field changes from the
        # payload rather than 403, since onboard always sends the full form (a
        # hard reject would block legitimate edits to unlocked fields).
        from core.profile_lock import IDENTITY_FIELDS, AUTO_LOCK_REASON

        is_admin_actor = getattr(current_user, 'is_superuser', False) or is_company_admin_user_for(target_company_id, current_user)
        is_self_edit = current_user.user_id == main_user.user_id
        identity_frozen = bool(getattr(private_user, 'identity_verified', False)) or (
            bool(getattr(private_user, 'is_locked', False))
            and getattr(private_user, 'lock_reason', None) != AUTO_LOCK_REASON
        )
        company_frozen = bool(getattr(private_user, 'is_locked', False))
        enforce_identity_lock = is_self_edit and not is_admin_actor and identity_frozen
        enforce_company_lock = is_self_edit and not is_admin_actor and company_frozen

        # Update PrivateUser details from payload. `onboard_complete` is
        # excluded — clients cannot set it directly.
        user_update_data = job_info.user_data.model_dump(exclude_unset=True, exclude={'private_user_id', 'onboard_complete'})
        if enforce_identity_lock:
            # Locked identity — drop any attempt to change name/DOB/passport/gender.
            user_update_data = {k: v for k, v in user_update_data.items() if k not in IDENTITY_FIELDS}

        # Phone needs special handling — it must be normalized to canonical form,
        # uniqueness-checked, and synced to BOTH PrivateUser.phone (the onboarding
        # gate, onboarding.py) and User.phone (used for phone-number login) so the
        # two can never diverge. It is NOT an identity-locked field, so a locked
        # user may still repair a missing/incorrect number. Pop it out of the
        # generic setattr loop below and handle it explicitly.
        raw_phone = user_update_data.pop('phone', None)
        if raw_phone is not None and str(raw_phone).strip():
            from core.phone_utils import normalize_phone, lookup_variants
            normalized_phone = normalize_phone(str(raw_phone))
            if not normalized_phone:
                raise HTTPException(status_code=422, detail="Please enter a valid phone number.")
            # Reject if another account already owns this number (login collision).
            variants = lookup_variants(normalized_phone)
            if variants:
                clash = db.query(User).filter(
                    User.phone.in_(variants),
                    User.user_id != main_user.user_id,
                ).first()
                if clash:
                    raise HTTPException(status_code=409, detail="This phone number is already in use by another account.")
            private_user.phone = normalized_phone
            main_user.phone = normalized_phone

        for key, value in user_update_data.items():
            if hasattr(private_user, key):
                setattr(private_user, key, value)

        # Upsert Job
        existing_job = db.query(Job).filter(Job.private_user_id == private_user_id).first()
        job_data_dict = job_info.job_data.model_dump(exclude_unset=True)

        # Resolve employer_brn → company_id so the job is linkable via ID queries
        if job_data_dict.get('employer_brn') and not job_data_dict.get('company_id'):
            brn_lookup = job_data_dict['employer_brn'].strip().lower()
            matched_company = db.query(Company).filter(
                func.lower(Company.brn) == brn_lookup
            ).first()
            if matched_company:
                job_data_dict['company_id'] = matched_company.company_id
                # Also link the PrivateUser to the company if not already set
                if not private_user.company_id:
                    private_user.company_id = matched_company.company_id
                    from services.employee_code_service import ensure_employee_code
                    ensure_employee_code(db, private_user)

        job_obj = None
        if existing_job:
            # Company-locked self-edit: keep the existing job as-is (employment
            # fields such as first_date_of_employment are frozen). Admins bypass.
            if not enforce_company_lock:
                for key, value in job_data_dict.items():
                    if hasattr(existing_job, key):
                        setattr(existing_job, key, value)
            job_obj = existing_job
        else:
            job_pydantic = CreateJob(**job_data_dict)
            job_obj = await create_job(job_pydantic, db)

        db.flush()  # Ensure job_obj has an ID for new jobs

        # Upsert Salary — skipped for a company-locked self-edit (salary is a
        # frozen company field; admins bypass).
        if hasattr(job_info, 'salary_data') and job_info.salary_data and not enforce_company_lock:
            salary_data_dict = job_info.salary_data.model_dump(exclude_unset=True)
            existing_salary = db.query(Salary).filter(Salary.job_id == job_obj.job_id).first()

            if existing_salary:
                from db_models.crud.job import _enforce_salary_money, _parse_decimal
                prev_salary = _parse_decimal(existing_salary.salary)
                prev_revenue = _parse_decimal(getattr(existing_salary, 'revenue', '0'))
                had_allowance = existing_salary.allowance is not None and str(existing_salary.allowance).strip() != ''
                # `revenue` is derived (revenue = salary + allowance) — never
                # trust the client value; recompute via _enforce_salary_money.
                for key, value in salary_data_dict.items():
                    if key in ('revenue', 'currency'):
                        continue  # revenue is derived; currency is server-authoritative
                    if hasattr(existing_salary, key):
                        setattr(existing_salary, key, value)
                if 'allowance' not in salary_data_dict and not had_allowance:
                    existing_salary.allowance = str(max(0.0, prev_revenue - prev_salary))
                # Stamp currency from the employee's country, not the client's 'MUR'.
                from db_models.crud.job import resolve_salary_currency
                resolved_currency = resolve_salary_currency(db, job_obj)
                if resolved_currency:
                    existing_salary.currency = resolved_currency
                _enforce_salary_money(existing_salary)
            else:
                from schema.job_schema import Salary as SalarySchema
                salary_data_dict['job_id'] = job_obj.job_id
                salary_db_model = SalarySchema(**salary_data_dict)
                await create_salary(salary_db_model, db)  # enforces the invariant

        # Auto-assign to Operations department if employee has no department yet
        if not private_user.department_id and target_company_id:
            try:
                from core.model import Department
                ops_dept = db.query(Department).filter(
                    Department.company_id == target_company_id,
                    Department.name.ilike('Operations')
                ).first()
                if ops_dept:
                    private_user.department_id = ops_dept.department_id
            except Exception as dept_err:
                logger.warning(f"Could not auto-assign Operations dept: {dept_err}")

        # Plan Phase 12.A — recompute `onboard_complete` server-side from the
        # now-persisted profile + job rows. Replaces the legacy unconditional
        # flip that lit up onboarding even when downstream data was incomplete.
        onboard_missing: list[str] = []
        try:
            from core.onboarding import refresh_user_onboard_state
            db.flush()
            _new_value, onboard_missing = refresh_user_onboard_state(main_user, db)
        except Exception as ob_err:
            logger.warning(f"refresh_user_onboard_state failed (non-fatal): {ob_err}")

        db.commit()

        # Fetch the fully updated user to return
        user = get_user_by_user_id(main_user.user_id, db)
        return JSONResponse(
            status_code=200,
            content={
                "status": "success",
                "message": "User onboarded/updated successfully",
                # `missing` lets the client tell the user WHY onboarding is still
                # incomplete (e.g. missing phone) instead of silently bouncing
                # them back to the same form. Empty list ⇒ onboarding complete.
                "missing": onboard_missing,
                "data": jsonable_encoder(showUser.model_validate(user))
            }
        )
    except HTTPException:
        # Intentional client errors (422 invalid phone, 409 phone in use, lock
        # conflicts, etc.) must propagate with their real status — the broad
        # `except Exception` below would otherwise remask them as opaque 500s.
        raise
    except SQLAlchemyError as e:
        logger.error(f"Database error: {e}")
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail="Database error occurred")
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────────────────────────────────
# Onboarding state — plan Phase 12.A
# ─────────────────────────────────────────────────────────────────────────

@router.get('/{user_id}/onboarding-progress', status_code=200)
async def get_onboarding_progress(
    user_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the missing-fields list for the given user. Used by the
    mobile + web wizards to resume at the first incomplete step. Caller
    must be the user themselves or a platform admin."""
    if current_user.user_id != user_id and not getattr(current_user, 'is_superuser', False):
        raise HTTPException(status_code=403, detail='Not authorized')

    from core.onboarding import evaluate_missing
    target = get_user_by_user_id(user_id, db)
    if not target:
        raise HTTPException(status_code=404, detail='User not found')

    missing = evaluate_missing(target, db)
    return {
        'user_id': user_id,
        'user_type': target.user_type.value if hasattr(target.user_type, 'value') else target.user_type,
        'onboard_complete': bool(target.onboard_complete),
        'missing': missing,
    }


@router.post('/{user_id}/onboard-complete', status_code=200)
async def finalize_onboarding(
    user_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Explicit "I'm done" endpoint. Re-evaluates the user's onboarding
    state from persisted data; 422 with the missing-fields list if the
    threshold isn't met; 200 with the flipped flag if it is. The client
    cannot lie its way through — every field the helper checks is read
    from the DB, not from the request body."""
    if current_user.user_id != user_id and not getattr(current_user, 'is_superuser', False):
        raise HTTPException(status_code=403, detail='Not authorized')

    from core.onboarding import refresh_user_onboard_state
    target = get_user_by_user_id(user_id, db)
    if not target:
        raise HTTPException(status_code=404, detail='User not found')

    new_value, missing = refresh_user_onboard_state(target, db)
    if not new_value:
        db.rollback()
        raise HTTPException(
            status_code=422,
            detail={
                'message': 'Onboarding requirements not met',
                'missing': missing,
            },
        )
    db.commit()
    return {
        'status': 'success',
        'user_id': user_id,
        'onboard_complete': True,
    }

@router.delete('/{user_id}', status_code=status.HTTP_204_NO_CONTENT)
async def delete_user_by_id(user_id: int, db: Session = Depends(config.get_db)):
    try:
        delete_user(user_id, db)
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                        detail=f"something is wrong with your query")
    except:
        logger.error("Unexpected Error:", sys.exc_info())
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
    return None


@router.get('/user-rights/user/{private_user_id}', status_code=200)
async def get_user_complaints_endpoint(
    private_user_id: int,
    db: Session = Depends(config.get_db)
) -> dict:
    """Get all complaints for a specific user."""
    try:
        rightHistory = get_user_right_history(private_user_id, db)
        return {
            "status": "success",
            "message": "Rights history fetched successfully",
            "data": jsonable_encoder(rightHistory)
        }
    except Exception as e:
        logger.error(f"Error fetching user rights history: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch complaints"
        )

@router.get('/user-rights', status_code=200)
async def get_all_complaints_endpoint(
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Get all complaints (platform compliance view — EVERY company's grievances).

    SECURITY: this was previously UNAUTHENTICATED and returned all companies'
    whistleblower grievances to any caller — a critical cross-company leak of the
    most legally-sensitive data. Restricted to platform admin / compliance officer,
    the same oversight audience as /disputes/compliance. (A company-scoped view for
    employers belongs on a separate, company-filtered endpoint.)
    """
    from db_models.crud.role import user_has_role_by_user_id
    is_admin = getattr(current_user, "is_superuser", False) or user_has_role_by_user_id(
        current_user.user_id, "platform_admin", db
    )
    is_compliance = user_has_role_by_user_id(current_user.user_id, "compliance_officer", db)
    if not (is_admin or is_compliance):
        raise HTTPException(status_code=403, detail="Requires compliance_officer or platform_admin role.")
    try:
        rightHistory = get_all_right_history(db)
        return {
            "status": "success",
            "message": "All rights history fetched successfully",
            "data": jsonable_encoder(rightHistory)
        }
    except Exception as e:
        logger.error(f"Error fetching all rights history: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch rights history"
        )

@router.get('/user-right/{complaint_id}', status_code=200)
async def get_complaint_by_id_endpoint(
    complaint_id: int,
    db: Session = Depends(config.get_db)
) -> dict:
    """Get a specific complaint by ID."""
    try:
        rightHistory = get_right_history_by_id(complaint_id, db)
        if not rightHistory:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Rights history not found"
            )
        return {
            "status": "success",
            "message": "Rights history fetched successfully",
            "data": jsonable_encoder(rightHistory)
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching rights history: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch rights history"
        )

@router.post('/user-right', status_code=status.HTTP_201_CREATED)
async def create_user_right(
    private_user_id: int = Form(...),
    title: str = Form(...),
    category: str = Form(...),
    issue_description: str = Form(...),
    contact_method: str = Form(...),
    previous_occurence: bool = Form(False),
    date_of_occurrence: Optional[str] = Form(None),
    time: Optional[str] = Form(None),
    occurrence_description: Optional[str] = Form(None),
    urgency_level: str = Form(...),
    resolution_method: str = Form(...),
    accept_terms_and_conditions: bool = Form(...),
    acknowledge_information: bool = Form(...),
    agreed_to_be_contacted: bool = Form(...),
    complaint_status: str = Form(..., alias="status"),
    expected_outcome: str = Form(...),
    # Plan Phase 11 Step 4 — 'internal' (default; employer sees full detail)
    # or 'external' (employer never sees content; routes to compliance officers).
    channel: str = Form("internal"),
    # Plan Phase 11 Step 6 — when True, employee identity is masked on
    # company-side reads. Compliance officers + platform admins still see it.
    is_anonymous: bool = Form(False),
    # M4 — JSON list of {"user_id": int, "label": str} for admins/employees
    # implicated in the report. Drives conflict-of-interest auto-escalation:
    # when ANY named party is a company admin for the reporter's company,
    # this report auto-routes to Kiruko Compliance (channel='external')
    # so the named admin cannot read or mutate the case against themselves.
    # Capped at 5 entries; >5 returns 422.
    named_parties: Optional[str] = Form(None),
    # #6 — comma-separated user_ids of the manager(s)/HR the worker chose to route
    # this report to (sourced from the company role page). Additive: these handlers
    # are notified in addition to the normal routing; does NOT change channel/COI.
    send_to: Optional[str] = Form(None),
    # Optional link to the payroll run / payslip this concern is about — set by
    # the mobile "Raise a query" from a payslip so the employer can jump to it.
    payroll_run_id: Optional[int] = Form(None),
    payslip_id: Optional[int] = Form(None),
    attachment: Optional[UploadFile] = File(None),
    db: Session = Depends(config.get_db)
) -> dict:
    # IDOR guard (kept OUT of the try below, whose `except Exception` would mask
    # a 403 as a 500): a payslip/run link must belong to the REPORTER — else a
    # crafted request could point a dispute at another employee's payslip and
    # drive a correction against it. Derive the run from the validated payslip so
    # a mismatched run id can't sneak through.
    link_payslip_id = None
    link_run_id = None
    if payslip_id is not None:
        from core.model import Payslip as _Payslip
        _ps = db.query(_Payslip).filter(_Payslip.id == payslip_id).first()
        if _ps is None or _ps.private_user_id != private_user_id:
            raise HTTPException(status_code=403, detail="That payslip is not yours.")
        link_payslip_id = payslip_id
        link_run_id = _ps.payroll_run_id
    elif payroll_run_id is not None:
        from core.model import PayrollRun as _PR, PrivateUser as _PU
        _run = db.query(_PR).filter(_PR.id == payroll_run_id).first()
        _rep = db.query(_PU).filter(_PU.private_user_id == private_user_id).first()
        _rep_company = _rep.company_id if _rep else None
        if _run is None or (_rep_company is not None and _run.company_id != _rep_company):
            raise HTTPException(status_code=403, detail="That payroll run is not in your company.")
        link_run_id = payroll_run_id

    try:
        # Local import — `ConcernStatus` is also imported deeper in the
        # PATCH handler; keep imports module-local to avoid polluting the
        # top-level namespace and to keep this fix isolated.
        from core.concern_states import ConcernStatus as _ConcernStatusInit

        parsed_time = None
        # Handle file upload — M7: scan BEFORE storing. Magic-byte mismatches,
        # disallowed MIMEs, and (optionally) ClamAV-detected malware are
        # rejected with 415 + reason so we never persist a malicious file.
        attachment_url = None
        attachment_scan_db_value = None
        attachment_scanned_at_ts = None
        if attachment:
            from services import attachment_scanner
            from datetime import timezone as _tz_scan

            file_bytes = await attachment.read()
            scan_result = attachment_scanner.scan(file_bytes, attachment.content_type)
            attachment_scan_db_value = scan_result.db_value
            attachment_scanned_at_ts = datetime.now(_tz_scan.utc)

            if scan_result.status == "rejected":
                logger.warning(
                    "Concern attachment rejected: filename=%s declared_mime=%s reason=%s",
                    getattr(attachment, "filename", "?"),
                    attachment.content_type,
                    scan_result.reason,
                )
                raise HTTPException(
                    status_code=415,
                    detail=f"Attachment rejected: {scan_result.reason}",
                )

            # Rewind / re-wrap for the storage service. We've already read
            # the bytes, so wrap them back into an UploadFile-compatible
            # object so the existing storage layer keeps working.
            import io
            from starlette.datastructures import UploadFile as StarletteUploadFile
            stream = io.BytesIO(file_bytes)
            wrapped = StarletteUploadFile(
                file=stream,
                filename=attachment.filename,
                headers=attachment.headers,
            )

            storage_service = get_storage_service()
            attachment_url = await storage_service.upload_file(wrapped, folder="rights_reports")
            if attachment_url:
                logger.info(f"Report attachment uploaded (scan={scan_result.db_value}): {attachment_url}")
            else:
                logger.error("Failed to upload report attachment")

        if time:
            try:
                # If it's just time (e.g., "10:48"), parse it as time
                from datetime import time as time_obj
                if ':' in time and len(time.split(':')) == 2:
                    hour, minute = map(int, time.split(':'))
                    parsed_time = time_obj(hour, minute)
                else:
                    # Try parsing as full datetime if it's in that format
                    parsed_time = datetime.fromisoformat(time).time()
            except ValueError:
                # If parsing fails, set to None or handle accordingly
                parsed_time = None

        # Normalize channel — anything that isn't a recognised value falls
        # back to 'internal' so a misbehaving client cannot quietly hide
        # complaints by typoing the value.
        channel_norm = (channel or "internal").strip().lower()
        if channel_norm not in ("internal", "external"):
            channel_norm = "internal"

        # M4 — parse + validate named_parties.
        named_parties_list: list = []
        if named_parties:
            try:
                import json as _json
                parsed = _json.loads(named_parties)
                if not isinstance(parsed, list):
                    raise HTTPException(
                        status_code=422,
                        detail="named_parties must be a JSON array.",
                    )
                if len(parsed) > 5:
                    raise HTTPException(
                        status_code=422,
                        detail="named_parties is capped at 5 entries.",
                    )
                # Normalise each entry — only user_id is required; label is
                # display-only and may be missing.
                for entry in parsed:
                    if not isinstance(entry, dict) or "user_id" not in entry:
                        raise HTTPException(
                            status_code=422,
                            detail="Each named_parties entry must be {user_id, label?}.",
                        )
                    named_parties_list.append({
                        "user_id": int(entry["user_id"]),
                        "label": str(entry.get("label", ""))[:200],
                    })
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(status_code=422, detail="named_parties must be valid JSON.")

        # M4 — conflict-of-interest auto-escalation. If ANY named party is a
        # company admin for the reporter's company, the case is auto-routed
        # to Kiruko Compliance regardless of the reporter's chosen channel.
        # We resolve target company from the reporter's PrivateUser.
        from core.roles import is_company_admin_by_user_id
        from core.model import PrivateUser as PUModel
        coi_admin_user_ids: list[int] = []
        target_company_id = None
        pu = db.query(PUModel).filter(PUModel.private_user_id == private_user_id).first()
        if pu is not None:
            job = next((j for j in (pu.jobs or []) if getattr(j, "company_id", None)), None)
            target_company_id = (job.company_id if job else None) or getattr(pu, "company_id", None)
        if target_company_id and named_parties_list:
            for entry in named_parties_list:
                uid = entry["user_id"]
                if is_company_admin_by_user_id(uid, target_company_id, db):
                    coi_admin_user_ids.append(uid)

        escalated_at = None
        escalated_reason_str = None
        if coi_admin_user_ids:
            channel_norm = "external"
            from datetime import timezone as _tz
            escalated_at = datetime.now(_tz.utc)
            escalated_reason_str = (
                f"Conflict-of-interest auto-escalation: named party "
                f"user_id(s)={coi_admin_user_ids[:5]} are admin(s) of company {target_company_id}."
            )

        user_right_data = UserRightSchema(
            private_user_id=private_user_id,
            title=title,
            category=category,
            issue_description=issue_description,
            contact_method=contact_method,
            previous_occurence=previous_occurence,
            date_of_occurrence=date.fromisoformat(date_of_occurrence) if date_of_occurrence else None,
            time=parsed_time,
            occurrence_description=occurrence_description,
            urgency_level=urgency_level,
            resolution_method=resolution_method,
            accept_terms_and_conditions=accept_terms_and_conditions,
            acknowledge_information=acknowledge_information,
            agreed_to_be_contacted=agreed_to_be_contacted,
            # Status of a newly-filed concern is always `received` per the
            # v2 state machine — the client-supplied value is ignored so a
            # malicious caller can't open a case directly into `closed`/
            # `resolved`, and so legacy clients still sending the pre-M1
            # `"pending"` value don't trip the `ck_user_rights_status_v2`
            # CHECK constraint.
            status=_ConcernStatusInit.RECEIVED.value,
            expected_outcome=expected_outcome,
            attachment_url=attachment_url,
            channel=channel_norm,
            is_anonymous=bool(is_anonymous),
        )
        user_right = create_user_right_report(user_right_data, db)

        # M2 (Concerns v2) — issue a reporter-portal PIN on every concern.
        # Plaintext is returned to the caller in this response only; only the
        # bcrypt hash is persisted. A reporter who loses the PIN cannot
        # recover it (by design — preserves true anonymity for anonymous
        # filings; the alternative would require linking an email backup,
        # which leaks identifying metadata).
        from services import concern_pin
        from services import concern_audit
        plaintext_pin = concern_pin.generate()
        user_right.case_pin_hash = concern_pin.hash_pin(plaintext_pin)

        # M4 — persist named_parties + auto-escalation stamps.
        if named_parties_list:
            user_right.named_parties = named_parties_list
        if escalated_at:
            user_right.escalated_to_external_at = escalated_at
            user_right.escalated_reason = escalated_reason_str

        # M7 — persist the attachment-scan outcome so the handler UI can
        # show a "Clean" / "Skipped" badge next to the download link.
        if attachment_scanned_at_ts:
            user_right.attachment_scanned_at = attachment_scanned_at_ts
            user_right.attachment_scan_result = attachment_scan_db_value

        # Structural link to the payroll run/payslip this concern is about
        # (ownership-validated above; run derived from the payslip).
        if link_run_id is not None:
            user_right.payroll_run_id = link_run_id
        if link_payslip_id is not None:
            user_right.payslip_id = link_payslip_id

        db.add(user_right)
        db.commit()
        db.refresh(user_right)

        # Audit-log the case creation.
        concern_audit.log(
            db,
            right_id=user_right.right_id,
            actor_kind="reporter",
            actor_user_id=None,  # anonymous filings have no actor user_id; named ones don't expose it on the create event either
            action=concern_audit.ACTION_CREATED,
            details={
                "channel": channel_norm,
                "is_anonymous": bool(is_anonymous),
                "named_parties_count": len(named_parties_list),
            },
        )
        # Separate audit row for the auto-escalation so dashboards can filter on it.
        if escalated_at:
            concern_audit.log(
                db,
                right_id=user_right.right_id,
                actor_kind="system",
                actor_user_id=None,
                action=concern_audit.ACTION_ESCALATED,
                details={
                    "reason": "conflict_of_interest",
                    "coi_admin_user_ids": coi_admin_user_ids,
                    "target_company_id": target_company_id,
                },
            )
            # M8 closeout — push to Kiruko triage queue + reporter.
            # Best-effort; both helpers swallow their own exceptions.
            try:
                from services.notification_service import NotificationService
                NotificationService.notify_kontokaz_triage(db, user_right)
                NotificationService.notify_employee_concern_rerouted(db, user_right)
            except Exception as notify_err:
                logger.warning(
                    f"Auto-escalation notifications failed (non-fatal) "
                    f"for right_id={user_right.right_id}: {notify_err}"
                )

        # Plan Phase 10 + Phase 11 Step 4 — close the silent-submission loop.
        # Notification fan-out is best-effort: a downstream failure must
        # never prevent the report from being recorded.
        try:
            from services.notification_service import NotificationService
            if channel_norm == "external":
                NotificationService.notify_compliance_user_right_external(db, user_right)
            else:
                NotificationService.notify_employer_user_right_report(db, user_right)
        except Exception as notify_err:
            logger.warning(
                f"Your Right notification failed (non-fatal) for right_id={user_right.right_id}: {notify_err}"
            )

        # #6 — additionally notify the manager(s)/HR the worker routed this to.
        # Validate the chosen ids against the company's actual role-holders so a
        # worker can't notify arbitrary users. Best-effort; never blocks the report.
        if send_to and target_company_id:
            try:
                from services.notification_service import NotificationService
                valid_handler_ids = {u.user_id for u in get_company_role_holders(target_company_id, db)}
                requested_ids = {int(t.strip()) for t in send_to.split(',') if t.strip().isdigit()}
                for uid in list(requested_ids & valid_handler_ids)[:5]:
                    NotificationService.create_notification(
                        db=db,
                        user_id=uid,
                        title=f"A report was routed to you — case #{user_right.right_id}",
                        message=(
                            f"A worker sent you a report: "
                            f"{(user_right.title or 'Untitled')[:80]}. Review it in the Concerns dashboard."
                        ),
                        notification_type="user_right_report",
                        meta={"user_right_id": user_right.right_id, "routed_handler": True},
                    )
            except Exception as handler_err:
                logger.warning(
                    f"send_to handler notification failed (non-fatal) for right_id={user_right.right_id}: {handler_err}"
                )

        return JSONResponse(
            status_code=status.HTTP_201_CREATED,
            content={
                "status": "success",
                "message": "Rights report submitted successfully",
                "data": jsonable_encoder(user_right),
                # Reporter portal access — show this PIN to the user ONCE and
                # offer a download as PDF. The plaintext is not persisted and
                # cannot be recovered.
                "case_access": {
                    "case_id": user_right.right_id,
                    "pin": plaintext_pin,
                    "portal_url": "/concerns/track",  # frontends compose the absolute URL
                    "ttl_disclaimer": (
                        "This PIN is shown only once. Save it now — it cannot be recovered."
                    ),
                },
            }
        )
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"something is wrong with your query")
    except Exception:
        logger.error("Unexpected Error in create_user_right:", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)


def _parse_dispute_range(since: Optional[str], until: Optional[str]):
    """Parse `since`/`until` query params for dispute date-range filtering.

    Mirrors the audit-log endpoint's contract: ISO 8601 (a bare `YYYY-MM-DD`
    is accepted and treated as midnight). `since` is inclusive, `until` is
    exclusive. Returns (since_dt, until_dt) with either side None when omitted.
    Raises HTTP 422 on a malformed value.
    """
    since_dt = until_dt = None
    if since:
        try:
            since_dt = datetime.fromisoformat(since)
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid `since` ISO date/datetime.")
    if until:
        try:
            until_dt = datetime.fromisoformat(until)
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid `until` ISO date/datetime.")
    return since_dt, until_dt


@router.get('/disputes/company/{company_id}', status_code=200)
async def get_company_disputes(
    company_id: int,
    channel: Optional[str] = Query("internal", description="internal | external | all"),
    dispute_status: Optional[str] = Query(None, alias="status"),
    since: Optional[str] = Query(None, description="ISO date/datetime, inclusive lower bound on created_at"),
    until: Optional[str] = Query(None, description="ISO date/datetime, exclusive upper bound on created_at"),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Company-wide dispute list for the web dashboard.

    For internal disputes: full detail (description, resolution, assignee).
    For external disputes: AGGREGATED ONLY — no employee names, no content (worker privacy).
    Anonymous reports (is_anonymous=True) mask the employee identity on the
    company-side response. The Compliance dashboard sees full identity.
    """
    from core.model import UserRight as URModel, PrivateUser as PUModel, Job as JobModel
    from core.roles import is_company_admin_for
    from sqlalchemy import and_

    # Plan P0-2 pattern — tenant-gate this endpoint. The previous version
    # only required authentication, so any logged-in user could read any
    # company's full dispute history.
    from core.permission_guards import assert_company_permission
    assert_company_permission(current_user, company_id, 'view_disputes', db)

    try:
        # Get all private_user_ids for this company
        company_pu_ids = [
            pu.private_user_id
            for pu in db.query(PUModel).filter(PUModel.company_id == company_id).all()
        ]
        if not company_pu_ids:
            return {"internal": [], "external_stats": {"total": 0, "by_category": {}}, "total": 0}

        query = db.query(URModel).filter(URModel.private_user_id.in_(company_pu_ids))

        if channel and channel != "all":
            query = query.filter(URModel.channel == channel)
        if dispute_status:
            query = query.filter(URModel.status == dispute_status)
        since_dt, until_dt = _parse_dispute_range(since, until)
        if since_dt is not None:
            query = query.filter(URModel.created_at >= since_dt)
        if until_dt is not None:
            query = query.filter(URModel.created_at < until_dt)

        disputes = query.order_by(URModel.created_at.desc()).all()

        internal_out = []
        external_stats: dict = {"total": 0, "by_category": {}, "by_month": {}}

        for d in disputes:
            # M4 — conflict-of-interest filter. If the calling admin is named
            # in `named_parties`, they cannot see this case AT ALL — neither
            # in the internal list nor in the aggregate stats. The case has
            # already been auto-escalated to Kiruko (see POST /user-right),
            # so the legitimate handler will see it on the compliance
            # dashboard; the named admin is intentionally locked out.
            named_user_ids = []
            try:
                if getattr(d, "named_parties", None):
                    named_user_ids = [
                        int(entry.get("user_id"))
                        for entry in (d.named_parties or [])
                        if isinstance(entry, dict) and entry.get("user_id") is not None
                    ]
            except Exception:
                named_user_ids = []
            if current_user.user_id in named_user_ids:
                # Skip this case for the COI'd admin. Audit-log the filter
                # event so a redacted view is itself attributable in legal forensics.
                from services import concern_audit
                from core.concern_states import ActorKind
                concern_audit.log(
                    db,
                    right_id=d.right_id,
                    actor_kind=ActorKind.SYSTEM.value,
                    action="coi_filtered",
                    actor_user_id=current_user.user_id,
                    details={"reason": "calling_admin_named_in_case"},
                )
                continue

            pu = db.query(PUModel).filter(PUModel.private_user_id == d.private_user_id).first()

            # Plan Phase 11 Step 6 — mask identity on anonymous reports for the
            # company-side response. Compliance dashboard reads via a different
            # endpoint and sees full identity for follow-up + legal record.
            if getattr(d, "is_anonymous", False):
                employee_name = "Anonymous"
                pu_id_for_response = None
            else:
                employee_name = f"{pu.first_name} {pu.last_name}" if pu else "Unknown"
                pu_id_for_response = d.private_user_id

            if d.channel == "external":
                # Aggregate only — never expose identity or content
                external_stats["total"] += 1
                cat = d.category or "other"
                external_stats["by_category"][cat] = external_stats["by_category"].get(cat, 0) + 1
                month_key = d.created_at.strftime("%Y-%m") if d.created_at else "unknown"
                external_stats["by_month"][month_key] = external_stats["by_month"].get(month_key, 0) + 1
            else:
                # Internal — full detail
                days_open = (
                    (datetime.now(timezone.utc) - d.created_at).days
                    if d.created_at and not d.closed_at else 0
                )
                internal_out.append({
                    "right_id": d.right_id,
                    "employee_name": employee_name,
                    "private_user_id": pu_id_for_response,
                    "is_anonymous": bool(getattr(d, "is_anonymous", False)),
                    "title": d.title,
                    "category": d.category,
                    "urgency_level": d.urgency_level,
                    "status": d.status,
                    "channel": d.channel,
                    "issue_description": d.issue_description,
                    "expected_outcome": d.expected_outcome,
                    "occurrence_description": d.occurrence_description,
                    "date_of_occurrence": d.date_of_occurrence.isoformat() if d.date_of_occurrence else None,
                    "attachment_url": d.attachment_url,
                    "attachment_scan_result": getattr(d, "attachment_scan_result", None),
                    "assigned_to": d.assigned_to,
                    "internal_notes": d.internal_notes,
                    "resolution": d.resolution,
                    "closed_at": d.closed_at.isoformat() if d.closed_at else None,
                    "closed_by": d.closed_by,
                    "payroll_run_id": getattr(d, "payroll_run_id", None),
                    "payslip_id": getattr(d, "payslip_id", None),
                    "days_open": days_open,
                    "created_at": d.created_at.isoformat() if d.created_at else None,
                    "updated_at": d.updated_at.isoformat() if d.updated_at else None,
                    # M8 closeout — expose `named_parties` to enable the UI
                    # defense-in-depth COI filter. The backend has already
                    # filtered out cases naming the calling admin (see COI
                    # gate above), so this list never includes them; it
                    # may include OTHER company users who are implicated.
                    # That's intentionally visible — it's useful context
                    # for the handler.
                    "named_parties": d.named_parties or [],
                })

        return {
            "internal": internal_out,
            "external_stats": external_stats,
            "total": len(disputes),
        }

    except SQLAlchemyError as e:
        logger.error(f"DB error in company disputes: {e}")
        raise HTTPException(status_code=500, detail="Database error fetching disputes.")
    except Exception:
        logger.error("Unexpected error in company disputes:", exc_info=True)
        raise HTTPException(status_code=500, detail="Unexpected server error.")


@router.get('/disputes/compliance', status_code=200)
async def get_compliance_disputes(
    channel: Optional[str] = Query("all", description="internal | external | all"),
    dispute_status: Optional[str] = Query(None, alias="status"),
    only_aging: bool = Query(False, description="If true, restrict to reports past 5 working days"),
    company_id: Optional[int] = Query(None, description="Narrow the cross-company view to one company"),
    country_code: Optional[str] = Query(None, description="Narrow the cross-company view to one country"),
    since: Optional[str] = Query(None, description="ISO date/datetime, inclusive lower bound on created_at"),
    until: Optional[str] = Query(None, description="ISO date/datetime, exclusive upper bound on created_at"),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Compliance/Platform-admin dispute list (plan Phase 11 Step 4 + 5).

    Returns FULL detail for both internal and external reports — including
    employee identity even when `is_anonymous=True` — because compliance
    officers and platform admins are the audience the anonymity opt-in was
    designed to preserve identity FROM the employer, not from oversight.

    Auth: requires either the `compliance_officer` platform role or
    `platform_admin`. Any other authenticated user is rejected.

    ``country_code`` is applied at the DB level (via the same
    ``private_user_ids_for_country`` helper /admin/stats and /admin/all-users
    use), before the 500-row cap below — filtering client-side after the cap
    would silently drop older cases in a lower-volume country once overall
    dispute volume passed 500, and would leave reporters with no resolvable
    company (independent workers) permanently excluded from every country
    view since they'd never match any single country's cases.
    """
    from core.model import UserRight as URModel, PrivateUser as PUModel, Company
    from db_models.crud.role import user_has_role_by_user_id
    from db_models.crud.user import private_user_ids_for_country
    from datetime import timezone as tz, timedelta as td

    is_admin = getattr(current_user, "is_superuser", False) or user_has_role_by_user_id(
        current_user.user_id, "platform_admin", db
    )
    is_compliance = user_has_role_by_user_id(
        current_user.user_id, "compliance_officer", db
    )
    if not (is_admin or is_compliance):
        raise HTTPException(
            status_code=403,
            detail="Requires compliance_officer or platform_admin role.",
        )

    try:
        query = db.query(URModel)
        if channel and channel != "all":
            query = query.filter(URModel.channel == channel)
        if dispute_status:
            query = query.filter(URModel.status == dispute_status)
        if company_id is not None:
            # The compliance view is cross-company by default; narrow it to one
            # company's reporters when an admin selects a company in the UI.
            company_pu_ids = [
                pu.private_user_id
                for pu in db.query(PUModel).filter(PUModel.company_id == company_id).all()
            ]
            query = query.filter(URModel.private_user_id.in_(company_pu_ids or [-1]))
        if country_code:
            query = query.filter(
                URModel.private_user_id.in_(private_user_ids_for_country(db, country_code) or [-1])
            )
        since_dt, until_dt = _parse_dispute_range(since, until)
        if since_dt is not None:
            query = query.filter(URModel.created_at >= since_dt)
        if until_dt is not None:
            query = query.filter(URModel.created_at < until_dt)
        if only_aging:
            # 5 working days = approx 7 calendar days. Cheap and clear.
            cutoff = datetime.now(timezone.utc) - td(days=7)
            query = query.filter(
                URModel.status.in_(["pending", "in_progress"]),
                URModel.created_at < cutoff,
            )
        disputes = query.order_by(URModel.created_at.desc()).limit(500).all()

        out = []
        for d in disputes:
            pu = db.query(PUModel).filter(PUModel.private_user_id == d.private_user_id).first()
            employee_name = f"{pu.first_name} {pu.last_name}" if pu else "Unknown"
            company_name = None
            company_id = None
            dispute_country_code = None
            if pu:
                job = next((j for j in (pu.jobs or []) if j.company_id), None)
                company_id = (job.company_id if job else None) or pu.company_id
                if company_id:
                    c = db.query(Company).filter(Company.company_id == company_id).first()
                    if c:
                        company_name = c.company_name
                        dispute_country_code = c.country_code
                if dispute_country_code is None:
                    # Independent reporter (no resolvable company) — fall back
                    # to their own profile country the same way every other
                    # admin view does (PrivateUser.effective_country_code),
                    # instead of leaving this None and having every country
                    # filter/badge treat the case as belonging to nowhere.
                    dispute_country_code = pu.effective_country_code

            days_open = (
                (datetime.now(timezone.utc) - d.created_at).days
                if d.created_at and not d.closed_at else 0
            )

            out.append({
                "right_id": d.right_id,
                "employee_name": employee_name,
                "private_user_id": d.private_user_id,
                "is_anonymous": bool(getattr(d, "is_anonymous", False)),
                "company_id": company_id,
                "company_name": company_name,
                "country_code": dispute_country_code,
                "title": d.title,
                "category": d.category,
                "urgency_level": d.urgency_level,
                "status": d.status,
                "channel": d.channel,
                "issue_description": d.issue_description,
                "expected_outcome": d.expected_outcome,
                "occurrence_description": d.occurrence_description,
                "date_of_occurrence": d.date_of_occurrence.isoformat() if d.date_of_occurrence else None,
                "attachment_url": d.attachment_url,
                "assigned_to": d.assigned_to,
                "internal_notes": d.internal_notes,
                "resolution": d.resolution,
                "closed_at": d.closed_at.isoformat() if d.closed_at else None,
                "closed_by": d.closed_by,
                "days_open": days_open,
                "created_at": d.created_at.isoformat() if d.created_at else None,
                "updated_at": d.updated_at.isoformat() if d.updated_at else None,
            })

        return {"disputes": out, "total": len(out)}
    except SQLAlchemyError as e:
        logger.error(f"DB error in compliance disputes: {e}")
        raise HTTPException(status_code=500, detail="Database error fetching disputes.")
    except Exception:
        logger.error("Unexpected error in compliance disputes:", exc_info=True)
        raise HTTPException(status_code=500, detail="Unexpected server error.")


@router.patch('/disputes/{right_id}', status_code=200)
async def update_dispute(
    right_id: int,
    request: Request,
    body: dict = Body(...),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Update a concern's workflow state.

    Accepted fields: status, assigned_to, internal_notes, resolution.

    Channel-aware authorization (M1):
      - internal channel → requires `is_company_admin_for(target_company)`.
      - external channel → requires the `compliance_officer` or
        `platform_admin` platform role. (Previously: ALL external mutations
        returned 403, blocking Kiruko lawyers from resolving cases in-system.)

    State transitions are validated against `core.concern_states` —
    illegal transitions return 409 with a descriptive message. Reporters
    cannot drive the workflow (appeals are exposed via the reporter portal,
    not via this endpoint).

    Closed concerns remain append-only — only `internal_notes` may change
    after `closed_at` is set (also enforced by the DB trigger
    `user_rights_closed_immutable` as a defence-in-depth guard).

    Every successful mutation writes to `concern_audit_log`. Status changes
    auto-stamp `acknowledged_at` on first transition out of `received`.
    """
    from core.model import UserRight as URModel, PrivateUser as PUModel
    from core.roles import is_company_admin_for, is_compliance_or_platform_admin
    from core.concern_states import (
        ActorKind,
        ConcernStatus,
        StateTransitionError,
        validate_transition,
    )
    from services import concern_audit
    from datetime import timezone as tz

    dispute = db.query(URModel).filter(URModel.right_id == right_id).first()
    if not dispute:
        raise HTTPException(status_code=404, detail="Concern not found.")

    # Channel-aware role gate.
    if dispute.channel == "external":
        if not is_compliance_or_platform_admin(current_user, db):
            raise HTTPException(
                status_code=403,
                detail=(
                    "External concerns are routed to Kiruko Compliance. "
                    "Only compliance_officer or platform_admin may resolve them."
                ),
            )
        actor_kind = ActorKind.KONTOKAZ.value
        target_company_id = None  # external cases are not tenant-scoped at the company level
    else:
        # Internal — tenant gate via the employee's company.
        pu = db.query(PUModel).filter(PUModel.private_user_id == dispute.private_user_id).first()
        if pu is None:
            raise HTTPException(status_code=404, detail="Concern author not found.")
        job = next((j for j in (pu.jobs or []) if j.company_id), None)
        target_company_id = (job.company_id if job else None) or pu.company_id
        from core.permission_guards import has_company_permission
        if not target_company_id or not has_company_permission(current_user, target_company_id, 'view_disputes', db):
            raise HTTPException(status_code=403, detail="Not authorized to update this concern.")
        actor_kind = ActorKind.EMPLOYER.value

    # Append-only on closed concerns. Once closed_at is set the only mutation
    # we permit is appending to internal_notes.
    if dispute.closed_at is not None:
        forbidden = set(body.keys()) - {"internal_notes"}
        if forbidden:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Concern #{right_id} was closed at {dispute.closed_at.isoformat()} "
                    f"and is append-only. Field(s) not allowed after close: {sorted(forbidden)}. "
                    f"File a new linked concern to revise the resolution."
                ),
            )

    # State-machine validation — only when status is being changed.
    requested_status = body.get("status")
    if requested_status is not None:
        try:
            validate_transition(dispute.status, requested_status, actor_kind)
        except StateTransitionError as e:
            raise HTTPException(status_code=409, detail=str(e))

    previous_status = dispute.status
    ALLOWED = {"status", "assigned_to", "internal_notes", "resolution"}
    for field, val in body.items():
        if field in ALLOWED:
            setattr(dispute, field, val)

    now = datetime.now(tz.utc)

    # First transition out of `received` implicitly acknowledges the case
    # (EU directive: handler must acknowledge within 7 days).
    just_acknowledged = False
    if (
        previous_status == ConcernStatus.RECEIVED.value
        and requested_status is not None
        and requested_status != ConcernStatus.RECEIVED.value
        and dispute.acknowledged_at is None
    ):
        dispute.acknowledged_at = now
        just_acknowledged = True

    # Auto-stamp closed_at when resolving or rejecting (legacy behavior).
    just_closed = False
    if requested_status in ("resolved", "rejected") and not dispute.closed_at:
        dispute.closed_at = now
        dispute.closed_by = current_user.user_id
        just_closed = True

    # Stamp retention_purge_at at close-time per plan §Schema delta
    # ("Computed as closed_at + 7 years on closure"). The retention-purge
    # cron will still catch any closed concern that slipped through (e.g.
    # legacy rows closed before this code shipped) as a safety net.
    if just_closed and dispute.retention_purge_at is None:
        years = 7
        try:
            pu = db.query(PrivateUser).filter(
                PrivateUser.private_user_id == dispute.private_user_id
            ).first()
            if pu and pu.job_id:
                job = db.query(Job).filter(Job.job_id == pu.job_id).first()
                if job and job.company_id:
                    company = db.query(Company).filter(
                        Company.company_id == job.company_id
                    ).first()
                    if company and getattr(company, "concern_retention_years", None):
                        years = int(company.concern_retention_years)
        except Exception as e:
            logger.warning(
                f"retention_purge_at lookup failed for right_id={dispute.right_id}: {e}"
            )
        dispute.retention_purge_at = dispute.closed_at + timedelta(days=365 * years)

    db.commit()
    db.refresh(dispute)

    status_changed = bool(dispute.status and dispute.status != previous_status)
    client_ip = (request.client.host if request and request.client else None)

    # Audit-log every mutation. Best-effort.
    if status_changed:
        concern_audit.log(
            db,
            right_id=dispute.right_id,
            actor_kind=actor_kind,
            action=concern_audit.ACTION_STATUS_CHANGED,
            actor_user_id=current_user.user_id,
            details={
                "from": previous_status,
                "to": dispute.status,
                "channel": dispute.channel,
            },
            ip=client_ip,
        )
        # Closure event is logged separately so dashboards/reports can pivot.
        if dispute.closed_at is not None and previous_status not in ("resolved", "rejected"):
            concern_audit.log(
                db,
                right_id=dispute.right_id,
                actor_kind=actor_kind,
                action=concern_audit.ACTION_CLOSED,
                actor_user_id=current_user.user_id,
                details={"final_status": dispute.status},
                ip=client_ip,
            )

    if "internal_notes" in body or "resolution" in body:
        concern_audit.log(
            db,
            right_id=dispute.right_id,
            actor_kind=actor_kind,
            action=concern_audit.ACTION_NOTE_ADDED,
            actor_user_id=current_user.user_id,
            details={
                "fields": sorted(set(body.keys()) & {"internal_notes", "resolution"}),
            },
            ip=client_ip,
        )

    # Notify the employee whenever status changes. Best-effort; never blocks.
    # Distinct copy for acknowledgment + closure events (plan §Notification
    # copy); generic status-change push for every other transition.
    if status_changed:
        try:
            from services.notification_service import NotificationService
            if just_acknowledged:
                NotificationService.notify_employee_concern_acknowledged(db, dispute)
            if just_closed:
                NotificationService.notify_employee_concern_closed(db, dispute)
            if not just_acknowledged and not just_closed:
                NotificationService.notify_employee_user_right_status_change(
                    db, dispute, dispute.status
                )
        except Exception as notify_err:
            logger.warning(
                f"Concern status-change notification failed (non-fatal) "
                f"for right_id={dispute.right_id}: {notify_err}"
            )

    return {"status": "success", "right_id": dispute.right_id, "new_status": dispute.status}


# ── Audit-log viewer (M7) — Kiruko forensic surface ──────────────────────
@router.get('/concerns/audit-log', status_code=200)
async def list_concern_audit_log(
    right_id: Optional[int] = Query(None),
    action: Optional[str] = Query(None),
    actor_kind: Optional[str] = Query(None),
    since: Optional[str] = Query(None, description="ISO datetime; inclusive."),
    until: Optional[str] = Query(None, description="ISO datetime; exclusive."),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    output: str = Query("json", description="json | csv"),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Audit-log viewer for Kiruko Compliance + platform admins.

    Filterable by `right_id`, `action`, `actor_kind`, and date range. Returns
    JSON by default or CSV when `output=csv` (downloads as
    `concern_audit_log.csv`).

    Auth: same as `GET /disputes/compliance` — compliance_officer or
    platform_admin only. Anyone else gets 403.
    """
    from core.model import ConcernAuditLog
    from core.roles import is_compliance_or_platform_admin

    if not is_compliance_or_platform_admin(current_user, db):
        raise HTTPException(
            status_code=403,
            detail="Requires compliance_officer or platform_admin.",
        )

    q = db.query(ConcernAuditLog)
    if right_id:
        q = q.filter(ConcernAuditLog.right_id == right_id)
    if action:
        q = q.filter(ConcernAuditLog.action == action)
    if actor_kind:
        q = q.filter(ConcernAuditLog.actor_kind == actor_kind)
    if since:
        try:
            since_dt = datetime.fromisoformat(since)
            q = q.filter(ConcernAuditLog.created_at >= since_dt)
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid `since` ISO datetime.")
    if until:
        try:
            until_dt = datetime.fromisoformat(until)
            q = q.filter(ConcernAuditLog.created_at < until_dt)
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid `until` ISO datetime.")

    # Count BEFORE limit/offset for pagination metadata.
    total = q.count()
    rows = (
        q.order_by(ConcernAuditLog.created_at.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )

    def _row_dict(r):
        return {
            "audit_id": r.audit_id,
            "right_id": r.right_id,
            "actor_user_id": r.actor_user_id,
            "actor_kind": r.actor_kind,
            "action": r.action,
            "details": r.details,
            "ip": r.ip,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }

    if output == "csv":
        import csv as _csv
        import io as _io
        buf = _io.StringIO()
        writer = _csv.writer(buf)
        writer.writerow([
            "audit_id", "created_at", "right_id", "actor_user_id",
            "actor_kind", "action", "ip", "details",
        ])
        for r in rows:
            import json as _json
            writer.writerow([
                r.audit_id,
                r.created_at.isoformat() if r.created_at else "",
                r.right_id,
                r.actor_user_id if r.actor_user_id is not None else "",
                r.actor_kind,
                r.action,
                r.ip or "",
                _json.dumps(r.details) if r.details is not None else "",
            ])
        from fastapi.responses import Response as _Response
        return _Response(
            content=buf.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=concern_audit_log.csv"},
        )

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "rows": [_row_dict(r) for r in rows],
    }


# ── Kiruko triage dismiss (M4 — defang COI auto-escalation abuse) ────────
@router.patch('/disputes/{right_id}/triage', status_code=200)
async def triage_dismiss_or_accept(
    right_id: int,
    request: Request,
    body: dict = Body(...),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Kiruko Compliance reviews an auto-escalated case in the Triage queue
    and either accepts it (proceeds normally as an external case) or
    dismisses-back-to-internal (the named party is removed, channel flips
    back, the case returns to the employer's queue).

    Body: {"action": "dismiss"|"accept", "reason": str}.

    Auth: requires compliance_officer or platform_admin (same gate as
    GET /disputes/compliance and PATCH on external cases).

    Only applies to cases auto-escalated via the COI path
    (`escalated_to_external_at IS NOT NULL`) — manual external filings
    cannot be dismissed back to internal via this endpoint.
    """
    from core.model import UserRight as URModel
    from core.roles import is_compliance_or_platform_admin
    from core.concern_states import ActorKind
    from services import concern_audit
    from datetime import timezone as _tz

    if not is_compliance_or_platform_admin(current_user, db):
        raise HTTPException(status_code=403, detail="Requires compliance_officer or platform_admin.")

    action = (body or {}).get("action")
    reason = str((body or {}).get("reason", "")).strip()[:500]
    if action not in ("dismiss", "accept"):
        raise HTTPException(status_code=422, detail="action must be 'dismiss' or 'accept'.")

    dispute = db.query(URModel).filter(URModel.right_id == right_id).first()
    if not dispute:
        raise HTTPException(status_code=404, detail="Concern not found.")
    if dispute.escalated_to_external_at is None:
        raise HTTPException(
            status_code=409,
            detail="Only auto-escalated cases can be triaged via this endpoint.",
        )
    if dispute.acknowledged_at is not None:
        raise HTTPException(
            status_code=409,
            detail="Case has already been acknowledged; triage window has closed.",
        )

    now = datetime.now(_tz.utc)
    client_ip = (request.client.host if request and request.client else None)

    if action == "dismiss":
        # Clear the named_parties entries that triggered escalation and
        # flip the case back to internal so the employer handles it.
        dispute.named_parties = []
        dispute.channel = "internal"
        dispute.acknowledged_at = now  # Kiruko "acknowledged" by dismissing
        dispute.triage_dismissed_at = now  # M8 closeout: dedicated dismissal stamp
        db.commit()
        db.refresh(dispute)

        concern_audit.log(
            db,
            right_id=right_id,
            actor_kind=ActorKind.KONTOKAZ.value,
            action=concern_audit.ACTION_TRIAGE_DISMISSED,
            actor_user_id=current_user.user_id,
            details={"reason": reason, "previous_channel": "external"},
            ip=client_ip,
        )

        # Notify the reporter that their case was rerouted.
        try:
            from services.notification_service import NotificationService
            NotificationService.notify_employee_user_right_status_change(
                db, dispute, dispute.status
            )
        except Exception:
            pass

        return {
            "ok": True,
            "right_id": right_id,
            "channel": dispute.channel,
            "action": "dismissed",
        }

    # action == "accept" — Kiruko takes the case; stamp acknowledged_at so
    # subsequent reads know the triage window is closed.
    dispute.acknowledged_at = now
    db.commit()
    db.refresh(dispute)

    concern_audit.log(
        db,
        right_id=right_id,
        actor_kind=ActorKind.KONTOKAZ.value,
        action="triage_accepted",
        actor_user_id=current_user.user_id,
        details={"reason": reason},
        ip=client_ip,
    )

    return {
        "ok": True,
        "right_id": right_id,
        "channel": dispute.channel,
        "action": "accepted",
    }


# ── Owner-gated message thread (M3 — logged-in reporter on mobile) ─────────
# Anonymous reporters use the public PIN portal at /portal/concerns/*. A
# logged-in reporter (the case is in their own history) can use these
# endpoints to read/post into the thread WITHOUT entering a PIN — they're
# authenticated normally. The auth gate is `current_user.private_user_id ==
# right.private_user_id`.
def _owner_for_concern(dispute, current_user):
    pu = getattr(current_user, "private_user", None)
    if pu is None:
        return False
    return getattr(pu, "private_user_id", None) == dispute.private_user_id


@router.get('/user-right/{right_id}/messages', status_code=200)
async def list_owner_messages(
    right_id: int,
    request: Request,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    from core.model import UserRight as URModel, ConcernMessage as CMModel
    from core.concern_states import ActorKind
    from services import concern_audit

    dispute = db.query(URModel).filter(URModel.right_id == right_id).first()
    if not dispute:
        raise HTTPException(status_code=404, detail="Concern not found.")
    if not _owner_for_concern(dispute, current_user):
        raise HTTPException(status_code=403, detail="Not authorized.")

    messages = (
        db.query(CMModel)
        .filter(CMModel.right_id == right_id)
        .order_by(CMModel.created_at.asc())
        .all()
    )
    client_ip = (request.client.host if request and request.client else None)
    concern_audit.log(
        db,
        right_id=right_id,
        actor_kind=ActorKind.REPORTER.value,
        action=concern_audit.ACTION_VIEWED,
        actor_user_id=current_user.user_id,
        details={"surface": "owner_thread"},
        ip=client_ip,
    )
    return {
        "right_id": right_id,
        "messages": [
            {
                "message_id": m.message_id,
                "author_kind": m.author_kind,
                # Owner thread mirrors the public portal — handler user_ids
                # are not exposed (could de-anonymise the investigator).
                "body": m.body,
                "attachment_url": m.attachment_url,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in messages
        ],
    }


@router.post('/user-right/{right_id}/messages', status_code=201)
async def post_owner_message(
    right_id: int,
    request: Request,
    body: dict = Body(...),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    from core.model import UserRight as URModel, ConcernMessage as CMModel
    from core.concern_states import ActorKind
    from services import concern_audit

    text = (body or {}).get("body")
    if not isinstance(text, str) or not (1 <= len(text.strip()) <= 8000):
        raise HTTPException(status_code=422, detail="Body must be 1-8000 characters.")
    attachment_url = (body or {}).get("attachment_url")
    if attachment_url is not None and not isinstance(attachment_url, str):
        raise HTTPException(status_code=422, detail="attachment_url must be a string.")

    dispute = db.query(URModel).filter(URModel.right_id == right_id).first()
    if not dispute:
        raise HTTPException(status_code=404, detail="Concern not found.")
    if not _owner_for_concern(dispute, current_user):
        raise HTTPException(status_code=403, detail="Not authorized.")

    msg = CMModel(
        right_id=right_id,
        author_kind=ActorKind.REPORTER.value,
        # Even for the owner endpoint we DO NOT store the author_user_id —
        # the message thread must look identical regardless of whether the
        # reporter posted from the in-app surface or the PIN portal.
        # Otherwise an anonymous reporter who logs in named via the same
        # device leaks their identity through the messages table.
        author_user_id=None,
        body=text.strip(),
        attachment_url=attachment_url or None,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)

    client_ip = (request.client.host if request and request.client else None)
    concern_audit.log(
        db,
        right_id=right_id,
        actor_kind=ActorKind.REPORTER.value,
        action=concern_audit.ACTION_MESSAGE_SENT,
        actor_user_id=current_user.user_id,
        details={"message_id": msg.message_id, "surface": "owner_thread"},
        ip=client_ip,
    )
    # M8 closeout — push to the handler side. Reporter is the message author
    # here, so we wake up their handler. Best-effort.
    try:
        from services.notification_service import NotificationService
        NotificationService.notify_handler_reporter_message(db, dispute)
    except Exception as notify_err:
        logger.warning(
            f"Owner-thread reply notification failed (non-fatal) "
            f"for right_id={right_id}: {notify_err}"
        )
    return {
        "ok": True,
        "message_id": msg.message_id,
        "created_at": msg.created_at.isoformat() if msg.created_at else None,
    }


# ── Thread-message attachments (closes plan-vs-shipped gap #21) ────────────
@router.post('/concerns/messages/attachments', status_code=201)
async def upload_concern_message_attachment(
    file: UploadFile = File(...),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Scan + store a file for use as a `ConcernMessage.attachment_url`.

    Authenticated callers only — both employer admins/Kiruko and named
    reporters in-app go through here. Anonymous reporters posting via
    `/portal/concerns/{case_id}/messages` use the portal-scoped equivalent
    in `concerns_portal.py`.

    Scanner contract mirrors the main filing flow at `POST /user-right`:
    MIME allow-list + magic-byte sniff (+ optional ClamAV when enabled).
    Returns the storage URL + scan_result; caller passes the URL back in
    the subsequent message POST.
    """
    from services import attachment_scanner
    from services.storage_service import get_storage_service

    file_bytes = await file.read()
    scan_result = attachment_scanner.scan(file_bytes, file.content_type)
    if not scan_result.accepted:
        logger.warning(
            "Concern thread attachment rejected: filename=%s mime=%s reason=%s",
            getattr(file, "filename", "?"),
            file.content_type,
            scan_result.reason,
        )
        raise HTTPException(status_code=415, detail=scan_result.reason or "Attachment rejected.")

    # Wrap back into an UploadFile so storage_service can stream it; same
    # pattern the filing endpoint uses after exhausting the read buffer.
    import io
    from starlette.datastructures import UploadFile as StarletteUploadFile
    wrapped = StarletteUploadFile(
        filename=file.filename,
        headers=file.headers,
        file=io.BytesIO(file_bytes),
    )
    storage_service = get_storage_service()
    url = await storage_service.upload_file(wrapped, folder="concern_messages")
    if not url:
        raise HTTPException(status_code=500, detail="Attachment upload failed.")
    return {
        "attachment_url": url,
        "scan_result": scan_result.db_value,
    }


# ── Handler-side message thread (M2 of Concerns plan) ──────────────────────
# Reporter-side endpoints for the same thread live in api/v1/concerns_portal.py.
def _authorize_handler_for_concern(dispute, current_user, db):
    """Resolve the right authorisation for a handler reading/writing the
    thread on a concern. Returns the actor_kind ('employer' | 'kontokaz')
    or raises HTTPException."""
    from core.model import PrivateUser as PUModel
    from core.roles import is_company_admin_for, is_compliance_or_platform_admin
    from core.concern_states import ActorKind

    if dispute.channel == "external":
        if not is_compliance_or_platform_admin(current_user, db):
            raise HTTPException(
                status_code=403,
                detail=(
                    "External concerns are routed to Kiruko Compliance. "
                    "Only compliance_officer or platform_admin may participate."
                ),
            )
        return ActorKind.KONTOKAZ.value

    pu = db.query(PUModel).filter(PUModel.private_user_id == dispute.private_user_id).first()
    if pu is None:
        raise HTTPException(status_code=404, detail="Concern author not found.")
    job = next((j for j in (pu.jobs or []) if j.company_id), None)
    target_company_id = (job.company_id if job else None) or pu.company_id
    from core.permission_guards import has_company_permission
    if not target_company_id or not has_company_permission(current_user, target_company_id, 'view_disputes', db):
        raise HTTPException(status_code=403, detail="Not authorized to access this concern.")
    return ActorKind.EMPLOYER.value


@router.get('/disputes/{right_id}/messages', status_code=200)
async def list_dispute_messages(
    right_id: int,
    request: Request,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Read the message thread for a concern. Channel-aware authorization
    matches PATCH /disputes/{right_id}."""
    from core.model import UserRight as URModel, ConcernMessage as CMModel
    from services import concern_audit

    dispute = db.query(URModel).filter(URModel.right_id == right_id).first()
    if not dispute:
        raise HTTPException(status_code=404, detail="Concern not found.")

    actor_kind = _authorize_handler_for_concern(dispute, current_user, db)

    messages = (
        db.query(CMModel)
        .filter(CMModel.right_id == right_id)
        .order_by(CMModel.created_at.asc())
        .all()
    )

    client_ip = (request.client.host if request and request.client else None)
    concern_audit.log(
        db,
        right_id=right_id,
        actor_kind=actor_kind,
        action=concern_audit.ACTION_VIEWED,
        actor_user_id=current_user.user_id,
        details={"surface": "thread"},
        ip=client_ip,
    )

    return {
        "right_id": right_id,
        "messages": [
            {
                "message_id": m.message_id,
                "author_kind": m.author_kind,
                "author_user_id": m.author_user_id,  # handler view: shows the colleague's user_id
                "body": m.body,
                "attachment_url": m.attachment_url,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in messages
        ],
    }


@router.post('/disputes/{right_id}/messages', status_code=201)
async def post_dispute_message(
    right_id: int,
    request: Request,
    body: dict = Body(...),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Handler posts a reply into the thread. Channel-aware authorization
    matches PATCH /disputes/{right_id}. Pushes a notification to the reporter
    on best-effort basis."""
    from core.model import UserRight as URModel, ConcernMessage as CMModel
    from services import concern_audit

    text = (body or {}).get("body")
    if not isinstance(text, str) or not (1 <= len(text.strip()) <= 8000):
        raise HTTPException(status_code=422, detail="Body must be 1-8000 characters.")
    attachment_url = (body or {}).get("attachment_url")
    if attachment_url is not None and not isinstance(attachment_url, str):
        raise HTTPException(status_code=422, detail="attachment_url must be a string.")

    dispute = db.query(URModel).filter(URModel.right_id == right_id).first()
    if not dispute:
        raise HTTPException(status_code=404, detail="Concern not found.")

    actor_kind = _authorize_handler_for_concern(dispute, current_user, db)

    msg = CMModel(
        right_id=right_id,
        author_kind=actor_kind,
        author_user_id=current_user.user_id,
        body=text.strip(),
        attachment_url=attachment_url or None,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)

    client_ip = (request.client.host if request and request.client else None)
    concern_audit.log(
        db,
        right_id=right_id,
        actor_kind=actor_kind,
        action=concern_audit.ACTION_MESSAGE_SENT,
        actor_user_id=current_user.user_id,
        details={"message_id": msg.message_id, "surface": "thread"},
        ip=client_ip,
    )

    # M8 closeout — dedicated "new message" push for the reporter rather
    # than the legacy status-change shim. Best-effort.
    try:
        from services.notification_service import NotificationService
        NotificationService.notify_reporter_handler_message(db, dispute)
    except Exception as notify_err:
        logger.warning(
            f"Concern message notification failed (non-fatal) "
            f"for right_id={right_id}: {notify_err}"
        )

    return {
        "ok": True,
        "message_id": msg.message_id,
        "created_at": msg.created_at.isoformat() if msg.created_at else None,
    }


@router.post("/create-transfer", status_code=status.HTTP_201_CREATED)
async def create_transfer(transfer_data: CreateTransfer, db: Session = Depends(config.get_db)):
    try:
        transfer = create_transfer_transaction(transfer_data, db)
        return JSONResponse(status_code=status.HTTP_201_CREATED, content=jsonable_encoder(transfer))
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"something is wrong with your query")
    except:
        logger.error("Unexpected Error:", sys.exc_info())
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
# revisit this function
# @router.post("/upload")
# async def upload_file(file: UploadFile, db: Session = Depends(config.get_db)):
#     # TODO: Implement S3/file storage logic. The following is placeholder.
#     # The s3_client, S3_BUCKET, and S3_ENDPOINT variables need to be configured.
#     raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="File upload not implemented")

@router.post("/login")
@(limiter.limit("10/minute") if RATE_LIMITING_ENABLED else lambda f: f)
async def login_user(request: Request, login_data: UserLoginModel, db: Session = Depends(config.get_db)):
    # Token audience binds to the client platform: admin endpoints require aud='web'.
    # Header is forgeable; this is defense-in-depth for leaked mobile-origin tokens,
    # not protection against fully malicious clients (which is unreachable anyway).
    raw_platform = (request.headers.get("X-Client-Platform") or "").strip().lower()
    client_platform = "mobile" if raw_platform == "mobile" else "web"

    from core.session_security import get_client_ip, device_signal
    client_ip = get_client_ip(request)
    device_id = device_signal(request)

    login_result = await UserService.login_user(
        login_data, db, client_platform=client_platform, client_ip=client_ip, device_id=device_id
    )
    
    # Extract data for response and cookies
    access_token = login_result["access_token"]
    refresh_token = login_result["refresh_token"]
    user_data = login_result["user"]
    
    response = JSONResponse(
        status_code=200,
        content={
            "status": "success",
            "message": "User logged in successfully",
            "access_token": access_token,
            "refresh_token": refresh_token,
            "data": user_data
        }
    )
    
    # Set HttpOnly cookies for web access
    from core.settings import config as settings_config
    cookie_secure = settings_config("COOKIE_SECURE", default="False").lower() == "true"
    
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=cookie_secure,
        samesite="lax",
        path="/",
        max_age=ACCESS_TOKEN_EXPIRY
    )
    
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=cookie_secure,
        samesite="lax",
        path="/",
        max_age=60 * 60 * 24 * REFRESH_TOKEN_EXPIRY
    )
    
    return response

@router.post("/logout")
async def logout():
    response = JSONResponse(
        status_code=200,
        content={"status": "success", "message": "Logged out successfully"}
    )
    # Both cookies must be cleared — deleting access_token alone left the
    # refresh_token cookie alive, and the web client's /user/refresh-token
    # response interceptor (web/ivor-web/src/services/apiClient.tsx) would
    # silently re-mint a new access token on the very next API call,
    # making logout look like a no-op ("stays logged in indefinitely").
    #
    # path matches the set_cookie above. samesite/secure don't influence
    # delete_cookie's matching in Starlette but we mirror them anyway so
    # the Set-Cookie response header is consistent with what the browser
    # originally received.
    from core.settings import config as settings_config
    cookie_secure = settings_config("COOKIE_SECURE", default="False").lower() == "true"
    response.delete_cookie("access_token", path="/", samesite="lax", secure=cookie_secure, httponly=True)
    response.delete_cookie("refresh_token", path="/", samesite="lax", secure=cookie_secure, httponly=True)
    return response


@router.post("/refresh-token")
async def refresh_access_token(request: Request, token_data: Optional[RefreshToken] = None, db: Session = Depends(config.get_db)):
    """
    Refresh access token using a valid refresh token.
    Accepts token via JSON body (mobile) or HttpOnly cookie (web).
    """
    # 1. Try to get refresh token from body
    refresh_token = token_data.refresh_token if token_data else None
    
    # 2. If not in body, try to get from cookie (web)
    if not refresh_token:
        refresh_token = request.cookies.get("refresh_token")
        
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token missing"
        )
    payload = decode_token(refresh_token)
    
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token"
        )
    
    # Check if it's actually a refresh token
    if not payload.get("refresh", False):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token is not a refresh token"
        )

    # Audience must be present (web/mobile). Tokens issued before audience-binding
    # was deployed lack `aud` — we reject them and force re-login.
    token_audience = payload.get("aud")
    if token_audience not in ("web", "mobile"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token missing audience claim. Please log in again."
        )

    # Extract user info
    user_info = payload.get("user", {})
    email = user_info.get("email")
    user_id = user_info.get("user_uid") or user_info.get("user_id")
    
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing user information"
        )
        
    # Get user from database to ensure they still exist and are active
    user = get_user_by_email(email, db)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
        
    if not user.user_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is disabled"
        )

    # Re-compute roles and superuser status for the new access token
    try:
        from core.settings import config as settings_config
        super_emails = settings_config("SUPER_ADMIN_EMAILS", default="") or ""
        super_list = [
            e.strip().strip('"').strip("'").lower()
            for e in super_emails.split(",")
            if e.strip()
        ]
        is_super = user.email.lower() in super_list if getattr(user, 'email', None) else False
    except Exception:
        is_super = False

    try:
        from db_models.crud.role import get_roles_for_user
        roles = get_roles_for_user(user.user_id, db)
    except Exception:
        roles = []

    # Re-derive the web-dashboard access flag so a delegated management employee
    # (HR etc.) isn't bounced by the middleware after their 30-min access token
    # refreshes. Must mirror the computation in services/user_service.py:login.
    try:
        from core.roles import is_company_admin
        from core.permission_guards import company_access_for_user, company_rbac_enabled
        # Unconditional (null-safe): owners have no private_user but ARE admins.
        _is_company_admin = is_company_admin(user)
        _cperms, _croles = company_access_for_user(user, db)
        company_web_access = bool(company_rbac_enabled() and (_is_company_admin or _croles))
    except Exception:
        company_web_access = False

    # Re-derive session binding claims (device + IP) so a refreshed token keeps
    # the same anomaly contract as a freshly-issued one.
    from core.session_security import get_client_ip, device_signal, session_anomaly_mode, session_binding_claims
    _binding = {}
    if session_anomaly_mode() != "off":
        _binding = session_binding_claims(device=device_signal(request), ip=get_client_ip(request))

    # Issue new access token, preserving audience from the refresh token.
    new_access_token = create_access_token(
        user_data={
            "email": user.email,
            "user_id": user.user_id,
            "user_name": user.user_name,
            "is_superuser": is_super,
            "user_type": user.user_type.value if hasattr(user.user_type, 'value') else user.user_type,
            "roles": roles,
            "company_web_access": company_web_access,
            **_binding,
        },
        audience=token_audience,
    )
    
    response = JSONResponse(
        status_code=200,
        content={
            "status": "success",
            "access_token": new_access_token,
            "message": "Access token refreshed successfully"
        }
    )
    
    # If using cookies (detected by presence of refresh_token in request cookies), update the access_token cookie
    if request.cookies.get("refresh_token") == refresh_token:
        from core.settings import config as settings_config
        cookie_secure = settings_config("COOKIE_SECURE", default="False").lower() == "true"
        
        response.set_cookie(
            key="access_token",
            value=new_access_token,
            httponly=True,
            secure=cookie_secure,
            samesite="lax",
            path="/",
            max_age=ACCESS_TOKEN_EXPIRY
        )
        
    return response


@router.get('/debug/echo-cookies')
async def echo_cookies(request: Request):
    """Debug endpoint: returns cookies received on the request. Useful for verifying whether the browser sent the auth cookie."""
    try:
        return JSONResponse(status_code=200, content={"cookies": dict(request.cookies)})
    except Exception as e:
        logger.error('Error echoing cookies: %s', e)
        return JSONResponse(status_code=500, content={"error": "failed to read cookies"})
    
@router.post('/purchase', status_code=201)
async def create_purchase_route(purchase_data: CreatePurchase, db: Session = Depends(config.get_db)):
    try:
        purchase = create_purchase(purchase_data, db)
        return JSONResponse(status_code=201, content={"status": "success", "data": jsonable_encoder(purchase)})
    except Exception as e:
        logger.error(f"Create purchase error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create purchase")

@router.get('/purchase/{purchase_id}', status_code=200)
async def get_purchase_route(purchase_id: int, db: Session = Depends(config.get_db)):
    purchase = get_purchase_by_id(purchase_id, db)
    if not purchase:
        raise HTTPException(status_code=404, detail="Purchase not found")
    return JSONResponse(status_code=200, content={"status": "success", "data": jsonable_encoder(purchase)})

@router.get('/purchases', status_code=200)
async def get_all_purchases_route(db: Session = Depends(config.get_db)):
    purchases = get_all_purchases(db)
    return JSONResponse(status_code=200, content={"status": "success", "data": jsonable_encoder(purchases)})

@router.put('/purchase/{purchase_id}', status_code=200)
async def update_purchase_route(purchase_id: int, update_data: dict, db: Session = Depends(config.get_db)):
    purchase = update_purchase(purchase_id, update_data, db)
    if not purchase:
        raise HTTPException(status_code=404, detail="Purchase not found")
    return JSONResponse(status_code=200, content={"status": "success", "data": jsonable_encoder(purchase)})

@router.delete('/purchase/{purchase_id}', status_code=204)
async def delete_purchase_route(purchase_id: int, db: Session = Depends(config.get_db)):
    success = delete_purchase(purchase_id, db)
    if not success:
        raise HTTPException(status_code=404, detail="Purchase not found")
    return _fastapi.Response(status_code=status.HTTP_204_NO_CONTENT)

# --- Repayment CRUD Routes ---
@router.post('/repayment', status_code=201)
async def create_repayment_route(repayment_data: Repayment, db: Session = Depends(config.get_db)):
    try:
        from db_models.crud.repayment import create_repayment
        repayment = create_repayment(repayment_data, db)
        return JSONResponse(status_code=201, content={"status": "success", "data": jsonable_encoder(repayment)})
    except Exception as e:
        logger.error(f"Create repayment error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create repayment")

@router.get('/repayment/{repayment_id}', status_code=200)
async def get_repayment_route(repayment_id: int, db: Session = Depends(config.get_db)):
    from db_models.crud.repayment import get_repayment_by_id
    repayment = get_repayment_by_id(repayment_id, db)
    if not repayment:
        raise HTTPException(status_code=404, detail="Repayment not found")
    return JSONResponse(status_code=200, content={"status": "success", "data": jsonable_encoder(repayment)})

@router.get('/repayments/{loan_id}', status_code=200)
async def get_repayments_by_loan_route(loan_id: int, db: Session = Depends(config.get_db)):
    from db_models.crud.repayment import get_repayments_by_loan
    repayments = get_repayments_by_loan(loan_id, db)
    return JSONResponse(status_code=200, content={"status": "success", "data": jsonable_encoder(repayments)})

@router.put('/repayment/{repayment_id}', status_code=200)
async def update_repayment_route(repayment_id: int, update_data: dict, db: Session = Depends(config.get_db)):
    from db_models.crud.repayment import update_repayment
    repayment = update_repayment(repayment_id, update_data, db)
    if not repayment:
        raise HTTPException(status_code=404, detail="Repayment not found")
    return JSONResponse(status_code=200, content={"status": "success", "data": jsonable_encoder(repayment)})

@router.delete('/repayment/{repayment_id}', status_code=204)
async def delete_repayment_route(repayment_id: int, db: Session = Depends(config.get_db)):
    from db_models.crud.repayment import delete_repayment
    success = delete_repayment(repayment_id, db)
    if not success:
        raise HTTPException(status_code=404, detail="Repayment not found")
    return JSONResponse(status_code=204, content={"status": "success"})

@router.get('/{private_user_id}/schedules', status_code=status.HTTP_200_OK, response_model=List[ShowSchedule])
async def get_schedules_for_user_endpoint(private_user_id: int, db: Session = Depends(config.get_db)):
    """
    Get all schedules assigned to a specific user.
    """
    try:
        schedules = await get_schedules_for_user_crud(private_user_id, db)
        if not schedules:
            return []
        return schedules
    except Exception as e:
        logger.error(f"Error fetching schedules for user {private_user_id}: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="An unexpected error occurred while fetching schedules.")

@router.post("/register-push-token", status_code=200)
async def register_push_token_route(
    token_data: dict = Body(...),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user)
):
    """Register Expo Push Token for current user"""
    token = token_data.get("token")
    if not token:
        raise HTTPException(status_code=400, detail="Token is required")
        
    try:
        current_user.expo_push_token = token
        db.add(current_user)
        db.commit()
        return {"status": "success", "message": "Push token registered"}
    except Exception as e:
        db.rollback()
        logger.error(f"Error registering push token: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to register push token")


# --- Document Vault Routes ---


def _audit_doc_access(
    db: Session,
    *,
    doc_id: int,
    actor_user_id: Optional[int],
    action: str,
    request: Optional[Request] = None,
) -> None:
    """Append a DocumentAccessLog row. Best-effort — a log failure must
    never fail the underlying read/write."""
    try:
        ip = None
        user_agent = None
        if request is not None:
            ip = request.client.host if request.client else None
            user_agent = (request.headers.get("user-agent") or "")[:255]
        db.add(DocumentAccessLog(
            doc_id=doc_id,
            actor_user_id=actor_user_id,
            action=action,
            ip=ip,
            user_agent=user_agent,
        ))
        db.flush()
    except Exception as e:  # noqa: BLE001
        logger.warning(f"document_access_logs: failed to record {action} on doc {doc_id}: {e}")


@router.post('/vault/upload', status_code=201)
async def upload_vault_document(
    private_user_id: int = Form(...),
    doc_type: str = Form(...),
    name: str = Form(...),
    expiry_date: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    visibility: str = Form("employer_only"),
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    if visibility not in ("private", "employee_only", "employer_only", "company_admin"):
        raise HTTPException(status_code=400, detail=f"Invalid visibility {visibility!r}")
    # Authorize the target vault (was an IDOR — any authenticated user could
    # upload to any private_user_id). Permission-controlled: the employee
    # themselves, a company admin, or a role granted `upload_documents`.
    from core.permission_guards import assert_company_permission
    emp = db.query(PrivateUser).filter(PrivateUser.private_user_id == private_user_id).one_or_none()
    if emp is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    if current_user.user_id != emp.user_id:
        if emp.company_id is None:
            raise HTTPException(status_code=403, detail="Not permitted to upload to this vault")
        assert_company_permission(current_user, emp.company_id, "upload_documents", db)
    try:
        file_url = None
        file_name = None
        file_mime = None
        if file and file.filename:
            storage_service = get_storage_service()
            file_url = await storage_service.upload_file(file, folder=f"vault/{private_user_id}")
            file_name = file.filename
            file_mime = file.content_type
            if not file_url:
                raise HTTPException(status_code=500, detail="File upload failed")

        doc = DocumentVault(
            private_user_id=private_user_id,
            doc_type=doc_type,
            name=name,
            expiry_date=expiry_date or None,
            notes=notes or None,
            file_url=file_url,
            file_name=file_name,
            file_mime=file_mime,
            uploaded_by_user_id=current_user.user_id,
            visibility=visibility,
        )
        db.add(doc)
        db.commit()
        db.refresh(doc)
        return JSONResponse(status_code=201, content={"status": "success", "data": jsonable_encoder(doc)})
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Vault upload error: {e}")
        raise HTTPException(status_code=500, detail="Failed to save document")


@router.get('/vault/company/{company_id}', status_code=200)
async def get_company_vault_documents(
    company_id: int,
    doc_type: Optional[str] = Query(None, description="Filter by doc_type"),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Return EMPLOYER-VISIBLE vault documents across the company's employees,
    enriched with employee name. Admin-gated; excludes employee-private docs
    (private / employee_only)."""
    from core.roles import is_company_admin_for
    from core.permission_guards import _company_permissions_for_user
    # Permission-controlled: company admin, or a role granted view_documents.
    is_admin = is_company_admin_for(current_user, company_id, db)
    has_doc_perm = False
    if not is_admin:
        _perms, _roles = _company_permissions_for_user(current_user, company_id, db)
        has_doc_perm = "view_documents" in _perms
    if not (is_admin or has_doc_perm):
        raise HTTPException(status_code=403, detail="Not permitted to view this company's documents")
    # Admins also see admin-only docs; plain doc-viewers see employer docs only.
    visibilities = ["employer_only", "company_admin"] if is_admin else ["employer_only"]
    try:
        from core.model import DocumentVault as VaultORM
        docs = (
            db.query(VaultORM)
            .join(PrivateUser, VaultORM.private_user_id == PrivateUser.private_user_id)
            .filter(PrivateUser.company_id == company_id)
            # Employer never sees the employee's private docs.
            .filter(VaultORM.visibility.in_(visibilities))
        )
        if doc_type:
            docs = docs.filter(VaultORM.doc_type == doc_type)
        docs = docs.order_by(VaultORM.created_at.desc()).all()

        result = []
        for doc in docs:
            pu = doc.private_user
            result.append({
                "doc_id": doc.doc_id,
                "private_user_id": doc.private_user_id,
                "employee_name": f"{pu.first_name} {pu.last_name}" if pu else "Unknown",
                "doc_type": doc.doc_type,
                "name": doc.name,
                "expiry_date": doc.expiry_date,
                "notes": doc.notes,
                "file_url": doc.file_url,
                "file_name": doc.file_name,
                "file_mime": doc.file_mime,
                "created_at": doc.created_at.isoformat() if doc.created_at else None,
                "updated_at": doc.updated_at.isoformat() if doc.updated_at else None,
            })
        return JSONResponse(status_code=200, content={"status": "success", "data": result})
    except Exception as e:
        logger.error(f"Error fetching company vault: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch documents")


@router.get('/vault/{private_user_id}', status_code=200)
async def get_vault_documents(
    private_user_id: int,
    request: Request,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    # Owner-scope: only the employee themselves, or an admin of their company,
    # may read this vault (was an IDOR — any authenticated user could pass any
    # private_user_id). Visibility then decides WHICH docs each role sees.
    from core.roles import is_company_admin_for
    from core.permission_guards import _company_permissions_for_user
    emp = db.query(PrivateUser).filter(PrivateUser.private_user_id == private_user_id).one_or_none()
    if emp is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    is_owner = current_user.user_id == emp.user_id
    is_admin = emp.company_id is not None and is_company_admin_for(current_user, emp.company_id, db)
    # Permission-controlled: a delegated role granted `view_documents` may read
    # employer-visible docs (admin already covered above). Owner-of-the-vault
    # (the employee) always sees their own.
    has_doc_perm = False
    if not is_owner and not is_admin and emp.company_id is not None:
        _perms, _roles = _company_permissions_for_user(current_user, emp.company_id, db)
        has_doc_perm = "view_documents" in _perms
    if not (is_owner or is_admin or has_doc_perm):
        raise HTTPException(status_code=403, detail="Not permitted to view this vault")
    allowed: set = set()
    if is_owner:
        allowed |= {"private", "employee_only", "employer_only"}
    if is_admin:
        allowed |= {"employer_only", "company_admin"}
    if has_doc_perm:
        # Doc-viewers see employer-visible docs, but not admin-only ones.
        allowed |= {"employer_only"}

    docs = db.query(DocumentVault).filter(
        DocumentVault.private_user_id == private_user_id,
        DocumentVault.visibility.in_(allowed),
    ).order_by(DocumentVault.created_at.desc()).all()
    # Serialize BEFORE the audit commit. db.commit() expires these ORM objects
    # (SQLAlchemy expire_on_commit=True), after which jsonable_encoder() reads an
    # empty __dict__ and returns [{}, …] with no doc_id — which silently breaks
    # the client list (no doc_type/name) and delete (DELETE /vault/doc/undefined).
    serialized = jsonable_encoder(docs)
    # M22 — record one access log per doc surfaced. Bulk insert kept simple
    # (one row per doc); avoids per-doc round-trips later when an auditor
    # asks "who saw this doc on date X".
    for doc in docs:
        _audit_doc_access(
            db, doc_id=doc.doc_id, actor_user_id=current_user.user_id,
            action="list", request=request,
        )
    db.commit()
    return JSONResponse(status_code=200, content={"status": "success", "data": serialized})


@router.delete('/vault/doc/{doc_id}', status_code=200)
async def delete_vault_document(
    doc_id: int,
    request: Request,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    doc = db.query(DocumentVault).filter(DocumentVault.doc_id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    # Owner-scope the delete too (was an IDOR — any user could delete any doc by id).
    # Permission-controlled: owner (the employee), company admin, or a role
    # granted `delete_documents`. assert_company_permission raises 403 otherwise
    # (owner/admin bypass lives inside it).
    from core.permission_guards import assert_company_permission
    emp = db.query(PrivateUser).filter(PrivateUser.private_user_id == doc.private_user_id).one_or_none()
    is_owner = emp is not None and current_user.user_id == emp.user_id
    if not is_owner:
        if emp is None or emp.company_id is None:
            raise HTTPException(status_code=403, detail="Not permitted to delete this document")
        assert_company_permission(current_user, emp.company_id, "delete_documents", db)
    # M22 — log the delete BEFORE removing the row so the audit row references
    # the doc that actually existed (the FK has ON DELETE CASCADE so the log
    # row would be wiped along with the doc, but at least the chain is
    # consistent up to the delete moment).
    _audit_doc_access(
        db, doc_id=doc.doc_id, actor_user_id=current_user.user_id,
        action="delete", request=request,
    )
    db.delete(doc)
    db.commit()
    return JSONResponse(status_code=200, content={"status": "success"})