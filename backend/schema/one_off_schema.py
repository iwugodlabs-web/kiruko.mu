"""Pydantic schemas for one-off allowances (Module 8)."""

from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field


class OneOffAllowanceCreate(BaseModel):
    private_user_id: int
    component_id: int
    amount: Decimal
    payable_in_year: int
    payable_in_month: int = Field(ge=1, le=12)
    notes: Optional[str] = None


class AdditionalRemunerationCreate(BaseModel):
    """#18 — grant additional remuneration for additional duty.

    A thin wrapper over the one-off allowance: the caller doesn't supply a
    component_id — the server ensures the company's canonical "Additional duty"
    earning component exists (taxable, non-basic) and books the one-off against
    it. This keeps additional duty as ONE component category across the company
    instead of ad-hoc free-text lines.
    """
    amount: Decimal = Field(gt=0)
    payable_in_year: int
    payable_in_month: int = Field(ge=1, le=12)
    notes: Optional[str] = None


class AdHocDeductionCreate(BaseModel):
    """Grant an ad-hoc deduction (mirrors AdditionalRemunerationCreate).

    No component_id — the server ensures the company's canonical "Ad-hoc
    deduction" component exists and books the one-off against it. Notes are
    required here (unlike the generic one-off) since the component label
    stays generic on purpose; the note is what tells the employee, and
    whoever reviews the payslip, why pay was docked.
    """
    amount: Decimal = Field(gt=0)
    payable_in_year: int
    payable_in_month: int = Field(ge=1, le=12)
    notes: str = Field(min_length=1)


class OneOffAllowanceRead(BaseModel):
    id: int
    private_user_id: int
    component_id: int
    component_code: Optional[str] = None
    component_label: Optional[str] = None
    amount: Decimal
    payable_in_year: int
    payable_in_month: int
    applied_to_payslip_id: Optional[int] = None
    notes: Optional[str] = None
    created_by_user_id: Optional[int] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True
