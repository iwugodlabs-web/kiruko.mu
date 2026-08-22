"""Pydantic schemas for the leave_types catalog (Module 1)."""

from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field


class LeaveTypeBase(BaseModel):
    code: str = Field(max_length=40)
    label: str = Field(max_length=100)
    is_paid: bool = True
    is_statutory: bool = False
    accrual_method: str = "annual"  # monthly | annual | tenure_based
    accrual_rate_days_per_month: Optional[Decimal] = None
    days_per_year: Optional[int] = None
    max_balance: Optional[int] = None
    carry_forward_max: Optional[int] = None
    encashable: bool = False
    min_service_months: int = 0
    requires_doc: bool = False
    is_active: bool = True


class LeaveTypeCreate(LeaveTypeBase):
    pass


class LeaveTypeUpdate(BaseModel):
    label: Optional[str] = None
    is_paid: Optional[bool] = None
    accrual_method: Optional[str] = None
    accrual_rate_days_per_month: Optional[Decimal] = None
    days_per_year: Optional[int] = None
    max_balance: Optional[int] = None
    carry_forward_max: Optional[int] = None
    encashable: Optional[bool] = None
    min_service_months: Optional[int] = None
    requires_doc: Optional[bool] = None
    is_active: Optional[bool] = None


class LeaveTypeRead(LeaveTypeBase):
    id: int
    company_id: int
    country_default_id: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SeedFromCountryReport(BaseModel):
    """Result of seeding a company's leave_types from country_leave_defaults."""
    company_id: int
    country_code: str
    created: list[str] = []
    updated: list[str] = []
    skipped: list[str] = []
