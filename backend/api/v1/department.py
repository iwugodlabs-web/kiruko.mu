from fastapi import APIRouter, Depends, status, HTTPException
from sqlalchemy.orm import Session
from typing import List

from core.dependencies import get_current_user
from core.config import get_db
from core.model import Company, User
from db_models.crud import department as department_crud
from db_models.crud import company as company_crud
from schema.department_schema import CreateDepartment, ShowDepartment
from db_models.crud.user import get_user_by_user_id
from core.roles import is_company_admin_for

router = APIRouter(prefix="/company", tags=["Departments"])


def ensure_company_admin(company_id: int, current_user: User, db: Session, permission: str = "view_departments"):
    # Fetch company and ensure current_user may administer it. When the RBAC flag
    # is ON, enforce a company permission (default view_departments; owner/admin
    # bypass inside). Flag OFF ⇒ company admin/manager as today.
    company = db.query(Company).filter(Company.company_id == company_id).first()
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")
    from core.permission_guards import company_rbac_enabled, assert_company_permission
    if company_rbac_enabled():
        assert_company_permission(current_user, company_id, permission, db)
        return company
    if not is_company_admin_for(current_user, company_id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only company administrators can perform this action")
    return company


@router.post("/{company_id}/departments", response_model=ShowDepartment, status_code=status.HTTP_201_CREATED)
async def create_department_endpoint(company_id: int, payload: CreateDepartment, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ensure_company_admin(company_id, current_user, db, "create_department")
    dept = department_crud.create_department(company_id, payload.name, db)
    company_crud.log_audit(company_id, 'department.created', current_user.user_id, f'department:{dept.department_id}', db, metadata={'name': payload.name})
    return dept


@router.get("/{company_id}/departments", response_model=List[ShowDepartment])
async def list_departments_endpoint(company_id: int, db: Session = Depends(get_db)):
    """List departments for a company. This endpoint is intentionally public to allow client-side department lookups during onboarding/editing."""
    try:
        departments = department_crud.get_departments_by_company(company_id, db)
        # For debugging, return plain dicts (avoid pydantic/orm serialization issues)
        simplified = [ { 'department_id': d.department_id, 'company_id': d.company_id, 'name': d.name, 'created_at': d.created_at.isoformat() if getattr(d, 'created_at', None) else None } for d in departments ]
        return simplified
    except Exception as e:
        # Log and return a 500 with a helpful message
        import logging
        logging.exception(f"Failed to list departments for company {company_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail='Failed to load departments')


@router.put("/{company_id}/departments/{department_id}", response_model=ShowDepartment)
async def update_department_endpoint(company_id: int, department_id: int, payload: CreateDepartment, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ensure_company_admin(company_id, current_user, db, "edit_department")
    dept = department_crud.update_department(department_id, payload.name, db)
    if not dept:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")
    company_crud.log_audit(company_id, 'department.updated', current_user.user_id, f'department:{department_id}', db, metadata={'name': payload.name})
    return dept


@router.delete("/{company_id}/departments/{department_id}", status_code=status.HTTP_200_OK)
async def delete_department_endpoint(company_id: int, department_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ensure_company_admin(company_id, current_user, db, "delete_department")
    ok = department_crud.delete_department(department_id, db)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")
    company_crud.log_audit(company_id, 'department.deleted', current_user.user_id, f'department:{department_id}', db)
    return {"success": True}
