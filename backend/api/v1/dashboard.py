from fastapi import APIRouter, Depends, HTTPException, status
from typing import Optional
from sqlalchemy.orm import Session
from core import config
from core.model import User
from core.dependencies import get_current_user
from db_models.crud.dashboard import get_dashboard_stats_from_db, get_dashboard_trend_deltas
from schema.dashboard_schema import DashboardData

router = APIRouter(
    prefix="/dashboard",
    tags=['Dashboard']
)

@router.get('/stats')
async def get_dashboard_stats(
    period: Optional[str] = None,
    department_id: Optional[int] = None,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user)
):
    from core.permission_guards import company_rbac_enabled, assert_company_permission
    if company_rbac_enabled():
        # RBAC on: admit company owners AND management-role employees who hold a
        # dashboard-view permission. Resolve the company the SAME way the login
        # token / RLS does (services/user_service.py): employee membership FIRST,
        # then owned company. This matters for an account that is BOTH an owner of
        # one (possibly empty) company AND a role-holding employee of another — the
        # token binds RLS to their employment, so the dashboard must show that same
        # company. Preferring the owned company here made such a user see their own
        # empty "Get started" owner dashboard instead of the company they work in.
        # Owners have no private_user, so they still fall through to their Company.
        company_id = (
            current_user.private_user.company_id
            if getattr(current_user, 'private_user', None) and getattr(current_user.private_user, 'company_id', None)
            else (current_user.company.company_id if getattr(current_user, 'company', None) else None)
        )
        if not company_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied. Your account is not linked to a company.",
            )
        assert_company_permission(current_user, company_id, "view_attendance", db,
                                  endpoint="/dashboard/stats", method="GET")
    else:
        # RBAC off → today's behavior: company (owner) accounts only.
        if current_user.user_type.value != 'company':
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied. Company dashboard is for company accounts only."
            )
        if not current_user.company:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied. Your account is not linked to a company. If you joined via a company BRN, you have an employee account — please use the employee dashboard."
            )
        company_id = current_user.company.company_id
    try:
        # Validate period if provided
        if period and period not in ('daily', 'weekly', 'monthly'):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid period; allowed: daily, weekly, monthly")

        # The headcount aggregation scopes employees via a company-derived id set
        # (private_user_id IN ...) rather than a literal company_id column, so the
        # tenant guard can't see the scope and warns. It IS company-scoped and
        # read-only — bind the tenant for RLS and bypass the app-layer heuristic.
        from core.tenant_context import with_tenant, bypass_tenant_guard
        with with_tenant(company_id), bypass_tenant_guard("dashboard stats: company-scoped aggregation via derived id set"):
            stats = get_dashboard_stats_from_db(db, company_id, period, department_id=department_id)
            stats["trends"] = get_dashboard_trend_deltas(db, company_id, period, department_id=department_id)
        # Serialize data (handles datetimes, etc.)
        from fastapi.encoders import jsonable_encoder
        json_compatible_item_data = jsonable_encoder(stats)
        
        from fastapi.responses import JSONResponse
        return JSONResponse(content=json_compatible_item_data)
    except Exception:
        # Defensive: log and return a clear HTTP 500 so client (and browser) sees a consistent response
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to compute dashboard statistics")