// Single source of truth for kiosk-mode persistence + tablet detection.
// AsyncStorage (not SecureStore) is intentional: possession of the wall-
// mounted tablet already implies access to anything on it, and the same
// threat model is accepted by the web kiosk client (localStorage). Adding
// SecureStore would buy us nothing while pulling in a native dep.

export const KIOSK_STORAGE_KEYS = {
  // boolean-as-string ("1" / null) — true means this device is provisioned
  // as a clock-in kiosk and `app/index.tsx` should bypass the auth gate.
  mode: "@kontokaz/kiosk-mode",
  // raw token in `{device_uuid}.{secret}` form, attached as X-Kiosk-Token.
  token: "@kontokaz/kiosk-token",
  // 4-digit admin PIN set at provisioning. Gates the admin-only surfaces
  // (re-enter token + exit kiosk) so employees stay locked to clock-in — and
  // an admin can re-onboard a dead token WITHOUT uninstalling the app.
  adminPin: "@kontokaz/kiosk-admin-pin",
} as const;

// 600 dp is Material Design's sw600dp tablet breakpoint — the standard
// "this is a tablet, not a phone" cutoff. Phones cap out well below 600dp
// (largest ~430dp), so they stay on the traditional login, while 7"+ Android
// tablets (600dp) and every iPad flip to the kiosk option. The old 768dp
// threshold hid the kiosk on 7–8" tablets.
export const KIOSK_TABLET_MIN_WIDTH = 600;
