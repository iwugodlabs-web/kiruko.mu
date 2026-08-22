// Shared TypeScript types for the new payroll/HR backend (M8).
// Mirrors the Pydantic schemas in backend/schema/*.py.
//
// One section per backend router. Used by both web and mobile service
// wrappers under services/payroll-api.{ts,tsx}.

// ---------------------------------------------------------------------------
// Common
// ---------------------------------------------------------------------------

export type ApiResult<T> = T | { error: string; status?: number };

// ---------------------------------------------------------------------------
// Country payroll rules (foundation: tax brackets, statutory deductions,
// leave defaults, bonus rules)
// ---------------------------------------------------------------------------

export interface TaxBracketLine {
  order_index: number;
  lower_bound: string; // Decimal serialized as string
  upper_bound?: string | null;
  rate: string;
  description?: string | null;
}

export interface TaxBracketSet {
  id: number;
  country_code: string;
  fiscal_year: number;
  label?: string | null;
  effective_from: string;
  effective_to?: string | null;
  superseded_by_id?: number | null;
  version: number;
  source_reference?: string | null;
  change_reason?: string | null;
  created_by_user_id?: number | null;
  created_at?: string | null;
  brackets: (TaxBracketLine & { id: number; bracket_set_id: number })[];
}

export interface TaxBracketSetCreate {
  country_code: string;
  fiscal_year: number;
  label?: string;
  effective_from: string;
  source_reference?: string;
  change_reason?: string;
  brackets: TaxBracketLine[];
}

export interface StatutoryDeduction {
  id: number;
  country_code: string;
  code: string;
  label: string;
  rate: string;
  threshold_low?: string | null;
  threshold_high?: string | null;
  taxable_base: 'basic' | 'gross' | 'custom';
  employer_or_employee: 'employer' | 'employee';
  effective_from: string;
  effective_to?: string | null;
  superseded_by_id?: number | null;
  version: number;
  source_reference?: string | null;
  change_reason?: string | null;
  created_by_user_id?: number | null;
  created_at?: string | null;
}

export type StatutoryDeductionCreate = Omit<
  StatutoryDeduction,
  'id' | 'effective_to' | 'superseded_by_id' | 'version' | 'created_by_user_id' | 'created_at'
>;

export interface CountryLeaveDefault {
  id: number;
  country_code: string;
  leave_type_code: string;
  label: string;
  days_per_year: number;
  accrual_method: 'monthly' | 'annual' | 'tenure_based';
  carry_forward_max?: number | null;
  encashable: boolean;
  min_service_months: number;
  effective_from: string;
  effective_to?: string | null;
  superseded_by_id?: number | null;
  version: number;
  source_reference?: string | null;
  change_reason?: string | null;
  created_by_user_id?: number | null;
  created_at?: string | null;
}

export type CountryLeaveDefaultCreate = Omit<
  CountryLeaveDefault,
  'id' | 'effective_to' | 'superseded_by_id' | 'version' | 'created_by_user_id' | 'created_at'
>;

export interface CountryBonusRule {
  id: number;
  country_code: string;
  bonus_code: string;
  label: string;
  formula: 'twelfth_of_annual' | 'fixed' | 'percent_of_basic' | 'custom';
  eligibility_min_service_months: number;
  payable_month: number;
  prorate_on_partial_year: boolean;
  taxable: boolean;
  fixed_amount?: string | null;
  rate?: string | null;
  effective_from: string;
  effective_to?: string | null;
  superseded_by_id?: number | null;
  version: number;
  source_reference?: string | null;
  change_reason?: string | null;
  created_by_user_id?: number | null;
  created_at?: string | null;
}

export type CountryBonusRuleCreate = Omit<
  CountryBonusRule,
  'id' | 'effective_to' | 'superseded_by_id' | 'version' | 'created_by_user_id' | 'created_at'
>;

export interface CountryOvertimeWeekdayTier {
  id: number;
  tier_order: number;
  up_to_hours?: string | null; // null = "and beyond"
  multiplier: string;
}

export interface CountryOvertimeRule {
  id: number;
  country_code: string;
  effective_from: string;
  effective_to?: string | null;
  superseded_by_id?: number | null;
  version: number;
  source_reference?: string | null;
  change_reason?: string | null;
  notes?: string | null;
  created_by_user_id?: number | null;
  created_at?: string | null;
  weekly_threshold_h: string;
  daily_threshold_h?: string | null;
  rest_day_multiplier: string;
  public_holiday_normal_hours_multiplier: string;
  public_holiday_after_hours_multiplier: string;
  night_start?: string | null;
  night_end?: string | null;
  night_multiplier_habitual?: string | null;
  night_multiplier_occasional?: string | null;
  night_mode?: string | null;
  weekly_ot_soft_cap_h?: string | null;
  weekly_total_max_h?: string | null;
  monthly_basic_ot_cap?: string | null;
  stack_holiday_on_rest_day: string;
  stack_night_on_premium: string;
  week_start_dow: number;
  weekday_tiers: CountryOvertimeWeekdayTier[];
}

export interface PublicHoliday {
  holiday_id: number;
  country_code: string;
  name: string;
  date: string;
  observed_date?: string | null;
  year: number;
  is_recurring: boolean;
}

export interface ReconcileClockIn {
  date: string;
  start_hhmm: string;
  end_hhmm: string;
  is_overtime?: boolean;
  overtime_confirmed?: boolean;
}

export interface OvertimeReconcileRequest {
  period_start: string;
  period_end: string;
  hourly_rate: string;
  weekly_rest_day_dow?: number;
  overtime_eligibility?: string;
  monthly_basic?: string | null;
  contracted_hours_per_week?: string | null;
  company_timezone?: string;
  clock_ins: ReconcileClockIn[];
}

export interface OvertimeReconcileBucket {
  code: string;
  label: string;
  hours: string;
  multiplier: string;
  amount: string;
}

export interface OvertimeReconcileResponse {
  buckets: OvertimeReconcileBucket[];
  total: string;
  rule_version: number;
  rule_effective_from: string;
  compliance_flags: string[];
}

export interface CountryRulesSnapshot {
  country_code: string;
  resolved_for_period_start: string;
  resolved_at: string;
  tax_bracket_set?: TaxBracketSet | null;
  statutory_deductions: StatutoryDeduction[];
  leave_defaults: CountryLeaveDefault[];
  bonus_rules: CountryBonusRule[];
  overtime?: CountryOvertimeRule | null;
}

// ---------------------------------------------------------------------------
// Profile lock
// ---------------------------------------------------------------------------

export interface ProfileLockState {
  private_user_id: number;
  is_locked: boolean;
  locked_at?: string | null;
  locked_by_user_id?: number | null;
  lock_reason?: string | null;
  // Two-lock model: identity_verified is one-way and freezes IDENTITY_FIELDS
  // (first/last name, DOB, passport, gender) independently of is_locked.
  identity_verified?: boolean;
  identity_verified_at?: string | null;
  identity_verified_by_user_id?: number | null;
}

export interface ProfileLockRequest {
  reason?: string;
}

export interface VerifyIdentityRequest {
  note?: string;
}

// ---------------------------------------------------------------------------
// Salary structures (components, structures with lines, employee assignments)
// ---------------------------------------------------------------------------

export interface SalaryComponent {
  id: number;
  company_id: number;
  code: string;
  label: string;
  kind: 'earning' | 'deduction';
  category: string;
  is_basic: boolean;
  is_taxable: boolean;
  is_recurring: boolean;
  is_one_off: boolean;
  prorate_on_partial_month: boolean;
  // 'monthly' | 'daily' — daily components store a per-day rate, scaled by
  // working days in the period at resolution time.
  frequency: 'monthly' | 'daily';
  // 'amount' | 'percent_of_basic' — percent_of_basic stores percentage
  // POINTS (5.00 = 5%), applied against the structure's BASIC.
  value_type: 'amount' | 'percent_of_basic';
  statutory_base_codes: string[];
  country_default_code?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export type SalaryComponentCreate = Omit<
  SalaryComponent,
  'id' | 'company_id' | 'created_at' | 'updated_at'
>;

export interface SalaryComponentPatch {
  label?: string;
  category?: string;
  is_taxable?: boolean;
  is_recurring?: boolean;
  is_one_off?: boolean;
  prorate_on_partial_month?: boolean;
  frequency?: 'monthly' | 'daily';
  value_type?: 'amount' | 'percent_of_basic';
  statutory_base_codes?: string[];
}

export interface SalaryStructureLine {
  id: number;
  structure_id: number;
  component_id: number;
  amount?: string | null;
  formula_expression?: string | null;
  order_index: number;
  component_code?: string | null;
}

export type SalaryStructureLineCreate = Omit<SalaryStructureLine, 'id' | 'structure_id' | 'component_code'>;

export interface SalaryStructure {
  id: number;
  company_id: number;
  name: string;
  description?: string | null;
  is_default: boolean;
  default_for_department_id?: number | null;
  default_for_role?: string | null;
  default_for_sector_grade_id?: number | null;
  created_at?: string | null;
  archived_at?: string | null;
  lines: SalaryStructureLine[];
}

export type SalaryStructureCreate = Omit<
  SalaryStructure,
  'id' | 'company_id' | 'created_at' | 'archived_at' | 'lines'
> & {
  lines: SalaryStructureLineCreate[];
};

export interface EmployeeSalaryOverride {
  id: number;
  assignment_id: number;
  component_id: number;
  amount?: string | null;
  formula_expression?: string | null;
  notes?: string | null;
}

export type EmployeeSalaryOverrideCreate = Omit<EmployeeSalaryOverride, 'id' | 'assignment_id'>;

export interface EmployeeSalaryAssignment {
  id: number;
  private_user_id: number;
  structure_id?: number | null;
  currency: string;
  effective_from: string;
  effective_to?: string | null;
  notes?: string | null;
  created_by_user_id?: number | null;
  created_at?: string | null;
  overrides: EmployeeSalaryOverride[];
}

export interface EmployeeSalaryAssignmentCreate {
  private_user_id: number;
  structure_id?: number | null;
  currency: string;
  effective_from: string;
  notes?: string | null;
  overrides: EmployeeSalaryOverrideCreate[];
}

export interface ResolvedComponent {
  component_id: number;
  code: string;
  label: string;
  kind: 'earning' | 'deduction';
  category: string;
  amount: string;
  is_taxable: boolean;
  is_basic: boolean;
  source: 'structure' | 'override' | 'one_off' | 'bonus';
  statutory_base_codes: string[];
  // 'monthly' | 'daily' — amount is already fully resolved (daily scaling
  // and percent-of-basic are both applied upstream); this just tells the
  // UI which badge/breakdown to show.
  frequency?: 'monthly' | 'daily';
  value_type?: 'amount' | 'percent_of_basic';
  prorate_on_partial_month?: boolean;
  meta?: Record<string, unknown> | null;
}

export interface ResolvedSalary {
  private_user_id: number;
  period_start: string;
  assignment_id?: number | null;
  structure_id?: number | null;
  currency: string;
  components: ResolvedComponent[];
}

// ---------------------------------------------------------------------------
// Payroll runs & payslips
// ---------------------------------------------------------------------------

export type PayrollRunStatus = 'draft' | 'finalized' | 'cancelled';

export interface PayslipComponent {
  code: string;
  label: string;
  kind: 'earning' | 'deduction';
  category: string;
  amount: string;
  is_taxable: boolean;
  is_basic: boolean;
  source: string;
  /** Overtime engine audit drill-down — only present on source='overtime'
   *  buckets. multiplier/hours/source_timelog_ids/weekly_accumulator_at_emit. */
  meta?: {
    multiplier?: string;
    hours?: string;
    source_timelog_ids?: number[];
    weekly_accumulator_at_emit?: string;
    notes?: string;
  } | null;
}

export interface Payslip {
  id: number;
  payroll_run_id: number;
  private_user_id: number;
  job_id?: number | null;
  gross: string;
  taxable_income: string;
  paye: string;
  bonus: string;
  allowances_total: string;
  deductions_total: string;
  loan_repayments: string;
  leave_impact: string;
  /** Per-type leave aggregated from approved Leave rows in the period.
   *  null if none, otherwise items shaped { code, label, days, paid }. */
  leave_summary?: Array<{ code: string; label: string; days: number; paid: boolean }> | null;
  /** Year-to-date leave balance guide (entitlement / taken / remaining) for the
   *  period's year, computed fresh at read time. null if no derivable allowance. */
  leave_balance?: Array<{
    code: string; label: string; is_paid: boolean;
    entitlement: number; taken: number; remaining: number;
  }> | null;
  net_pay: string;
  statutory_employee?: Record<string, string> | null;
  statutory_employer?: Record<string, string> | null;
  // Correction metadata. When is_adjustment is true this row is NOT a second
  // payslip — it's a correction to parent_payslip_id, and every money field
  // (net_pay, gross, paye, components…) is a signed DELTA versus the original,
  // not an absolute amount. The UI renders it as a "Correction (+/− Rs X)".
  is_adjustment?: boolean;
  parent_payslip_id?: number | null;
  adjustment_reason?: string | null;
  currency: string;
  locale?: string | null;
  /** Phase 2 shadow payroll — host-country statutory figures for an employee on
   *  an active foreign-country assignment. All null when not shadowed. Amounts
   *  are in shadow_currency; shadow_equalization_due is in `currency`. */
  shadow_country_code?: string | null;
  shadow_currency?: string | null;
  shadow_gross?: string | null;
  shadow_taxable_income?: string | null;
  shadow_tax?: string | null;
  shadow_ss?: string | null;
  shadow_equalization_due?: string | null;
  components?: PayslipComponent[] | null;
  pdf_url?: string | null;
  hash_sha256?: string | null;
  created_at?: string | null;
  // Read-time enrichment from the PayslipRead endpoint — denormalized
  // so the viewer can render the header without a second round-trip.
  employer_name?: string | null;
  employer_brn?: string | null;
  /** The employee this payslip is for (resolved at read time). */
  employee_name?: string | null;
  employee_code?: string | null;
  /** Branch/site the employee was based at for this run. home_geofence_id is
   *  snapshotted on the payslip at run time; home_site_name resolved read-time. */
  home_geofence_id?: number | null;
  home_site_name?: string | null;
  period_start?: string | null;  // ISO date "YYYY-MM-DD"
  period_end?: string | null;
  // Denormalized run status — drives the "Estimated" badge and the
  // download gate. "draft" = estimated (no PDF); "finalized" = official.
  run_status?: PayrollRunStatus | null;
  finalized_at?: string | null;
  // This employee's slice of the run's compliance_flags (the `u{id}:` prefix
  // stripped). Explains a zero/odd payslip — e.g. "hourly_zero_pay:open_logs:1".
  flags?: string[] | null;
}

/** GET /private-users/{id}/payslips/estimate (also .../me/... for self) —
 * the authoritative, mode-aware current-period estimate. Both web and
 * mobile should render THIS, not recompute pay client-side from local
 * clock-in logs (that was the source of a real bug — see PaySummary). */
export interface PayslipEstimate {
  currency: string;
  // start/end are the ACTUAL window the estimate was computed for —
  // period_start/period_end overridden by the caller, else the company's
  // open payroll run, else the current calendar month (see backend
  // payslip_estimate.py::_target_window). They can diverge from "the
  // current calendar month" whenever a run is open, which is why the
  // mobile "This Month" filter must compare against these dates rather
  // than assume they always match — see resolveLiveAmount.ts.
  period?: { label?: string; start?: string; end?: string } | null;
  gross: string;
  net: string;
  earnings: { code: string; label: string; amount_str: string; multiplier_badge: string | null; hours_str: string | null }[];
  deductions: { code: string; label: string; amount_str: string; is_statutory: boolean }[];
  leave_summary?: { code: string; label: string; days: number; paid: boolean }[];
  pay_is_hours_driven: boolean;
  // 'no_pay_basis' | 'no_clockins' | null — why gross is 0, so the UI can
  // explain it instead of showing a bare 0.
  zero_reason: 'no_pay_basis' | 'no_clockins' | null;
  // Day-count breakdown for salaried staff at a company that requires
  // clock-ins for payroll — null when not applicable (hourly/daily pay,
  // clock-ins not required, or the employee has never clocked in at all).
  attendance: { scheduled_days: number; present_days: number; absent_days: number } | null;
  is_estimate: true;
}

export interface PayrollRun {
  id: number;
  company_id: number;
  period_start: string;
  period_end: string;
  status: PayrollRunStatus;
  currency: string;
  notes?: string | null;
  country_rules_snapshot?: Record<string, unknown> | null;
  compute_version?: number | null;
  compliance_flags?: string[] | null;
  fx_snapshot?: { source?: string; as_of?: string | null; base?: string; rates?: Record<string, string> } | null;
  fx_source?: string | null;
  fx_as_of?: string | null;
  created_by_user_id?: number | null;
  finalized_at?: string | null;
  finalized_by_user_id?: number | null;
  created_at?: string | null;
  payslips: Payslip[];
}

export interface PayrollRunSummary {
  id: number;
  company_id: number;
  period_start: string;
  period_end: string;
  status: PayrollRunStatus;
  currency: string;
  payslip_count: number;
  total_net: string;
  /** Count of run compliance_flags (zero-pay reasons, cap/data-quality
   *  warnings) — drives a warning badge in the list. */
  warning_count?: number;
  /** The actual flag codes (e.g. "pending_clockins:3",
   *  "u12:hourly_zero_pay:no_logs_in_period") so the UI can show WHY. */
  warnings?: string[];
  /** Maps a flag's `u<id>:` private_user_id (string key) to the employee's
   *  display name, so the UI can show WHICH employee a warning is about. */
  warning_subjects?: Record<string, string>;
  finalized_at?: string | null;
  created_at?: string | null;
}

export interface PayrollRunCreate {
  company_id: number;
  period_start: string;
  period_end: string;
  notes?: string;
  private_user_ids?: number[];
}

// ---------------------------------------------------------------------------
// Leave types
// ---------------------------------------------------------------------------

export interface LeaveType {
  id: number;
  company_id: number;
  code: string;
  label: string;
  is_paid: boolean;
  is_statutory: boolean;
  accrual_method: 'monthly' | 'annual' | 'tenure_based';
  accrual_rate_days_per_month?: string | null;
  days_per_year?: number | null;
  max_balance?: number | null;
  carry_forward_max?: number | null;
  encashable: boolean;
  min_service_months: number;
  requires_doc: boolean;
  country_default_id?: number | null;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export type LeaveTypeCreate = Omit<
  LeaveType,
  'id' | 'company_id' | 'country_default_id' | 'created_at' | 'updated_at'
>;

export interface LeaveTypeUpdate {
  label?: string;
  is_paid?: boolean;
  accrual_method?: 'monthly' | 'annual' | 'tenure_based';
  accrual_rate_days_per_month?: string | null;
  days_per_year?: number | null;
  max_balance?: number | null;
  carry_forward_max?: number | null;
  encashable?: boolean;
  min_service_months?: number;
  requires_doc?: boolean;
  is_active?: boolean;
}

export interface SeedFromCountryReport {
  company_id: number;
  country_code: string;
  created: string[];
  updated: string[];
  skipped: string[];
}

// ---------------------------------------------------------------------------
// One-off allowances
// ---------------------------------------------------------------------------

export interface OneOffAllowance {
  id: number;
  private_user_id: number;
  component_id: number;
  component_code?: string | null;
  component_label?: string | null;
  amount: string;
  payable_in_year: number;
  payable_in_month: number;
  applied_to_payslip_id?: number | null;
  notes?: string | null;
  created_by_user_id?: number | null;
  created_at?: string | null;
}

export interface OneOffAllowanceCreate {
  private_user_id: number;
  component_id: number;
  amount: string;
  payable_in_year: number;
  payable_in_month: number;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Step-up auth (M7)
// ---------------------------------------------------------------------------

export type StepUpPurpose = 'payroll_finalize' | 'rule_supersede';

export interface StepUpRequestBody {
  purpose: StepUpPurpose;
}

export interface StepUpVerifyBody {
  purpose: StepUpPurpose;
  otp_code: string;
}

export interface StepUpVerifyResponse {
  token: string;
  expires_at: string;
  purpose: StepUpPurpose;
}


// ---------------------------------------------------------------------------
// Kiosk MVP (M26 backend / M28 admin UI)
// ---------------------------------------------------------------------------

export interface KioskLocation {
  latitude?: number;
  longitude?: number;
  address?: string;
}

export interface KioskRegisterRequest {
  device_name: string;
  location?: KioskLocation | null;
}

export interface KioskRegisterResponse {
  device_id: string;       // UUID
  device_name: string;
  api_token: string;       // shown once — copy immediately
  admin_pin: string;       // shown once — admin enters this on the tablet
  token_expires_at: string;
}

export interface KioskListItem {
  device_id: string;       // UUID
  device_name: string;
  location: KioskLocation | null;
  is_active: boolean;
  last_seen_at: string | null;
  token_expires_at: string;
  created_at: string;
}

export interface KioskRotateResponse {
  device_id: string;
  api_token: string;       // shown once — copy immediately
  token_expires_at: string;
}

export interface KioskRotatePinResponse {
  device_id: string;
  admin_pin: string;       // shown once — admin enters this on the tablet
}

export interface KioskPinRequest {
  pin: string;             // 4 digits
}

// ---------------------------------------------------------------------------
// Employee country assignments (missions / transfers)
// ---------------------------------------------------------------------------

export type CountryAssignmentReason =
  | 'mission'
  | 'transfer_same_company'
  | 'transfer_new_company';

export interface EmployeeCountryAssignment {
  id: number;
  private_user_id: number;
  country_code: string;
  reason: CountryAssignmentReason;
  effective_from: string;      // YYYY-MM-DD
  effective_to?: string | null; // null = open-ended
  new_company_id?: number | null;
  notes?: string | null;
  created_by_user_id?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  archived_at?: string | null;
  // Convenience fields populated by the API:
  country_name?: string | null;
  country_currency?: string | null;
}

export interface CountryAssignmentCreate {
  country_code: string;
  reason: CountryAssignmentReason;
  effective_from: string;
  effective_to?: string | null;
  new_company_id?: number | null;
  notes?: string | null;
}
