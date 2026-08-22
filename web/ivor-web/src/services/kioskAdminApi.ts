/**
 * M28 — Admin-side kiosk device management.
 *
 * Mirrors the shape of `payroll-api.ts::timeLogReview`:
 *   * methods return `Promise<ApiResult<T>>` (T | { error, status })
 *   * use the shared `api` axios instance (auth cookies + 401 refresh)
 *   * normalize all errors through one helper
 *
 * Auth: the backend's admin endpoints (POST /companies/{cid}/kiosks/register,
 * POST /kiosks/{id}/rotate-token, etc.) accept platform admins OR company
 * admins — the M28 admin pages currently surface them to platform admins
 * only via RoleGuard, but the API client doesn't enforce — leaving the
 * door open for a v1.1 self-serve company-admin dashboard reusing this
 * client.
 */
import { api } from './apiClient';
import type {
  ApiResult,
  KioskListItem,
  KioskPinRequest,
  KioskRegisterRequest,
  KioskRegisterResponse,
  KioskRotateResponse,
  KioskRotatePinResponse,
} from '../../../../shared/types/payroll';


type AnyError = { error: string; status?: number };

/**
 * Fleet-wide device row (platform admin). Like KioskListItem but carries the
 * owning company so the admin overview can group / link across all companies.
 */
export interface KioskFleetItem {
  device_id: string;
  device_name: string;
  company_id: number;
  company_name: string;
  location: { latitude?: number; longitude?: number; address?: string } | null;
  is_active: boolean;
  last_seen_at: string | null;
  last_seen_ip: string | null;
  token_expires_at: string;
  created_at: string;
}

function normalizeError(err: unknown): AnyError {
  // Match the helper shape from payroll-api.ts so callers can use the same
  // `isError` guard. Inlined here so this file stays free of cross-imports.
  const e = err as {
    response?: { status?: number; data?: { detail?: string; message?: string } | string };
    message?: string;
  };
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


export const kioskAdmin = {
  /**
   * Register a new kiosk device for a company. The returned `api_token`
   * is the ONLY time the raw token is visible — the DB stores a bcrypt
   * hash. Callers must surface it to the user immediately (one-time
   * display + copy-to-clipboard) before navigating away.
   */
  register: async (
    companyId: number,
    body: KioskRegisterRequest,
  ): Promise<ApiResult<KioskRegisterResponse>> => {
    try {
      const r = await api.post(`/companies/${companyId}/kiosks/register`, body);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  /**
   * Fleet-wide list across ALL companies (platform admin only). Backend:
   * GET /admin/kiosks/fleet. Powers the admin fleet-health overview.
   */
  fleet: async (
    opts?: { includeInactive?: boolean },
  ): Promise<ApiResult<{ data: KioskFleetItem[]; total: number }>> => {
    try {
      const r = await api.get(`/admin/kiosks/fleet`, {
        params: { include_inactive: opts?.includeInactive ?? false },
      });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  /**
   * List the kiosk devices for a company. `include_inactive=true`
   * surfaces deactivated devices for audit; the default hides them so
   * the operational view is uncluttered.
   */
  list: async (
    companyId: number,
    opts?: { includeInactive?: boolean },
  ): Promise<ApiResult<KioskListItem[]>> => {
    try {
      const r = await api.get(`/companies/${companyId}/kiosks`, {
        params: { include_inactive: opts?.includeInactive ?? false },
      });
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  /**
   * Replace a device's token + push the expiry out by 30 days. The
   * previous token stops validating immediately on server commit, so
   * tablets running the old token will start hitting 403 within seconds.
   */
  rotateToken: async (
    deviceId: string,
  ): Promise<ApiResult<KioskRotateResponse>> => {
    try {
      const r = await api.post(`/kiosks/${deviceId}/rotate-token`);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  /**
   * Regenerate the device's 4-digit admin PIN. The previous PIN stops working;
   * the new one is returned ONCE and must be entered on the tablet.
   */
  rotateAdminPin: async (
    deviceId: string,
  ): Promise<ApiResult<KioskRotatePinResponse>> => {
    try {
      const r = await api.post(`/kiosks/${deviceId}/rotate-admin-pin`);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },

  /**
   * Permanently disable a device. Equivalent to "revoke token" — useful
   * when a tablet is lost/stolen and we don't trust it again.
   * Returns void (204).
   */
  deactivate: async (deviceId: string): Promise<ApiResult<void>> => {
    try {
      await api.post(`/kiosks/${deviceId}/deactivate`);
      return undefined as unknown as void;
    } catch (e) { return normalizeError(e); }
  },

  /**
   * Admin-driven PIN set/reset for an employee. v1 PIN reset path —
   * employees can't self-reset via mobile/email since the target market
   * is precisely the segment with low mobile adoption (see plan Risk §2).
   */
  setEmployeePin: async (
    privateUserId: number,
    body: KioskPinRequest,
  ): Promise<ApiResult<void>> => {
    try {
      await api.post(`/private-users/${privateUserId}/kiosk-pin`, body);
      return undefined as unknown as void;
    } catch (e) { return normalizeError(e); }
  },

  /**
   * v1.6 polish — ask the server to generate a random 4-digit PIN for
   * the employee. Returns the digits exactly once (shown to admin so
   * they can share with the employee). Employee then changes it on
   * first kiosk use via the change-pin flow.
   */
  generateEmployeePin: async (
    privateUserId: number,
  ): Promise<ApiResult<{ pin: string }>> => {
    try {
      const r = await api.post(`/private-users/${privateUserId}/kiosk-pin/generate`);
      return r.data;
    } catch (e) { return normalizeError(e); }
  },
};


/**
 * Type-narrowing helper: ApiResult<T> is `T | { error, status }`. Use
 * this to discriminate before destructuring.
 */
export function isKioskError<T>(r: ApiResult<T>): r is { error: string; status?: number } {
  return typeof r === 'object' && r !== null && 'error' in (r as object);
}
