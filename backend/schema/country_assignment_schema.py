"""Pydantic schemas for effective-dated employee country assignments."""

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field, model_validator


class CountryAssignmentCreate(BaseModel):
    country_code: str = Field(min_length=2, max_length=2)
    reason: str = Field(pattern="^(mission|transfer_same_company|transfer_new_company)$")
    effective_from: date
    effective_to: Optional[date] = None
    new_company_id: Optional[int] = None
    notes: Optional[str] = None

    @model_validator(mode="after")
    def _validate(self) -> "CountryAssignmentCreate":
        if self.effective_to is not None and self.effective_to < self.effective_from:
            raise ValueError("effective_to must be >= effective_from")
        if self.reason == "transfer_new_company" and self.new_company_id is None:
            raise ValueError("new_company_id is required when reason='transfer_new_company'")
        if self.reason != "transfer_new_company" and self.new_company_id is not None:
            raise ValueError("new_company_id is only allowed when reason='transfer_new_company'")
        return self


class CountryAssignmentEnd(BaseModel):
    """Close an open assignment at a specific date."""
    effective_to: date


class CountryAssignmentRead(BaseModel):
    id: int
    private_user_id: int
    country_code: str
    reason: str
    effective_from: date
    effective_to: Optional[date]
    new_company_id: Optional[int]
    notes: Optional[str]
    created_by_user_id: Optional[int]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]
    archived_at: Optional[datetime]
    # Convenience, resolved at serialization time by the API:
    country_name: Optional[str] = None
    country_currency: Optional[str] = None

    class Config:
        from_attributes = True
