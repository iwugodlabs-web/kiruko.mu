from pydantic import BaseModel, Field, model_validator, field_validator
from typing import Dict, List, Optional
from datetime import date, datetime
from decimal import Decimal


class CountrySchema(BaseModel):
    code: str
    name: str
    currency: str
    locale: Optional[str] = None
    fiscal_year_start: Optional[str] = None
    date_format: Optional[str] = None
    min_wage: Optional[float] = None
    is_active: bool = True

    class Config:
        from_attributes = True

class Sector(BaseModel):
    id: int
    activity: str
    # ISO 3166-1 alpha-2, e.g. 'MU', 'ZA', 'KE'
    country_code: str = "MU"
    # ISO 4217 currency code, e.g. 'MUR', 'ZAR', 'KES'
    currency: str = "MUR"

    class Config:
        from_attributes = True


class SectorCategory(BaseModel):
    id: int
    sector_id: int
    name: str
    currency: str = "MUR"

    class Config:
        from_attributes = True


class SectorGrade(BaseModel):
    id: int
    sector_id: int
    sector_category_id: int
    grade: Optional[str] = None

    class Config:
        from_attributes = True


class CreateSector(BaseModel):
    activity: str
    description: Optional[str] = None
    # ISO 3166-1 alpha-2 country code
    country_code: str = "MU"
    # ISO 4217 currency code
    currency: str = "MUR"

    class Config:
        from_attributes = True

class CreateSectorCategory(BaseModel):
    sector_id: int
    name: str
    currency: str = "MUR"

    class Config:
        from_attributes = True

class CreateSectorGrade(BaseModel):
    sector_id: int
    sector_category_id: int
    grade: Optional[str] = None

    class Config:
        from_attributes = True


class UpdateSector(BaseModel):
    activity: Optional[str] = None
    description: Optional[str] = None
    currency: Optional[str] = None


class UpdateSectorCategory(BaseModel):
    name: Optional[str] = None
    currency: Optional[str] = None


class UpdateSectorGrade(BaseModel):
    grade: Optional[str] = None


class SectorCategorySalary(BaseModel):
    id: int
    sector_category_id: int
    sector_grade_id: Optional[int] = None
    min_years_of_service: Optional[int] = None
    max_years_of_service: Optional[int] = None
    # Date from which this rate is effective. None = always valid.
    # Calculator: WHERE effective_from <= today ORDER BY effective_from DESC
    effective_from: Optional[date] = None
    basic_monthly_salary: Optional[float] = None
    basic_daily_salary: Optional[float] = None
    hourly_rate: Optional[float] = None
    productivity: Optional[float] = None
    unit: Optional[str] = None
    notes: Optional[str] = None
    voided_at: Optional[datetime] = None
    voided_by_user_id: Optional[int] = None
    voided_reason: Optional[str] = None

    class Config:
        from_attributes = True


# Plan C2 — guardrail upper bound. 10M of any major currency / month is
# well past any legitimate sector rate; defends against typo'd zeros.
_RATE_MAX = Decimal('10000000')


class CreateSectorCategorySalary(BaseModel):
    sector_category_id: int
    sector_grade_id: Optional[int] = None
    min_years_of_service: Optional[int] = None
    max_years_of_service: Optional[int] = None
    effective_from: Optional[date] = None
    basic_monthly_salary: Optional[Decimal] = Field(default=None, gt=0, lt=_RATE_MAX)
    basic_daily_salary: Optional[Decimal] = Field(default=None, gt=0, lt=_RATE_MAX)
    hourly_rate: Optional[Decimal] = Field(default=None, gt=0, lt=_RATE_MAX)
    productivity: Optional[Decimal] = Field(default=None, gt=0, lt=_RATE_MAX)
    unit: Optional[str] = None
    notes: Optional[str] = None

    @model_validator(mode='after')
    def _require_one_rate(self):
        """Plan C1 — refuse rows with no usable rate. The append-only rule
        would otherwise trap operators behind a void-and-reappend cycle."""
        if not any([
            self.basic_monthly_salary,
            self.basic_daily_salary,
            self.hourly_rate,
            self.productivity,
        ]):
            raise ValueError(
                "At least one rate (basic_monthly_salary, basic_daily_salary, "
                "hourly_rate, or productivity) must be > 0."
            )
        return self

    class Config:
        from_attributes = True


class VoidSalaryRequest(BaseModel):
    """Plan Phase 3.A — body of POST /sector/category/salary/{id}/void.
    Reason is required and audited. The endpoint never touches rate or
    effective_from columns, preserving the append-only legal record."""
    reason: str = Field(min_length=5, max_length=500)

class ShowSector(Sector):
    id: int
    activity: str
    categories: Optional[List[SectorCategory]] = None

    class Config:
        from_attributes = True


class ShowSectorCategory(SectorCategory):
    id: int
    sector_id: int
    grades: Optional[List["ShowSectorGrade"]] = None
    salary_ranges: Optional[List[SectorCategorySalary]] = None

    class Config:
        from_attributes = True


class ShowSectorGrade(SectorGrade):
    id: int
    sector_id: int
    sector_category_id: int

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Salary history / year-over-year comparison
# ---------------------------------------------------------------------------

class SalaryHistoryRow(BaseModel):
    """One salary tier for a specific effective year."""
    id: int
    min_years_of_service: Optional[int] = None
    max_years_of_service: Optional[int] = None
    grade: Optional[str] = None
    basic_monthly_salary: Optional[float] = None
    basic_daily_salary: Optional[float] = None
    hourly_rate: Optional[float] = None
    productivity: Optional[float] = None
    unit: Optional[str] = None
    notes: Optional[str] = None
    voided_at: Optional[datetime] = None
    voided_by_user_id: Optional[int] = None
    voided_reason: Optional[str] = None

    class Config:
        from_attributes = True


class SalaryHistoryYear(BaseModel):
    """All salary tiers for one effective year."""
    effective_from: date
    rows: List[SalaryHistoryRow]


class SalaryHistoryResponse(BaseModel):
    """Year-over-year salary history for a single category."""
    category_id: int
    category_name: str
    sector_name: str
    country_code: str
    currency: str
    # Keys are ISO date strings (YYYY-MM-DD), ordered oldest → newest
    years: List[SalaryHistoryYear]