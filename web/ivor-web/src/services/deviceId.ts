/**
 * Stable per-browser device identifier for OTP-login device binding.
 *
 * Stored in localStorage. Cleared on cache wipe / incognito — that's
 * by design: a wiped browser re-binds via TOFU (or, for passwordless
 * users, gets `new_device_requires_approval`). Users with a password
 * set bypass device-binding entirely (password is the fallback), so
 * incognito doesn't lock them out.
 *
 * Header contract (read by backend/services/trusted_device_service.py):
 *   X-Device-Id    : `getOrCreateDeviceId()` result (≤ 80 chars)
 *   X-Device-Name  : human-readable, used purely for admin visibility
 */

const STORAGE_KEY = "kontokaz.device-id";

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const fresh = uuid();
    window.localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // Private mode / quota / disabled storage — degrade open. Returning
    // an empty string causes the interceptor to skip the header, and
    // the backend's trusted_device_service treats no-header as "skipped"
    // rather than failing the login.
    return "";
  }
}

export function getDeviceName(): string {
  if (typeof navigator === "undefined") return "Web";
  const ua = navigator.userAgent || "";
  // Tight platform sniff — we just want a human-readable label for the
  // "manage devices" UI; precision isn't required.
  if (/iPhone/.test(ua)) return "Safari on iPhone";
  if (/iPad/.test(ua)) return "Safari on iPad";
  if (/Android/.test(ua)) return "Chrome on Android";
  if (/Edg\//.test(ua)) return "Edge";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "Web";
}
