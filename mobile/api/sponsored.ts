/**
 * Mobile API client for the sponsored-content surface (M7).
 *
 * Wraps the four employee-facing endpoints implemented in M3:
 *   GET  /api/v1/sponsored/serve?surface=home
 *   POST /api/v1/sponsored/views
 *   POST /api/v1/sponsored/clicks
 *   POST /api/v1/sponsored/dismissals
 *
 * Routes through the shared `services/apiClient.tsx` axios instance so the
 * mobile-audience JWT header, refresh-on-401, and platform tagging all apply
 * uniformly (per CLAUDE.md: ALL mobile API calls must use that instance).
 *
 * Notes on /clicks: the server responds with a 302 redirect. We need the
 * destination URL on the client (we open it ourselves with Linking.openURL),
 * so we configure axios to NOT follow the redirect — `maxRedirects: 0` plus
 * a `validateStatus` that treats 302 as success and extracts `Location`.
 */

import { api } from "../services/apiClient";
import type { AxiosResponse } from "axios";

export type SponsoredKind = "employer" | "ad" | "house";

/** Shape returned by GET /api/v1/sponsored/serve when an eligible candidate exists. */
export interface ServedSponsoredContent {
    sponsored_content_id: number;
    version_id: number;
    kind: SponsoredKind;
    funding_company_id: number | null;
    funding_company_name: string | null;
    /** kind='house' only — display name of an external advertiser when
     *  Kontokaz sold the slot to a third party. Null on first-party house. */
    external_advertiser_name: string | null;
    title: string;
    body: string;
    image_url: string | null;
    cta_label: string | null;
    cta_url: string | null;
    /** Server-issued UUIDs the client echoes back on /views and /clicks for idempotency. */
    view_token: string;
    click_token: string;
    surface: string;
}

// Tight timeout for the home slot — the home screen renders without waiting
// for sponsored content; a slow /serve never blocks layout. 3 s is enough
// for a healthy backend and still short enough that a degraded network
// fails fast.
const SERVE_TIMEOUT_MS = 3000;

/**
 * Fetch the next sponsored content to render on `surface`.
 *
 * Returns `null` on:
 *   - server returned no eligible candidate (`200` with `null` body)
 *   - any network/transport error within the timeout window
 *   - HTTP 4xx/5xx (logged but never surfaced — failure mode is "no card")
 *
 * The serve endpoint is wrapped in a 60-second per-user cache server-side
 * so repeat fetches in fast remount scenarios all return the same payload
 * (same view_token), which makes a second /views call a no-op due to the
 * UNIQUE idempotency constraint.
 */
export async function fetchForSurface(
    surface: string = "home",
): Promise<ServedSponsoredContent | null> {
    try {
        const res: AxiosResponse<ServedSponsoredContent | null> = await api.get(
            "/sponsored/serve",
            {
                params: { surface },
                timeout: SERVE_TIMEOUT_MS,
            },
        );
        return res.data ?? null;
    } catch (err) {
        if (__DEV__) {
            console.debug("[sponsored.fetchForSurface] suppressed error:", err);
        }
        return null;
    }
}

export interface LogViewInput {
    sponsored_content_id: number;
    version_id: number;
    view_token: string;
    surface?: string;
}

export async function logView(input: LogViewInput): Promise<void> {
    try {
        await api.post("/sponsored/views", {
            sponsored_content_id: input.sponsored_content_id,
            version_id: input.version_id,
            view_token: input.view_token,
            surface: input.surface ?? "home",
        });
    } catch (err) {
        if (__DEV__) console.debug("[sponsored.logView] suppressed:", err);
    }
}

export interface LogClickInput {
    sponsored_content_id: number;
    version_id: number;
    click_token: string;
}

/**
 * POST /clicks and return the URL to open.
 *
 * The server fetches `cta_url` from the named `version_id` (NOT
 * `current_version_id` — attribution stays locked to whatever the user saw)
 * and returns it as JSON. We open the URL ourselves via `Linking.openURL`.
 *
 * NB: an earlier design had the server return 302 directly. That works in
 * a browser but breaks on React Native — `axios` uses `XMLHttpRequest` under
 * the hood, and XHR auto-follows redirects with no way to disable, so the
 * Location header is gone by the time axios sees the response. JSON works
 * identically on every platform.
 *
 * Returns `null` if the click couldn't be recorded or the server rejected
 * the URL (e.g. scheme blocklist or allowlist mismatch).
 */
export async function logClickAndResolveUrl(
    input: LogClickInput,
): Promise<string | null> {
    try {
        const res = await api.post<{ ok: boolean; redirect_url?: string }>(
            "/sponsored/clicks",
            {
                sponsored_content_id: input.sponsored_content_id,
                version_id: input.version_id,
                click_token: input.click_token,
            },
        );
        return res.data?.redirect_url ?? null;
    } catch (err) {
        if (__DEV__) console.debug("[sponsored.logClick] suppressed:", err);
        return null;
    }
}

export interface LogDismissalInput {
    sponsored_content_id: number;
    surface?: string;
}

export async function logDismissal(input: LogDismissalInput): Promise<void> {
    try {
        await api.post("/sponsored/dismissals", {
            sponsored_content_id: input.sponsored_content_id,
            surface: input.surface ?? "home",
        });
    } catch (err) {
        if (__DEV__) console.debug("[sponsored.logDismissal] suppressed:", err);
    }
}

// ── Consent (M12 / Phase 2) ────────────────────────────────────────────
/**
 * Server-returned consent state. `ads_consent_at` is null when the user has
 * declined or withdrawn; `is_ad_free` is true when serving must be blocked
 * (either explicit decline / withdrawal, or the employer-paid B2B perk).
 * `company_ads_enabled` mirrors `Company.ads_enabled` for the user's
 * employer — used to suppress the first-launch consent modal when the
 * company has ads turned off (no point asking for something they can
 * never see).
 */
export interface ConsentState {
    ok: boolean;
    ads_consent_at: string | null;
    is_ad_free: boolean;
    company_ads_enabled?: boolean;
}

/**
 * Read the authoritative consent state from the server (M13).
 *
 * The Settings → Ad preferences screen uses this to render the toggle's
 * initial position, so a withdrawal made on another device shows up
 * correctly here. Returns `null` on any error — caller falls back to the
 * local AsyncStorage hint.
 */
export async function getAdsConsent(): Promise<ConsentState | null> {
    try {
        const res = await api.get<ConsentState>("/sponsored/consent");
        return res.data;
    } catch (err) {
        if (__DEV__) console.debug("[sponsored.getAdsConsent] suppressed:", err);
        return null;
    }
}

/**
 * Apply the first-launch consent decision.
 *
 *   accepted=true  → server sets ads_consent_at=now; is_ad_free=false.
 *   accepted=false → server clears consent; is_ad_free=true (explicit decline).
 *
 * `policyVersion` is stored in the AuditLog meta so we can prove which
 * privacy-policy revision the user agreed to. Throws on network failure —
 * callers wrap in try/catch so the modal can surface a retry.
 */
export async function postAdsConsent(
    accepted: boolean,
    policyVersion?: string,
): Promise<ConsentState> {
    const res = await api.post<ConsentState>("/sponsored/consent", {
        accepted,
        policy_version: policyVersion ?? null,
    });
    return res.data;
}

/**
 * DPA Article 7-style withdrawal mechanism. Idempotent server-side.
 * Used by the Settings → Ad preferences toggle when the user flips ads off.
 */
export async function withdrawAdsConsent(): Promise<ConsentState> {
    const res = await api.delete<ConsentState>("/sponsored/consent");
    return res.data;
}
