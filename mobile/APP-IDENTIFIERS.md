# App Store Identifiers — Kiruko

The app uses **different identifiers per platform**. This is intentional and
correct (not a misconfiguration): `com.kiruko.app` is permanently locked to the
published Google Play app and can never be changed, and it was already taken on
Apple by another developer account (Apple Bundle IDs are globally unique across
all Apple accounts, separate from Google's namespace). They cannot be made to
match, and they don't need to — users only ever see the name "Kiruko".

| Platform | Identifier | Where (`app.json`) |
|---|---|---|
| Android (Google Play) | `com.kiruko.app` | `expo.android.package` |
| iOS (App Store) | `mu.kiruko.app` | `expo.ios.bundleIdentifier` |

Deep-link scheme `kiruko://` is shared (`expo.scheme`) and works on both.

## Two things to remember LATER (not needed yet)

When these features are added, keep the per-platform IDs straight:

### 1. Push notifications
The app uses `expo-notifications`, but push is **not configured yet** on either
platform (build/TestFlight work fine without it; notifications just won't deliver).
When wiring it up:
- **iOS (APNs)** is tied to the iOS Bundle ID **`mu.kiruko.app`**. EAS manages the
  APNs key per Bundle ID automatically (`eas credentials` → iOS → Push Key) — no
  manual mismatch risk.
- **Android (FCM)** is tied to the Android package **`com.kiruko.app`**. Configure
  an **FCM V1 service account key** in EAS (`eas credentials` → Android → FCM V1),
  or add a `google-services.json` whose package is `com.kiruko.app`.
- If you add Firebase, register **two** Firebase apps — iOS with `mu.kiruko.app`,
  Android with `com.kiruko.app`.

### 2. Universal links / App Links
No `associatedDomains` is configured today. If you later add universal links for
`kiruko.mu` (so `https://kiruko.mu/...` opens the app):
- **iOS:** add `applinks:kiruko.mu` to `expo.ios.associatedDomains`, and the
  `apple-app-site-association` file hosted at `https://kiruko.mu/.well-known/`
  must reference **`<APPLE_TEAM_ID>.mu.kiruko.app`** (the iOS Bundle ID).
- **Android:** add the intent-filter / `assetlinks.json` referencing package
  **`com.kiruko.app`** and the app's signing-cert SHA-256.

## iOS build note (for the record)
First iOS build hit Apple's flaky **SMS 2FA** ("verification codes can't be sent
to this phone number"). Workaround used / recommended: an **App Store Connect API
key** (App Store Connect → Users and Access → Integrations → App Store Connect API
→ generate, download the `.p8`, note Key ID + Issuer ID) wired into EAS via
`eas credentials`. This makes iOS builds/submits non-interactive (no Apple login,
no 2FA). See `expo.fyi/apple-2fa-sms-issues-workaround`.
