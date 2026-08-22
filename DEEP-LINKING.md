# Deep linking — invite / claim links open the Kiruko app

Employee invites email a `https://app.kiruko.mu/claim?token=…` link. This makes
that link open the **mobile app** (to set a password + onboard) instead of a web
page. Company-user `/invite` links intentionally stay in the browser (they use
the web dashboard).

## What's implemented (works now)

- **`mobile/app.json`**
  - iOS: `ios.associatedDomains: ["applinks:app.kiruko.mu"]`
  - Android: `android.intentFilters` — `autoVerify` VIEW filter for
    `https://app.kiruko.mu/claim*` only.
  - Custom scheme `kiruko` was already set.
- **`mobile/app/claim.tsx`** — the claim screen: validates the token, sets a
  password (`/account/claim/complete`), logs the user in, and routes a
  fresh employee to profile completion (`/private_dashboard/profile`).
- **`mobile/services/api.tsx`** — `claimValidate()` / `claimComplete()` helpers.

The **custom scheme works immediately** — `kiruko://claim?token=…` opens the app
and drives the screen with no hosting or store publish. Test in dev/TestFlight:

```
npx uri-scheme open "kiruko://claim?token=TESTTOKEN" --ios     # or --android
```

## What still needs YOU before HTTPS universal/app links work

`https://app.kiruko.mu/claim?…` opening the app additionally requires two
association files hosted on **app.kiruko.mu** (the Next.js web app) AND the app
installed from a store/TestFlight. Two values below must be confirmed — do NOT
deploy these with guessed values (Android caches a failed verification):

### 1. iOS — `/.well-known/apple-app-site-association` (no extension, `application/json`)

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "TEAMID.mu.kiruko.app",
        "paths": ["/claim", "/claim/*"]
      }
    ]
  }
}
```

⚠️ **Team ID conflict — confirm which is correct.** `mobile/app.json` declares
`appleTeamId: "U29MDGMN4R"`, but the iOS production build's distribution
certificate was Team `5A98R976WC` (ZILWA EKLERE LTD). The AASA `appID` must use
the Team ID the shipped binary is actually signed under. Confirm with
`eas credentials -p ios` (look at the distribution cert's team) before filling
`TEAMID`.

### 2. Android — `/.well-known/assetlinks.json` (`application/json`)

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.kiruko.app",
      "sha256_cert_fingerprints": ["REPLACE_WITH_SHA256"]
    }
  }
]
```

Get the fingerprint from `eas credentials -p android` (the build keystore's
SHA-256). If you later ship via Google Play App Signing, also add Play's
"App signing key certificate" SHA-256 to the array.

### Hosting on the Next.js app (`web/ivor-web`)

Serve both at `app.kiruko.mu/.well-known/…`. Simplest: put the files under
`web/ivor-web/public/.well-known/`. `assetlinks.json` serves with the right
content-type automatically; for the extension-less `apple-app-site-association`,
add a header rule in `next.config` (or a route handler) so it's returned as
`application/json`.

## Notes

- `marketing/index.html` references the wrong Play package
  (`com.iwugodlabs.kiruko`); the real one is `com.kiruko.app`. Fix when wiring
  the store buttons.
- Until the app is published and the files above are hosted with confirmed
  values, only the `kiruko://` scheme opens the app — the HTTPS links fall back
  to the browser (which is fine: `/claim` on web still works).
