from pydantic import BaseModel, Field
from datetime import date, datetime, time
from decimal import Decimal
from typing import Dict, Optional, Union, List, Any

   
class Job(BaseModel) : 
    private_user_id: int
    company_id: Optional[int] = None
    job_title: str
    employer_name:str
    employer_brn:str
    employer_email: Optional[str]  # OUTPUT: str not EmailStr (a deleted/sentinel email must not 500 serialization)
    employer_phone: Optional[str]
    employer_address: Optional[str]
    first_date_of_employment: Optional[date] = None
    work_start_time: Optional[time] = None
    work_end_time: Optional[time] = None
    work_days: Optional[Dict[str, str]] = None
    has_contract: Optional[bool] = False
    has_permission_to_work: Optional[bool] = False
    work_permit_type: Optional[str] = None
    working_on_tourist_visa: Optional[bool] = False
    is_salary_deducted: Optional[bool] = False
    reason_for_deduction: Optional[Dict[str, bool]] = None
    is_accommodation_covered_by_employer: Optional[bool] = False
    is_accommodation_a_dormitory: Optional[bool] = False
    is_accommodation_decent: Optional[bool] = False
    is_passport_retained: Optional[bool] = False
    is_job_execution_same_as_description: Optional[bool] = False
    doubts_about_compensation: Optional[bool] = None
    auto_clockin_enabled: Optional[bool] = False
    minimum_break_minutes: Optional[int] = None
    department_id: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    class Config:
        from_attributes=True

class CreateJob(Job):
   pass

class ShowJob(Job):
    job_id: int
    department_id: Optional[int] = None
    salaries: Optional[List['ShowSalary']] = None
    class Config:
     from_attributes = True

class ShowProfileJob(Job):
    salaries: Optional[List['ShowSalary']] = None
    # pass
    class Config:
     from_attributes = True

class PendingEmployee(BaseModel):
    id: int
    user_id: int
    private_user_id: int
    job_id: int
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    passport_number: Optional[str] = None
    date_of_birth: Optional[str] = None
    job_title: Optional[str] = None
    employer_name: Optional[str] = None
    employer_brn: Optional[str] = None
    employer_email: Optional[str] = None
    employer_phone: Optional[str] = None
    employer_address: Optional[str] = None
    first_date_of_employment: Optional[str] = None
    work_start_time: Optional[str] = None
    work_end_time: Optional[str] = None
    monthly_salary: Optional[str] = None
    currency: Optional[str] = None
    last_clock_in_location: Optional[str] = None
    last_clock_out_location: Optional[str] = None
    total_work_locations: Optional[int] = None
    created_at: Optional[str] = None
    verification_status: Optional[str] = None
    
    class Config:
        from_attributes = True

class LocationPoint(BaseModel):
    address: str
    latitude: float
    longitude: float
    timestamp: Optional[str] = None
    accuracy: Optional[float] = None

class Location(BaseModel):
    # Support both old format (direct location) and new format (clock_in/clock_out)
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    clock_in: Optional[LocationPoint] = None
    clock_out: Optional[LocationPoint] = None
    
    class Config:
        # Allow extra fields for backward compatibility
        extra = "allow"


class TimeLog(BaseModel):
    job_id: int
    private_user_id: int
    day_of_week: str
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    break_duration: Optional[float] = 0.0
    location: Union[Location, Dict[str, Any]]  # Support both new and legacy formats
    hours_worked: Optional[float] = None
    breaks: Optional[List['ShowBreakLog']] = []

    # Overtime tracking
    is_overtime: Optional[bool] = False
    overtime_confirmed_by_employer: Optional[bool] = False
    overtime_rejected: Optional[bool] = False
    marked_as_overtime_at: Optional[datetime] = None
    overtime_reason: Optional[str] = None

    # M26 — provenance for fast-track approval filtering on
    # /dashboard/time-logs. Defaults to 'mobile' so existing callers don't
    # need a code change; the kiosk service passes 'kiosk' explicitly.
    # CHECK constraint at the DB layer (time_logs_created_source_chk)
    # enforces the four-value enum: mobile | web | kiosk | admin.
    created_source: Optional[str] = 'mobile'

    # Schedule-aware clock-in: optional reason the employee gives when starting
    # late. is_late is computed server-side (never trusted from the client).
    late_reason: Optional[str] = None
    is_late: Optional[bool] = False

    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True 

class GeoCheckContext(BaseModel):
    """Geofencing v3 — device/location integrity context for a punch.

    Sent alongside the clock-in/out so the server can run the geofence
    decision (accuracy gate, mock detection, QR/Wi-Fi anchors, audit pack).
    All fields optional: legacy clients omit it and the server simply
    records without enforcement, exactly as before.
    """
    accuracy_m: Optional[float] = None
    fix_timestamp: Optional[datetime] = None
    mock_detected: bool = False
    qr_token: Optional[str] = None
    wifi_bssid: Optional[str] = None
    device_id: Optional[str] = None
    os: Optional[str] = None
    app_version: Optional[str] = None

class CreateTimeLog(TimeLog):
    break_duration: Optional[float] = 0
    geo_check: Optional[GeoCheckContext] = None
    pass

class ShowTimeLog(TimeLog):
    timelog_id: int
    employee_name: Optional[str] = None
    job_title: Optional[str] = None
    
    class Config:
        from_attributes = True

class BreakLog(BaseModel):
    timelog_id: int
    start_time: datetime
    end_time: Optional[datetime] = None

class ShowBreakLog(BreakLog):
    break_id: int
    class Config:
        from_attributes = True

class JobHistory(BaseModel):
    history_id: int
    job_id: int
    private_user_id: int
    company_id: Optional[int] = None
    job_title: str
    employer_name: str
    employer_brn: str
    employer_email: Optional[str]  # OUTPUT: str not EmailStr (a deleted/sentinel email must not 500 serialization)
    employer_phone: Optional[str]
    employer_address: Optional[str]
    first_date_of_employment: Optional[date] = None
    work_start_time: Optional[time] = None
    work_end_time: Optional[time] = None
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
    is_job_execution_same_as_description: bool
    doubts_about_compensation: Optional[bool] = None
    change_reason: Optional[str] = None
    changed_by: Optional[str] = None
    change_timestamp: datetime
    original_created_at: Optional[datetime] = None
    original_updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True

class ShowJobHistory(JobHistory):
    pass
    class Config:
        from_attributes = True

class CreateSalary(BaseModel):
    monthly_hours: str
    break_in_minutes_per_day: int
    days_of_work_per_month: int
    # Server-authoritative: derived from the employee's country on write
    # (see crud/job.resolve_salary_currency). Any client value is ignored.
    currency: Optional[str] = None
    revenue: Optional[Decimal] = None
    allowance: Optional[Decimal] = None
    salary: Decimal
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    class Config:
        from_attributes=True

class Salary(CreateSalary):
    job_id: int
    class Config:
        from_attributes=True

class ShowSalary(Salary):
    salary_id: int
    # Response-only pay-basis fields (read straight off the ORM row). Kept out
    # of CreateSalary so the write path is untouched. The web Salary card needs
    # pay_basis to tell monthly staff (paid from the salary STRUCTURE, so the
    # amounts here are a legacy reference) from hourly/daily staff (paid from
    # the rate here).
    pay_basis: Optional[str] = None
    hourly_rate: Optional[Decimal] = None
    daily_rate: Optional[Decimal] = None
    class Config:
     from_attributes = True


class UpdateUser(BaseModel):
    private_user_id: Optional[int] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    gender: Optional[str] = None
    date_of_birth: Optional[date] = None
    pass_port_number: Optional[str] = None
    onboard_complete: Optional[bool] = None


class OnboardJob(BaseModel):
    user_data: UpdateUser
    job_data: Job
    salary_data: CreateSalary
    class Config:
        from_attributes = True

# --- Schemas for Job Scheduling ---

class ScheduleBase(BaseModel):
    """Base model for a scheduled job or task."""
    title: str
    company_id: int
    location: str  # The address string from the frontend
    hours: Optional[str] = None  # e.g., "8 hours/day"
    notes: Optional[str] = None
    start_time: datetime
    status: Optional[str] = 'pending'
    end_time: datetime
    # Optional additional remuneration each assignee earns once the employer
    # verifies their completion. None / 0 = unpaid task.
    additional_remuneration_amount: Optional[Decimal] = None

    class Config:
        from_attributes = True

class CreateSchedule(ScheduleBase):
    """Schema for creating a new schedule and assigning employees."""
    assigned_employee_ids: List[int] = Field(default_factory=list)

class UpdateSchedule(BaseModel):
    """Schema for updating an existing schedule."""
    title: Optional[str] = None
    location: Optional[str] = None
    hours: Optional[str] = None
    notes: Optional[str] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    status: Optional[str] = None
    assigned_employee_ids: Optional[List[int]] = None
    additional_remuneration_amount: Optional[Decimal] = None

class AssignedEmployee(BaseModel):
    """A simple representation of an employee for a scheduled job."""
    private_user_id: int
    first_name: str
    last_name: str
    
    class Config:
        from_attributes = True

class AssigneeStatus(BaseModel):
    """Per-employee completion status on a task/schedule.
    Each assignee can independently mark their own progress (pending → started → completed)
    without overwriting the global task status or other assignees' statuses.
    """
    schedule_id: int
    private_user_id: int
    status: str = 'pending'   # 'pending' | 'started' | 'completed'
    note: Optional[str] = None   # this assignee's own message on the task
    proof_image_url: Optional[str] = None   # #4 — photo proof of completion
    # Non-null once the employer verified-and-paid this assignee's completion.
    remuneration_one_off_id: Optional[int] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class VerifyCompletionResult(BaseModel):
    """Outcome of an employer verifying a task's completion and booking pay."""
    schedule_id: int
    paid_count: int          # assignees newly paid this call
    skipped_count: int       # already paid, or not yet completed
    amount_each: Optional[Decimal] = None
    total_booked: Decimal = Decimal("0.00")

class UpdateMyTaskStatus(BaseModel):
    """Payload for an employee to mark their own progress on a task."""
    status: str  # 'pending' | 'started' | 'completed'
    note: Optional[str] = None   # this assignee's own message on the task

class ShowSchedule(ScheduleBase):
    """Schema for displaying a scheduled job with its assignments."""
    schedule_id: int
    assigned_employees: List[AssignedEmployee]
    assignee_statuses: List[AssigneeStatus] = []   # per-employee progress
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

# --- Schemas for Leave Requests ---

class LeaveRequestBase(BaseModel):
    private_user_id: int
    leave_type: str  # e.g., 'sick', 'holiday', 'bereavement', 'wedding'
    start_date: date
    end_date: date
    reason: Optional[str] = None
    status: str = 'pending'  # 'pending', 'approved', 'rejected'
    notes: Optional[str] = None

    class Config:
        from_attributes = True

class CreateLeaveRequest(LeaveRequestBase):
    pass

class ShowLeaveRequest(LeaveRequestBase):
    leave_request_id: int
    requester_name: Optional[str] = None
    approved_by: Optional[int] = None
    approved_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None
    approver_comments: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class ApproveLeaveRequest(BaseModel):
    action: str  # 'approve' or 'reject'
    rejection_reason: Optional[str] = None
    approver_comments: Optional[str] = None

    class Config:
        from_attributes = True

TimeLog.model_rebuild()
OnboardJob.model_rebuild()
Salary.model_rebuild()
AssigneeStatus.model_rebuild()
ShowSchedule.model_rebuild()
ShowBreakLog.model_rebuild()
ShowLeaveRequest.model_rebuild()
ShowJob.model_rebuild()
ShowProfileJob.model_rebuild()
ShowLeaveRequest.model_rebuild()
