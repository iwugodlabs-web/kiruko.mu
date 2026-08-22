/**
 * Kiosk runtime API client (Expo port of web/ivor-web/src/services/kioskApi.ts).
 *
 * Dedicated axios instance separate from the shared `services/apiClient.tsx`.
 * Why not reuse?
 *   * apiClient attaches the user JWT and runs 401 refresh against
 *     /user/refresh-token — neither applies to a tablet authenticating
 *     with a device-issued X-Kiosk-Token.
 *   * The shared client's interceptor warns/short-circuits when no auth
 *     token is present on a "protected endpoint"; /kiosk/* would trip it.
 *   * Idempotency-Key is per-attempt and lives in caller state (mirrors
 *     the web contract — same key across retries of the same press,
 *     fresh key on a brand-new press).
 *
 * Token lives in AsyncStorage under `KIOSK_STORAGE_KEYS.token`. The
 * interceptor reads it fresh on every request so a mid-session re-
 * onboard takes effect without reload.
 *
 * Response shapes mirror web 1:1 — backend doesn't know which client hit it.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import axios, { AxiosInstance } from "axios";
import { Platform } from "react-native";
import { KIOSK_STORAGE_KEYS } from "../constants";
import { offlineQueue } from "./offlineQueue";

// ---------------------------------------------------------------------------
// Base URL — driven by the SAME env var as services/apiClient.tsx
// (EXPO_PUBLIC_API_URL) so the kiosk and main clients always hit one host, and
// defaults to the branded production domain. Was hardcoded to the raw
// DigitalOcean app hostname, which bypassed api.kiruko.mu (and any CDN/WAF in
// front of it) and would break if the app slug changed.
// ---------------------------------------------------------------------------

const KIOSK_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "https://api.kiruko.mu/api/v1";

// ---------------------------------------------------------------------------
// Token storage helpers
// ---------------------------------------------------------------------------

export async function getKioskToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KIOSK_STORAGE_KEYS.token);
  } catch {
    return null;
  }
}

export async function setKioskToken(token: string): Promise<void> {
  await AsyncStorage.setItem(KIOSK_STORAGE_KEYS.token, token);
}

export async function clearKioskToken(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KIOSK_STORAGE_KEYS.token);
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Axios instance
// ---------------------------------------------------------------------------

const kioskHttp: AxiosInstance = axios.create({
  baseURL: KIOSK_BASE_URL,
  timeout: 15000,
  headers: { "Content-Type": "application/json" },
});

kioskHttp.defaults.headers.common["X-Platform"] = Platform.OS;
kioskHttp.defaults.headers.common["X-Client-Platform"] = "kiosk";

kioskHttp.interceptors.request.use(async (config) => {
  const token = await getKioskToken();
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>)["X-Kiosk-Token"] = token;
  }
  return config;
});

// ---------------------------------------------------------------------------
// Error normalization — matches web's ApiResult shape so the offline
// fallback's network-class detection works identically.
// ---------------------------------------------------------------------------

export interface KioskApiError {
  error: string;
  status?: number;
}

export type ApiResult<T> = T | KioskApiError;

export function isKioskApiError<T>(r: ApiResult<T>): r is KioskApiError {
  return typeof r === "object" && r !== null && "error" in r;
}

function normalizeError(err: unknown): KioskApiError {
  const e = err as {
    response?: { status?: number; data?: { detail?: string; message?: string } | string };
    message?: string;
    code?: string;
  };
  // No `response` field at all = pure network failure (offline, DNS, timeout).
  // Report status=0 so the offline-fallback path recognizes it as a queue
  // candidate rather than a backend 4xx (which would be a real rejection).
  if (!e.response) {
    return { error: e.message ?? "network_error", status: 0 };
  }
  const status = e.response.status ?? 500;
  const data = e.response.data;
  let detail: string;
  if (typeof data === "string") {
    detail = data;
  } else {
    detail = data?.detail ?? data?.message ?? e.message ?? "Unexpected error";
  }
  return { error: detail, status };
}

/**
 * Generate a per-attempt Idempotency-Key. Caller owns it — pass the same
 * value across retries of the same attempt, roll a fresh one on a new
 * attempt. Backend's M26 dedup cache uses (device_id, key) as PK so the
 * same key replay returns the original timelog_id.
 */
export function newIdempotencyKey(): string {
  // RFC 4122 v4 — React Native doesn't ship `crypto.randomUUID` on all
  // Hermes builds. Math.random is acceptable here: the key only needs
  // collision resistance against this device's own concurrent attempts.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ---------------------------------------------------------------------------
// Response shapes — mirror web/ivor-web/src/services/kioskApi.ts exactly.
// ---------------------------------------------------------------------------

export interface KioskLookupCandidate {
  private_user_id: number;
  display_name: string;
  has_pin: boolean;
  has_active_session: boolean;
  preferred_locale?: string | null;
  department_name?: string | null;
  job_title?: string | null;
}

export interface KioskClockInResponse {
  status: string;
  timelog_id: number;
  message: string;
  clocked_in_at: string;
  created_source: string;
}

export interface KioskClockOutResponse {
  status: string;
  timelog_id: number;
  message: string;
  clocked_out_at: string;
  hours_worked: number | null;
}

export interface KioskHeartbeatResponse {
  status: string;
  device_id: string;
  checked_at: string;
}

export interface KioskClockInPayload {
  private_user_id: number;
  pin: string;
  location: { latitude: number; longitude: number };
  photo_b64?: string | null;
}

export interface KioskClockOutPayload {
  private_user_id: number;
  pin: string;
  location: { latitude: number; longitude: number };
}

export interface KioskChangePinPayload {
  private_user_id: number;
  current_pin: string;
  new_pin: string;
}

// ---------------------------------------------------------------------------
// API surface
// ---------------------------------------------------------------------------

export const kioskApi = {
  /**
   * Validate the configured token. 200 = good; 401/403 = re-onboard.
   * Used by the setup screen to smoke-test a pasted token before
   * persisting + flipping the kiosk-mode flag.
   */
  heartbeat: async (): Promise<ApiResult<KioskHeartbeatResponse>> => {
    try {
      const r = await kioskHttp.get("/kiosk/heartbeat");
      return r.data;
    } catch (e) {
      return normalizeError(e);
    }
  },

  /**
   * Verify the admin PIN for the configured token's device. Used at setup to
   * confirm the operator typed the PIN shown on the web. 200 = good; 403 =
   * wrong PIN for this device.
   */
  verifyAdminPin: async (pin: string): Promise<ApiResult<{ status: string }>> => {
    try {
      const r = await kioskHttp.post("/kiosk/verify-admin-pin", { pin });
      return r.data;
    } catch (e) {
      return normalizeError(e);
    }
  },

  /**
   * Look up an employee by email/phone substring. Result is company-
   * scoped server-side (KioskService.find_employees enforces) and capped
   * at 5. Returns a restricted projection — no raw email/phone, just
   * display_name + disambiguators.
   */
  lookup: async (query: string): Promise<ApiResult<KioskLookupCandidate[]>> => {
    try {
      const r = await kioskHttp.post("/kiosk/employee-lookup", { query });
      return r.data;
    } catch (e) {
      return normalizeError(e);
    }
  },

  /**
   * Create the clock-in. Caller MUST pass an Idempotency-Key and reuse
   * the same one across retries of one user-initiated attempt. See
   * web client comments for the full error matrix the UI handles.
   */
  clockIn: async (
    payload: KioskClockInPayload,
    idempotencyKey: string,
  ): Promise<ApiResult<KioskClockInResponse>> => {
    try {
      const r = await kioskHttp.post("/kiosk/clock-in", payload, {
        headers: { "Idempotency-Key": idempotencyKey },
      });
      return r.data;
    } catch (e) {
      return normalizeError(e);
    }
  },

  /**
   * Close the employee's active TimeLog. Same auth + idempotency contract
   * as clock-in. The kiosk UI chooses between in/out based on the
   * candidate's `has_active_session` flag.
   */
  clockOut: async (
    payload: KioskClockOutPayload,
    idempotencyKey: string,
  ): Promise<ApiResult<KioskClockOutResponse>> => {
    try {
      const r = await kioskHttp.post("/kiosk/clock-out", payload, {
        headers: { "Idempotency-Key": idempotencyKey },
      });
      return r.data;
    } catch (e) {
      return normalizeError(e);
    }
  },

  /**
   * v1.6 — employee self-serve PIN change. Requires current_pin so a
   * stolen tablet can't reset anyone's PIN. Returns 204 on success.
   */
  changePin: async (payload: KioskChangePinPayload): Promise<ApiResult<void>> => {
    try {
      await kioskHttp.post("/kiosk/change-pin", payload);
      return undefined as unknown as void;
    } catch (e) {
      return normalizeError(e);
    }
  },

  /**
   * M31 — clock-in with offline fallback. Tries the network first; on a
   * network-class failure (status 0 / 5xx) enqueues to SQLite and
   * returns a synthetic "queued" success so the kiosk UI can confirm
   * "we got it, will sync later". 4xx errors (wrong PIN, no_active_job,
   * rate limit) STILL bubble up immediately — queuing bad payloads
   * just sends them again later anyway.
   *
   * The caller's idempotency key is persisted with the queued row so
   * the sync worker reuses it on retry.
   */
  clockInWithOfflineFallback: async (
    payload: KioskClockInPayload,
    idempotencyKey: string,
  ): Promise<ApiResult<KioskClockInResponse> | { queued: true; queueId: string }> => {
    const r = await kioskApi.clockIn(payload, idempotencyKey);
    if (!isKioskApiError(r)) return r;
    const networkClass =
      r.status === undefined || r.status === 0 || (r.status >= 500 && r.status < 600);
    if (!networkClass) return r;
    const queueId = await offlineQueue.enqueue("clock_in", payload, idempotencyKey);
    return { queued: true, queueId };
  },

  /** M32 — clock-out with offline fallback. Mirrors clockInWithOfflineFallback. */
  clockOutWithOfflineFallback: async (
    payload: KioskClockOutPayload,
    idempotencyKey: string,
  ): Promise<ApiResult<KioskClockOutResponse> | { queued: true; queueId: string }> => {
    const r = await kioskApi.clockOut(payload, idempotencyKey);
    if (!isKioskApiError(r)) return r;
    const networkClass =
      r.status === undefined || r.status === 0 || (r.status >= 500 && r.status < 600);
    if (!networkClass) return r;
    const queueId = await offlineQueue.enqueue("clock_out", payload, idempotencyKey);
    return { queued: true, queueId };
  },
};

/**
 * Type guard for the queued-fallback variant returned by the *WithOfflineFallback
 * helpers. Lets the kiosk UI branch between "sent and confirmed" and
 * "queued, will sync later".
 */
export function isQueuedResult<T>(
  r: ApiResult<T> | { queued: true; queueId: string },
): r is { queued: true; queueId: string } {
  return typeof r === "object" && r !== null && "queued" in r && r.queued === true;
}
