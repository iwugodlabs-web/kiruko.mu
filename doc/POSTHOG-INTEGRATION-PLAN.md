# PostHog Integration Plan (mobile)

## Context

Deferred to **after** launch (launch is Tue next week). Goal: production JS error
tracking — uncaught exceptions + unhandled promise rejections — and (optionally)
product analytics, session replay, and native crash tracking.

**Decision:** PostHog over Sentry — we get analytics + error tracking in a single
SDK rather than adding a second vendor. Scope for v1 is JS error tracking only;
session replay and native crashes are optional follow-ups (see "Optional" below).

## Cost to be aware of

`posthog-react-native` is a native module + config plugin, so adding it forces a
**new native build and a store resubmission**. Plan it into the next release, not
as an OTA update.

---

## Prerequisites (gather before starting)

| Item | Where | Secret? |
| --- | --- | --- |
| Project API key (`phc_...`) | PostHog → Project settings | No (public, embedded in client) |
| Host | `https://us.i.posthog.com` (US) or `https://eu.i.posthog.com` (EU) | No |
| Personal API key (source-map upload preset) | PostHog → Settings → Personal API keys | **Yes** |
| Project ID | PostHog → Project settings | No |

---

## Steps

### 1. Install SDK + peer deps

```sh
cd mobile
npx expo install posthog-react-native expo-file-system expo-application
```

`expo-device` and `expo-localization` are already installed. `expo-file-system`
is imported directly by the app (`expo-file-system/legacy`) but was only a
transitive dep — this makes it explicit (correct anyway).

### 2. Environment variables

Add to `.env.example` (and local `.env` for dev):

```sh
EXPO_PUBLIC_POSTHOG_API_KEY=
EXPO_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

Add to `eas.json` `production` and `preview` `env`:

```json
"env": {
  "EXPO_PUBLIC_API_URL": "https://api.kiruko.mu/api/v1",
  "EXPO_PUBLIC_POSTHOG_API_KEY": "<phc_project_key>",
  "EXPO_PUBLIC_POSTHOG_HOST": "https://us.i.posthog.com"
}
```

For source-map upload, set these as **EAS secret env vars** (never commit):

```sh
POSTHOG_CLI_API_KEY=<personal_api_key>
POSTHOG_CLI_PROJECT_ID=<project_id>
POSTHOG_CLI_HOST=https://us.posthog.com
```

### 3. Wrap the app in `PostHogProvider`

In `mobile/app/_layout.tsx`, wrap the provider tree (inside `<Suspense>`, outside
the other providers so every screen can use `usePostHog`):

```tsx
import { PostHogProvider } from 'posthog-react-native';

const POSTHOG_API_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

// ...
return (
  <Suspense fallback={<BrandSplash />}>
    <PostHogProvider
      apiKey={POSTHOG_API_KEY}
      options={{
        host: POSTHOG_HOST,
        captureAppLifecycleEvents: true,
        // Disable when no key is configured so a local build never errors.
        disabled: !POSTHOG_API_KEY,
        errorTracking: {
          autocapture: {
            uncaughtExceptions: true,
            unhandledRejections: true,
          },
        },
      }}
    >
      <SQLiteProvider ...>
        {/* existing providers ... */}
      </SQLiteProvider>
    </PostHogProvider>
  </Suspense>
);
```

Notes:
- `disabled: !POSTHOG_API_KEY` means dev builds only send events if the key is
  in `.env`. Add `|| __DEV__` if you want to silence dev events entirely.
- `captureAppLifecycleEvents` gives `Application Opened / Became Active /
  Backgrounded` for free.

### 4. Add the config plugin

In `mobile/app.json`, add to `plugins` (for source-map upload during EAS Build):

```json
["posthog-react-native/expo"]
```

### 5. Wrap Metro config (source-map injection)

`mobile/metro.config.js` currently uses NativeWind's `withNativeWind`. Apply the
PostHog wrapper to the resulting config:

```js
const path = require("path");
const { withNativeWind } = require("nativewind/metro");
const { getDefaultConfig } = require("expo/metro-config");
const { getPostHogExpoConfig } = require("posthog-react-native/metro");

const config = getPostHogExpoConfig(__dirname);
config.resolver.sourceExts.push("sql");
config.watchFolders = [path.resolve(__dirname, "../shared")];

module.exports = withNativeWind(config, { input: "./global.css" });
```

> `getPostHogExpoConfig` returns a standard Expo metro config with PostHog's
> source-map injection; apply NativeWind + our customizations to it (don't call
> `getDefaultConfig` yourself).

### 6. Verify source maps

After a build/update, JS exceptions should show readable stack traces in
PostHog → Error tracking. For OTA updates, upload maps manually after each
`eas update`:

```sh
eas update --platform ios
posthog-cli hermes upload --directory dist
```

---

## Optional (later)

- **Native crash capture** — needs `@posthog/react-native-plugin`, the config
  plugin option `{ "uploadNativeSymbols": true }`, and the "Enable exception
  autocapture" toggle in PostHog.
- **Session replay** — needs `@posthog/react-native-session-replay` + a dev
  build (doesn't work in Expo Go); set `enableSessionReplay: true`.

---

## Verification checklist

- [ ] `npx tsc --noEmit` clean
- [ ] `npx expo-doctor` clean
- [ ] Trigger a test error in a preview build, confirm it appears under
      PostHog → Error tracking with a source-mapped stack
- [ ] Confirm no events leak from dev builds (if `disabled` set)

## Rollback

Remove the plugin + provider + metro wrapper and the `posthog-react-native`
dependency. No backend changes involved.

## Known gotchas

- Use `posthog-react-native` **^4.66** — older versions had a `captureException`
  crash in React Native (`error instanceof Event` with no `Event` global).
- If the Metro dev server was running when env vars were added, do a full
  reload (not Fast Refresh).
