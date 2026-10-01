/**
 * Analytics bridge for non-component code (sync workers, queue stores).
 *
 * Components use `usePostHog()` directly. Plain modules can't — hooks are
 * component-only, and constructing a second PostHog instance here would
 * double-init the SDK (separate session, duplicated config). Instead the
 * provider tree registers its instance once (see `AnalyticsBridge` in
 * app/_layout.tsx) and workers capture through this holder.
 *
 * Safe by default: unset client or disabled SDK → silent no-op. Never throws,
 * never blocks the calling flow — telemetry must not break user actions.
 */

interface AnalyticsClient {
  capture: (event: string, props?: Record<string, unknown>) => void;
}

let _client: AnalyticsClient | null = null;

export function setAnalyticsClient(client: AnalyticsClient | null): void {
  _client = client;
}

export function track(event: string, props?: Record<string, unknown>): void {
  try {
    _client?.capture(event, props);
  } catch {
    /* telemetry is best-effort */
  }
}
