/**
 * Stable per-install device identifier for OTP-login device binding.
 *
 * Generated once on first read and persisted in AsyncStorage. Cleared
 * on app uninstall — that's by design: a wiped device should re-bind
 * via TOFU (or, for passwordless users, require admin approval if
 * other devices are already on file). For users with a password set,
 * the backend bypasses device binding entirely (password is the
 * fallback channel), so reinstall doesn't lock them out.
 *
 * Why not `expo-application.getAndroidId()` / `getIosIdForVendorAsync`?
 * They survive reinstalls (slightly better for the trust model) but
 * require adding `expo-application` as a dep. The AsyncStorage UUID is
 * good enough for pilot — the threat model we're really mitigating is
 * phone-number recycling, not reinstall-as-attack. We can upgrade
 * later without changing the wire contract.
 *
 * Header contract (read by backend/services/trusted_device_service.py):
 *   X-Device-Id    : `getOrCreateDeviceId()` result (≤ 80 chars)
 *   X-Device-Name  : human-readable, used purely for admin visibility
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Device from "expo-device";
import { Platform } from "react-native";

const STORAGE_KEY = "@kontokaz/device-id";

let _cached: string | null = null;

function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function getOrCreateDeviceId(): Promise<string> {
  if (_cached) return _cached;
  try {
    const existing = await AsyncStorage.getItem(STORAGE_KEY);
    if (existing) {
      _cached = existing;
      return existing;
    }
  } catch {
    /* fall through to generate */
  }
  const fresh = uuid();
  try {
    await AsyncStorage.setItem(STORAGE_KEY, fresh);
  } catch {
    // Even if persistence fails, return the fresh value so this session
    // still attaches a device ID; next launch will get a different one,
    // which the backend treats as a new-device-attempt. Acceptable.
  }
  _cached = fresh;
  return fresh;
}

export function getDeviceName(): string {
  // Best-effort human label. expo-device's brand+modelName gives
  // "Apple iPhone 12", "Samsung SM-G991U", etc.; falls back to the
  // platform name if both are unavailable (rare).
  const parts = [Device.brand, Device.modelName].filter(Boolean);
  if (parts.length) return parts.join(" ");
  return Platform.OS === "ios" ? "iOS device" : "Android device";
}
