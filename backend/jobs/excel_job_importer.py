"""Utility to import sector/job/salary rows from Excel into DB.

Class: ExcelJobImporter
- read_excel(path_or_bytes) -> pandas.DataFrame
- import_from_excel(path_or_bytes, dry_run=False) -> dict summary

Notes
- This utility uses pandas to read Excel files (openpyxl engine). If pandas is not installed
  the class will raise an informative error.
- It attempts to match users by `private_user_id`, then `email`, then passport number, then
  by (first_name, last_name) if available. If no user is found the row is flagged.
- It will try to lookup a sector and sector category via `backend/db_models/crud/sector` helpers
  where possible; if your ORM Sector models are named differently adjust the helper calls.
- The importer computes monthly salary using this priority:
    Monthly Basic 2025 -> Monthly Basic 2024 -> Daily Rate * standard_working_days -> Hourly Rate * standard_monthly_hours

This is intentionally conservative and non-destructive: each row is inserted inside its
own DB transaction so failures don't roll back unrelated rows. You can run with dry_run=True
first to see mapping output without writing to the DB.
"""
from typing import Optional, Dict, Any, Tuple
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError
from datetime import datetime
import logging

# Import ORM models used by the job/salary CRUD
from core.model import Job as JobORM, Salary as SalaryORM, PrivateUser as PrivateUserORM

# Import CRUD helpers, often safer than writing raw SQL here
try:
    from backend.db_models.crud import sector as sector_crud
except Exception:
    # If package import path differs in your environment, fallback to direct import
    try:
        from db_models.crud import sector as sector_crud
    except Exception:
        sector_crud = None

# pandas is optional but recommended for reading Excel files
try:
    import pandas as pd
except Exception as e:
    pd = None


class ExcelJobImporter:
    def __init__(self, db: Session, standard_working_days: int = 22, standard_monthly_hours: int = 160):
        self.db = db
        self.standard_working_days = standard_working_days
        self.standard_monthly_hours = standard_monthly_hours
        self.logger = logging.getLogger(self.__class__.__name__)

        if pd is None:
            raise ImportError("pandas is required for ExcelJobImporter (pip3 install pandas openpyxl)")

    def read_excel(self, path_or_buffer) -> "pd.DataFrame":
        """Read an Excel file (or buffer) into a normalized DataFrame.

        Returns a DataFrame with normalized column names (strip/lower) and keeps original
        column names accessible via `.columns` in the returned DataFrame.
        """
        # Accept .csv paths and buffers too — prefer excel but fall back to csv
        try:
            # If a filepath string ends with .csv, read as CSV directly
            if isinstance(path_or_buffer, str) and path_or_buffer.strip().lower().endswith('.csv'):
                df = pd.read_csv(path_or_buffer)
            else:
                # Try Excel first
                try:
                    df = pd.read_excel(path_or_buffer, engine="openpyxl")
                except Exception:
                    # Fall back to CSV if Excel reader fails (handles file-like buffers too)
                    df = pd.read_csv(path_or_buffer)

            # Normalize column names: strip
            df.columns = [str(c).strip() for c in df.columns]

            # Forward-fill `Sector` values: many human-authored spreadsheets use
            # a top-level sector cell followed by many rows where the Sector
            # column is empty. Treat empty/dash/NaN as missing and propagate
            # the last-seen non-empty Sector downwards so each data row has
            # an explicit sector when applicable.
            try:
                sector_col = next((c for c in df.columns if str(c).strip().lower() == 'sector'), None)
                if sector_col is not None:
                    s = df[sector_col]
                    # mark placeholder-like values as NA
                    s_str = s.fillna('').astype(str).str.strip()
                    placeholder_mask = s_str.str.lower().isin(['', '-', 'nan', 'none'])
                    df.loc[placeholder_mask, sector_col] = pd.NA
                    # forward-fill missing sectors
                    df[sector_col] = df[sector_col].ffill()
            except Exception:
                # non-fatal if forward-fill cannot be performed
                pass
            return df
        except Exception as e:
            self.logger.error(f"failed to read spreadsheet ({path_or_buffer}): {e}")
            raise

    def _compute_monthly_from_row(self, row: Dict[str, Any]) -> Tuple[Optional[float], str]:
        """Compute monthly salary and return (monthly, source)"""
        def _clean_num(val: Any) -> Optional[float]:
            if val is None:
                return None
            # If it's already a number
            try:
                if isinstance(val, (int, float)):
                    return float(val)
            except Exception:
                pass

            # Convert to string and remove common thousands separators and quotes
            try:
                s = str(val).strip()
                # empty or dash means no value
                if s == "" or s == "-" or s.lower() in ("nan", "none"):
                    return None
                # Remove thousands separators (commas, non-breaking spaces) but keep decimal point
                s = s.replace('\u00A0', '')
                s = s.replace(',', '')
                s = s.replace('"', '')
                s = s.replace("'", '')
                s = s.replace(' ', '')
                return float(s)
            except Exception:
                return None

        # Try the obvious columns (prefer 2025 then 2024)
        for col in ("Monthly Basic 2025", "Monthly Basic 2024", "Monthly Basic 2025 "):
            if col in row and not pd.isna(row[col]):
                cleaned = _clean_num(row[col])
                if cleaned is not None:
                    return cleaned, col
        # Daily rate
        if "Daily Rate" in row and not pd.isna(row["Daily Rate"]):
            cleaned = _clean_num(row["Daily Rate"])
            if cleaned is not None:
                return cleaned * self.standard_working_days, "Daily Rate"
        # Hourly rate
        if "Hourly Rate" in row and not pd.isna(row.get("Hourly Rate")):
            cleaned = _clean_num(row.get("Hourly Rate"))
            if cleaned is not None:
                return cleaned * self.standard_monthly_hours, "Hourly Rate"
        return None, "none"

    def _nullify_sector_fields(self, row: Dict[str, Any]) -> Dict[str, Any]:
        """Ensure sector-related fields are None when empty/placeholder values are present.

        This normalizes values for the importer so downstream lookups receive explicit None
        instead of empty strings, dashes, or NaN-like strings.
        """
        keys = ["Sector", "sector", "Category of Employee", "category", "Grade / Service Details", "grade"]
        for k in keys:
            if k in row:
                v = row.get(k)
                try:
                    if pd.isna(v):
                        row[k] = None
                        continue
                except Exception:
                    # pd may not like some types; fall back to string check
                    pass
                if v is None:
                    row[k] = None
                    continue
                s = str(v).strip()
                if s == "" or s == "-" or s.lower() in ("nan", "none"):
                    row[k] = None
                else:
                    row[k] = s
        return row

    def _find_private_user(self, row: Dict[str, Any]) -> Optional[PrivateUserORM]:
        """Attempt to find a PrivateUser by private_user_id, email, passport, or name.
        The caller should ensure required fields exist in the DataFrame.
        """
        # By id
        if "private_user_id" in row and not pd.isna(row["private_user_id"]):
            try:
                uid = int(row["private_user_id"])
                user = self.db.query(PrivateUserORM).filter(PrivateUserORM.private_user_id == uid).first()
                if user:
                    return user
            except Exception:
                pass
        # By email
        if "email" in row and not pd.isna(row["email"]):
            try:
                user = self.db.query(PrivateUserORM).join(PrivateUserORM.user).filter(PrivateUserORM.user.has(email=row["email"])) .first()
                if user:
                    return user
            except Exception:
                pass
        # By passport number
        if "pass_port_number" in row and not pd.isna(row["pass_port_number"]):
            try:
                user = self.db.query(PrivateUserORM).filter(PrivateUserORM.pass_port_number == str(row["pass_port_number"]).strip()).first()
                if user:
                    return user
            except Exception:
                pass
        # By name (first + last)
        if "first_name" in row and "last_name" in row and not pd.isna(row["first_name"]) and not pd.isna(row["last_name"]):
            try:
                fn = str(row["first_name"]).strip()
                ln = str(row["last_name"]).strip()
                user = self.db.query(PrivateUserORM).filter(PrivateUserORM.first_name == fn, PrivateUserORM.last_name == ln).first()
                if user:
                    return user
            except Exception:
                pass
        return None

    def _lookup_sector_category(self, row: Dict[str, Any]):
        """Try to find an existing SectorCategory using available columns. Returns ORM or None.
        This uses the sector CRUD helpers if available; otherwise returns None.
        Expect that `sector_crud.get_categories_by_sector` and `get_all_sectors` exist.
        """
        if sector_crud is None:
            return None
        # Try to match sector by name first
        sector_name = row.get("Sector") or row.get("sector")
        category_name = row.get("Category of Employee") or row.get("category")
        grade = row.get("Grade / Service Details") or row.get("grade")

        if not sector_name:
            return None
        try:
            # Look up sector list and try a case-insensitive match
            sectors = sector_crud.get_all_sectors(self.db)
            matched = None
            for s in sectors:
                if getattr(s, 'name', '').strip().lower() == str(sector_name).strip().lower() or getattr(s, 'activity', '').strip().lower() == str(sector_name).strip().lower():
                    matched = s
                    break
            if not matched:
                return None
            # Now try to find a matching category for that sector
            cats = sector_crud.get_categories_by_sector(matched.sector_id, self.db)
            for c in cats:
                # Compare by category or grade or years_of_service approximate match
                if category_name and str(c.category).strip().lower() == str(category_name).strip().lower():
                    return c
                if grade and hasattr(c, 'grade') and str(c.grade).strip().lower() == str(grade).strip().lower():
                    return c
            # no close match
            return None
        except Exception as e:
            self.logger.warning(f"sector lookup failed: {e}")
            return None

    def import_from_excel(self, path_or_buffer, dry_run: bool = True) -> Dict[str, Any]:
        """Main import entry point.

        Reads the excel and for each row attempts to create a Job and Salary record (if a matching user is found).
        Returns a summary dict with counts and a list of failures.
        dry_run=True will not commit DB changes.
        """
        df = self.read_excel(path_or_buffer)
        summary = {
            "rows": len(df),
            "created_jobs": 0,
            "created_salaries": 0,
            "skipped": 0,
            "failed": [],
        }

        for idx, row in df.iterrows():
            try:
                row_dict = row.to_dict()
                # Normalize sector/category/grade fields: set to None when empty or placeholder
                row_dict = self._nullify_sector_fields(row_dict)
                monthly_salary, source = self._compute_monthly_from_row(row_dict)
                user = self._find_private_user(row_dict)

                if not user:
                    summary["skipped"] += 1
                    summary["failed"].append({"row": idx, "reason": "user_not_found", "data": row_dict})
                    continue

                # Create job (non-verbose minimal fields) and salary in a transaction
                try:
                    # Start savepoint/transaction per row
                    if dry_run:
                        # Just simulate mapping
                        summary["created_jobs"] += 0
                        if monthly_salary:
                            summary["created_salaries"] += 0
                        summary["failed"].append({"row": idx, "note": "dry_run mapping", "monthly": monthly_salary, "source": source})
                        continue

                    job_obj = JobORM(
                        private_user_id=user.private_user_id,
                        company_id=user.company_id,
                        job_title=row_dict.get("Category of Employee") or row_dict.get("job_title") or row_dict.get("role"),
                        employer_name=None,
                        employer_brn=None,
                        employer_email=None,
                        employer_phone=None,
                        employer_address=None,
                        first_date_of_employment=None,
                        work_start_time=None,
                        work_end_time=None,
                        work_days={},
                        has_contract=False,
                        has_permission_to_work=False,
                        work_permit_type=None,
                        working_on_tourist_visa=False,
                        is_salary_deducted=False,
                        reason_for_deduction=None,
                        is_accommodation_covered_by_employer=False,
                        is_accommodation_a_dormitory=False,
                        is_accommodation_decent=False,
                        is_passport_retained=False,
                        is_job_execution_same_as_description=False,
                        doubts_about_compensation=False,
                        created_at=datetime.utcnow(),
                    )
                    self.db.add(job_obj)
                    self.db.flush()
                    self.db.refresh(job_obj)
                    summary["created_jobs"] += 1

                    # Create salary record if monthly computed
                    if monthly_salary is not None:
                        salary_obj = SalaryORM(
                            job_id=job_obj.job_id,
                            monthly_hours=str(self.standard_monthly_hours),
                            break_in_minutes_per_day=0,
                            days_of_work_per_month=self.standard_working_days,
                            currency=row_dict.get("currency", "MUR"),
                            salary=str(monthly_salary),
                            revenue=str(monthly_salary),
                            created_at=datetime.utcnow(),
                        )
                        self.db.add(salary_obj)
                        self.db.flush()
                        self.db.refresh(salary_obj)
                        summary["created_salaries"] += 1

                    # commit per row
                    self.db.commit()
                except SQLAlchemyError as db_e:
                    self.db.rollback()
                    summary["failed"].append({"row": idx, "reason": "db_error", "error": str(db_e)})
                except Exception as ex:
                    self.db.rollback()
                    summary["failed"].append({"row": idx, "reason": "unexpected", "error": str(ex)})

            except Exception as e:
                summary["failed"].append({"row": idx, "reason": "read_row_failure", "error": str(e)})

        return summary


# Example usage (not executed here):
# from sqlalchemy import create_engine
# from sqlalchemy.orm import sessionmaker
# engine = create_engine(DB_URL)
# SessionLocal = sessionmaker(bind=engine)
# db = SessionLocal()
# importer = ExcelJobImporter(db)
# result = importer.import_from_excel('sector_rates.xlsx', dry_run=True)
# print(result)
