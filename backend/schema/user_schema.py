# --- Purchase Pydantic Model ---
from pydantic import BaseModel
from typing import Optional, Any
from datetime import datetime
from schema.job_schema import ShowJob, ShowProfileJob, ShowTimeLog, TimeLog
from schema.department_schema import ShowDepartment
from pydantic import BaseModel, EmailStr, Field, model_validator
from datetime import date, datetime, time as dt_time
from decimal import Decimal
from typing import Dict, Optional, Union, List, Any
from enum import Enum

class UserType(str, Enum):
    private = "private"
    company = "company"
class User(BaseModel):
    user_type: UserType
    email: EmailStr
    phone: Optional[str] = None
    user_name:Optional[str] = None
    # Never serialize the bcrypt hash to clients. exclude=True keeps the field
    # available for validation/internal reads but drops it from every response
    # (login, /user/me, /users/company, …) that uses this model or showUser.
    password_hash: Optional[str] = Field(default=None, exclude=True)
    onboard_complete: Optional[bool] = False
    company_onboarding_status: Optional[str] = "pending"
    preferred_locale: Optional[str] = None  # M18 — UI locale (en | fr | mg)
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class  PrivateUser(BaseModel):
    user_id: int
    first_name: str
    last_name: str
    phone: Optional[str] = None
    gender: Optional[str] = None
    date_of_birth: Optional[date]
    pass_port_number: Optional[str]
    company_id: Optional[str] = None
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class Company(BaseModel):
    company_name: str
    email: EmailStr
    brn: str
    address: str
    phone: Optional[str] = None
    # Which country this company operates in — determines tax/statutory
    # rules, timezone, currency. Optional here for backward compatibility
    # with app builds that don't send it yet; register_user() defaults to
    # 'MU' when omitted. Immutable after creation (see CompanyUpdate).
    country_code: Optional[str] = None
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}
class CreateCompanySignup(BaseModel):
    company_name: str
    brn: str
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class CreateUser(User):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    company_data: Optional[CreateCompanySignup] = None

class Notification(BaseModel):
    notification_id: Optional[int] = None
    user_id: int
    title: str
    message: str
    type: str
    notification_type: Optional[str] = None
    is_read: bool = False
    meta: Optional[Dict[str, Any]] = None
    related_entity_id: Optional[int] = None
    created_at: Optional[datetime] = None
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

    @model_validator(mode='after')
    def populate_computed_fields(self) -> 'Notification':
        self.notification_type = self.type
        if self.meta and isinstance(self.meta, dict):
            self.related_entity_id = self.meta.get('timelog_id')
        return self

# Basic schemas without circular references
class ShowPrivateUserBasic(BaseModel):
    private_user_id: int
    user_id: int
    first_name: str
    last_name: str
    phone: Optional[str] = None
    gender: Optional[str] = None
    date_of_birth: Optional[date] = None
    pass_port_number: Optional[str] = None
    company_id: Optional[int] = None
    department_id: Optional[int] = None
    # Branch/site this employee is assigned to (mirrored onto their payslips).
    home_geofence_id: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class ShowCompanyBasic(BaseModel):
    company_id: int
    # Company.user_id and Company.email are both nullable columns — keep these
    # Optional on the OUTPUT schema so a company with a detached owner or no
    # email doesn't 500 the whole response when nested under an employee.
    user_id: Optional[int] = None
    company_name: str
    email: Optional[str] = None  # str not EmailStr AND optional — see showUser (avoid serialize-time 500s)
    brn: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    vat: Optional[str] = None
    # Surfaced so the web settings toggle reflects the saved value on reload.
    require_approved_clockins_for_payroll: Optional[bool] = False
    default_max_shift_hours: Optional[float] = None
    # The company's actual operating currency (derived from Company.currency,
    # itself derived from country_code) — was previously not on this schema
    # at all, so mobile/web had no reliable source for "what currency are
    # these salary figures in" beyond hardcoding MUR or using a user's
    # unrelated personal display-currency preference.
    country_code: Optional[str] = None
    currency: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class showUser(User):
    # OUTPUT schema: email is `Optional[str]`, NOT EmailStr — and NOT a required
    # `str`. Two ways a required/validated email 500s the WHOLE company list:
    #   1. Format validation on an anonymized sentinel (`deleted+<id>@…invalid`).
    #   2. A NULL email (the `users.email` column is nullable — e.g. bulk-imported
    #      staff created without an address) failing `str` validation.
    # Either single bad record tanks the entire List[showUser] response with a
    # 500. Email format is enforced on INPUT schemas (register/login/invite).
    email: Optional[str] = None
    user_id: int
    user_verified: Optional[bool] = False
    user_enabled: Optional[bool] = True
    company: Optional[ShowCompanyBasic] = None
    private_user: Optional['ShowPrivateUser'] = None
    roles: Optional[List[str]] = None
    # Phase 2 — union of permissions across all platform roles this user
    # holds. Empty for non-platform users. Used by the web Sidebar to gate
    # admin navigation entries.
    platform_permissions: Optional[List[str]] = None
    # Company RBAC — union of permissions across the company roles this user
    # holds (resolved from CompanyRole.permissions). Drives fine-grained web
    # navigation + access for delegated management-role employees.
    company_permissions: Optional[List[str]] = None
    company_roles: Optional[List[str]] = None
    # Mirror of the backend COMPANY_RBAC_ENABLED flag so the web applies the
    # same behavior (admit management-role employees) only when it's on.
    company_rbac_enabled: Optional[bool] = False
    is_superuser: Optional[bool] = False
    is_company_admin: Optional[bool] = False
    verification_note: Optional[str] = None
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class ShowPrivateUser(PrivateUser):
    private_user_id: int
    user_id: int
    first_name: str
    last_name: str
    phone: Optional[str] = None
    gender: Optional[str] = None
    date_of_birth: Optional[date] = None
    pass_port_number: Optional[str] = None
    company_id: Optional[int] = None
    department_id: Optional[int] = None
    # Branch/site this employee is assigned to (mirrored onto their payslips).
    home_geofence_id: Optional[int] = None
    # Resolved site name (survives site deletion). Backed by the ORM property.
    home_site_name: Optional[str] = None
    # Short human-readable code (e.g. 'JS4821') shown on the Employees list +
    # Clock-in review screen instead of the raw private_user_id.
    employee_code: Optional[str] = None
    department: Optional[ShowDepartment] = None
    # A delegated role-holder (HR etc.) has no User.company — their company lives
    # here via PrivateUser.company. Surface it (lightweight, no nested users) so the
    # web/mobile dashboard can show which company a representative is acting for.
    company: Optional[ShowCompanyBasic] = None
    # Self-reported country (independent users only — see core/model.py:113-118).
    # A company-affiliated employee's own value here is never consulted for
    # anything (effective_country_code ignores it), so the mobile settings
    # screen only offers this field to independent users.
    country_code: Optional[str] = None
    # Computed: company's country for an employee, else country_code, else a
    # phone-calling-code inference, else 'MU' (core/model.py:149-176). Lets
    # mobile show "what's actually in effect" without re-deriving the same
    # precedence client-side.
    effective_country_code: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    jobs: Optional[List[ShowJob]] = None
    # NOTE: time_logs/leaves are intentionally NOT serialized here. They are
    # lazy ORM relationships — including them made every employee-list response
    # (showUser → private_user) pull each worker's FULL attendance history at
    # dump time (N+1 + ~170 KB/employee for a year of clock-ins → multi-second
    # responses that tripped the client 15 s timeout). Dedicated endpoints serve
    # timelogs and leaves; the employee list never needs them inline.
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class MePrivateUser(BaseModel):
    """Slim `private_user` for GET /user/me — identical to `ShowPrivateUser`
    EXCEPT it omits `jobs` (and the nested salaries, immigration/compliance
    flags, and employer PII that `jobs` drags in).

    /user/me is polled constantly (mobile re-evaluates navigation on it, web
    calls it on every load + refreshUser), so shipping the full job history +
    salary + compliance record on every tick is both a payload problem and an
    unnecessary PII surface. None of /user/me's consumers read `jobs` — job
    detail comes from dedicated endpoints (mobile `getJobById`, the web
    employee-detail page). Omitting it also avoids a lazy-load of the job
    history on every session tick (same rationale as `ShowPrivateUser` dropping
    `time_logs`/`leaves`).

    Keep the remaining fields in sync with `ShowPrivateUser`.
    """
    private_user_id: int
    user_id: int
    first_name: str
    last_name: str
    phone: Optional[str] = None
    gender: Optional[str] = None
    date_of_birth: Optional[date] = None
    pass_port_number: Optional[str] = None
    company_id: Optional[int] = None
    department_id: Optional[int] = None
    home_geofence_id: Optional[int] = None
    home_site_name: Optional[str] = None
    employee_code: Optional[str] = None
    department: Optional[ShowDepartment] = None
    company: Optional[ShowCompanyBasic] = None
    country_code: Optional[str] = None
    effective_country_code: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}


class MeResponse(showUser):
    """Slim response for GET /user/me — same shape as `showUser` but with
    `private_user` serialized as `MePrivateUser` (no `jobs`). Used ONLY by
    /user/me; login and employee-list endpoints keep the full `showUser`.
    """
    private_user: Optional[MePrivateUser] = None

class ShowCompany(Company):
    company_id: int
    user_id: int
    company_name: str
    email: str  # OUTPUT: str not EmailStr — see showUser (avoid serialize-time 500s)
    brn: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    private_users: Optional[List['ShowPrivateUser']] = None  
    jobs: Optional[List['Job']] = None 
    # Removed circular reference to user
    time_logs: Optional[List['TimeLog']] = None
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class CreatePrivateUser(PrivateUser):
    pass
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class UpdatePrivateUser(PrivateUser):
    pass
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class CreateCompany(Company):
    pass
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}


class CompanySignupRequest(BaseModel):
    user_type: UserType
    first_name: str
    last_name: Optional[str] = None
    email: EmailStr
    phone: str
    password_hash: str
    company_data: CreateCompany
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class UpdateUser(BaseModel):
    gender: Optional[str] = None
    date_of_birth: Optional[date] = None
    pass_port_number: Optional[str] = None
    onboard_complete: Optional[bool] = None
    company_onboarding_status: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    preferred_locale: Optional[str] = None  # M18 — 'en' | 'fr' | 'mg'
    # kiosk v1.6 — per-employee override for the missed-clockout cron's
    # max-shift fallback chain (Job → PrivateUser → Company → 12h, see
    # services/time_log_service.py::resolve_max_shift_hours). NULL means
    # "fall through to the next level". CRUD's update_user (db_models/
    # crud/user.py) auto-applies via hasattr since the column lives on
    # PrivateUser (added in M26 migration).
    max_shift_hours: Optional[float] = None
    # Only meaningful for independent users (no company_id) — a
    # company-affiliated employee's country always comes from their
    # employer and PrivateUser.effective_country_code ignores this column
    # entirely for them (core/model.py:149-176). Validated against active
    # Country rows in api/v1/user.py's update_user_profile, same rigor as
    # company signup — auto-applied via the same hasattr mechanism above.
    country_code: Optional[str] = None
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class Job(BaseModel):
    private_user_id: int
    company_id: Optional[int] = None
    job_title: str
    employer_name:str
    employer_brn:str
    employer_email: Optional[str]  # OUTPUT: str not EmailStr (avoid serialize-time 500s)
    employer_phone: Optional[str]
    employer_address: Optional[str]
    first_date_of_employment: Optional[date] = None
    work_start_time: Optional[dt_time] = None
    work_end_time: Optional[dt_time] = None
    work_days: Optional[Dict[str, str]] = None
    has_contract: bool
    has_permission_to_work:bool
    work_permit_type: Optional[str] = None
    working_on_tourist_visa: bool
    is_salary_deducted: bool
    reason_for_deduction: Optional[Dict[str, bool]] = None
    is_accommodation_covered_by_employer: bool
    is_accommodation_a_dormitory: bool
    is_accommodation_decent: bool
    is_passport_retained: bool
    is_job_execution_same_as_description:bool
    doubts_about_compensation: Optional[bool] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class Salary(BaseModel) :
    private_user_id: int  
    job_id:int
    monthly_hours: str
    break_in_minutes_per_day: int
    days_of_work_per_month: int
    revenue: Optional[Decimal] = None
    allowance: Optional[Decimal] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}
# Main onboarding schema
class OnboardJob(BaseModel):
    user_data: UpdateUser
    job_data: Job
    salary_data: Salary
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class UserLoginModel(BaseModel):
    # `email` kept for back-compat with mobile / web clients that pre-date
    # the phone-or-email login addition. New clients send `identifier`
    # which accepts either an email or a phone; the server detects which
    # by presence of `@`. See core/phone_utils.looks_like_phone.
    email: Optional[str] = Field(default=None, max_length=40)
    identifier: Optional[str] = Field(default=None, max_length=40)
    password: str = Field(min_length=6)
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class RefreshToken(BaseModel):
    refresh_token: Optional[str] = None
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}



class UserRight(BaseModel):
    private_user_id: int
    title: str
    category: str
    issue_description: str
    contact_method: str
    previous_occurence: Optional[bool] = None
    date_of_occurrence: Optional[date] = None
    time: Optional[dt_time] = None
    occurrence_description: Optional[str] = None
    urgency_level: str
    resolution_method: str
    accept_terms_and_conditions: bool
    acknowledge_information: bool
    agreed_to_be_contacted: bool
    status: str
    expected_outcome: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    attachment_url: Optional[str] = None
    # Plan Phase 11 — Step 4 (external channel) + Step 6 (anonymity).
    # `channel`: 'internal' (default; employer sees full detail) | 'external'
    # (employer NEVER sees the content; routes to compliance officers).
    # `is_anonymous`: when True, company-side reads mask the employee's name
    # and user_id even on internal-channel reports.
    channel: Optional[str] = "internal"
    is_anonymous: Optional[bool] = False
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}



class Transfer(BaseModel):
    transfer_id: int
    private_user_id: int
    amount: float
    currency: str
    from_user: Optional[str] = None
    to_user: Optional[str] = None
    status: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class CreateTransfer(BaseModel):
    private_user_id: int
    amount: float
    currency: str
    from_user: Optional[str] = None
    to_user: Optional[str] = None
    status: str
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class Purchase(BaseModel):
    purchase_id: int
    private_user_id: int
    description: str
    amount: float
    currency: str = "MUR"
    merchant: Optional[str] = None
    category: Optional[str] = None
    payment_method: Optional[str] = None
    items: Optional[List[Dict[str, Union[str, float, int]]]] = None
    receipt_image_url: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class CreatePurchase(BaseModel):
    private_user_id: int
    description: str
    amount: float
    currency: str = "MUR"
    merchant: Optional[str] = None
    category: Optional[str] = None
    payment_method: Optional[str] = None
    items: Optional[List[Dict[str, Union[str, float, int]]]] = None
    receipt_image_url: Optional[str] = None
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class Subscription(BaseModel):
    subscription_id: int
    private_user_id: int
    description: str
    amount: float
    currency: str = "MUR"
    subscription_date: Optional[date] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class CreateSubscription(BaseModel):
    private_user_id: int
    description: str
    amount: float
    currency: str = "MUR"
    subscription_date: Optional[date] = None
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class Loan(BaseModel):
    loan_id: int
    private_user_id: int
    description: str
    amount: float
    currency: str = "MUR"
    start_date: Optional[date] = None
    due_date: Optional[date] = None
    status: Optional[str] = "active"
    repaid_amount: Optional[float] = 0.0
    is_recurrent: Optional[bool] = False
    duration_months: Optional[int] = None
    payment_frequency: Optional[str] = None
    interest_rate: Optional[float] = None
    lender_name: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class CreateLoan(BaseModel):
    private_user_id: int
    description: str
    amount: float
    currency: str = "MUR"
    start_date: Optional[date] = None
    due_date: Optional[date] = None
    status: Optional[str] = "active"
    repaid_amount: Optional[float] = 0.0
    is_recurrent: Optional[bool] = False
    duration_months: Optional[int] = None
    payment_frequency: Optional[str] = None
    interest_rate: Optional[float] = None
    lender_name: Optional[str] = None
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class LoanWithRepayments(Loan):
    repayments: Optional[List['Repayment']] = None

class Repayment(BaseModel):
    repayment_id: Optional[int] = None
    loan_id: int
    amount: float
    payment_date: date
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class Leave(BaseModel):
    private_user_id: int
    leave_type: str
    start_date: date
    end_date: date
    status: str
    notes: Optional[str] = None
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class CreateLeave(Leave):
    pass

class ShowLeave(Leave):
    leave_id: int
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class Rent(BaseModel):
    rent_id: int
    private_user_id: int
    description: str
    amount: float
    currency: str = "MUR"
    landlord_name: Optional[str] = None
    property_address: Optional[str] = None
    due_day: Optional[int] = None
    is_recurring: Optional[bool] = True
    status: Optional[str] = "active"
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class CreateRent(BaseModel):
    private_user_id: int
    description: str
    amount: float
    currency: str = "MUR"
    landlord_name: Optional[str] = None
    property_address: Optional[str] = None
    due_day: Optional[int] = None
    is_recurring: Optional[bool] = True
    status: Optional[str] = "active"
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class LeaveQuota(BaseModel):
    quota_id: int
    private_user_id: int
    leave_type: str
    total_days: int
    used_days: int = 0
    year: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class CreateLeaveQuota(BaseModel):
    private_user_id: int
    leave_type: str
    total_days: int
    used_days: int = 0
    year: int
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class BudgetGoal(BaseModel):
    budget_id: int
    private_user_id: int
    category: str
    monthly_limit: float
    currency: str = "MUR"
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class CreateBudgetGoal(BaseModel):
    private_user_id: int
    category: str
    monthly_limit: float
    currency: str = "MUR"
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class PublicHolidaySchema(BaseModel):
    holiday_id: int
    country_code: str
    name: str
    date: date
    year: int
    is_recurring: Optional[bool] = False
    created_at: Optional[datetime] = None
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class CreatePublicHoliday(BaseModel):
    country_code: str
    name: str
    date: date
    year: int
    is_recurring: Optional[bool] = False
    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

class FinancialsData(BaseModel):
    transfers: List[Transfer]
    purchases: List[Purchase]
    subscriptions: List[Subscription]
    loans: List[LoanWithRepayments]
    rents: List[Rent] = []

    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

showUser.model_rebuild()
ShowPrivateUser.model_rebuild()
ShowCompany.model_rebuild()
LoanWithRepayments.model_rebuild()
ShowLeave.model_rebuild()
