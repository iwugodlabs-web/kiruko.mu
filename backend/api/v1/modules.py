"""Company feature-entitlement API.

Exposes which paid modules are switched on for a company so the web and mobile
clients can hide the corresponding UI. Platform-admins toggle modules via
`PUT /admin/companies/{company_id}/modules/{module_key}` (see `admin.py`).
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from core import config
from core.dependencies import require_company_scope
from core.modules import list_company_modules


router = APIRouter(tags=["Modules"])


@router.get("/companies/{company_id}/modules", response_model=dict)
def get_company_modules(
    company_id: int,
    company=Depends(require_company_scope),
    db: Session = Depends(config.get_db),
):
    """List every registered module with its resolved enabled state for the
    company. `require_company_scope` handles authorization (company admin or
    platform operator)."""
    return {"company_id": company_id, "modules": list_company_modules(db, company_id)}
