import axios from "axios";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Base URL resolves from EXPO_PUBLIC_API_URL so each build profile targets
// the right backend (see eas.json):
//   - production builds → https://api.kiruko.mu/api/v1 (set in eas.json)
//   - local dev         → put your ngrok tunnel / LAN IP in mobile/.env
//                         (gitignored): EXPO_PUBLIC_API_URL=https://<tunnel>/api/v1
// Falls back to production so a build that forgets the var is still safe.
const PROD_API_URL = "https://api.kiruko.mu/api/v1";
const RESOLVED_API_URL = process.env.EXPO_PUBLIC_API_URL ?? PROD_API_URL;

// GUARD: a production (release) bundle must NEVER talk to a dev/tunnel/LAN
// backend, even if a local `mobile/.env` value leaked in at build or
// `eas update` time (an `eas update` inlines .env and once shipped an ngrok
// URL to production, taking the app fully offline). In a release build
// (__DEV__ === false), if the resolved URL looks dev-like, force production.
// Local dev (expo start, __DEV__ === true) keeps using the .env value.
const isDevLikeUrl = /ngrok|localhost|127\.0\.0\.1|10\.\d|192\.168\.|:8000|:19000/i.test(
  RESOLVED_API_URL,
);
const API_BASE_URL = !__DEV__ && isDevLikeUrl ? PROD_API_URL : RESOLVED_API_URL;
if (!__DEV__ && isDevLikeUrl) {
  console.warn(
    `[apiClient] Ignored dev-like EXPO_PUBLIC_API_URL ("${RESOLVED_API_URL}") in a release build; using ${PROD_API_URL}.`,
  );
}
// Create shared API client instance.
export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Set platform header globally for all requests from this client
api.defaults.headers.common["X-Platform"] = Platform.OS;

// Bind issued tokens to the mobile audience. Backend reads this on /login and
// stamps aud='mobile' on the JWT, which makes the token unusable against
// /admin/* endpoints even if it leaks off the device.
api.defaults.headers.common["X-Client-Platform"] = "mobile";

// Device-binding headers for OTP login (see services/deviceId.ts +
// backend/services/trusted_device_service.py). Attached via interceptor
// rather than as static defaults so the first access can await
// AsyncStorage. Backend ignores these on routes that don't care; only
// /auth/otp/verify currently enforces them.
import { getOrCreateDeviceId, getDeviceName } from "./deviceId";
api.interceptors.request.use(async (cfg) => {
  try {
    const id = await getOrCreateDeviceId();
    cfg.headers = cfg.headers ?? {};
    (cfg.headers as Record<string, string>)["X-Device-Id"] = id;
    (cfg.headers as Record<string, string>)["X-Device-Name"] = getDeviceName();
  } catch {
    // Best-effort — if AsyncStorage is unavailable the backend degrades
    // open per services/trusted_device_service.py (no header = skipped).
  }
  return cfg;
});

// Add request interceptor for better error handling and token guard
api.interceptors.request.use(
  async (config) => {
    // List of public endpoints that don't require authentication
    const publicEndpoints = [
      "/user/login",
      "/user/sign-up",
      "/user/company-sign-up",
      "/password/forgot-password",
      "/password/verify-otp",
      "/password/reset-password",
      "/company/lookup/",
      "/verify/signup",
      "/verify/resend",
      "/auth/otp/request",
      "/auth/otp/verify",
      "/sector/countries",
    ];

    const isPublicEndpoint = publicEndpoints.some((endpoint) =>
      config.url?.startsWith(endpoint),
    );

    if (!isPublicEndpoint) {
      const token = await AsyncStorage.getItem("authToken");
      if (!token && !config.headers.Authorization) {
        console.warn(
          `🛑 API Client: Prevented request to protected endpoint without token: ${config.url}`,
        );
        return Promise.reject({
          message: "No authentication token available",
          config,
          isInternalGuard: true,
        });
      }
    }

    console.log("API Request:", config.method?.toUpperCase(), config.url);
    return config;
  },
  (error) => {
    console.error("API Request Error:", error);
    return Promise.reject(error);
  },
);

// Add response interceptor for better error handling and silent refresh
api.interceptors.response.use(
  (response) => {
    console.log("API Response:", response.status, response.config.url);
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    // Don't log internal guard rejections as response errors
    if (error.isInternalGuard) {
      return Promise.reject(error);
    }

    // Handle error responses
    if (error.response) {
      const isAuthCheck = originalRequest?.url?.includes("/user/me");
      // Any 403 is an authorization denial the caller handles (no-access /
      // empty UI) — never an unexpected crash. Detect by status, not by the
      // wording of `detail`, so variants like "Not permitted to view this
      // vault" (no literal "permission") are still treated as handled.
      const isPermissionDenied = error.response.status === 403;
      if (
        isAuthCheck &&
        (error.response.status === 401 || error.response.status === 403)
      ) {
        // Silent for auth checks as they are expected to fail sometimes
        console.log(
          "🔑 API Client: Auth check returned unauthorized (expected if logged out)",
        );
      } else if (isPermissionDenied) {
        // Expected when a delegated company role lacks a permission. Screen-level
        // PermissionGates stop most of these, but secondary/incidental fetches
        // can still reach the wire — log quietly so it doesn't look like a crash.
        console.log(
          "🔒 API Client: permission denied (handled):",
          originalRequest?.url,
        );
      } else {
        console.error(
          "API Response Error:",
          error.response.status,
          error.response.data || error.message,
        );
      }
    } else {
      console.error("API Error:", error.message);
    }

    // Handle 401 Unauthorized errors (token expired)
    if (error.response?.status === 401 && !originalRequest._retry) {
      console.log("🔄 API Client: Token expired, attempting silent refresh...");
      originalRequest._retry = true;

      try {
        const refreshToken = await AsyncStorage.getItem("refreshToken");

        if (!refreshToken) {
          console.log("❌ API Client: No refresh token available, logging out");
          // We can't log out directly from here without circular dependencies usually,
          // but we can let the AuthProvider handle the 401.
          return Promise.reject(error);
        }

        console.log("🔄 API Client: Calling /user/refresh-token...");
        const response = await axios.post(
          `${api.defaults.baseURL}/user/refresh-token`,
          {
            refresh_token: refreshToken,
          },
        );

        if (response.data.status === "success" && response.data.access_token) {
          const newToken = response.data.access_token;
          console.log(
            "✅ API Client: Refresh successful, retrying original request",
          );

          // Store new token
          await AsyncStorage.setItem("authToken", newToken);

          // Update axios defaults for future requests
          api.defaults.headers.Authorization = `Bearer ${newToken}`;

          // Retry original request with new token
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          return api(originalRequest);
        }
      } catch (refreshError) {
        console.error("❌ API Client: Silent refresh failed:", refreshError);
        // Clear tokens and logout happens via AuthProvider or by rejecting
        await AsyncStorage.multiRemove(["authToken", "refreshToken"]);
        return Promise.reject(refreshError);
      }
    }

    // Handle network errors
    if (error.code === "NETWORK_ERROR" || error.message === "Network Error") {
      console.error("Network connectivity issue detected");
    }

    return Promise.reject(error);
  },
);

// Export for use in other services and contexts
export default api;
