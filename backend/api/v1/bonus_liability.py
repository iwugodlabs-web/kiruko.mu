"""Bonus liability dashboard endpoints (M23).

Read-only summary of accumulated EOY bonus liability per company.
Backed by the bonus_provisions table populated by the monthly cron
(jobs/bonus_provisioning.py). Triggering a fresh on-demand provision
is intentionally NOT exposed here — provisions reflect end-of-month
finalized payslips, so on-demand recomputes during a partially
finalized month would be misleading.

Endpoints:
    GET /companies/{company_id}/bonus-liability?year=YYYY
        Aggregate liability + per-employee breakdown for the dashboard tile.
"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from core import config
from core.dependencies import get_current_user
from core.model import Company, User
from services import bonus_provisioning


router = APIRouter(tags=["Bonus liability"])


def _require_admin_for_company(actor: User, company_id: int, db: Session, permission=None) -> None:
    """Company-admin gate. When COMPANY_RBAC_ENABLED is on, enforces a company
    permission (default ``view_salary`` — bonus liability is salary data; owner/
    admin bypass inside). Flag off ⇒ admin-only as today."""
    perm = permission or "view_salary"
    from core.permission_guards import company_rbac_enabled, assert_company_permission
    if company_rbac_enabled():
        assert_company_permission(actor, company_id, perm, db)
        return
    from core.auth_guards import require_company_admin
    require_company_admin(actor, company_id, db)


@router.get("/companies/{company_id}/bonus-liability")
def get_bonus_liability(
    company_id: int,
    year: int = date.today().year,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin_for_company(current_user, company_id, db)
    return bonus_provisioning.get_liability_summary(db, company_id=company_id, year=year)
