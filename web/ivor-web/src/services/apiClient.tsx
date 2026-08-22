import axios from 'axios';
import { getOrCreateDeviceId, getDeviceName } from './deviceId';

// Web-specific API client — requests go to /api/v1/* on same domain,
// Next.js server-side rewrites proxy them to BACKEND_URL (no CORS, no build-time env needed)
const baseURL = '/api/v1';

export const api = axios.create({
  baseURL,
  timeout: 15000,
  withCredentials: true, // IMPORTANT: Enable sending cookies!
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(
  (config) => {
    // Minimal logging for dev
    if (process.env.NODE_ENV !== 'production') {
      console.debug('API Request:', config.method?.toUpperCase(), config.url);
    }
    // Device-binding headers for OTP login (see services/deviceId.ts +
    // backend/services/trusted_device_service.py). Backend ignores
    // these on routes that don't care; only /auth/otp/verify currently
    // enforces them. getOrCreateDeviceId returns "" in private mode →
    // backend then degrades open (skipped, not rejected).
    const deviceId = getOrCreateDeviceId();
    if (deviceId) {
      config.headers = config.headers ?? {};
      (config.headers as Record<string, string>)['X-Device-Id'] = deviceId;
      (config.headers as Record<string, string>)['X-Device-Name'] = getDeviceName();
    }
    // FormData uploads: the browser MUST set Content-Type itself so it includes
    // the multipart boundary. The default 'application/json' (or a hand-set
    // 'multipart/form-data' without a boundary) makes the backend unable to
    // parse the form → 422 and a silently-failing upload. Strip it so the
    // browser fills in `multipart/form-data; boundary=…`.
    if (typeof FormData !== 'undefined' && config.data instanceof FormData && config.headers) {
      delete (config.headers as Record<string, string>)['Content-Type'];
      delete (config.headers as Record<string, string>)['content-type'];
    }
    // No more localStorage. Cookies are handled by withCredentials.
    return config;
  },
  (error) => Promise.reject(error)
);

// Session-expiry handler. When the silent refresh fails (refresh token also
// expired/missing), a dashboard tab left open would otherwise keep polling
// (notifications, dashboard stats, …) every ~minute forever — each tick logging
// a `protected 401 → refresh 401` pair on the server. Clearing the hint and
// redirecting to login once unmounts those pollers and breaks the loop. Guarded
// so concurrent in-flight 401s trigger at most one redirect, and never from a
// public page (avoids a redirect loop on the login screen itself).
let _sessionExpiryHandled = false;
function handleSessionExpired() {
  if (typeof window === 'undefined' || _sessionExpiryHandled) return;
  try { localStorage.removeItem('auth_hint'); } catch { /* private mode */ }
  const path = window.location.pathname;
  if (path === '/' || path.startsWith('/accept-invite')) return; // already public
  _sessionExpiryHandled = true;
  window.location.replace('/');
}

// Single-flight refresh: when several requests 401 at once (token expiry during
// a dashboard load or a poll tick), share ONE refresh call instead of each
// firing its own — prevents refresh storms and inconsistent outcomes.
let _refreshPromise: Promise<import('axios').AxiosResponse> | null = null;
function refreshTokenOnce() {
  if (!_refreshPromise) {
    _refreshPromise = axios
      .post(`${baseURL}/user/refresh-token`, null, { withCredentials: true })
      .finally(() => { _refreshPromise = null; });
  }
  return _refreshPromise;
}

// Raw session probe (bypasses THIS interceptor to avoid recursion). Confirms the
// session is truly dead before redirecting to login — a single endpoint's 401 or
// a refresh hiccup must not log the user out while the session is still valid
// (the "logged out abruptly, but a reload puts me back in" bug).
async function sessionIsAlive(): Promise<boolean> {
  try {
    const r = await axios.get(`${baseURL}/user/me`, { withCredentials: true });
    return r.status >= 200 && r.status < 300;
  } catch {
    return false;
  }
}

api.interceptors.response.use(
  (resp) => resp,
  async (error) => {
    const originalRequest = error.config;

    // Silent refresh on 401: attempt one token refresh, then retry the original
    // request. Runs in all environments (cookies are sent via withCredentials).
    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const refresh = await refreshTokenOnce();
        if (refresh.data?.status === 'success') {
          return api(originalRequest);
        }
        // 200 but not success — only end the session if it's ACTUALLY dead.
        if (!(await sessionIsAlive())) handleSessionExpired();
      } catch (refreshErr: any) {
        // Refresh rejected. Only treat as a dead session if a session probe ALSO
        // fails — a single endpoint's 401 (or a refresh hiccup) must not log the
        // user out while the session is still valid. Transient/network errors
        // (no response status) leave the tab alone.
        const rs = refreshErr?.response?.status;
        if (rs === 401 || rs === 403) {
          if (!(await sessionIsAlive())) handleSessionExpired();
        }
      }
    }

    if (process.env.NODE_ENV !== 'production') {
      const status = error.response?.status;
      const url = error.config?.url || error.request?.responseURL || '<unknown>';
      // Downgrade expected auth/permission/missing errors to warnings to avoid noisy console errors
      if (status === 401 || status === 403 || status === 404) {
        // Suppress logs specifically for the dashboard stats or missing bank details (expected states)
        if (url && (url.toString().includes('/dashboard/stats') || url.toString().includes('/payroll/bank-details'))) {
          console.debug(`API Response (${status}) for ${url}: suppressed/downgraded`);
        } else {
          console.warn(`API Response (${status}) for ${url}:`, error.response?.data || error.message);
        }
      } else {
        // Everything else (5xx, gateway, network, CORS) — warn only. Callers
        // surface errors via in-app state/modals; a red console.error here only
        // adds noise for flows that are handled gracefully (e.g. the geocode
        // proxy 502 until Places/Geocoding APIs are enabled).
        console.warn(`API Response (${status}) for ${url}:`, error.response?.data || error.message);
      }
    }
    return Promise.reject(error);
  }
);

// Safe wrapper for GET /dashboard/stats that returns structured errors instead of throwing
export const getCompanyDashboardStats = async (period?: string, departmentId?: number) => {
  try {
    const resp = await api.get('/dashboard/stats', { params: { period, department_id: departmentId } });
    return resp.data;
  } catch (error: any) {
    // Normalize the error so callers can handle 403/401 gracefully
    const status = error.response?.status || 500;
    const detail = error.response?.data?.detail || error.response?.data || error.message || 'Unexpected error';
    return { error: detail, status };
  }
};

// Safe wrapper for GET /user/me
export const getCurrentUser = async () => {
  try {
    const resp = await api.get('/user/me');
    return resp.data;
  } catch (error: any) {
    const status = error.response?.status || 500;
    const detail = error.response?.data?.detail || error.response?.data || error.message || 'Unexpected error';
    return { error: detail, status };
  }
};

export default api;
