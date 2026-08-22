/**
 * Platform-admin endpoints for sponsored content management.
 *
 * - POST /admin/ads/house    — create a Kontokaz-wide house announcement (kind='house')
 * - GET  /admin/sponsored    — cross-kind moderation listing
 *
 * Phase 2 will add the full ads-management surface here (`/admin/ads/campaigns/*`).
 * Kept separate from `services/announcements.ts` so the company-side and
 * platform-admin concerns don't bleed into each other.
 */
import { api } from '@/services/apiClient';
import type {
    Announcement,
    AnnouncementKind,
    AnnouncementStatus,
    AnnouncementTargeting,
} from './announcements';

export interface CreateHouseInput {
    title: string;
    body: string;
    image_url?: string | null;
    cta_label?: string | null;
    cta_url?: string | null;
    targeting?: AnnouncementTargeting & {
        company_ids?: number[];
        exclude_company_ids?: number[];
        country_codes?: string[];
        roles?: string[];
    };
    start_at?: string | null;
    end_at?: string | null;
    // When set, mobile renders "from {name}" on the card; null/omitted
    // means Kontokaz first-party (existing default).
    external_advertiser_name?: string | null;
}

export async function createHouseAnnouncement(
    input: CreateHouseInput,
): Promise<Announcement> {
    const res = await api.post('/admin/ads/house', {
        kind: 'house',
        funding_company_id: null,
        ...input,
    });
    return res.data;
}

/** Cross-kind PATCH for platform admins. The dedicated /announcements
 *  and /admin/ads/campaigns routers each pin a single kind, so house
 *  rows (and cross-kind moderation actions) had no edit path — this
 *  closes that gap. Status flips + creative edits both go through here. */
export async function patchSponsored(
    id: number,
    patch: {
        status?: AnnouncementStatus;
        title?: string;
        body?: string;
        image_url?: string | null;
        cta_label?: string | null;
        cta_url?: string | null;
        start_at?: string | null;
        end_at?: string | null;
        // Backend accepts targeting JSONB on patch (SponsoredContentPatch);
        // the house form uses this for country_codes. Loose `unknown` so
        // we don't need to model the per-kind targeting shape twice.
        targeting?: Record<string, unknown> | null;
        external_advertiser_name?: string | null;
    },
): Promise<Announcement> {
    const res = await api.patch(`/admin/sponsored/${id}`, patch);
    return res.data;
}

/** Cross-kind soft delete. Idempotent. */
export async function deleteSponsored(id: number): Promise<Announcement> {
    const res = await api.delete(`/admin/sponsored/${id}`);
    return res.data;
}

export interface ModerationListParams {
    kind?: AnnouncementKind;
    status?: AnnouncementStatus;
    funding_company_id?: number;
    include_deleted?: boolean;
    limit?: number;
    offset?: number;
}

export async function listSponsoredModeration(
    opts: ModerationListParams = {},
): Promise<Announcement[]> {
    // Backend's filter param is `status_filter` to avoid shadowing FastAPI's
    // `status` module. Map here so the caller uses a natural name.
    const params: Record<string, string | number | boolean> = {};
    if (opts.kind) params.kind = opts.kind;
    if (opts.status) params.status_filter = opts.status;
    if (opts.funding_company_id !== undefined)
        params.funding_company_id = opts.funding_company_id;
    if (opts.include_deleted) params.include_deleted = true;
    if (opts.limit !== undefined) params.limit = opts.limit;
    if (opts.offset !== undefined) params.offset = opts.offset;

    const res = await api.get('/admin/sponsored', { params });
    return res.data;
}

// ── Eligibility diagnostic (M16) ──────────────────────────────────────────
export type EligibilityCheckLevel = 'ok' | 'fail' | 'info';

export interface EligibilityCheck {
    key: string;
    level: EligibilityCheckLevel;
    label: string;
    detail: string | null;
    hint: string | null;
}

export interface EligibilityReport {
    content_id: number;
    kind: AnnouncementKind;
    status: AnnouncementStatus;
    summary: 'ready' | 'blocked';
    checks: EligibilityCheck[];
    audience: {
        funding_company_id: number | null;
        funding_company_name: string | null;
        total_employees: number | null;
        /** kind='ad' only */
        consenting_employees: number | null;
        /** kind='ad' only */
        ad_free_employees: number | null;
    };
}

/** Runs every serve-time gate for the campaign and returns a structured
 *  pass/fail report. Platform-admin only; the panel consuming this is
 *  rendered behind a role check. */
export async function getSponsoredEligibility(
    contentId: number,
): Promise<EligibilityReport> {
    const res = await api.get(`/admin/sponsored/${contentId}/eligibility`);
    return res.data;
}

// ── Cross-kind stats (works for ad / employer / house) ──────────────────
import type { AnnouncementStats } from './announcements';

export async function getSponsoredStats(
    contentId: number,
    bucket: 'day' | 'hour' = 'day',
): Promise<AnnouncementStats> {
    const res = await api.get(`/admin/sponsored/${contentId}/stats`, {
        params: { bucket },
    });
    return res.data;
}
