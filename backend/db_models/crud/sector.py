from sqlalchemy.orm import Session
from core.model import Sector as SectorORM, SectorCategory as SectorCategoryORM, SectorGrade as SectorGradeORM, SectorCategorySalary as SectorCategorySalaryORM, Country as CountryORM
from schema.sector_schema import CreateSector, CreateSectorCategory, CreateSectorGrade, CreateSectorCategorySalary, UpdateSector, UpdateSectorCategory, UpdateSectorGrade
from typing import List, Optional
from datetime import datetime, date
from fastapi import HTTPException
import logging
from sqlalchemy.orm import joinedload


def create_sector(sector_data: CreateSector, db: Session) -> SectorORM:
    """Create a new sector"""
    try:
        sector = SectorORM(
            name=sector_data.activity,
            description=getattr(sector_data, 'description', None),
            country_code=getattr(sector_data, 'country_code', 'MU'),
            currency=getattr(sector_data, 'currency', 'MUR'),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db.add(sector)
        db.commit()
        db.refresh(sector)
        return sector
    except Exception as e:
        db.rollback()
        logging.error(f"Error creating sector: {e}")
        raise HTTPException(status_code=500, detail="Failed to create sector")


def get_sector_by_id(sector_id: int, db: Session) -> Optional[SectorORM]:
    return db.query(SectorORM).filter(SectorORM.sector_id == sector_id).first()


def get_all_sectors(db: Session, country_code: Optional[str] = None) -> List[SectorORM]:
    q = db.query(SectorORM)
    if country_code:
        q = q.filter(SectorORM.country_code == country_code.upper())
    return q.order_by(SectorORM.name.asc()).all()


def get_sectors_by_country(country_code: str, db: Session) -> List[SectorORM]:
    """Convenience wrapper — returns sectors for a given ISO country code."""
    return get_all_sectors(db, country_code=country_code)


def create_sector_category(category_data: CreateSectorCategory, db: Session) -> SectorCategoryORM:
    """Create a new sector category"""
    try:
        cat = SectorCategoryORM(
            sector_id=category_data.sector_id,
            name=category_data.name,
            currency=category_data.currency,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db.add(cat)
        db.commit()
        db.refresh(cat)
        return cat
    except Exception as e:
        db.rollback()
        logging.error(f"Error creating sector category: {e}")
        raise HTTPException(status_code=500, detail="Failed to create sector category")


def get_sector_category_by_id(category_id: int, db: Session) -> Optional[SectorCategoryORM]:
    return db.query(SectorCategoryORM).filter(SectorCategoryORM.id == category_id).first()


def get_categories_by_sector(sector_id: int, db: Session) -> List[SectorCategoryORM]:
    # Get all categories with their relationships
    categories = db.query(SectorCategoryORM).options(
        joinedload(SectorCategoryORM.grades),
        joinedload(SectorCategoryORM.salary_ranges)
    ).filter(SectorCategoryORM.sector_id == sector_id).all()

    # Group categories by name to handle duplicates
    from collections import defaultdict
    categories_by_name = defaultdict(list)

    for cat in categories:
        categories_by_name[cat.name].append(cat)

    # Merge duplicates: keep the first category and combine all salary_ranges
    merged_categories = []
    for name, cat_list in categories_by_name.items():
        if not cat_list:
            continue

        # Use the first category as the base
        primary_cat = cat_list[0]

        # Combine all salary_ranges from all duplicate categories
        all_salary_ranges = []
        all_grades = []

        for cat in cat_list:
            # Ensure salary_ranges are loaded (joinedload should have done this, but be safe)
            if hasattr(cat, 'salary_ranges') and cat.salary_ranges is not None:
                all_salary_ranges.extend(cat.salary_ranges)
            if hasattr(cat, 'grades') and cat.grades is not None:
                all_grades.extend(cat.grades)

        # Deduplicate salary_ranges by their database primary key (id).
        # Using the PK is the only correct approach: two rows with different ids
        # are definitionally different records and must both be kept, regardless
        # of how similar their field values are (e.g. same year-band but different
        # unit, different grade_id, or different rate values).
        unique_salary_ranges = []
        seen_sr_ids = set()
        for sr in all_salary_ranges:
            if sr.id not in seen_sr_ids:
                seen_sr_ids.add(sr.id)
                unique_salary_ranges.append(sr)

        # Remove duplicates in grades (same grade name)
        unique_grades = []
        seen_grades = set()
        for grade in all_grades:
            grade_key = grade.grade if grade.grade else f"grade_{grade.id}"
            if grade_key not in seen_grades:
                seen_grades.add(grade_key)
                unique_grades.append(grade)

        # Update the primary category with merged data
        primary_cat.salary_ranges = unique_salary_ranges
        primary_cat.grades = unique_grades

        merged_categories.append(primary_cat)

    # Sort by name
    merged_categories.sort(key=lambda x: x.name)

    return merged_categories


def get_all_sector_categories(db: Session) -> List[SectorCategoryORM]:
    return db.query(SectorCategoryORM).options(joinedload(SectorCategoryORM.grades), joinedload(SectorCategoryORM.salary_ranges)).order_by(SectorCategoryORM.sector_id.asc(), SectorCategoryORM.name.asc()).all()


def create_sector_grade(grade_data: CreateSectorGrade, db: Session) -> SectorGradeORM:
    """Create a new sector grade"""
    try:
        grade = SectorGradeORM(
            sector_id=grade_data.sector_id,
            sector_category_id=grade_data.sector_category_id,
            grade=grade_data.grade,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db.add(grade)
        db.commit()
        db.refresh(grade)
        return grade
    except Exception as e:
        db.rollback()
        logging.error(f"Error creating sector grade: {e}")
        raise HTTPException(status_code=500, detail="Failed to create sector grade")


def get_sector_grade_by_id(grade_id: int, db: Session) -> Optional[SectorGradeORM]:
    return db.query(SectorGradeORM).filter(SectorGradeORM.id == grade_id).first()


def get_grades_by_category(sector_category_id: int, db: Session) -> List[SectorGradeORM]:
    return db.query(SectorGradeORM).filter(SectorGradeORM.sector_category_id == sector_category_id).order_by(SectorGradeORM.id.asc()).all()


def get_all_sector_grades(db: Session) -> List[SectorGradeORM]:
    return db.query(SectorGradeORM).order_by(SectorGradeORM.sector_id.asc(), SectorGradeORM.sector_category_id.asc()).all()


def create_sector_category_salary(salary_data: CreateSectorCategorySalary, db: Session) -> SectorCategorySalaryORM:
    """Create a new sector category salary range"""
    try:
        salary = SectorCategorySalaryORM(
            sector_category_id=salary_data.sector_category_id,
            sector_grade_id=getattr(salary_data, 'sector_grade_id', None),
            min_years_of_service=salary_data.min_years_of_service,
            max_years_of_service=salary_data.max_years_of_service,
            effective_from=getattr(salary_data, 'effective_from', None),
            basic_monthly_salary=salary_data.basic_monthly_salary,
            basic_daily_salary=salary_data.basic_daily_salary,
            hourly_rate=salary_data.hourly_rate,
            productivity=salary_data.productivity,
            unit=salary_data.unit,
            notes=salary_data.notes,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db.add(salary)
        db.commit()
        db.refresh(salary)
        return salary
    except Exception as e:
        db.rollback()
        logging.error(f"Error creating sector category salary: {e}")
        raise HTTPException(status_code=500, detail="Failed to create sector category salary")


def get_sector_category_salary_by_id(salary_id: int, db: Session) -> Optional[SectorCategorySalaryORM]:
    return db.query(SectorCategorySalaryORM).filter(SectorCategorySalaryORM.id == salary_id).first()


def get_salary_ranges_by_category(sector_category_id: int, db: Session) -> List[SectorCategorySalaryORM]:
    """Return ACTIVE (non-voided) salary ranges where effective_from is on or
    before today, ordered newest-first so the calculator naturally picks the
    most-recent rate. Rows with effective_from IS NULL are always included
    (treated as always valid). Voided rows are excluded entirely.
    """
    today = date.today()
    q = (
        db.query(SectorCategorySalaryORM)
        .filter(
            SectorCategorySalaryORM.sector_category_id == sector_category_id,
            SectorCategorySalaryORM.voided_at.is_(None),
        )
        .filter(
            (SectorCategorySalaryORM.effective_from <= today) |
            (SectorCategorySalaryORM.effective_from.is_(None))
        )
        .order_by(
            SectorCategorySalaryORM.effective_from.desc().nullslast(),
            SectorCategorySalaryORM.min_years_of_service.asc(),
        )
    )
    return q.all()


def get_all_sector_category_salaries(db: Session) -> List[SectorCategorySalaryORM]:
    return db.query(SectorCategorySalaryORM).order_by(SectorCategorySalaryORM.sector_category_id.asc()).all()


# ---------------------------------------------------------------------------
# Country helpers
# ---------------------------------------------------------------------------

def get_active_countries(db: Session) -> List[CountryORM]:
    """Return all countries flagged is_active=True, ordered by name."""
    return db.query(CountryORM).filter(CountryORM.is_active.is_(True)).order_by(CountryORM.name.asc()).all()


def get_salary_history_by_category(sector_category_id: int, db: Session) -> List[SectorCategorySalaryORM]:
    """Return ALL salary rows for a category across every effective year.
    Ordered by effective_from ASC (oldest → newest) then by years-of-service ASC,
    so callers can group by year and compare rates side-by-side.
    """
    return (
        db.query(SectorCategorySalaryORM)
        .filter(SectorCategorySalaryORM.sector_category_id == sector_category_id)
        .order_by(
            SectorCategorySalaryORM.effective_from.asc().nullsfirst(),
            SectorCategorySalaryORM.min_years_of_service.asc(),
        )
        .all()
    )


def get_country(code: str, db: Session) -> Optional[CountryORM]:
    """Return a single country by ISO-3166-1 alpha-2 code (case-insensitive)."""
    return db.query(CountryORM).filter(CountryORM.code == code.upper()).first()


# ---------------------------------------------------------------------------
# Admin write helpers (update / delete)
# ---------------------------------------------------------------------------

def update_sector(sector_id: int, data: UpdateSector, db: Session) -> Optional[SectorORM]:
    sector = db.query(SectorORM).filter(SectorORM.sector_id == sector_id).first()
    if not sector:
        return None
    patch = data.model_dump(exclude_unset=True)
    if "activity" in patch and patch["activity"] is not None:
        sector.name = patch["activity"]
    if "description" in patch:
        sector.description = patch["description"]
    if "currency" in patch and patch["currency"] is not None:
        sector.currency = patch["currency"]
    sector.updated_at = datetime.utcnow()
    try:
        db.commit()
        db.refresh(sector)
        return sector
    except Exception as e:
        db.rollback()
        logging.error(f"Error updating sector {sector_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to update sector")


def delete_sector(sector_id: int, db: Session) -> bool:
    sector = db.query(SectorORM).filter(SectorORM.sector_id == sector_id).first()
    if not sector:
        return False
    child_count = db.query(SectorCategoryORM).filter(SectorCategoryORM.sector_id == sector_id).count()
    if child_count > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Sector has {child_count} categories. Delete or reassign them first.",
        )
    try:
        db.delete(sector)
        db.commit()
        return True
    except Exception as e:
        db.rollback()
        logging.error(f"Error deleting sector {sector_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete sector")


def update_sector_category(category_id: int, data: UpdateSectorCategory, db: Session) -> Optional[SectorCategoryORM]:
    cat = db.query(SectorCategoryORM).filter(SectorCategoryORM.id == category_id).first()
    if not cat:
        return None
    patch = data.model_dump(exclude_unset=True)
    if "name" in patch and patch["name"] is not None:
        cat.name = patch["name"]
    if "currency" in patch and patch["currency"] is not None:
        cat.currency = patch["currency"]
    cat.updated_at = datetime.utcnow()
    try:
        db.commit()
        db.refresh(cat)
        return cat
    except Exception as e:
        db.rollback()
        logging.error(f"Error updating category {category_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to update category")


def delete_sector_category(category_id: int, db: Session) -> bool:
    cat = db.query(SectorCategoryORM).filter(SectorCategoryORM.id == category_id).first()
    if not cat:
        return False
    grade_count = db.query(SectorGradeORM).filter(SectorGradeORM.sector_category_id == category_id).count()
    salary_count = db.query(SectorCategorySalaryORM).filter(SectorCategorySalaryORM.sector_category_id == category_id).count()
    if grade_count > 0 or salary_count > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Category has {grade_count} grades and {salary_count} salary rows. Salary rows are append-only and cannot be deleted; remove grades first.",
        )
    try:
        db.delete(cat)
        db.commit()
        return True
    except Exception as e:
        db.rollback()
        logging.error(f"Error deleting category {category_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete category")


def update_sector_grade(grade_id: int, data: UpdateSectorGrade, db: Session) -> Optional[SectorGradeORM]:
    grade = db.query(SectorGradeORM).filter(SectorGradeORM.id == grade_id).first()
    if not grade:
        return None
    patch = data.model_dump(exclude_unset=True)
    if "grade" in patch:
        grade.grade = patch["grade"]
    grade.updated_at = datetime.utcnow()
    try:
        db.commit()
        db.refresh(grade)
        return grade
    except Exception as e:
        db.rollback()
        logging.error(f"Error updating grade {grade_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to update grade")


def delete_sector_grade(grade_id: int, db: Session) -> bool:
    grade = db.query(SectorGradeORM).filter(SectorGradeORM.id == grade_id).first()
    if not grade:
        return False
    salary_count = db.query(SectorCategorySalaryORM).filter(SectorCategorySalaryORM.sector_grade_id == grade_id).count()
    if salary_count > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Grade has {salary_count} salary rows attached. Salary rows are append-only — reassign or supersede them before deleting the grade.",
        )
    try:
        db.delete(grade)
        db.commit()
        return True
    except Exception as e:
        db.rollback()
        logging.error(f"Error deleting grade {grade_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete grade")


def get_existing_active_salary_by_band(
    sector_category_id: int,
    sector_grade_id: Optional[int],
    effective_from: date,
    min_years_of_service: Optional[int],
    max_years_of_service: Optional[int],
    unit: Optional[str],
    db: Session,
) -> Optional[SectorCategorySalaryORM]:
    """Return the active (non-voided) row matching the FULL natural key
    (category, grade, effective_from, min_years, max_years, unit), or None.

    The append-only POST uses this to 409 a true duplicate insert while
    still allowing distinct year-of-service bands, distinct rate types
    (`unit`), or distinct dates for the same (category, grade) pair."""
    q = db.query(SectorCategorySalaryORM).filter(
        SectorCategorySalaryORM.sector_category_id == sector_category_id,
        SectorCategorySalaryORM.effective_from == effective_from,
        SectorCategorySalaryORM.voided_at.is_(None),
    )
    if sector_grade_id is None:
        q = q.filter(SectorCategorySalaryORM.sector_grade_id.is_(None))
    else:
        q = q.filter(SectorCategorySalaryORM.sector_grade_id == sector_grade_id)
    if min_years_of_service is None:
        q = q.filter(SectorCategorySalaryORM.min_years_of_service.is_(None))
    else:
        q = q.filter(SectorCategorySalaryORM.min_years_of_service == min_years_of_service)
    if max_years_of_service is None:
        q = q.filter(SectorCategorySalaryORM.max_years_of_service.is_(None))
    else:
        q = q.filter(SectorCategorySalaryORM.max_years_of_service == max_years_of_service)
    if unit is None:
        q = q.filter(SectorCategorySalaryORM.unit.is_(None))
    else:
        q = q.filter(SectorCategorySalaryORM.unit == unit)
    return q.first()


def get_active_salary_for_category(
    sector_category_id: int,
    sector_grade_id: Optional[int],
    as_of: date,
    db: Session,
) -> Optional[SectorCategorySalaryORM]:
    """Return the active salary row for a (category, grade) pair as of `as_of`.
    Skips voided rows entirely. NULL effective_from is treated as always-valid
    and ranks below any dated row."""
    q = db.query(SectorCategorySalaryORM).filter(
        SectorCategorySalaryORM.sector_category_id == sector_category_id,
        SectorCategorySalaryORM.voided_at.is_(None),
    )
    if sector_grade_id is None:
        q = q.filter(SectorCategorySalaryORM.sector_grade_id.is_(None))
    else:
        q = q.filter(SectorCategorySalaryORM.sector_grade_id == sector_grade_id)
    q = q.filter(
        (SectorCategorySalaryORM.effective_from <= as_of)
        | (SectorCategorySalaryORM.effective_from.is_(None))
    )
    return q.order_by(SectorCategorySalaryORM.effective_from.desc().nullslast()).first()


def void_sector_category_salary(
    salary_id: int, voided_by_user_id: int, reason: str, db: Session
) -> Optional[SectorCategorySalaryORM]:
    """Mark a salary row as voided. Append-only is preserved — the rate
    columns and effective_from are NEVER touched. Only the three voided_*
    metadata columns are written. Idempotent rejection: voiding twice 409s.

    The caller is responsible for committing OR rolling back its own
    transaction; this function flushes but does not commit, so the void
    + audit row land atomically (plan F2)."""
    row = db.query(SectorCategorySalaryORM).filter(
        SectorCategorySalaryORM.id == salary_id
    ).first()
    if not row:
        return None
    if row.voided_at is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Salary row {salary_id} is already voided "
                   f"(at {row.voided_at.isoformat()}). Append a corrective "
                   f"version instead.",
        )
    row.voided_at = datetime.utcnow()
    row.voided_by_user_id = voided_by_user_id
    row.voided_reason = reason
    db.flush()
    return row
