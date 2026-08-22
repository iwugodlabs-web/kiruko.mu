from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class CreateDepartment(BaseModel):
    name: str


class ShowDepartment(BaseModel):
    department_id: int
    company_id: int
    name: str
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}
