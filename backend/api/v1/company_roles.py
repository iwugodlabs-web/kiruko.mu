"""
Company Roles & Permissions API
Manages custom roles with JSONB permission sets per company.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

from core import config
from core.model import CompanyRole, Company, PrivateUser, User, CompanyUserRole
from core.tenant_context import bypass_tenant_guard
from api.v1.user import get_current_user

router = APIRouter(prefix="/company", tags=["Company Roles"])


def _require_role_access(company_id: int, current_user, db, permission: str = "view_roles") -> None:
    """Authorize role-management access. These endpoints previously had NO authz —
    any authenticated user could read/manage any company's roles. Flag off ⇒
    company admin/owner only (closes that leak); flag on ⇒ the given permission
    (default view_roles for reads; owner/admin bypass inside)."""
    from core.permission_guards import company_rbac_enabled, assert_company_permission
    if company_rbac_enabled():
        assert_company_permission(current_user, company_id, permission, db)
        return
    from core.roles import is_company_admin_for
    if not is_company_admin_for(current_user, company_id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Company admin role required")

# ─── Permission catalogue ────────────────────────────────────────────────────
PERMISSION_GROUPS = {
    "Employee Management": [
        "view_employee", "create_employee", "edit_employee",
        "delete_employee", "export_employee", "onboard_employee",
    ],
    "Salary & Payroll": [
        "view_salary", "edit_salary", "export_payroll",
        "lock_payroll", "approve_deductions",
        # Phase 1 — fine-grained payroll runs gates
        "manage_payroll",          # create/cancel draft runs
        "finalize_payroll",        # finalize a draft + stamp repayments
        "view_payslip",            # admin-side payslip reads
        "manage_allowances",       # create/delete one-off allowances
        "manage_salary_structures",  # create/edit company salary structures
    ],
    "Attendance & Time Logs": [
        "view_attendance", "export_attendance", "edit_hours",
    ],
    "Leave": [
        "view_leave", "approve_leave",
    ],
    "Compliance": [
        "view_compliance", "export_compliance", "send_reminder",
    ],
    "Disputes": [
        "view_disputes", "assign_dispute", "resolve_dispute", "export_audit",
    ],
    "Overtime": [
        "view_overtime", "approve_overtime", "reject_overtime", "bulk_approve_overtime",
    ],
    "Schedule": [
        "view_schedule", "create_schedule", "edit_schedule",
        "delete_schedule", "publish_schedule",
    ],
    "Documents": [
        "view_documents", "upload_documents", "delete_documents", "bulk_upload_documents",
    ],
    "Reports": [
        "view_reports", "export_reports",
    ],
    "Department Management": [
        "view_departments", "create_department", "edit_department", "delete_department",
    ],
    "Communications": [
        "manage_announcements",
    ],
    "Role Management": [
        "view_roles", "create_role", "edit_role", "delete_role",
    ],
}

# Pre-built system roles (seeded per company on first request)
SYSTEM_ROLES = [
    {
        "name": "Owner",
        "description": "Full access. One per company.",
        "permissions": [p for group in PERMISSION_GROUPS.values() for p in group],
    },
    {
        "name": "Company Admin",
        "description": "All permissions except Owner-level role management.",
        "permissions": [
            p for group_name, perms in PERMISSION_GROUPS.items()
            for p in perms
            if not (group_name == "Role Management" and p == "delete_role")
        ],
    },
    # Sensible defaults so a fresh company is usable out-of-the-box (no
    # onboarding cliff). Two surfaces stay fail-closed on EVERY non-admin role —
    # granted only by explicit opt-in in Permissions settings:
    #   - Compliance + Disputes (legally-sensitive whistleblower channel)
    #   - Role Management (prevents a delegated role from self-escalating)
    # Hard-deletes (delete_employee / _department / _schedule / _documents /
    # delete_role) also stay Owner/Admin-only. Companies can widen any role.
    {
        "name": "HR Manager",
        "description": "People-ops + payroll operator. Compliance, disputes and role management stay admin-only.",
        "permissions": [
            # Employees (no hard delete)
            "view_employee", "create_employee", "edit_employee", "export_employee", "onboard_employee",
            # Salary & payroll — full operator, incl. finalize + salary edits
            "view_salary", "edit_salary", "view_payslip", "manage_payroll", "finalize_payroll",
            "manage_allowances", "manage_salary_structures", "export_payroll", "approve_deductions",
            # Attendance & time
            "view_attendance", "export_attendance", "edit_hours",
            # Leave
            "view_leave", "approve_leave",
            # Overtime
            "view_overtime", "approve_overtime", "reject_overtime", "bulk_approve_overtime",
            # Schedule (no delete)
            "view_schedule", "create_schedule", "edit_schedule", "publish_schedule",
            # Documents (no delete)
            "view_documents", "upload_documents", "bulk_upload_documents",
            # Reports, departments (view), announcements
            "view_reports", "export_reports", "view_departments", "manage_announcements",
        ],
    },
    {
        "name": "Department Manager",
        "description": "Team oversight — their people's attendance, leave, overtime and schedule. No payroll or salary.",
        "permissions": [
            "view_employee",
            "view_attendance",
            "view_leave", "approve_leave",
            "view_overtime", "approve_overtime", "reject_overtime",
            "view_schedule", "create_schedule", "edit_schedule", "publish_schedule",
            "view_reports", "view_departments",
        ],
    },
    {
        "name": "Supervisor",
        "description": "Floor-level — view attendance, fix clock-ins, approve overtime for their shift.",
        "permissions": [
            "view_employee",
            "view_attendance", "edit_hours",
            "view_leave",
            "view_overtime", "approve_overtime",
            "view_schedule",
        ],
    },
]


def _ensure_system_roles(company_id: int, db: Session):
    """Seed system roles for a company if they don't exist yet."""
    for sr in SYSTEM_ROLES:
        existing = db.query(CompanyRole).filter(
            CompanyRole.company_id == company_id,
            CompanyRole.name == sr["name"],
            CompanyRole.is_system == True,
        ).first()
        if not existing:
            role = CompanyRole(
                company_id=company_id,
                name=sr["name"],
                description=sr["description"],
                is_system=True,
                permissions=sr["permissions"],
            )
            db.add(role)
    db.commit()


# ─── Schemas ─────────────────────────────────────────────────────────────────

class RoleCreate(BaseModel):
    name: str
    description: Optional[str] = None
    permissions: List[str] = []


class RoleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class PermissionsUpdate(BaseModel):
    permissions: List[str]


class RoleOut(BaseModel):
    role_id: int
    company_id: int
    name: str
    description: Optional[str]
    is_system: bool
    permissions: List[str]
    created_at: Optional[datetime]
    user_count: int = 0

    class Config:
        from_attributes = True


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/{company_id}/roles", status_code=200)
async def list_roles(
    company_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """List all roles for a company (seeds system roles on first call)."""
    _require_role_access(company_id, current_user, db, "view_roles")
    _ensure_system_roles(company_id, db)
    roles = (
        db.query(CompanyRole)
        .filter(CompanyRole.company_id == company_id)
        .order_by(CompanyRole.is_system.desc(), CompanyRole.name)
        .all()
    )
    # Count users per role. Roles are assigned via the catalogue
    # (company_user_roles); the owner/legacy path uses the PrivateUser.role
    # scalar. Count the UNION so catalogue-assigned staff (incl. imported
    # employees, whose scalar stays 'employee') aren't undercounted — counting
    # only PrivateUser.role showed every catalogue-assigned role as 0 users.
    # company_user_roles returns empty under tenant scope, so bypass it (we
    # still filter by company_id).
    cat_by_role: dict = {}
    leg_by_role: dict = {}
    with bypass_tenant_guard("count users per company role"):
        for pid, role_str in db.query(CompanyUserRole.private_user_id, CompanyUserRole.role).filter(
            CompanyUserRole.company_id == company_id
        ).all():
            cat_by_role.setdefault((role_str or "").lower(), set()).add(pid)
        for pid, role_scalar in db.query(PrivateUser.private_user_id, PrivateUser.role).filter(
            PrivateUser.company_id == company_id
        ).all():
            leg_by_role.setdefault((role_scalar or "").lower(), set()).add(pid)

    result = []
    for r in roles:
        slug = r.name.lower().replace(" ", "_")
        name_l = r.name.lower()
        ids = (
            cat_by_role.get(slug, set())
            | cat_by_role.get(name_l, set())
            | leg_by_role.get(slug, set())
        )
        result.append({
            "role_id": r.role_id,
            "company_id": r.company_id,
            "name": r.name,
            "description": r.description,
            "is_system": r.is_system,
            "permissions": r.permissions or [],
            "created_at": r.created_at,
            "user_count": len(ids),
            "permission_count": len(r.permissions or []),
        })
    return result


@router.post("/{company_id}/roles", status_code=201)
async def create_role(
    company_id: int,
    payload: RoleCreate,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a custom role for the company."""
    _require_role_access(company_id, current_user, db, "create_role")
    # Check uniqueness
    existing = db.query(CompanyRole).filter(
        CompanyRole.company_id == company_id,
        CompanyRole.name == payload.name,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="A role with this name already exists.")

    # Validate permissions against catalogue
    all_known = {p for perms in PERMISSION_GROUPS.values() for p in perms}
    unknown = [p for p in payload.permissions if p not in all_known]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown permissions: {unknown}")

    role = CompanyRole(
        company_id=company_id,
        name=payload.name,
        description=payload.description,
        is_system=False,
        permissions=payload.permissions,
    )
    db.add(role)
    db.commit()
    db.refresh(role)
    return {"role_id": role.role_id, "name": role.name, "message": "Role created."}


@router.put("/{company_id}/roles/{role_id}", status_code=200)
async def update_role(
    company_id: int,
    role_id: int,
    payload: RoleUpdate,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Rename or re-describe a custom role (system roles: description only)."""
    _require_role_access(company_id, current_user, db, "edit_role")
    role = db.query(CompanyRole).filter(
        CompanyRole.company_id == company_id,
        CompanyRole.role_id == role_id,
    ).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found.")
    if role.is_system and payload.name:
        raise HTTPException(status_code=403, detail="System role names cannot be changed.")
    if payload.name:
        role.name = payload.name
    if payload.description is not None:
        role.description = payload.description
    db.commit()
    db.refresh(role)
    return {"role_id": role.role_id, "name": role.name}


@router.get("/{company_id}/roles/{role_id}/permissions", status_code=200)
async def get_role_permissions(
    company_id: int,
    role_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    _require_role_access(company_id, current_user, db, "view_roles")
    role = db.query(CompanyRole).filter(
        CompanyRole.company_id == company_id,
        CompanyRole.role_id == role_id,
    ).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found.")
    return {"role_id": role.role_id, "permissions": role.permissions or []}


@router.put("/{company_id}/roles/{role_id}/permissions", status_code=200)
async def update_role_permissions(
    company_id: int,
    role_id: int,
    payload: PermissionsUpdate,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Replace the permission set for a role."""
    _require_role_access(company_id, current_user, db, "edit_role")
    role = db.query(CompanyRole).filter(
        CompanyRole.company_id == company_id,
        CompanyRole.role_id == role_id,
    ).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found.")
    # The Owner role stays full-access so a company can't lock itself out.
    # Every other role (system or custom) is freely editable by the company.
    if role.is_system and (role.name or "").strip().lower() == "owner":
        raise HTTPException(status_code=403, detail="The Owner role can't be modified.")

    all_known = {p for perms in PERMISSION_GROUPS.values() for p in perms}
    unknown = [p for p in payload.permissions if p not in all_known]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown permissions: {unknown}")

    role.permissions = list(set(payload.permissions))  # deduplicate
    db.commit()
    return {"role_id": role.role_id, "permission_count": len(role.permissions)}


@router.delete("/{company_id}/roles/{role_id}", status_code=200)
async def delete_role(
    company_id: int,
    role_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a custom role. System roles cannot be deleted."""
    _require_role_access(company_id, current_user, db, "delete_role")
    role = db.query(CompanyRole).filter(
        CompanyRole.company_id == company_id,
        CompanyRole.role_id == role_id,
    ).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found.")
    if role.is_system:
        raise HTTPException(status_code=403, detail="System roles cannot be deleted.")
    db.delete(role)
    db.commit()
    return {"success": True}


@router.get("/{company_id}/permissions", status_code=200)
async def get_available_permissions(
    company_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the full permission catalogue grouped by feature."""
    _require_role_access(company_id, current_user, db, "view_roles")
    # Annotate each permission with how many roles currently use it
    all_roles = db.query(CompanyRole).filter(CompanyRole.company_id == company_id).all()
    usage: dict[str, int] = {}
    for r in all_roles:
        for p in (r.permissions or []):
            usage[p] = usage.get(p, 0) + 1

    groups = []
    for group_name, perms in PERMISSION_GROUPS.items():
        groups.append({
            "group": group_name,
            "permissions": [
                {"key": p, "used_by_roles": usage.get(p, 0)}
                for p in perms
            ],
        })
    return {"groups": groups, "total": sum(len(p) for p in PERMISSION_GROUPS.values())}
