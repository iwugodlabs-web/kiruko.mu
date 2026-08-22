/**
 * Payroll/HR API service wrappers (M8).
 *
 * Covers the seven new admin routers shipped during the production-hardening
 * phase: payroll-rules, profile-lock, payroll runs+payslips, leave-types,
 * one-off allowances, salary-structures, auth/step-up.
 *
 * All wrappers normalize errors as `T | { error, status }` (matching the
 * existing api.tsx pattern). The 8 endpoints that require an
 * `Idempotency-Key` header (M6) auto-generate one if the caller doesn't
 * supply one. The payroll finalize endpoint also takes an `X-Step-Up-Token`
 * (M7) — the helper `withStepUp(token)` builds the right header pair.
 */

import { api } from './apiClient';
import type {
  // result wrapper
  ApiResult,
  // foundation
  CountryRulesSnapshot,
  TaxBracketSet, TaxBracketSetCreate,
  StatutoryDeduction, StatutoryDeductionCreate,
  CountryLeaveDefault, CountryLeaveDefaultCreate,
  CountryBonusRule, CountryBonusRuleCreate,
  CountryOvertimeRule,
  OvertimeReconcileRequest, OvertimeReconcileResponse,
  PublicHoliday,
  // profile lock
  ProfileLockState, ProfileLockRequest,
  // salary structures
  SalaryComponent, SalaryComponentCreate, SalaryComponentPatch,
  SalaryStructure, SalaryStructureCreate, SalaryStructureLineCreate, SalaryStructureLine,
  EmployeeSalaryAssignment, EmployeeSalaryAssignmentCreate,
  ResolvedSalary,
  // payroll
  PayrollRun, PayrollRunCreate, PayrollRunSummary, Payslip,
  // leave types
  LeaveType, LeaveTypeCreate, LeaveTypeUpdate, SeedFromCountryReport,
  // one-offs
  OneOffAllowance, OneOffAllowanceCreate,
  // step-up
  StepUpPurpose, StepUpRequestBody, StepUpVerifyBody, StepUpVerifyResponse,
  // country assignments
  EmployeeCountryAssignment, CountryAssignmentCreate,
} from '../../../../shared/types/payroll';

// Re-export types so components can avoid the `../../../../shared/...` walk.
//   import { payroll, type PayrollRunSummary } from "@/services/payroll-api";
export type * from '../../../../shared/types/payroll';


// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------


/**
 * UUID v4 — used for Idempotency-Key when the caller doesn't pass one.
 * Tries crypto.randomUUID() (modern browsers), falls back to a Math.random
 * implementation for older runtimes. Not cryptographically perfect but good
 * enough for a per-operation client-side replay key.
 */
function makeKey(): string {
  if (typeof crypto !== 'undefined' && typeof (crypto as Crypto).randomUUID === 'function') {
    return (crypto as Crypto).randomUUID();
  }
  // Fallback: RFC4122-ish v4
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}


type AnyError = { error: string; status?: number };


function normalizeError(err: unknown): AnyError {
  // Use unknown + type-narrowing — eslint will be happier than `any`.
  const e = err as { response?: { status?: number; data?: { detail?: string; message?: string } | string }; message?: string };
  const status = e.response?.status ?? 500;
  const data = e.response?.data;
  let detail: string;
  if (typeof data === 'string') {
    detail = data;
  } else {
    detail = data?.detail ?? data?.message ?? e.message ?? 'Unexpected error';
  }
  return { error: detail, status };
}


type ReqHeaders = Record<string, string>;


/**
 * Build the headers for an Idempotency-Key-required POST. If `key` is
 * undefined, generate a fresh UUIDv4. Pass an explicit key when the
 * caller wants retry semantics (the same key returns the same response).
 */
function idempotencyHeaders(key?: string): ReqHeaders {
  return { 'Idempotency-Key': key ?? makeKey() };
}


/**
 * Build the headers for the payroll-finalize endpoint, which requires
 * BOTH Idempotency-Key (M6) AND X-Step-Up-Token (M7). The step-up token
 * is obtained via stepUp.verify().
 */
export function withStepUp(stepUpToken: string, idempotencyKey?: string): ReqHeaders {
  return {
    ...idempotencyHeaders(idempotencyKey),
    'X-Step-Up-Token': stepUpToken,
  };
}


// ---------------------------------------------------------------------------
// Country payroll rules (platform admin only)
// ---------------------------------------------------------------------------

export const payrollRules = {
  getSnapshot: async (
    countryCode: string,
    periodStart: string,
  ): Promise<ApiResult<CountryRulesSnapshot>> => {
    try {
      const r = await api.get(`/payroll-rules/${countryCode}/snapshot`, {
        params: { period_start: periodStart },
      });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  listTaxBracketSets: async (countryCode: string): Promise<ApiResult<TaxBracketSet[]>> => {
    try {
      const r = await api.get(`/payroll-rules/${countryCode}/tax-bracket-sets`);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  supersedeTaxBracketSet: async (
    countryCode: string,
    payload: TaxBracketSetCreate,
    opts?: { idempotencyKey?: string },
  ): Promise<ApiResult<TaxBracketSet>> => {
    try {
      const r = await api.post(`/payroll-rules/${countryCode}/tax-bracket-sets`, payload, {
        headers: idempotencyHeaders(opts?.idempotencyKey),
      });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  listStatutoryDeductions: async (
    countryCode: string,
    code?: string,
  ): Promise<ApiResult<StatutoryDeduction[]>> => {
    try {
      const r = await api.get(`/payroll-rules/${countryCode}/statutory-deductions`, {
        params: code ? { code } : undefined,
      });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  supersedeStatutoryDeduction: async (
    countryCode: string,
    payload: StatutoryDeductionCreate,
    opts?: { idempotencyKey?: string },
  ): Promise<ApiResult<StatutoryDeduction>> => {
    try {
      const r = await api.post(`/payroll-rules/${countryCode}/statutory-deductions`, payload, {
        headers: idempotencyHeaders(opts?.idempotencyKey),
      });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  listLeaveDefaults: async (
    countryCode: string,
    leaveTypeCode?: string,
  ): Promise<ApiResult<CountryLeaveDefault[]>> => {
    try {
      const r = await api.get(`/payroll-rules/${countryCode}/leave-defaults`, {
        params: leaveTypeCode ? { leave_type_code: leaveTypeCode } : undefined,
      });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  supersedeLeaveDefault: async (
    countryCode: string,
    payload: CountryLeaveDefaultCreate,
    opts?: { idempotencyKey?: string },
  ): Promise<ApiResult<CountryLeaveDefault>> => {
    try {
      const r = await api.post(`/payroll-rules/${countryCode}/leave-defaults`, payload, {
        headers: idempotencyHeaders(opts?.idempotencyKey),
      });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  listBonusRules: async (
    countryCode: string,
    bonusCode?: string,
  ): Promise<ApiResult<CountryBonusRule[]>> => {
    try {
      const r = await api.get(`/payroll-rules/${countryCode}/bonus-rules`, {
        params: bonusCode ? { bonus_code: bonusCode } : undefined,
      });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  supersedeBonusRule: async (
    countryCode: string,
    payload: CountryBonusRuleCreate,
    opts?: { idempotencyKey?: string },
  ): Promise<ApiResult<CountryBonusRule>> => {
    try {
      const r = await api.post(`/payroll-rules/${countryCode}/bonus-rules`, payload, {
        headers: idempotencyHeaders(opts?.idempotencyKey),
      });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  listOvertimeRules: async (countryCode: string): Promise<ApiResult<CountryOvertimeRule[]>> => {
    try {
      const r = await api.get(`/payroll-rules/${countryCode}/overtime-rules`);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  reconcileOvertime: async (
    countryCode: string,
    payload: OvertimeReconcileRequest,
  ): Promise<ApiResult<OvertimeReconcileResponse>> => {
    try {
      const r = await api.post(`/payroll-rules/${countryCode}/overtime/reconcile`, payload);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  // Read-only: prefill the reconcile form from a real employee's contract +
  // clock-ins for a period. Returns an OvertimeReconcileRequest-shaped payload
  // (+ employee_name). Backend touches no payroll-engine compute.
  reconcilePrefill: async (
    countryCode: string,
    params: { private_user_id: number; period_start: string; period_end: string },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<ApiResult<any>> => {
    try {
      const r = await api.get(`/payroll-rules/${countryCode}/overtime/reconcile/prefill`, { params });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  listPublicHolidays: async (countryCode: string, year?: number): Promise<ApiResult<PublicHoliday[]>> => {
    try {
      const r = await api.get(`/payroll-rules/${countryCode}/holidays`, {
        params: year ? { year } : undefined,
      });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  createPublicHoliday: async (
    countryCode: string,
    payload: { name: string; date: string; observed_date?: string | null; is_recurring?: boolean },
  ): Promise<ApiResult<PublicHoliday>> => {
    try {
      const r = await api.post(`/payroll-rules/${countryCode}/holidays`, payload);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  updatePublicHoliday: async (
    countryCode: string,
    holidayId: number,
    payload: Partial<{ name: string; date: string; observed_date: string | null; is_recurring: boolean }>,
  ): Promise<ApiResult<PublicHoliday>> => {
    try {
      const r = await api.put(`/payroll-rules/${countryCode}/holidays/${holidayId}`, payload);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  deletePublicHoliday: async (countryCode: string, holidayId: number): Promise<ApiResult<void>> => {
    try {
      await api.delete(`/payroll-rules/${countryCode}/holidays/${holidayId}`);
      return undefined as unknown as void;
    } catch (e) { return normalizeError(e); }
  },
};


// ---------------------------------------------------------------------------
// Profile lock
// ---------------------------------------------------------------------------

export const profileLock = {
  get: async (privateUserId: number): Promise<ApiResult<ProfileLockState>> => {
    try {
      const r = await api.get(`/private-users/${privateUserId}/lock`);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  lock: async (
    privateUserId: number,
    payload: ProfileLockRequest = {},
  ): Promise<ApiResult<ProfileLockState>> => {
    try {
      const r = await api.post(`/private-users/${privateUserId}/lock`, payload);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  unlock: async (
    privateUserId: number,
    payload: ProfileLockRequest = {},
  ): Promise<ApiResult<ProfileLockState>> => {
    try {
      const r = await api.post(`/private-users/${privateUserId}/unlock`, payload);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },
};


// ---------------------------------------------------------------------------
// Payroll runs + payslips
// ---------------------------------------------------------------------------

export const payroll = {
  createDraft: async (
    payload: PayrollRunCreate,
    opts?: { idempotencyKey?: string },
  ): Promise<ApiResult<PayrollRun>> => {
    try {
      const r = await api.post('/payroll/runs', payload, {
        headers: idempotencyHeaders(opts?.idempotencyKey),
      });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  /**
   * Finalize requires BOTH Idempotency-Key (M6) AND X-Step-Up-Token (M7).
   * Get a step-up token via `stepUp.verify(...)` first.
   */
  finalize: async (
    runId: number,
    stepUpToken: string,
    opts?: { idempotencyKey?: string },
  ): Promise<ApiResult<PayrollRun>> => {
    try {
      const r = await api.post(`/payroll/runs/${runId}/finalize`, {}, {
        headers: withStepUp(stepUpToken, opts?.idempotencyKey),
      });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  cancel: async (runId: number): Promise<ApiResult<PayrollRun>> => {
    try {
      const r = await api.post(`/payroll/runs/${runId}/cancel`);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  /**
   * Re-run a DRAFT in place against current data — rebuilds payslips from the
   * latest clock-ins / salaries / rules, preserving the run id. Finalized runs
   * are rejected (409). Powers the "Re-run" button on the runs dashboard.
   */
  recompute: async (runId: number): Promise<ApiResult<PayrollRun>> => {
    try {
      const r = await api.post(`/payroll/runs/${runId}/recompute`);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  /**
   * Void a FINALIZED (or draft) run and start a fresh DRAFT for the same
   * period, atomically. The old payslips are kept for audit; the returned
   * run is the new draft. Destructive — confirm before calling. Powers the
   * "Redo run" button on finalized rows.
   */
  redo: async (runId: number): Promise<ApiResult<PayrollRun>> => {
    try {
      const r = await api.post(`/payroll/runs/${runId}/redo`);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  listRuns: async (
    companyId: number,
    opts?: { status?: string; limit?: number; offset?: number },
  ): Promise<ApiResult<PayrollRunSummary[]>> => {
    try {
      const r = await api.get('/payroll/runs', {
        params: { company_id: companyId, ...(opts ?? {}) },
      });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  getRun: async (runId: number): Promise<ApiResult<PayrollRun>> => {
    try {
      const r = await api.get(`/payroll/runs/${runId}`);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  getPayslip: async (payslipId: number): Promise<ApiResult<Payslip>> => {
    try {
      const r = await api.get(`/payslips/${payslipId}`);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  listEmployeePayslips: async (
    privateUserId: number,
    opts?: { limit?: number; offset?: number },
  ): Promise<ApiResult<Payslip[]>> => {
    try {
      const r = await api.get(`/payslips/employee/${privateUserId}`, { params: opts });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  /** Same-origin URL for the payslip PDF. Auth cookies are sent automatically. */
  payslipPdfUrl: (payslipId: number): string => `/api/v1/payslips/${payslipId}/pdf`,

  /** Same-origin URL for the estimated (current-month, watermarked) payslip PDF. */
  estimatedPayslipPdfUrl: (): string => `/api/v1/private-users/me/payslips/estimated.pdf`,

  /** Download a finalized run as CSV (blob). Requires the `export_payroll` permission. */
  runCsvExport: async (runId: number): Promise<Blob | { error: string; status?: number }> => {
    try {
      const r = await api.get(`/payroll/runs/${runId}/export.csv`, { responseType: 'blob' });
      return r.data as Blob;
    } catch (e) { return normalizeError(e); }
  },

  /** Download all payslip PDFs for a finalized run as a ZIP (blob). Requires `export_payroll`. */
  runPayslipsZip: async (runId: number): Promise<Blob | { error: string; status?: number }> => {
    try {
      const r = await api.get(`/payroll/runs/${runId}/payslips.zip`, { responseType: 'blob' });
      return r.data as Blob;
    } catch (e) { return normalizeError(e); }
  },
};


// ---------------------------------------------------------------------------
// Leave types
// ---------------------------------------------------------------------------

export const leaveTypes = {
  list: async (
    companyId: number,
    includeInactive = false,
  ): Promise<ApiResult<LeaveType[]>> => {
    try {
      const r = await api.get(`/companies/${companyId}/leave-types`, {
        params: { include_inactive: includeInactive },
      });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  create: async (companyId: number, payload: LeaveTypeCreate): Promise<ApiResult<LeaveType>> => {
    try {
      const r = await api.post(`/companies/${companyId}/leave-types`, payload);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  patch: async (
    companyId: number, leaveTypeId: number, payload: LeaveTypeUpdate,
  ): Promise<ApiResult<LeaveType>> => {
    try {
      const r = await api.patch(`/companies/${companyId}/leave-types/${leaveTypeId}`, payload);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  seedFromCountry: async (companyId: number): Promise<ApiResult<SeedFromCountryReport>> => {
    try {
      const r = await api.post(`/companies/${companyId}/leave-types/seed-from-country`);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },
};


// ---------------------------------------------------------------------------
// One-off allowances
// ---------------------------------------------------------------------------

export const oneOffAllowances = {
  create: async (
    payload: OneOffAllowanceCreate,
    opts?: { idempotencyKey?: string },
  ): Promise<ApiResult<OneOffAllowance>> => {
    try {
      const r = await api.post('/one-off-allowances', payload, {
        headers: idempotencyHeaders(opts?.idempotencyKey),
      });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  // #18 — grant additional remuneration for additional duty. No component_id:
  // the server ensures the company's "Additional duty" component and books the
  // one-off against it. Flows into the month's run AND the worker's estimate.
  grantAdditionalRemuneration: async (
    privateUserId: number,
    payload: { amount: string; payable_in_year: number; payable_in_month: number; notes?: string },
    opts?: { idempotencyKey?: string },
  ): Promise<ApiResult<OneOffAllowance>> => {
    try {
      const r = await api.post(
        `/private-users/${privateUserId}/additional-remuneration`,
        payload,
        { headers: idempotencyHeaders(opts?.idempotencyKey) },
      );
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  // Mirrors grantAdditionalRemuneration for the deduction side. No
  // component_id: the server ensures the company's "Ad-hoc deduction"
  // component and books the one-off against it. Notes are required.
  grantAdHocDeduction: async (
    privateUserId: number,
    payload: { amount: string; payable_in_year: number; payable_in_month: number; notes: string },
    opts?: { idempotencyKey?: string },
  ): Promise<ApiResult<OneOffAllowance>> => {
    try {
      const r = await api.post(
        `/private-users/${privateUserId}/ad-hoc-deduction`,
        payload,
        { headers: idempotencyHeaders(opts?.idempotencyKey) },
      );
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  list: async (
    privateUserId: number,
    opts?: { pendingOnly?: boolean; year?: number; month?: number },
  ): Promise<ApiResult<OneOffAllowance[]>> => {
    try {
      const r = await api.get(`/private-users/${privateUserId}/one-off-allowances`, {
        params: {
          pending_only: opts?.pendingOnly,
          year: opts?.year,
          month: opts?.month,
        },
      });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  remove: async (oneOffId: number): Promise<ApiResult<{ status: 'ok' }>> => {
    try {
      await api.delete(`/one-off-allowances/${oneOffId}`);
      return { status: 'ok' };
    } catch (e) { return normalizeError(e); }
  },
};


// ---------------------------------------------------------------------------
// Salary structures
// ---------------------------------------------------------------------------

export const salaryStructures = {
  // Components
  listComponents: async (companyId: number): Promise<ApiResult<SalaryComponent[]>> => {
    try {
      const r = await api.get(`/companies/${companyId}/salary-components`);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  createComponent: async (
    companyId: number, payload: SalaryComponentCreate,
  ): Promise<ApiResult<SalaryComponent>> => {
    try {
      const r = await api.post(`/companies/${companyId}/salary-components`, payload);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  patchComponent: async (
    companyId: number, componentId: number, payload: SalaryComponentPatch,
  ): Promise<ApiResult<SalaryComponent>> => {
    try {
      const r = await api.patch(
        `/companies/${companyId}/salary-components/${componentId}`,
        payload,
      );
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  // Structures
  listStructures: async (
    companyId: number, opts?: { includeArchived?: boolean },
  ): Promise<ApiResult<SalaryStructure[]>> => {
    try {
      const r = await api.get(`/companies/${companyId}/salary-structures`, {
        params: opts?.includeArchived ? { include_archived: true } : undefined,
      });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  getStructure: async (
    companyId: number, structureId: number,
  ): Promise<ApiResult<SalaryStructure>> => {
    try {
      const r = await api.get(`/companies/${companyId}/salary-structures/${structureId}`);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  createStructure: async (
    companyId: number, payload: SalaryStructureCreate,
  ): Promise<ApiResult<SalaryStructure>> => {
    try {
      const r = await api.post(`/companies/${companyId}/salary-structures`, payload);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  addStructureLine: async (
    companyId: number, structureId: number, payload: SalaryStructureLineCreate,
  ): Promise<ApiResult<SalaryStructureLine>> => {
    try {
      const r = await api.post(
        `/companies/${companyId}/salary-structures/${structureId}/lines`,
        payload,
      );
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  patchStructureLine: async (
    companyId: number,
    structureId: number,
    lineId: number,
    payload: { amount?: string | null; formula_expression?: string | null; order_index?: number },
  ): Promise<ApiResult<SalaryStructureLine>> => {
    try {
      const r = await api.patch(
        `/companies/${companyId}/salary-structures/${structureId}/lines/${lineId}`,
        payload,
      );
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  deleteStructureLine: async (
    companyId: number, structureId: number, lineId: number,
  ): Promise<ApiResult<void>> => {
    try {
      await api.delete(
        `/companies/${companyId}/salary-structures/${structureId}/lines/${lineId}`,
      );
      return undefined as unknown as void;
    } catch (e) { return normalizeError(e); }
  },

  patchStructure: async (
    companyId: number,
    structureId: number,
    payload: {
      name?: string;
      description?: string | null;
      is_default?: boolean;
      default_for_department_id?: number | null;
      default_for_role?: string | null;
      default_for_sector_grade_id?: number | null;
    },
  ): Promise<ApiResult<SalaryStructure>> => {
    try {
      const r = await api.patch(
        `/companies/${companyId}/salary-structures/${structureId}`,
        payload,
      );
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  archiveStructure: async (
    companyId: number, structureId: number,
  ): Promise<ApiResult<void>> => {
    try {
      await api.delete(`/companies/${companyId}/salary-structures/${structureId}`);
      return undefined as unknown as void;
    } catch (e) { return normalizeError(e); }
  },

  restoreStructure: async (
    companyId: number, structureId: number,
  ): Promise<ApiResult<SalaryStructure>> => {
    try {
      const r = await api.post(
        `/companies/${companyId}/salary-structures/${structureId}/restore`,
      );
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  /** UX gate before destructive structure edits. Returns active +
   *  total assignment counts so the admin can confirm blast radius. */
  getStructureUsage: async (
    companyId: number, structureId: number,
  ): Promise<ApiResult<{
    structure_id: number;
    active_assignment_count: number;
    total_assignment_count: number;
    sample_employee_names: string[];
  }>> => {
    try {
      const r = await api.get(
        `/companies/${companyId}/salary-structures/${structureId}/usage`,
      );
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  /** Returns null if no structure matches the employee's scope. */
  suggestStructure: async (
    companyId: number, privateUserId: number,
  ): Promise<ApiResult<SalaryStructure | null>> => {
    try {
      const r = await api.get(
        `/companies/${companyId}/salary-structures/suggest`,
        { params: { private_user_id: privateUserId } },
      );
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  // Assignments
  listAssignments: async (
    privateUserId: number,
  ): Promise<ApiResult<EmployeeSalaryAssignment[]>> => {
    try {
      const r = await api.get(`/private-users/${privateUserId}/salary-assignments`);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  getActiveAssignment: async (
    privateUserId: number, asOf?: string,
  ): Promise<ApiResult<EmployeeSalaryAssignment | null>> => {
    try {
      const r = await api.get(`/private-users/${privateUserId}/salary-assignments/active`, {
        params: asOf ? { as_of: asOf } : undefined,
      });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  createAssignment: async (
    privateUserId: number, payload: EmployeeSalaryAssignmentCreate,
  ): Promise<ApiResult<EmployeeSalaryAssignment>> => {
    try {
      const r = await api.post(
        `/private-users/${privateUserId}/salary-assignments`, payload,
      );
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  /** Resolved component breakdown for a given date — used by the salary preview UI. */
  preview: async (
    privateUserId: number, asOf?: string,
  ): Promise<ApiResult<ResolvedSalary>> => {
    try {
      const r = await api.get(`/private-users/${privateUserId}/salary/preview`, {
        params: asOf ? { as_of: asOf } : undefined,
      });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },
};

// ---------------------------------------------------------------------------
// Employee country assignments (missions / transfers)
// ---------------------------------------------------------------------------

export const countryAssignments = {
  list: async (
    privateUserId: number,
  ): Promise<ApiResult<EmployeeCountryAssignment[]>> => {
    try {
      const r = await api.get(`/private-users/${privateUserId}/country-locations`);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  active: async (
    privateUserId: number, asOf?: string,
  ): Promise<ApiResult<EmployeeCountryAssignment | null>> => {
    try {
      const r = await api.get(
        `/private-users/${privateUserId}/country-locations/active`,
        { params: asOf ? { as_of: asOf } : undefined },
      );
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  create: async (
    privateUserId: number, payload: CountryAssignmentCreate,
  ): Promise<ApiResult<EmployeeCountryAssignment>> => {
    try {
      const r = await api.post(
        `/private-users/${privateUserId}/country-locations`, payload,
      );
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  end: async (
    privateUserId: number, assignmentId: number, effectiveTo: string,
  ): Promise<ApiResult<EmployeeCountryAssignment>> => {
    try {
      const r = await api.post(
        `/private-users/${privateUserId}/country-locations/${assignmentId}/end`,
        { effective_to: effectiveTo },
      );
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  archive: async (
    privateUserId: number, assignmentId: number,
  ): Promise<ApiResult<null>> => {
    try {
      const r = await api.delete(
        `/private-users/${privateUserId}/country-locations/${assignmentId}`,
      );
      return r.data ?? null;
    } catch (e) { return normalizeError(e); }
  },

  // Phase 3 — company-wide history/report with filters. Returns rows enriched
  // with employee name, country name/currency, status, host-days, and a
  // residency flag. `format: "csv"` streams the same view as an attachment.
  companyReport: async (
    companyId: number,
    filters: {
      asOf?: string; country?: string; reason?: string; status?: string;
      includeArchived?: boolean; format?: "json" | "csv";
    } = {},
  ): Promise<ApiResult<any>> => {
    try {
      const params: Record<string, string | number> = {};
      if (filters.asOf) params.as_of = filters.asOf;
      if (filters.country) params.country_code = filters.country;
      if (filters.reason) params.reason = filters.reason;
      if (filters.status) params.status = filters.status;
      if (filters.includeArchived === false) params.include_archived = "false";
      if (filters.format === "csv") params.format = "csv";
      const r = await api.get(
        `/companies/${companyId}/country-assignments/report`, { params },
      );
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  // Search active companies by name/BRN — lets a company admin pick the
  // destination for a cross-company transfer (transfer_new_company).
  searchCompanies: async (
    q: string, limit = 10,
  ): Promise<ApiResult<Array<{ company_id: number; company_name: string; brn: string; country_code: string }>>> => {
    try {
      const r = await api.get("/companies", { params: { q, limit } });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },
};


// ---------------------------------------------------------------------------
// Step-up auth
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Time-log review (M3)
// ---------------------------------------------------------------------------

export interface TimeLogReviewItem {
  timelog_id: number;
  private_user_id: number;
  employee_name: string;
  // Short human-readable code (e.g. 'JS4821') — glanceable identifier next
  // to the name on the review screen. Older employees may not have one yet
  // until the backfill runs.
  employee_code?: string | null;
  day: string | null;
  start_time: string | null;
  end_time: string | null;
  hours_worked: number | null;
  is_overtime: boolean;
  overtime_confirmed_by_employer: boolean;
  admin_approved: boolean;
  admin_approved_at: string | null;
  admin_rejected: boolean;
  admin_rejected_at: string | null;
  admin_rejected_reason: string | null;
  dispute_status: 'pending' | 'approved' | 'rejection_upheld' | null;
  // M30 — provenance + missed-clockout signal exposed by the backend.
  // Defaults handle older payloads gracefully (backend defaults to 'mobile').
  created_source?: TimeLogSource;
  auto_closed?: boolean;
  // v1.7 — kiosk buddy-punching deterrents. kiosk_photo_path is a
  // path under /uploads/; UI prepends '/uploads/' for the <img src>.
  kiosk_photo_path?: string | null;
  out_of_schedule?: boolean;
  // Late START (after scheduled start + grace, still in shift) — distinct
  // from out_of_schedule. late_reason is the employee's own explanation,
  // collected via a mobile prompt; null for kiosk clock-ins.
  is_late?: boolean;
  late_reason?: string | null;
  // #21 (light) — the employee's scheduled shift window (HH:MM), for the
  // "scheduled 09:00–17:00" annotation beside beyond-shift sessions.
  scheduled_start?: string | null;
  scheduled_end?: string | null;
}

export type TimeLogStatus = 'all' | 'pending' | 'approved' | 'rejected' | 'disputed';

/** M30 — source filter values. 'all' means "no source filter applied". */
export type TimeLogSource = 'mobile' | 'web' | 'kiosk' | 'admin';

export const timeLogReview = {
  list: async (
    companyId: number,
    month: string,  // 'YYYY-MM'
    opts?: { privateUserId?: number; status?: TimeLogStatus; source?: TimeLogSource },
  ): Promise<ApiResult<TimeLogReviewItem[]>> => {
    try {
      const r = await api.get(`/companies/${companyId}/time-logs`, {
        params: {
          month,
          private_user_id: opts?.privateUserId,
          status: opts?.status ?? 'all',
          // M30 — forward only when set so the backend default ("all sources") holds.
          source: opts?.source,
        },
      });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  patch: async (
    timeLogId: number,
    payload: {
      start_time?: string;
      end_time?: string;
      hours_worked?: number;
      overtime_confirmed_by_employer?: boolean;
      overtime_rejected?: boolean;
    },
  ): Promise<ApiResult<TimeLogReviewItem>> => {
    try {
      const r = await api.patch(`/time-logs/${timeLogId}`, payload);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  approve: async (
    companyId: number, timeLogIds: number[],
  ): Promise<ApiResult<{ approved_count: number; skipped_count: number; audit_log_id: number | null }>> => {
    try {
      const r = await api.post(
        `/companies/${companyId}/time-logs/approve`,
        { time_log_ids: timeLogIds },
      );
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  reject: async (
    companyId: number, timeLogIds: number[], reason: string,
  ): Promise<ApiResult<{ rejected_count: number; skipped_count: number; audit_log_id: number | null; notifications_sent: number }>> => {
    try {
      const r = await api.post(
        `/companies/${companyId}/time-logs/reject`,
        { time_log_ids: timeLogIds, reason },
      );
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  resolveDispute: async (
    timeLogId: number,
    decision: 'approved' | 'rejection_upheld',
    adminResponse: string,
  ): Promise<ApiResult<unknown>> => {
    try {
      const r = await api.post(
        `/time-logs/${timeLogId}/dispute/resolve`,
        { decision, admin_response: adminResponse },
      );
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  /** Direct download — returns the CSV as a blob. */
  auditExport: async (
    companyId: number, fromDate: string, toDate: string,
  ): Promise<Blob | { error: string; status?: number }> => {
    try {
      const r = await api.get(
        `/companies/${companyId}/time-logs/audit-export`,
        { params: { from: fromDate, to: toDate }, responseType: 'blob' },
      );
      return r.data as Blob;
    } catch (e) { return normalizeError(e); }
  },
};


export const stepUp = {
  /** Email an OTP for the requested purpose. Returns 200 on send. */
  request: async (
    purpose: StepUpPurpose,
  ): Promise<ApiResult<{ status: 'sent'; purpose: StepUpPurpose }>> => {
    try {
      const body: StepUpRequestBody = { purpose };
      const r = await api.post('/auth/step-up/request', body);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  /** Validate the OTP and return a 5-min single-use step-up token. */
  verify: async (
    purpose: StepUpPurpose, otpCode: string,
  ): Promise<ApiResult<StepUpVerifyResponse>> => {
    try {
      const body: StepUpVerifyBody = { purpose, otp_code: otpCode };
      const r = await api.post('/auth/step-up', body);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },
};
