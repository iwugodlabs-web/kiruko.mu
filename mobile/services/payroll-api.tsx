/**
 * Mobile-side wrappers for the new payroll/HR backend (M8).
 *
 * Same surface as web/ivor-web/src/services/payroll-api.ts so screens can
 * be written once and ported. Mobile-specific differences:
 *   * imports `api` from ./apiClient (token-based auth via AsyncStorage)
 *   * runs in React Native — no `crypto.randomUUID()` on Hermes; falls
 *     back to a Math.random-based v4 generator.
 *
 * Error normalization shape: `T | { error, status }` (matches the existing
 * mobile/services/api.tsx convention).
 */

import { api } from './apiClient';
import type {
  ApiResult,
  CountryRulesSnapshot,
  TaxBracketSet, TaxBracketSetCreate,
  StatutoryDeduction, StatutoryDeductionCreate,
  CountryLeaveDefault, CountryLeaveDefaultCreate,
  CountryBonusRule, CountryBonusRuleCreate,
  ProfileLockState, ProfileLockRequest, VerifyIdentityRequest,
  SalaryComponent, SalaryComponentCreate, SalaryComponentPatch,
  SalaryStructure, SalaryStructureCreate, SalaryStructureLineCreate, SalaryStructureLine,
  EmployeeSalaryAssignment, EmployeeSalaryAssignmentCreate,
  ResolvedSalary,
  PayrollRun, PayrollRunCreate, PayrollRunSummary, Payslip, PayslipEstimate,
  LeaveType, LeaveTypeCreate, LeaveTypeUpdate, SeedFromCountryReport,
  OneOffAllowance, OneOffAllowanceCreate,
  StepUpPurpose, StepUpRequestBody, StepUpVerifyBody, StepUpVerifyResponse,
  EmployeeCountryAssignment,
} from '../../shared/types/payroll';
export type { PayslipEstimate, ResolvedSalary, ResolvedComponent } from '../../shared/types/payroll';
export type { EmployeeCountryAssignment } from '../../shared/types/payroll';


// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------


function makeKey(): string {
  // crypto.randomUUID may not exist on Hermes (Expo Go); fall back to
  // a Math.random RFC4122 v4 generator. Good enough for client-side
  // replay keys; not used for security-sensitive randomness.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = globalThis as any;
  if (g?.crypto?.randomUUID) return g.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}


type AnyError = { error: string; status?: number };


function normalizeError(err: unknown): AnyError {
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

function idempotencyHeaders(key?: string): ReqHeaders {
  return { 'Idempotency-Key': key ?? makeKey() };
}

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
    countryCode: string, periodStart: string,
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
    countryCode: string, payload: TaxBracketSetCreate, opts?: { idempotencyKey?: string },
  ): Promise<ApiResult<TaxBracketSet>> => {
    try {
      const r = await api.post(`/payroll-rules/${countryCode}/tax-bracket-sets`, payload, {
        headers: idempotencyHeaders(opts?.idempotencyKey),
      });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  listStatutoryDeductions: async (
    countryCode: string, code?: string,
  ): Promise<ApiResult<StatutoryDeduction[]>> => {
    try {
      const r = await api.get(`/payroll-rules/${countryCode}/statutory-deductions`, {
        params: code ? { code } : undefined,
      });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  supersedeStatutoryDeduction: async (
    countryCode: string, payload: StatutoryDeductionCreate, opts?: { idempotencyKey?: string },
  ): Promise<ApiResult<StatutoryDeduction>> => {
    try {
      const r = await api.post(`/payroll-rules/${countryCode}/statutory-deductions`, payload, {
        headers: idempotencyHeaders(opts?.idempotencyKey),
      });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  listLeaveDefaults: async (
    countryCode: string, leaveTypeCode?: string,
  ): Promise<ApiResult<CountryLeaveDefault[]>> => {
    try {
      const r = await api.get(`/payroll-rules/${countryCode}/leave-defaults`, {
        params: leaveTypeCode ? { leave_type_code: leaveTypeCode } : undefined,
      });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  supersedeLeaveDefault: async (
    countryCode: string, payload: CountryLeaveDefaultCreate, opts?: { idempotencyKey?: string },
  ): Promise<ApiResult<CountryLeaveDefault>> => {
    try {
      const r = await api.post(`/payroll-rules/${countryCode}/leave-defaults`, payload, {
        headers: idempotencyHeaders(opts?.idempotencyKey),
      });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  listBonusRules: async (
    countryCode: string, bonusCode?: string,
  ): Promise<ApiResult<CountryBonusRule[]>> => {
    try {
      const r = await api.get(`/payroll-rules/${countryCode}/bonus-rules`, {
        params: bonusCode ? { bonus_code: bonusCode } : undefined,
      });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  supersedeBonusRule: async (
    countryCode: string, payload: CountryBonusRuleCreate, opts?: { idempotencyKey?: string },
  ): Promise<ApiResult<CountryBonusRule>> => {
    try {
      const r = await api.post(`/payroll-rules/${countryCode}/bonus-rules`, payload, {
        headers: idempotencyHeaders(opts?.idempotencyKey),
      });
      return r.data;
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
    privateUserId: number, payload: ProfileLockRequest = {},
  ): Promise<ApiResult<ProfileLockState>> => {
    try {
      const r = await api.post(`/private-users/${privateUserId}/lock`, payload);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  unlock: async (
    privateUserId: number, payload: ProfileLockRequest = {},
  ): Promise<ApiResult<ProfileLockState>> => {
    try {
      const r = await api.post(`/private-users/${privateUserId}/unlock`, payload);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  verifyIdentity: async (
    privateUserId: number, payload: VerifyIdentityRequest = {},
  ): Promise<ApiResult<ProfileLockState>> => {
    try {
      const r = await api.post(`/private-users/${privateUserId}/verify-identity`, payload);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },
};


// ---------------------------------------------------------------------------
// Time-log review (M3)
// ---------------------------------------------------------------------------

export interface TimeLogReviewItem {
  timelog_id: number;
  private_user_id: number;
  employee_name: string;
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
}

export type TimeLogStatus = 'all' | 'pending' | 'approved' | 'rejected' | 'disputed';

export const timeLogReview = {
  list: async (
    companyId: number,
    month: string,
    opts?: { privateUserId?: number; status?: TimeLogStatus },
  ): Promise<ApiResult<TimeLogReviewItem[]>> => {
    try {
      const r = await api.get(`/companies/${companyId}/time-logs`, {
        params: {
          month,
          private_user_id: opts?.privateUserId,
          status: opts?.status ?? 'all',
        },
      });
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

  /** Employee-only: file a dispute against a rejected log. */
  dispute: async (
    timeLogId: number, comment: string,
  ): Promise<ApiResult<unknown>> => {
    try {
      const r = await api.post(`/time-logs/${timeLogId}/dispute`, { comment });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },
};


// ---------------------------------------------------------------------------
// Payroll runs + payslips
// ---------------------------------------------------------------------------

export const payroll = {
  createDraft: async (
    payload: PayrollRunCreate, opts?: { idempotencyKey?: string },
  ): Promise<ApiResult<PayrollRun>> => {
    try {
      const r = await api.post('/payroll/runs', payload, {
        headers: idempotencyHeaders(opts?.idempotencyKey),
      });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  finalize: async (
    runId: number, stepUpToken: string, opts?: { idempotencyKey?: string },
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

  listRuns: async (
    companyId: number, opts?: { status?: string; limit?: number; offset?: number },
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
    privateUserId: number, opts?: { limit?: number; offset?: number },
  ): Promise<ApiResult<Payslip[]>> => {
    try {
      const r = await api.get(`/payslips/employee/${privateUserId}`, { params: opts });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  /**
   * Resolve the URL for the authenticated PDF stream endpoint. The actual
   * download happens via expo-file-system on the caller's side so the file
   * lands in the mobile cache and can be passed to expo-sharing.
   * Local-storage backends serve the bytes directly; S3 backends 302 to
   * the CDN URL — both work transparently with this URL + the auth header.
   */
  payslipPdfUrl: (payslipId: number): string => {
    const base = (api.defaults.baseURL ?? "").replace(/\/+$/, "");
    return `${base}/payslips/${payslipId}/pdf`;
  },

  /** M4 — URL of the watermarked estimated-payslip PDF for the current
   *  month. Caller streams via expo-file-system + auth header (same
   *  pattern as payslipPdfUrl). 409 means a finalized official payslip
   *  exists for this month — caller should route to that. */
  estimatedPayslipPdfUrl: (): string => {
    const base = (api.defaults.baseURL ?? "").replace(/\/+$/, "");
    return `${base}/private-users/me/payslips/estimated.pdf`;
  },

  /** The authenticated employee's own current-period pay estimate — the
   *  SAME authoritative figure the web employer profile shows, computed by
   *  the payroll engine (not a local hours×rate guess from clock-in logs). */
  getEstimate: async (): Promise<ApiResult<PayslipEstimate>> => {
    try {
      const r = await api.get('/private-users/me/payslips/estimate');
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  /** The authenticated employee's leave balance (entitlement / taken /
   *  remaining) per paid leave type for the year (default: current). */
  getLeaveBalance: async (year?: number): Promise<ApiResult<LeaveBalanceResponse>> => {
    try {
      const r = await api.get('/user/me/leave-balance', { params: year ? { year } : undefined });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },
};

export type LeaveBalanceItem = {
  code: string;
  label: string;
  is_paid: boolean;
  accrual_method: string;
  entitlement: number;
  taken: number;
  remaining: number;
};

export type LeaveBalanceResponse = { year: number; balances: LeaveBalanceItem[] };


// ---------------------------------------------------------------------------
// Leave types
// ---------------------------------------------------------------------------

export const leaveTypes = {
  list: async (companyId: number, includeInactive = false): Promise<ApiResult<LeaveType[]>> => {
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
    payload: OneOffAllowanceCreate, opts?: { idempotencyKey?: string },
  ): Promise<ApiResult<OneOffAllowance>> => {
    try {
      const r = await api.post('/one-off-allowances', payload, {
        headers: idempotencyHeaders(opts?.idempotencyKey),
      });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  list: async (
    privateUserId: number, opts?: { pendingOnly?: boolean; year?: number; month?: number },
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
        `/companies/${companyId}/salary-components/${componentId}`, payload,
      );
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  listStructures: async (companyId: number): Promise<ApiResult<SalaryStructure[]>> => {
    try {
      const r = await api.get(`/companies/${companyId}/salary-structures`);
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
        `/companies/${companyId}/salary-structures/${structureId}/lines`, payload,
      );
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  suggestStructure: async (
    companyId: number, privateUserId: number,
  ): Promise<ApiResult<SalaryStructure | null>> => {
    try {
      const r = await api.get(`/companies/${companyId}/salary-structures/suggest`, {
        params: { private_user_id: privateUserId },
      });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

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
};


// ---------------------------------------------------------------------------
// Step-up auth
// ---------------------------------------------------------------------------

export const stepUp = {
  request: async (
    purpose: StepUpPurpose,
  ): Promise<ApiResult<{ status: 'sent'; purpose: StepUpPurpose }>> => {
    try {
      const body: StepUpRequestBody = { purpose };
      const r = await api.post('/auth/step-up/request', body);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

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
