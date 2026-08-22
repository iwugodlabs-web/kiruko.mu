"""Pydantic schemas for payroll runs and payslips."""

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class PayrollRunCreate(BaseModel):
    company_id: int
    period_start: date
    period_end: date
    notes: Optional[str] = None
    # If omitted, the engine picks every PrivateUser in the company who has
    # an active EmployeeSalaryAssignment on period_start.
    private_user_ids: Optional[List[int]] = None
    # Projection mode: when set (e.g. today), salaried absence is only counted
    # up to this date, so a mid-period run is a "so far" projection instead of
    # docking not-yet-worked days. Omit for a normal final run (full period).
    as_of: Optional[date] = None


class PayslipComponent(BaseModel):
    code: str
    label: str
    kind: str
    category: str
    amount: Decimal
    is_taxable: bool
    is_basic: bool
    source: str


class PayslipRead(BaseModel):
    id: int
    payroll_run_id: int
    private_user_id: int
    job_id: Optional[int] = None
    gross: Decimal
    taxable_income: Decimal
    paye: Decimal
    bonus: Decimal
    allowances_total: Decimal
    deductions_total: Decimal
    loan_repayments: Decimal
    leave_impact: Decimal
    # Per-type leave aggregated from approved Leave rows in the period.
    # Item shape: {code, label, days, paid}.
    leave_summary: Optional[List[Dict[str, Any]]] = None
    # Year-to-date leave balance guide (entitlement / taken / remaining) for the
    # period's year, computed fresh at read time (not a frozen snapshot).
    # Item shape: {code, label, is_paid, entitlement, taken, remaining}.
    leave_balance: Optional[List[Dict[str, Any]]] = None
    net_pay: Decimal
    statutory_employee: Optional[Dict[str, Any]] = None
    statutory_employer: Optional[Dict[str, Any]] = None
    # Correction metadata. An adjustment payslip holds the signed DELTA versus
    # the original it amends (parent_payslip_id) — the money fields above are
    # the deltas, not absolute amounts — so the client can label it
    # "Correction" and render the +/- instead of mistaking it for a 2nd payslip.
    is_adjustment: bool = False
    parent_payslip_id: Optional[int] = None
    adjustment_reason: Optional[str] = None
    currency: str
    locale: Optional[str] = None
    # Phase 2 shadow payroll: host-country statutory figures for an employee on
    # an active foreign-country assignment. All NULL when not shadowed. Amounts
    # in shadow_currency; shadow_equalization_due is expressed in `currency`.
    shadow_country_code: Optional[str] = None
    shadow_currency: Optional[str] = None
    shadow_gross: Optional[Decimal] = None
    shadow_taxable_income: Optional[Decimal] = None
    shadow_tax: Optional[Decimal] = None
    shadow_ss: Optional[Decimal] = None
    shadow_equalization_due: Optional[Decimal] = None
    components: Optional[List[PayslipComponent]] = None
    pdf_url: Optional[str] = None
    hash_sha256: Optional[str] = None
    created_at: Optional[datetime] = None
    # Denormalized so mobile/web don't need an extra round-trip to render
    # the payslip header. Populated by the read endpoint, not stored on
    # the payslip row itself (so they always reflect current company /
    # run state — historical tampering is still prevented by the
    # immutable components JSONB + hash_sha256).
    employer_name: Optional[str] = None
    employer_brn: Optional[str] = None
    # The employee this payslip is for — resolved at read time so the viewer can
    # show who it's about.
    employee_name: Optional[str] = None
    employee_code: Optional[str] = None
    # Branch/site the employee was based at for this run. home_geofence_id is
    # snapshotted on the payslip row at run time; home_site_name is resolved
    # read-time from the geofence so a renamed/deleted site stays readable.
    home_geofence_id: Optional[int] = None
    home_site_name: Optional[str] = None
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    # Run status — denormalized so the viewer can render the "Estimated"
    # badge and gate the download button without a second round-trip.
    # "draft" → estimated (PDF not downloadable); "finalized" → official.
    run_status: Optional[str] = None
    finalized_at: Optional[datetime] = None
    # This employee's slice of the run's compliance_flags (the `u{id}:` prefix
    # stripped). Surfaces WHY a payslip is e.g. zero — unapproved clock-ins,
    # pending overtime, open shifts. Populated by the read endpoint.
    flags: Optional[List[str]] = None

    class Config:
        from_attributes = True


class PayrollRunRead(BaseModel):
    id: int
    company_id: int
    period_start: date
    period_end: date
    status: str
    currency: str
    notes: Optional[str] = None
    country_rules_snapshot: Optional[Dict[str, Any]] = None
    compute_version: Optional[int] = None
    compliance_flags: Optional[List[str]] = None
    fx_snapshot: Optional[Dict[str, Any]] = None
    fx_source: Optional[str] = None
    fx_as_of: Optional[date] = None
    created_by_user_id: Optional[int] = None
    finalized_at: Optional[datetime] = None
    finalized_by_user_id: Optional[int] = None
    created_at: Optional[datetime] = None
    payslips: List[PayslipRead] = []

    class Config:
        from_attributes = True


class PayrollRunSummary(BaseModel):
    """List-view: lighter than PayrollRunRead, no payslips embedded."""
    id: int
    company_id: int
    period_start: date
    period_end: date
    status: str
    currency: str
    payslip_count: int
    total_net: Decimal
    # Number of compliance_flags on the run (zero-pay reasons, cap warnings,
    # data-quality notes) — drives a warning badge in the run list so issues
    # are visible before finalizing.
    warning_count: int = 0
    # The actual flag codes (e.g. "pending_clockins:3",
    # "u12:hourly_zero_pay:no_logs_in_period") so the UI can show WHY, not just
    # a count.
    warnings: List[str] = []
    # Maps the `u<id>:` prefix's private_user_id (string key) to the employee's
    # display name, so the UI can show WHICH employee a per-employee warning is
    # about instead of a generic "An employee".
    warning_subjects: Dict[str, str] = {}
    finalized_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
