"""Bulk employee import endpoints — upload → dry-run preview → commit.

See EMPLOYEE-IMPORT-PLAN.md. Permission-gated on create_employee/onboard_employee
(resolved from the DB role; owner/Company Admin pass via those roles' seeded
perms). The parse + validate + commit logic lives in
services/employee_import_service.py; this is the HTTP wrapper.
"""
import os
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core import config
from core.dependencies import get_current_user
from core.model import User
from services import employee_import_service as imp

router = APIRouter()

MAX_IMPORT_BYTES = 5 * 1024 * 1024  # 5 MB — a roster, not a data lake


def _require_import_permission(current_user: User, company_id: int, db: Session) -> None:
    """Authorize bulk-import of staff — permission-driven, DB as the source of
    truth. A user may import if their company role (resolved from the DB:
    platform-seeded Owner/Company Admin, or a company-created custom role) grants
    `create_employee` OR `onboard_employee`.

    Resolution goes through the standard `assert_company_permission` guard, whose
    order is: platform cross-tier bypass → seeded owner/admin fallback (so an
    admin is never locked out of an unseeded company) → strict DB permission
    lookup. The DB permission set is the primary check; the role-name set is only
    the fallback."""
    from core.permission_guards import assert_company_permission, _company_permissions_for_user
    # OR across the two relevant permissions — read once from the DB role set.
    perms, _roles = _company_permissions_for_user(current_user, company_id, db)
    if "create_employee" in perms or "onboard_employee" in perms:
        return
    # Not granted by the DB role → 403 (assert applies the owner/admin/platform
    # fallbacks, writes the audit, and names the missing permission).
    assert_company_permission(current_user, company_id, "create_employee", db)


@router.get("/companies/{company_id}/employees/import/template")
def download_import_template(
    company_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Download the CSV template (header + one example row)."""
    _require_import_permission(current_user, company_id, db)
    return Response(
        content=imp.template_csv(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="employee_import_template.csv"'},
    )


@router.post("/companies/{company_id}/employees/import")
async def import_employees(
    company_id: int,
    file: UploadFile = File(...),
    dry_run: bool = Query(True, description="true → validate + preview only (no writes); false → commit"),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload a CSV/XLSX of staff. dry_run=true returns a validation preview
    without writing; dry_run=false creates the valid rows (idempotent)."""
    _require_import_permission(current_user, company_id, db)

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(raw) > MAX_IMPORT_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 5 MB).")

    try:
        rows = imp.parse(raw, file.filename or "upload.csv")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not rows:
        raise HTTPException(status_code=400, detail="No data rows found in the file.")

    preview = imp.validate(db, company_id, rows)
    if preview["missing_columns"]:
        raise HTTPException(
            status_code=400,
            detail=f"Missing required columns: {', '.join(preview['missing_columns'])}",
        )

    if dry_run:
        return {
            "status": "preview",
            "total": preview["total"],
            "ready": len(preview["ok"]),
            "errors": preview["errors"],
            "warnings": preview["warnings"],
        }

    summary = imp.commit(db, company_id, rows, actor_user_id=current_user.user_id)
    db.commit()

    # Auto-email each new employee their set-up (claim) link. Best-effort: queued
    # via the email worker, and a send failure must never break the import. The
    # links are also returned below so the employer can resend/copy manually.
    emailed = 0
    try:
        from services.email_service import send_account_claim_email
        from core.model import Company
        company = db.query(Company).filter(Company.company_id == company_id).first()
        company_name = company.company_name if company else None
        for c in summary.get("claims", []):
            try:
                send_account_claim_email(c["email"], c.get("name"), c["token"], company_name=company_name)
                emailed += 1
            except Exception:
                pass
    except Exception:
        pass

    # Best-effort audit trail.
    try:
        from db_models.crud import company as company_crud
        company_crud.log_audit(
            company_id, "employees.bulk_import", current_user.user_id,
            f"company:{company_id}", db,
            metadata={"created": summary["created"], "skipped": summary["skipped"],
                      "failed": len(summary["failed"])},
        )
        db.commit()
    except Exception:
        db.rollback()

    return {
        "status": "imported",
        "created": summary["created"],
        "skipped": summary["skipped"],
        "failed": summary["failed"],
        "warnings": summary["warnings"],
        # Set-up links were emailed automatically (count below); also returned so
        # the employer can copy/resend manually if a worker has no/bad email.
        "emailed": emailed,
        "claims": summary.get("claims", []),
    }


class SingleEmployeePayload(BaseModel):
    """One manually-onboarded employee. Field names mirror the import CSV columns
    so the same validate/create/claim pipeline (employee_import_service) drives
    both bulk import and the single-employee onboarding wizard — one source of
    truth for what a payroll-ready employee needs and how the claim link is sent."""
    first_name: str
    last_name: str
    email: str
    job_title: str
    start_date: str            # YYYY-MM-DD
    base_salary: float
    currency: str = "MUR"
    # recommended / optional (mapped straight onto import columns)
    passport_number: Optional[str] = None
    department: Optional[str] = None
    work_days_per_week: Optional[int] = None
    hours_per_month: Optional[float] = None
    role: Optional[str] = None
    pay_basis: Optional[str] = None
    dob: Optional[str] = None
    nationality: Optional[str] = None
    permit_type: Optional[str] = None
    permit_number: Optional[str] = None
    permit_expiry: Optional[str] = None


@router.post("/companies/{company_id}/employees", status_code=201)
def create_single_employee(
    company_id: int,
    payload: SingleEmployeePayload,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Directly create ONE payroll-ready employee from the onboarding wizard.

    Deliberately reuses the bulk-import pipeline: the payload is turned into a
    single import "row" and run through imp.commit(), so validation, the
    User+PrivateUser+Job+Salary+structure creation, idempotency, and the one-time
    account-claim token are byte-for-byte identical to a bulk import of one. The
    employee then receives the same "Set my password" claim email — NOT the old
    accept-only invite, which silently discarded everything but the email.
    """
    _require_import_permission(current_user, company_id, db)

    # Map the JSON payload onto the CSV column keys imp.commit expects. Drop
    # None/empty so the service applies its own defaults (e.g. currency, hours).
    row = {
        k: ("" if v is None else str(v))
        for k, v in {
            "first_name": payload.first_name,
            "last_name": payload.last_name,
            "email": payload.email,
            "job_title": payload.job_title,
            "start_date": payload.start_date,
            "base_salary": payload.base_salary,
            "currency": payload.currency,
            "passport_number": payload.passport_number,
            "department": payload.department,
            "work_days_per_week": payload.work_days_per_week,
            "hours_per_month": payload.hours_per_month,
            "role": payload.role,
            "pay_basis": payload.pay_basis,
            "dob": payload.dob,
            "nationality": payload.nationality,
            "permit_type": payload.permit_type,
            "permit_number": payload.permit_number,
            "permit_expiry": payload.permit_expiry,
        }.items()
    }

    # Pre-flight validation so the wizard gets a clean 400 with field errors
    # instead of a silent skip.
    preview = imp.validate(db, company_id, [row])
    if preview["missing_columns"]:
        raise HTTPException(
            status_code=400,
            detail=f"Missing required fields: {', '.join(preview['missing_columns'])}",
        )
    if preview["errors"]:
        fields = "; ".join(f"{e['field']}: {e['reason']}" for e in preview["errors"])
        raise HTTPException(status_code=400, detail=fields or "Invalid employee details.")

    summary = imp.commit(db, company_id, [row], actor_user_id=current_user.user_id)
    if summary["created"] == 0:
        # Idempotency skip (email/passport already exists) or a row-level failure.
        if summary["failed"]:
            raise HTTPException(status_code=400, detail=summary["failed"][0].get("error", "Could not create employee."))
        raise HTTPException(status_code=409, detail="An employee with this email or passport already exists.")
    db.commit()

    # Same auto-email path as bulk import: send the "Set my password" claim link.
    claim = (summary.get("claims") or [{}])[0]
    emailed = False
    try:
        from services.email_service import send_account_claim_email
        from core.model import Company
        company = db.query(Company).filter(Company.company_id == company_id).first()
        company_name = company.company_name if company else None
        if claim.get("email"):
            send_account_claim_email(claim["email"], claim.get("name"), claim["token"], company_name=company_name)
            emailed = True
    except Exception:
        pass

    try:
        from db_models.crud import company as company_crud
        company_crud.log_audit(
            company_id, "employees.onboard_single", current_user.user_id,
            f"company:{company_id}", db, metadata={"email": payload.email},
        )
        db.commit()
    except Exception:
        db.rollback()

    return {
        "status": "created",
        "email": claim.get("email", payload.email),
        "name": claim.get("name"),
        "emailed": emailed,
        "warnings": summary["warnings"],
        # Returned so the wizard can show/copy the link if the email bounces.
        "claim_link": f"{os.getenv('FRONTEND_URL', 'http://localhost:3000').rstrip('/')}/claim?token={claim['token']}" if claim.get("token") else None,
    }
