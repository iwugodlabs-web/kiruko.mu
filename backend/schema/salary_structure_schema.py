"""Pydantic schemas for the salary configuration redesign (Module 5)."""

from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Salary components — the catalog
# ---------------------------------------------------------------------------


class SalaryComponentBase(BaseModel):
    code: str = Field(max_length=40)
    label: str = Field(max_length=100)
    kind: str  # 'earning' | 'deduction'
    category: str = "earning.other"
    is_basic: bool = False
    is_taxable: bool = True
    is_recurring: bool = True
    is_one_off: bool = False
    prorate_on_partial_month: bool = True
    # 'monthly' | 'daily' — daily components store a per-day rate, scaled by
    # working days in the period at resolution time.
    frequency: str = "monthly"
    # 'amount' | 'percent_of_basic' — percent_of_basic stores percentage
    # POINTS (5.00 = 5%), applied against the structure's BASIC.
    value_type: str = "amount"
    statutory_base_codes: List[str] = Field(default_factory=list)
    country_default_code: Optional[str] = Field(default=None, min_length=2, max_length=2)


class SalaryComponentCreate(SalaryComponentBase):
    pass


class SalaryComponentRead(SalaryComponentBase):
    id: int
    company_id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Salary structures + lines
# ---------------------------------------------------------------------------


class SalaryStructureLineBase(BaseModel):
    component_id: int
    amount: Optional[Decimal] = None
    formula_expression: Optional[str] = None
    order_index: int = 0


class SalaryStructureLineCreate(SalaryStructureLineBase):
    pass


class SalaryStructureLineRead(SalaryStructureLineBase):
    id: int
    structure_id: int
    component_code: Optional[str] = None  # Populated by API for convenience

    class Config:
        from_attributes = True


class SalaryStructureBase(BaseModel):
    name: str = Field(max_length=100)
    description: Optional[str] = None
    is_default: bool = False
    # M2: scoping (auto-suggest hooks)
    default_for_department_id: Optional[int] = None
    default_for_role: Optional[str] = Field(default=None, max_length=40)
    default_for_sector_grade_id: Optional[int] = None


class SalaryStructureCreate(SalaryStructureBase):
    lines: List[SalaryStructureLineCreate] = []


class SalaryStructureRead(SalaryStructureBase):
    id: int
    company_id: int
    created_at: Optional[datetime] = None
    archived_at: Optional[datetime] = None
    lines: List[SalaryStructureLineRead] = []

    class Config:
        from_attributes = True


class SalaryStructurePatch(BaseModel):
    """Partial update for a salary structure's metadata.

    Only the included keys are mutated. Setting a scoping field to None
    clears it (use ``exclude_unset=True`` semantics on read). Lines are
    edited via the dedicated line endpoints.
    """
    name: Optional[str] = Field(default=None, max_length=100)
    description: Optional[str] = None
    is_default: Optional[bool] = None
    default_for_department_id: Optional[int] = None
    default_for_role: Optional[str] = Field(default=None, max_length=40)
    default_for_sector_grade_id: Optional[int] = None


class SalaryStructureLinePatch(BaseModel):
    """Partial update for a single line. ``component_id`` is immutable —
    delete and re-create the line if you need to change the component."""
    amount: Optional[Decimal] = None
    formula_expression: Optional[str] = None
    order_index: Optional[int] = None


class SalaryStructureUsage(BaseModel):
    """Returned to the UI before destructive structure edits so admins can
    see how many employees are affected. Existing assignments keep their
    snapshot — see ``archived_at`` docstring on the model."""
    structure_id: int
    active_assignment_count: int
    total_assignment_count: int
    sample_employee_names: List[str] = []


# ---------------------------------------------------------------------------
# Employee assignments + overrides
# ---------------------------------------------------------------------------


class EmployeeSalaryOverrideBase(BaseModel):
    component_id: int
    amount: Optional[Decimal] = None
    formula_expression: Optional[str] = None
    notes: Optional[str] = None


class EmployeeSalaryOverrideCreate(EmployeeSalaryOverrideBase):
    pass


class EmployeeSalaryOverrideRead(EmployeeSalaryOverrideBase):
    id: int
    assignment_id: int

    class Config:
        from_attributes = True


class EmployeeSalaryAssignmentCreate(BaseModel):
    private_user_id: int
    structure_id: Optional[int] = None
    currency: str = "MUR"
    effective_from: date
    notes: Optional[str] = None
    overrides: List[EmployeeSalaryOverrideCreate] = []


class EmployeeSalaryAssignmentRead(BaseModel):
    id: int
    private_user_id: int
    structure_id: Optional[int]
    currency: str
    effective_from: date
    effective_to: Optional[date]
    notes: Optional[str]
    created_by_user_id: Optional[int]
    created_at: Optional[datetime]
    overrides: List[EmployeeSalaryOverrideRead] = []

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Resolver output — what payroll_engine consumes.
# ---------------------------------------------------------------------------


class ResolvedComponent(BaseModel):
    """One line in an employee's resolved salary for a period."""
    component_id: int
    code: str
    label: str
    kind: str  # earning | deduction
    category: str
    amount: Decimal
    is_taxable: bool
    is_basic: bool
    source: str  # 'structure' | 'override' | 'one_off' | 'bonus' | 'overtime'
    # M4: list of statutory deduction codes this component contributes to.
    # Built from SalaryComponent.statutory_base_codes with legacy inference
    # fallback (is_basic → all; non-basic taxable → PAYE+CSG; etc.).
    statutory_base_codes: List[str] = Field(default_factory=list)
    # 'monthly' | 'daily'. Amount is still the raw per-unit value at this
    # point — daily scaling (× working days) happens in payroll_engine,
    # which has the country/period context this resolver doesn't.
    frequency: str = "monthly"
    value_type: str = "amount"  # 'amount' | 'percent_of_basic' — already applied to `amount` above.
    prorate_on_partial_month: bool = True
    # Overtime engine audit drill-down (multiplier, hours, source clock-ins,
    # weekly accumulator at emit). Only set for source='overtime' components.
    meta: Optional[dict] = None


class ResolvedSalary(BaseModel):
    private_user_id: int
    period_start: date
    assignment_id: Optional[int]
    structure_id: Optional[int]
    currency: str
    components: List[ResolvedComponent]
