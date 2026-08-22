"""Seed sector and sector category reference data from a CSV/Excel file.

This job populates the `sectors`, `sector_categories`, `sector_grades`, and
`sector_category_salaries` tables.  It is designed to be re-run safely:
existing rows are matched by name (and country) and only new data is inserted.

--- EXPECTED COLUMN LAYOUT ---

Required:
  Sector                   — sector name, e.g. "Sugar Industry"
  Category of Employee     — employee category name, e.g. "Bakery Operator"
  Rate Type                — one of: monthly | daily | hourly | per_kg | per_show | per_bag
  Rate                     — numeric rate amount, e.g. 16500.00

Optional:
  Grade / Service Details  — grade label, e.g. "Graduate", "Up to 125kg"
  Year of Service          — e.g. "1-3", "5+", "10th year & thereafter"
  Effective From           — ISO date YYYY-MM-DD (blank → 2024-01-01)
  Notes                    — free-text

Country is NOT a column — it is passed via CLI (--country MU).
Currency is NOT a column — it is passed via CLI (--currency MUR).

Usage:
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from backend.jobs.seed_sectors_from_excel import SectorExcelSeeder

    engine = create_engine(DB_URL)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()

    seeder = SectorExcelSeeder(db, default_country='MU', default_currency='MUR')
    report = seeder.seed_file('/path/to/mauritius_sector_rates.csv', dry_run=False)
    print(report)
"""
from typing import Optional, Dict, Any, List, Tuple
import math
import re
from sqlalchemy.orm import Session
from datetime import datetime, date
import logging

try:
    import pandas as pd
except Exception:
    pd = None

try:
    from backend.db_models.crud import sector as sector_crud
except Exception:
    try:
        from db_models.crud import sector as sector_crud
    except Exception:
        sector_crud = None

from schema.sector_schema import CreateSector, CreateSectorCategory, CreateSectorGrade, CreateSectorCategorySalary
from core.model import (
    Sector as SectorORM,
    SectorCategory as SectorCategoryORM,
    SectorGrade as SectorGradeORM,
    SectorCategorySalary as SectorCategorySalaryORM,
    Country as CountryORM,
)

_DEFAULT_EFFECTIVE_FROM = date(2024, 1, 1)

# Canonical rate types accepted in the Rate Type column
VALID_RATE_TYPES = {'monthly', 'daily', 'hourly', 'per_kg', 'per_show', 'per_bag'}


# ---------------------------------------------------------------------------
# Small parsing helpers
# ---------------------------------------------------------------------------

def _parse_number(val: Optional[Any]) -> Optional[float]:
    """Parse numeric values that may contain commas or be empty/NaN."""
    if val is None:
        return None
    try:
        if isinstance(val, str):
            cleaned = val.replace(',', '').strip()
            if cleaned == '':
                return None
            return float(cleaned)
        num = float(val)
        if math.isnan(num):
            return None
        return num
    except Exception:
        return None


def _normalize_text(val: Optional[Any]) -> Optional[str]:
    """Return stripped string or None for empty/NaN/'-' cells."""
    if val is None:
        return None
    try:
        if isinstance(val, float) and math.isnan(val):
            return None
    except Exception:
        pass
    s = str(val).strip()
    if s == '' or s == '-' or s.lower() == 'nan':
        return None
    return s


# Keywords in the "Year of Service" cell that indicate it is a quota/condition
# description rather than an actual years-of-service value.  If any of these
# appear we treat the cell as empty so the salary row applies to ALL experience
# levels (min=0, max=None via the fallback in _process_row).
_NON_YEAR_KEYWORDS = ('show', 'per month', 'per week', 'per day', ' kg', ' lb', 'kilogram')


def _parse_years(val: Optional[Any]) -> Tuple[Optional[int], Optional[int]]:
    """Parse a years-of-service cell into (min, max).

    Supported formats: '1-3', '5+', '1 to 3', '10th year & thereafter', '3'.
    Returns (None, None) for empty / all-years rows and for cells that contain
    quota/condition descriptions (e.g. 'up to 28 shows per month').
    """
    if val is None:
        return None, None
    s = str(val).strip()
    if s == '' or s == '-' or s.lower() == 'nan':
        return None, None

    # If the cell looks like a performance/quota description rather than a
    # time-based range, treat it as "applies to all years".
    if any(kw in s.lower() for kw in _NON_YEAR_KEYWORDS):
        return None, None

    if 'thereafter' in s.lower():
        nums = re.findall(r"(\d+)", s)
        if nums:
            return int(nums[0]), None

    nums = re.findall(r"(\d+)", s)
    if not nums:
        return None, None
    if '+' in s:
        return int(nums[0]), None
    if len(nums) == 1:
        n = int(nums[0])
        return n, n
    return int(nums[0]), int(nums[1])


def _parse_effective_from(val: Optional[Any]) -> date:
    """Parse an ISO date string ('YYYY-MM-DD') or return the default."""
    s = _normalize_text(val)
    if s is None:
        return _DEFAULT_EFFECTIVE_FROM
    try:
        return date.fromisoformat(s)
    except ValueError:
        return _DEFAULT_EFFECTIVE_FROM


def _rate_type_to_fields(rate_type: str, rate: float) -> Dict[str, Any]:
    """Map a canonical rate_type + scalar rate to the ORM field names."""
    rt = rate_type.strip().lower()
    if rt == 'monthly':
        return {'basic_monthly_salary': rate, 'basic_daily_salary': None, 'hourly_rate': None, 'productivity': None, 'unit': None}
    if rt == 'daily':
        return {'basic_monthly_salary': None, 'basic_daily_salary': rate, 'hourly_rate': None, 'productivity': None, 'unit': 'daily'}
    if rt == 'hourly':
        return {'basic_monthly_salary': None, 'basic_daily_salary': None, 'hourly_rate': rate, 'productivity': None, 'unit': 'hourly'}
    if rt in ('per_kg', 'per_show', 'per_bag'):
        return {'basic_monthly_salary': None, 'basic_daily_salary': None, 'hourly_rate': None, 'productivity': rate, 'unit': rt}
    # Fallthrough — unknown type, store as monthly so data is not lost
    return {'basic_monthly_salary': rate, 'basic_daily_salary': None, 'hourly_rate': None, 'productivity': None, 'unit': rt}


# ---------------------------------------------------------------------------
# Main seeder class
# ---------------------------------------------------------------------------

class SectorExcelSeeder:
    """Load sector/salary reference data from a CSV or Excel file.

    Country and currency are deployment concerns — they are passed via
    constructor args and applied uniformly to every row in the file.
    The file itself carries no Country or Currency column.
    """

    def __init__(self, db: Session, default_country: str = "MU", default_currency: str = "MUR"):
        if pd is None:
            raise ImportError("pandas is required for SectorExcelSeeder (pip install pandas openpyxl)")
        self.db = db
        self.default_country = default_country.upper()
        self.default_currency = default_currency.upper()
        self.logger = logging.getLogger(self.__class__.__name__)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def read_sheet(self, path_or_buffer) -> "pd.DataFrame":
        if str(path_or_buffer).lower().endswith('.csv'):
            df = pd.read_csv(path_or_buffer, dtype=str)
        else:
            df = pd.read_excel(path_or_buffer, engine='openpyxl', dtype=str)
        df.columns = [str(c).strip() for c in df.columns]
        return df

    def seed_file(self, path_or_buffer, dry_run: bool = True, drop_tables: bool = False) -> Dict[str, Any]:
        df = self.read_sheet(path_or_buffer)
        summary: Dict[str, Any] = {
            'rows': len(df),
            'country': self.default_country,
            'currency': self.default_currency,
            'sectors_created': 0,
            'categories_created': 0,
            'grades_created': 0,
            'salary_ranges_created': 0,
            'skipped': 0,
            'failures': [],
            'timestamp': datetime.utcnow().isoformat(),
        }

        if drop_tables and not dry_run:
            try:
                self.db.query(SectorCategorySalaryORM).delete()
                self.db.query(SectorGradeORM).delete()
                self.db.query(SectorCategoryORM).delete()
                self.db.query(SectorORM).filter(SectorORM.country_code == self.default_country).delete()
                self.db.commit()
                self.logger.info('Purged existing sector data for country=%s', self.default_country)
            except Exception:
                self.db.rollback()
                self.logger.exception('Failed to purge existing sector tables')

        # Ensure the country row exists before inserting FK-constrained sector rows
        if not dry_run:
            self._ensure_country()

        existing_sectors: List[SectorORM] = []
        try:
            existing_sectors = sector_crud.get_all_sectors(self.db, country_code=self.default_country) if sector_crud else []
        except Exception:
            pass

        for idx, row in df.iterrows():
            try:
                self._process_row(row, idx, existing_sectors, summary, dry_run)
            except Exception:
                self.logger.exception('Unhandled error on row %s', idx)
                summary['failures'].append({'row': int(idx), 'error': 'Unhandled exception'})

        return summary

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _ensure_country(self):
        """Upsert the country row so FK constraints are satisfied."""
        existing = self.db.query(CountryORM).filter(CountryORM.code == self.default_country).first()
        if existing:
            return
        # Map of known country codes to proper names
        COUNTRY_NAMES = {
            'MU': 'Mauritius',
        }
        country = CountryORM(
            code=self.default_country,
            name=COUNTRY_NAMES.get(self.default_country, self.default_country),
            currency=self.default_currency,
            is_active=True,
        )
        self.db.add(country)
        try:
            self.db.commit()
        except Exception:
            self.db.rollback()
            self.logger.warning('Could not upsert country %s (may already exist)', self.default_country)

    def _process_row(self, row, idx, existing_sectors: list, summary: dict, dry_run: bool):
        sector_name   = _normalize_text(row.get('Sector') or row.get('sector'))
        category_name = _normalize_text(row.get('Category of Employee') or row.get('Category') or row.get('category'))
        grade_raw     = _normalize_text(row.get('Grade / Service Details') or row.get('Grade') or row.get('grade'))
        years_raw     = row.get('Year of Service') or row.get('Years of Service')
        rate_type_raw = _normalize_text(row.get('Rate Type') or row.get('rate_type'))
        rate_raw      = _parse_number(row.get('Rate') or row.get('rate'))
        eff_from      = _parse_effective_from(row.get('Effective From') or row.get('effective_from'))
        notes         = _normalize_text(row.get('Notes') or row.get('notes'))

        # --- Mandatory field checks ---
        if not sector_name:
            summary['skipped'] += 1
            return
        if not category_name:
            summary['skipped'] += 1
            return
        if rate_type_raw is None or rate_raw is None:
            summary['skipped'] += 1
            self.logger.debug('Row %s skipped: missing Rate Type or Rate', idx)
            return

        rate_type = rate_type_raw.strip().lower()
        if rate_type not in VALID_RATE_TYPES:
            summary['failures'].append({'row': int(idx), 'error': f'Unknown Rate Type: {rate_type_raw!r}'})
            return

        min_years, max_years = _parse_years(years_raw)
        if min_years is None and max_years is None:
            min_years, max_years = 0, None  # applies to all years

        rate_fields = _rate_type_to_fields(rate_type, rate_raw)

        # --- Resolve / create Sector ---
        sector_obj = self._find_or_create_sector(sector_name, existing_sectors, summary, dry_run)
        if sector_obj is None:
            summary['skipped'] += 1
            return
        sector_id = getattr(sector_obj, 'sector_id', None)

        # --- Resolve / create SectorCategory ---
        category_obj = self._find_or_create_category(int(sector_id), category_name, summary, dry_run)
        if category_obj is None:
            summary['skipped'] += 1
            return

        # --- Resolve / create SectorGrade (if grade text present) ---
        grade_obj = None
        if grade_raw is not None:
            if dry_run:
                summary['grades_created'] += 1
            else:
                grade_obj = self._find_or_create_grade(int(sector_id), category_obj.id, grade_raw, summary)
        grade_id = grade_obj.id if grade_obj else None

        if dry_run:
            summary['salary_ranges_created'] = summary.get('salary_ranges_created', 0) + 1
            return

        # --- Insert salary row (idempotent on the composite key) ---
        self._upsert_salary_range(
            category_id=category_obj.id,
            grade_id=grade_id,
            min_years=min_years,
            max_years=max_years,
            effective_from=eff_from,
            rate_fields=rate_fields,
            notes=notes,
            summary=summary,
            row_idx=idx,
        )

    def _find_or_create_sector(self, name: str, existing_sectors: list, summary: dict, dry_run: bool) -> Optional[SectorORM]:
        for s in existing_sectors:
            s_name    = getattr(s, 'name', None) or getattr(s, 'activity', None)
            s_country = getattr(s, 'country_code', 'MU')
            if s_name and str(s_name).strip().lower() == name.strip().lower() and s_country.upper() == self.default_country:
                return s

        summary['sectors_created'] += 1
        if dry_run:
            return type('S', (), {'sector_id': f'dry-{name}', 'name': name, 'country_code': self.default_country})()

        cs = CreateSector(activity=name.strip(), country_code=self.default_country, currency=self.default_currency)
        created = sector_crud.create_sector(cs, self.db)
        existing_sectors.append(created)
        return created

    def _find_or_create_category(self, sector_id: int, name: str, summary: dict, dry_run: bool) -> Optional[SectorCategoryORM]:
        existing = None
        if not dry_run:
            existing = self.db.query(SectorCategoryORM).filter(
                SectorCategoryORM.sector_id == sector_id,
                SectorCategoryORM.name.ilike(name.strip())
            ).first()

        if existing:
            return existing

        summary['categories_created'] += 1
        if dry_run:
            return type('C', (), {'id': f'dry-cat-{sector_id}-{name}', 'sector_id': sector_id, 'name': name})()

        payload = CreateSectorCategory(sector_id=sector_id, name=name.strip(), currency=self.default_currency)
        return sector_crud.create_sector_category(payload, self.db)

    def _find_or_create_grade(self, sector_id: int, category_id: int, grade_text: str, summary: dict) -> Optional[SectorGradeORM]:
        existing = self.db.query(SectorGradeORM).filter(
            SectorGradeORM.sector_category_id == category_id,
            SectorGradeORM.grade.ilike(grade_text.strip())
        ).first()

        if existing:
            return existing

        summary['grades_created'] += 1
        payload = CreateSectorGrade(sector_id=sector_id, sector_category_id=category_id, grade=grade_text.strip())
        try:
            return sector_crud.create_sector_grade(payload, self.db)
        except Exception:
            self.logger.exception('Failed to create grade "%s" for category %s', grade_text, category_id)
            return None

    def _upsert_salary_range(self, *, category_id: int, grade_id: Optional[int],
                              min_years: Optional[int], max_years: Optional[int],
                              effective_from: date, rate_fields: Dict[str, Any],
                              notes: Optional[str], summary: dict, row_idx):
        """Insert a salary row; skip if the idempotency key already exists."""
        # Idempotency key: (category, grade, min_years, max_years, unit, effective_from)
        unit = rate_fields.get('unit')
        existing = (
            self.db.query(SectorCategorySalaryORM)
            .filter(
                SectorCategorySalaryORM.sector_category_id == category_id,
                SectorCategorySalaryORM.sector_grade_id == grade_id,
                SectorCategorySalaryORM.min_years_of_service == min_years,
                SectorCategorySalaryORM.max_years_of_service == max_years,
                SectorCategorySalaryORM.unit == unit,
                SectorCategorySalaryORM.effective_from == effective_from,
            )
            .first()
        )
        if existing:
            return  # already seeded — skip silently

        payload = CreateSectorCategorySalary(
            sector_category_id=category_id,
            sector_grade_id=grade_id,
            min_years_of_service=min_years,
            max_years_of_service=max_years,
            effective_from=effective_from,
            basic_monthly_salary=rate_fields.get('basic_monthly_salary'),
            basic_daily_salary=rate_fields.get('basic_daily_salary'),
            hourly_rate=rate_fields.get('hourly_rate'),
            productivity=rate_fields.get('productivity'),
            unit=unit,
            notes=notes,
        )
        try:
            sector_crud.create_sector_category_salary(payload, self.db)
            summary['salary_ranges_created'] = summary.get('salary_ranges_created', 0) + 1
        except Exception:
            self.logger.exception('Failed to create salary range row=%s effective_from=%s', row_idx, effective_from)
            summary['failures'].append({'row': int(row_idx), 'error': f'Salary range insert failed (effective_from={effective_from})'})

