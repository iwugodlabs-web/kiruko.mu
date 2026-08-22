"""Admin API for effective-dated employee country assignments (missions/transfers).

Endpoints:

    GET    /private-users/{pid}/country-locations
    GET    /private-users/{pid}/country-locations/active?as_of=YYYY-MM-DD
    POST   /private-users/{pid}/country-locations     (closes prior open)
    POST   /private-users/{pid}/country-locations/{id}/end
    DELETE /private-users/{pid}/country-locations/{id}      (soft archive)

Read endpoints allow the employee themselves (self-view) or a company admin for
their company. Writes require a company admin of the employee's company.

Phase 1 scope: display/currency only — these assignments feed
`PrivateUser.effective_country_code` and employee-detail UI. They have no
payroll effect (the engine stays Company.country_code-scoped until Phase 2).
"""

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc
from sqlalchemy.orm import Session

from core import config
from core.dependencies import get_current_user, require_company_read_access
from core.model import Company, Country, EmployeeCountryAssignment, PrivateUser, User
from schema.country_assignment_schema import (
    CountryAssignmentCreate,
    CountryAssignmentEnd,
    CountryAssignmentRead,
)
from services import country_assignment


router = APIRouter(tags=["Employee Country Assignments"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _admin_read_current_user(actor: User, target: PrivateUser, db: Session) -> None:
    """Authorize an admin to READ/act on a target employee's assignments."""
    if target.company_id is None:
        raise HTTPException(status_code=403, detail="Forbidden")
    from core.permission_guards import company_rbac_enabled, assert_company_permission
    if company_rbac_enabled():
        assert_company_permission(actor, target.company_id, "view_salary", db)
        return
    from core.auth_guards import require_company_admin
    require_company_admin(actor, target.company_id, db)


def _require_admin_write(actor: User, target: PrivateUser, db: Session) -> None:
    """Company-admin gate for writes on a target employee."""
    if target.company_id is None:
        raise HTTPException(status_code=400, detail="Employee has no company")
    from core.permission_guards import company_rbac_enabled, assert_company_permission
    if company_rbac_enabled():
        assert_company_permission(actor, target.company_id, "edit_salary", db)
        return
    from core.auth_guards import require_company_admin
    require_company_admin(actor, target.company_id, db)


def _authorize(target: PrivateUser, current_user: User, db: Session, *, write: bool) -> None:
    if current_user.user_id == target.user_id:
        if write:
            raise HTTPException(status_code=403, detail="Employees cannot set their own country assignments")
        return
    if write:
        _require_admin_write(current_user, target, db)
    else:
        _admin_read_current_user(current_user, target, db)


def _audit(db: Session, current_user: User, action: str, target: PrivateUser, a: EmployeeCountryAssignment) -> None:
    try:
        from db_models.crud.audit import create_audit_log
        create_audit_log(
            db,
            user_id=current_user.user_id,
            action=action,
            resource_type="employee_country_assignment",
            resource_id=a.id,
            details={
                "private_user_id": target.private_user_id,
                "country_code": a.country_code,
                "reason": a.reason,
                "effective_from": a.effective_from.isoformat() if a.effective_from else None,
                "effective_to": a.effective_to.isoformat() if a.effective_to else None,
            },
            commit=False,
        )
    except Exception:
        pass


def _resolve_target_employee(db: Session, private_user_id: int) -> PrivateUser:
    target = (
        db.query(PrivateUser)
        .filter(PrivateUser.private_user_id == private_user_id)
        .one_or_none()
    )
    if target is None:
        raise HTTPException(status_code=404, detail=f"PrivateUser {private_user_id} not found")
    return target


def _to_read(db: Session, a: EmployeeCountryAssignment) -> CountryAssignmentRead:
    country = db.query(Country).filter(Country.code == a.country_code).one_or_none() if a.country_code else None
    return CountryAssignmentRead(
        id=a.id,
        private_user_id=a.private_user_id,
        country_code=a.country_code,
        reason=a.reason,
        effective_from=a.effective_from,
        effective_to=a.effective_to,
        new_company_id=a.new_company_id,
        notes=a.notes,
        created_by_user_id=a.created_by_user_id,
        created_at=a.created_at,
        updated_at=a.updated_at,
        archived_at=a.archived_at,
        country_name=country.name if country else None,
        country_currency=country.currency if country else None,
    )


def _validate_country_active(db: Session, country_code: str) -> None:
    from core.model import Country as _C
    c = db.query(_C).filter(_C.code == country_code.upper()).one_or_none()
    if c is None or not c.is_active:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown or not-yet-available country_code '{country_code}'",
        )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/private-users/{private_user_id}/country-locations",
    response_model=List[CountryAssignmentRead],
)
def list_country_locations(
    private_user_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    target = _resolve_target_employee(db, private_user_id)
    _authorize(target, current_user, db, write=False)

    rows = (
        db.query(EmployeeCountryAssignment)
        .filter(EmployeeCountryAssignment.private_user_id == private_user_id)
        .order_by(desc(EmployeeCountryAssignment.effective_from))
        .all()
    )
    return [_to_read(db, a) for a in rows]


@router.get(
    "/private-users/{private_user_id}/country-locations/active",
    response_model=Optional[CountryAssignmentRead],
)
def get_active_country_location(
    private_user_id: int,
    as_of: Optional[date] = Query(None, description="Defaults to today."),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    target = _resolve_target_employee(db, private_user_id)
    _authorize(target, current_user, db, write=False)

    a = country_assignment.active_country_assignment(db, private_user_id, as_of)
    if a is None:
        return None
    return _to_read(db, a)


@router.post(
    "/private-users/{private_user_id}/country-locations",
    response_model=CountryAssignmentRead,
    status_code=201,
)
def create_country_location(
    private_user_id: int,
    payload: CountryAssignmentCreate,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    target = _resolve_target_employee(db, private_user_id)
    _authorize(target, current_user, db, write=True)

    _validate_country_active(db, payload.country_code)

    if payload.new_company_id is not None:
        new_co = db.query(Company).filter(Company.company_id == payload.new_company_id).one_or_none()
        if new_co is None:
            raise HTTPException(status_code=400, detail="new_company_id does not exist")

    # Supersede: close any OPEN or overlapping prior assignment at the new
    # effective_from so windows are non-overlapping [from, to).
    prior_open = (
        db.query(EmployeeCountryAssignment)
        .filter(EmployeeCountryAssignment.private_user_id == private_user_id)
        .filter(EmployeeCountryAssignment.archived_at.is_(None))
        .filter(
            (EmployeeCountryAssignment.effective_to.is_(None))
            | (EmployeeCountryAssignment.effective_to > payload.effective_from)
        )
        .order_by(EmployeeCountryAssignment.effective_from.desc())
        .all()
    )
    for prior in prior_open:
        if payload.effective_from <= prior.effective_from:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"new effective_from {payload.effective_from} must be strictly "
                    f"after prior effective_from {prior.effective_from}"
                ),
            )
        prior.effective_to = payload.effective_from

    new = EmployeeCountryAssignment(
        private_user_id=private_user_id,
        country_code=payload.country_code.upper(),
        reason=payload.reason,
        effective_from=payload.effective_from,
        effective_to=payload.effective_to,
        new_company_id=payload.new_company_id,
        notes=payload.notes,
        created_by_user_id=current_user.user_id,
    )
    db.add(new)

    # transfer_new_company — re-point the employee's primary affiliation in the
    # same transaction (never delete other job rows; multi-employer safe).
    if payload.reason == "transfer_new_company" and target.company_id != payload.new_company_id:
        target.company_id = payload.new_company_id

    _audit(db, current_user, "country_assignment.create", target, new)
    db.flush()
    db.commit()
    db.refresh(new)
    return _to_read(db, new)


@router.post(
    "/private-users/{private_user_id}/country-locations/{assignment_id}/end",
    response_model=CountryAssignmentRead,
)
def end_country_location(
    private_user_id: int,
    assignment_id: int,
    payload: CountryAssignmentEnd,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    target = _resolve_target_employee(db, private_user_id)
    _authorize(target, current_user, db, write=True)

    a = (
        db.query(EmployeeCountryAssignment)
        .filter(
            EmployeeCountryAssignment.id == assignment_id,
            EmployeeCountryAssignment.private_user_id == private_user_id,
        )
        .one_or_none()
    )
    if a is None:
        raise HTTPException(status_code=404, detail="Assignment not found")
    if a.archived_at is not None:
        raise HTTPException(status_code=409, detail="Assignment is archived")
    if payload.effective_to < a.effective_from:
        raise HTTPException(status_code=400, detail="effective_to must be >= effective_from")

    a.effective_to = payload.effective_to
    _audit(db, current_user, "country_assignment.end", target, a)
    db.commit()
    db.refresh(a)
    return _to_read(db, a)


@router.delete(
    "/private-users/{private_user_id}/country-locations/{assignment_id}",
    status_code=204,
)
def archive_country_location(
    private_user_id: int,
    assignment_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    from datetime import datetime as _dt

    target = _resolve_target_employee(db, private_user_id)
    _authorize(target, current_user, db, write=True)

    a = (
        db.query(EmployeeCountryAssignment)
        .filter(
            EmployeeCountryAssignment.id == assignment_id,
            EmployeeCountryAssignment.private_user_id == private_user_id,
        )
        .one_or_none()
    )
    if a is None:
        raise HTTPException(status_code=404, detail="Assignment not found")
    a.archived_at = _dt.utcnow()
    _audit(db, current_user, "country_assignment.archive", target, a)
    db.commit()
    return None


# ---------------------------------------------------------------------------
# Phase 3 — History & reporting (company-scoped, read-only)
# ---------------------------------------------------------------------------
# Lets a company admin answer "who is (or has been) on assignment where" in
# one query, optionally narrowed by country and/or a specific date, and export
# the same view to CSV. Read tier (`require_company_read_access`) so a read-only
# payroll role can pull it without write authority.


@router.get("/companies", response_model=List[dict])
def search_companies(
    q: str = Query(..., min_length=1, description="Name/BRN substring to match."),
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Search active companies by name/BRN for a transfer-company destination."""
    from core.roles import is_platform_operator

    is_admin = getattr(current_user, "is_superuser", False)
    if not is_admin:
        # Company owner/admin of at least one company (Company.user_id FK), OR a
        # platform operator. Employs are never administrators.
        owns_any = db.query(Company.company_id).filter(Company.user_id == current_user.user_id).first()
        if not (owns_any or is_platform_operator(current_user, db)):
            raise HTTPException(status_code=403, detail="Admin user required to search companies")

    pattern = f"%{q}%"
    rows = (
        db.query(Company)
        .filter(Company.status == "active")
        .filter(
            Company.company_name.ilike(pattern)
            | Company.brn.ilike(pattern)
        )
        .order_by(Company.company_name)
        .limit(limit)
        .all()
    )
    return [
        {
            "company_id": c.company_id,
            "company_name": c.company_name,
            "brn": c.brn,
            "country_code": c.country_code,
        }
        for c in rows
    ]


def _assignment_status(a: EmployeeCountryAssignment, as_of: date) -> str:
    """Derive a row's status relative to ``as_of`` (defaults to today)."""
    if a.archived_at is not None:
        return "archived"
    if a.effective_from > as_of:
        return "upcoming"
    if a.effective_to is not None and a.effective_to <= as_of:
        return "ended"
    return "active"


def _report_row(db: Session, a: EmployeeCountryAssignment, as_of: date) -> dict:
    country = db.query(Country).filter(Country.code == a.country_code).one_or_none()
    from datetime import timedelta as _td
    # Residency indicator (informational, NOT enforced by the payroll engine —
    # policy decision §4/§11): days the employee has/would have been in the host
    # country by `as_of`, capped at the assignment window. >= 183 days => a
    # "host residency" flag the employer should review for withholding.
    host_window_to = min(a.effective_to, as_of) if a.effective_to else as_of
    host_days = (host_window_to - a.effective_from).days if host_window_to > a.effective_from else 0
    residency_qualified = host_days >= 183
    return {
        "assignment_id": a.id,
        "private_user_id": a.private_user_id,
        "employee_name": (a.private_user.first_name + " " + (a.private_user.last_name or "")).strip() if a.private_user else None,
        "country_code": a.country_code,
        "country_name": country.name if country else a.country_code,
        "country_currency": country.currency if country else None,
        "reason": a.reason,
        "effective_from": a.effective_from.isoformat() if a.effective_from else None,
        "effective_to": a.effective_to.isoformat() if a.effective_to else None,
        "new_company_id": a.new_company_id,
        "notes": a.notes,
        "archived_at": a.archived_at.isoformat() if a.archived_at else None,
        "status": _assignment_status(a, as_of),
        "host_days": host_days,
        "residency_qualified": residency_qualified,
    }


@router.get(
    "/companies/{company_id}/country-assignments/report",
    response_model=List[dict],
)
def company_country_assignment_report(
    company_id: int,
    as_of: Optional[date] = Query(None, description="Status cutoff; defaults to today."),
    country_code: Optional[str] = Query(None, description="Filter to one host country."),
    reason: Optional[str] = Query(None, description="mission | transfer_same_company | transfer_new_company"),
    status: Optional[str] = Query(None, description="active | upcoming | ended | archived"),
    include_archived: bool = Query(True),
    format: str = Query("json", pattern="^(json|csv)$"),
    db: Session = Depends(config.get_db),
    _: Company = Depends(require_company_read_access),
):
    """All country assignments for a company's employees, with filters."""
    as_of = as_of or date.today()

    q = (
        db.query(EmployeeCountryAssignment)
        .join(PrivateUser, PrivateUser.private_user_id == EmployeeCountryAssignment.private_user_id)
        .filter(PrivateUser.company_id == company_id)
    )
    if not include_archived:
        q = q.filter(EmployeeCountryAssignment.archived_at.is_(None))
    if country_code:
        q = q.filter(EmployeeCountryAssignment.country_code == country_code.upper())
    if reason:
        q = q.filter(EmployeeCountryAssignment.reason == reason)
    rows = q.order_by(
        desc(EmployeeCountryAssignment.effective_from), EmployeeCountryAssignment.private_user_id
    ).all()

    if status:
        rows = [a for a in rows if _assignment_status(a, as_of) == status]

    data = [_report_row(db, a, as_of) for a in rows]

    if format == "csv":
        import csv as _csv
        import io as _io
        buf = _io.StringIO()
        writer = _csv.writer(buf)
        writer.writerow([
            "assignment_id", "employee_name", "private_user_id", "country_code",
            "country_name", "country_currency", "reason", "status", "effective_from",
            "effective_to", "new_company_id", "notes", "archived_at",
            "host_days", "residency_qualified",
        ])
        for r in data:
            writer.writerow([
                r["assignment_id"], r["employee_name"], r["private_user_id"],
                r["country_code"], r["country_name"], r["country_currency"] or "",
                r["reason"], r["status"], r["effective_from"] or "",
                r["effective_to"] or "", r["new_company_id"] or "",
                r["notes"] or "", r["archived_at"] or "",
                r["host_days"], "yes" if r["residency_qualified"] else "no",
            ])
        from fastapi.responses import Response as _Response
        return _Response(
            content=buf.getvalue(),
            media_type="text/csv",
            headers={
                "Content-Disposition": f"attachment; filename=country_assignments_company_{company_id}.csv"
            },
        )

    return data