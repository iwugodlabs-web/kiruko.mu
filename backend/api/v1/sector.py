from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError
import logging
import sys
from datetime import date as dt_date
from typing import List, Optional

from core import config
from core.model import User
from core.dependencies import get_current_user
from api.v1.admin import require_platform_admin
from db_models.crud.audit import create_audit_log

from db_models.crud.sector import (
    create_sector as crud_create_sector,
    get_sector_by_id,
    get_all_sectors,
    create_sector_category as crud_create_sector_category,
    get_sector_category_by_id,
    get_categories_by_sector,
    get_all_sector_categories,
    create_sector_grade as crud_create_sector_grade,
    get_sector_grade_by_id,
    get_grades_by_category,
    get_all_sector_grades,
    get_active_countries,
    get_salary_history_by_category,
    update_sector as crud_update_sector,
    delete_sector as crud_delete_sector,
    update_sector_category as crud_update_sector_category,
    delete_sector_category as crud_delete_sector_category,
    update_sector_grade as crud_update_sector_grade,
    delete_sector_grade as crud_delete_sector_grade,
    create_sector_category_salary as crud_create_sector_category_salary,
    get_existing_active_salary_by_band,
    get_active_salary_for_category,
)

from schema.sector_schema import (
    CreateSector,
    ShowSector,
    CreateSectorCategory,
    ShowSectorCategory,
    CreateSectorGrade,
    ShowSectorGrade,
    CountrySchema,
    SalaryHistoryResponse,
    SalaryHistoryYear,
    SalaryHistoryRow,
    UpdateSector,
    UpdateSectorCategory,
    UpdateSectorGrade,
    CreateSectorCategorySalary,
    SectorCategorySalary,
    VoidSalaryRequest,
)
from db_models.crud.sector import (
    void_sector_category_salary as crud_void_salary,
    get_sector_category_salary_by_id,
)

logger = logging.getLogger()

router = APIRouter(
    prefix="/sector",
    tags=['Sector']
)


@router.get('/countries', status_code=status.HTTP_200_OK, response_model=List[CountrySchema])
async def list_countries(db: Session = Depends(config.get_db)):
    """Return all active countries. Used by the mobile app to show a country picker."""
    try:
        return get_active_countries(db)
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database error while fetching countries")


@router.post('/create', status_code=status.HTTP_201_CREATED, response_model=ShowSector)
async def create_sector_endpoint(
    sector: CreateSector,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(require_platform_admin),
):
    """Create a new sector. Platform-admin only."""
    try:
        created = crud_create_sector(sector, db)
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database error while creating sector")
    except Exception as ex:
        logger.error("Unexpected Error:", sys.exc_info())
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
    create_audit_log(db, current_user.user_id, "sector.create", "sector", created.sector_id, f"name={created.name}")
    return created


@router.get('/all', status_code=status.HTTP_200_OK, response_model=List[ShowSector])
async def list_sectors(
    country_code: Optional[str] = Query(None, description="ISO 3166-1 alpha-2 country code filter, e.g. 'MU', 'ZA'"),
    db: Session = Depends(config.get_db)
):
    try:
        sectors = get_all_sectors(db, country_code=country_code)
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database error while fetching sectors")
    return sectors


@router.get('/{sector_id}', status_code=status.HTTP_200_OK, response_model=ShowSector)
async def get_sector(sector_id: int, db: Session = Depends(config.get_db)):
    try:
        sector = get_sector_by_id(sector_id, db)
        if not sector:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sector not found")
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database error while fetching sector")
    return sector


# --- Sector Category Endpoints ---
@router.post('/category/create', status_code=status.HTTP_201_CREATED, response_model=ShowSectorCategory)
async def create_sector_category_endpoint(
    category: CreateSectorCategory,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(require_platform_admin),
):
    """Create a sector category. Platform-admin only."""
    try:
        created = crud_create_sector_category(category, db)
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database error while creating sector category")
    except Exception as ex:
        logger.error("Unexpected Error:", sys.exc_info())
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
    create_audit_log(db, current_user.user_id, "sector.category.create", "sector_category", created.id, f"name={created.name},sector_id={created.sector_id}")
    return created


@router.get('/category/all', status_code=status.HTTP_200_OK, response_model=List[ShowSectorCategory])
async def list_all_sector_categories(db: Session = Depends(config.get_db)):
    try:
        cats = get_all_sector_categories(db)
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database error while fetching sector categories")
    return cats


@router.get('/category/{category_id}', status_code=status.HTTP_200_OK, response_model=ShowSectorCategory)
async def get_sector_category(category_id: int, db: Session = Depends(config.get_db)):
    try:
        cat = get_sector_category_by_id(category_id, db)
        if not cat:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sector category not found")
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database error while fetching sector category")
    return cat


@router.get('/category/sector/{sector_id}', status_code=status.HTTP_200_OK, response_model=List[ShowSectorCategory])
async def list_categories_for_sector(sector_id: int, db: Session = Depends(config.get_db)):
    try:
        cats = get_categories_by_sector(sector_id, db)
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database error while fetching sector categories")
    return cats


# --- Sector Grade Endpoints ---
@router.post('/grade/create', status_code=status.HTTP_201_CREATED, response_model=ShowSectorGrade)
async def create_sector_grade_endpoint(
    grade: CreateSectorGrade,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(require_platform_admin),
):
    """Create a sector grade. Platform-admin only."""
    try:
        created = crud_create_sector_grade(grade, db)
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database error while creating sector grade")
    except Exception as ex:
        logger.error("Unexpected Error:", sys.exc_info())
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
    create_audit_log(db, current_user.user_id, "sector.grade.create", "sector_grade", created.id, f"grade={created.grade},category_id={created.sector_category_id}")
    return created


@router.get('/grade/all', status_code=status.HTTP_200_OK, response_model=List[ShowSectorGrade])
async def list_all_sector_grades(db: Session = Depends(config.get_db)):
    try:
        grades = get_all_sector_grades(db)
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database error while fetching sector grades")
    return grades


@router.get('/grade/{grade_id}', status_code=status.HTTP_200_OK, response_model=ShowSectorGrade)
async def get_sector_grade(grade_id: int, db: Session = Depends(config.get_db)):
    try:
        g = get_sector_grade_by_id(grade_id, db)
        if not g:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sector grade not found")
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database error while fetching sector grade")
    return g


@router.get('/grade/category/{category_id}', status_code=status.HTTP_200_OK, response_model=List[ShowSectorGrade])
async def list_grades_for_category(category_id: int, db: Session = Depends(config.get_db)):
    try:
        grades = get_grades_by_category(category_id, db)
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database error while fetching sector grades")
    return grades


@router.get('/category/{category_id}/history', status_code=status.HTTP_200_OK, response_model=SalaryHistoryResponse)
async def get_category_salary_history(category_id: int, db: Session = Depends(config.get_db)):
    """Return year-over-year salary history for a category.
    All effective years are included (no date filter) so callers can compare
    e.g. 2024 rates vs 2025 rates vs 2026 rates side-by-side.
    """
    category = get_sector_category_by_id(category_id, db)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    sector = get_sector_by_id(category.sector_id, db)
    if not sector:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sector not found")

    try:
        all_rows = get_salary_history_by_category(category_id, db)
    except SQLAlchemyError as e:
        logger.error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database error while fetching salary history")

    # Group rows by effective_from date
    from collections import defaultdict
    from datetime import date as dt_date
    groups: dict = defaultdict(list)
    for row in all_rows:
        key = row.effective_from or dt_date(2024, 1, 1)
        groups[key].append(SalaryHistoryRow.model_validate(row))

    years = [
        SalaryHistoryYear(effective_from=k, rows=groups[k])
        for k in sorted(groups.keys())
    ]

    return SalaryHistoryResponse(
        category_id=category.id,
        category_name=category.name,
        sector_name=sector.activity,
        country_code=sector.country_code,
        currency=sector.currency,
        years=years,
    )


# ---------------------------------------------------------------------------
# Admin write endpoints — platform-admin only
# ---------------------------------------------------------------------------

@router.put('/{sector_id}', response_model=ShowSector)
async def update_sector_endpoint(
    sector_id: int,
    patch: UpdateSector,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(require_platform_admin),
):
    updated = crud_update_sector(sector_id, patch, db)
    if not updated:
        raise HTTPException(status_code=404, detail="Sector not found")
    create_audit_log(db, current_user.user_id, "sector.update", "sector", updated.sector_id, str(patch.model_dump(exclude_unset=True)))
    return updated


@router.delete('/{sector_id}', status_code=status.HTTP_204_NO_CONTENT)
async def delete_sector_endpoint(
    sector_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(require_platform_admin),
):
    if not crud_delete_sector(sector_id, db):
        raise HTTPException(status_code=404, detail="Sector not found")
    create_audit_log(db, current_user.user_id, "sector.delete", "sector", sector_id, None)
    return None


@router.put('/category/{category_id}', response_model=ShowSectorCategory)
async def update_sector_category_endpoint(
    category_id: int,
    patch: UpdateSectorCategory,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(require_platform_admin),
):
    updated = crud_update_sector_category(category_id, patch, db)
    if not updated:
        raise HTTPException(status_code=404, detail="Category not found")
    create_audit_log(db, current_user.user_id, "sector.category.update", "sector_category", updated.id, str(patch.model_dump(exclude_unset=True)))
    return updated


@router.delete('/category/{category_id}', status_code=status.HTTP_204_NO_CONTENT)
async def delete_sector_category_endpoint(
    category_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(require_platform_admin),
):
    if not crud_delete_sector_category(category_id, db):
        raise HTTPException(status_code=404, detail="Category not found")
    create_audit_log(db, current_user.user_id, "sector.category.delete", "sector_category", category_id, None)
    return None


@router.put('/grade/{grade_id}', response_model=ShowSectorGrade)
async def update_sector_grade_endpoint(
    grade_id: int,
    patch: UpdateSectorGrade,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(require_platform_admin),
):
    updated = crud_update_sector_grade(grade_id, patch, db)
    if not updated:
        raise HTTPException(status_code=404, detail="Grade not found")
    create_audit_log(db, current_user.user_id, "sector.grade.update", "sector_grade", updated.id, str(patch.model_dump(exclude_unset=True)))
    return updated


@router.delete('/grade/{grade_id}', status_code=status.HTTP_204_NO_CONTENT)
async def delete_sector_grade_endpoint(
    grade_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(require_platform_admin),
):
    if not crud_delete_sector_grade(grade_id, db):
        raise HTTPException(status_code=404, detail="Grade not found")
    create_audit_log(db, current_user.user_id, "sector.grade.delete", "sector_grade", grade_id, None)
    return None


@router.post('/category/{category_id}/salary', status_code=status.HTTP_201_CREATED, response_model=SectorCategorySalary)
async def append_category_salary_endpoint(
    category_id: int,
    payload: CreateSectorCategorySalary,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(require_platform_admin),
):
    """Append a new salary version for a category (+ optional grade + year-band).
    APPEND-ONLY per project legal/compliance rule — never UPDATE an existing
    row. Multiple rows may share `(category, grade, effective_from)` if they
    describe distinct year-of-service bands. To correct a wrong rate, void
    the bad row first, then append the corrected version.

    Rejected with 409 if an ACTIVE (non-voided) row already exists on the
    full natural key (category, grade, effective_from, min_years, max_years).
    The partial unique index `uq_sector_category_salaries_active` is the
    last-resort guard against TOCTOU races.
    """
    if payload.sector_category_id != category_id:
        raise HTTPException(
            status_code=400,
            detail="Path category_id does not match payload.sector_category_id",
        )
    if payload.effective_from is None:
        raise HTTPException(status_code=400, detail="effective_from is required for append-only inserts")

    category = get_sector_category_by_id(category_id, db)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    existing = get_existing_active_salary_by_band(
        category_id,
        payload.sector_grade_id,
        payload.effective_from,
        payload.min_years_of_service,
        payload.max_years_of_service,
        payload.unit,
        db,
    )
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail=(
                f"An active salary row already exists for this "
                f"(category={category_id}, grade={payload.sector_grade_id}, "
                f"effective_from={payload.effective_from.isoformat()}, "
                f"years={payload.min_years_of_service}-{payload.max_years_of_service}, "
                f"unit={payload.unit}). "
                f"Void it first to append a correction, or change one of the key fields."
            ),
        )

    created = crud_create_sector_category_salary(payload, db)
    create_audit_log(db, current_user.user_id, "sector.salary.append", "sector_category_salary", created.id, f"category_id={category_id},effective_from={created.effective_from},years={created.min_years_of_service}-{created.max_years_of_service},unit={created.unit}")
    return created


@router.get('/category/{category_id}/salary/active', response_model=Optional[SectorCategorySalary])
async def get_active_salary_endpoint(
    category_id: int,
    grade_id: Optional[int] = Query(None, description="Restrict to a specific grade. Omit to match category-only rows."),
    as_of: Optional[dt_date] = Query(None, description="Date to evaluate active version against. Defaults to today."),
    db: Session = Depends(config.get_db),
):
    """Return the active salary row for a (category, grade) pair as of a given date.
    'Active' = the row with the largest `effective_from <= as_of` whose
    `voided_at IS NULL`. Returns empty body if none exists. Public read;
    the calculator can call this directly."""
    target_date = as_of or dt_date.today()
    row = get_active_salary_for_category(category_id, grade_id, target_date, db)
    return row


@router.post('/category/salary/{salary_id}/void', response_model=SectorCategorySalary)
async def void_salary_endpoint(
    salary_id: int,
    payload: VoidSalaryRequest,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(require_platform_admin),
):
    """Mark a salary row as voided so the partial unique index releases the
    (category, grade, effective_from) slot for a corrective append.

    Append-only is preserved: rate / effective_from columns are NEVER mutated.
    Only the three `voided_*` metadata columns are written.

    409 on double-void (idempotent rejection). The void + audit log commit
    in a single transaction so an audit failure rolls back the void."""
    target = get_sector_category_salary_by_id(salary_id, db)
    if not target:
        raise HTTPException(status_code=404, detail="Salary row not found")

    try:
        voided = crud_void_salary(salary_id, current_user.user_id, payload.reason, db)
        create_audit_log(
            db,
            current_user.user_id,
            "sector.salary.void",
            "sector_category_salary",
            voided.id,
            details=(
                f"reason={payload.reason}|effective_from={voided.effective_from}|"
                f"monthly={voided.basic_monthly_salary}|daily={voided.basic_daily_salary}|"
                f"hourly={voided.hourly_rate}"
            ),
            commit=False,
        )
        db.commit()
        db.refresh(voided)
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        logger.error("void_salary_endpoint failure", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to void salary row")
    return voided