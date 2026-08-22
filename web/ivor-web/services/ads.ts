/**
 * Platform-admin endpoints for kind='ad' campaign management (M10/M11).
 *
 * Lives next to `services/sponsored-admin.ts` (house + moderation) and the
 * company-side `services/announcements.ts`. Kept distinct because the
 * permission model + UI surfaces are different: only platform admins land
 * on `/admin/ads/*`, and the campaign type carries advertiser + payment
 * fields the other kinds never touch.
 *
 * All calls route through the shared `apiClient` axios instance for auth +
 * silent refresh, same pattern as the rest of `services/`.
 */

import { api } from '@/services/apiClient';
import type {
    Announcement,
    AnnouncementStats,
    AnnouncementStatus,
    AnnouncementVersion,
} from './announcements';

// ── Types ─────────────────────────────────────────────────────────────────
export interface AdTargeting {
    company_ids?: number[];
    exclude_company_ids?: number[];
    country_codes?: string[];
    roles?: string[];
    /** M14 — narrow to specific departments within allow-listed companies.
     *  Combined AND with company_ids on the serve side. Empty/undefined =
     *  all departments of the allow-listed companies. */
    department_ids?: number[];
}

export interface CreateAdInput {
    funding_company_id: number;            // advertiser (required by per-kind invariant)
    title: string;
    body: string;
    image_url?: string | null;
    cta_label?: string | null;
    cta_url?: string | null;
    surfaces?: string[];
    targeting?: AdTargeting;
    start_at?: string | null;
    end_at?: string | null;
    base_priority?: number | null;
    paid_amount_cents: number;             // required for kind='ad'
    paid_currency: string;                 // ISO 4217, e.g. "MUR"
    payment_notes?: string | null;
    variant_group?: string | null;
    variant_label?: string | null;
}

export interface PatchAdInput {
    title?: string;
    body?: string;
    image_url?: string | null;
    cta_label?: string | null;
    cta_url?: string | null;
    status?: AnnouncementStatus;
    surfaces?: string[];
    targeting?: AdTargeting;
    start_at?: string | null;
    end_at?: string | null;
    base_priority?: number | null;
    paid_amount_cents?: number | null;
    paid_currency?: string | null;
    payment_notes?: string | null;
    variant_group?: string | null;
    variant_label?: string | null;
}

// Result rows reuse the company-side `Announcement` type — the backend
// returns the same SponsoredContent row shape regardless of kind.
export type AdCampaign = Announcement;

// ── List / get ────────────────────────────────────────────────────────────
export async function listAdCampaigns(opts?: {
    status?: AnnouncementStatus;
    funding_company_id?: number;
    include_deleted?: boolean;
    limit?: number;
    offset?: number;
}): Promise<AdCampaign[]> {
    // Backend names the status param `status_filter` (avoids shadowing
    // FastAPI's status module) — translate here so callers use a natural key.
    const params: Record<string, string | number | boolean> = {};
    if (opts?.status) params.status_filter = opts.status;
    if (opts?.funding_company_id !== undefined)
        params.funding_company_id = opts.funding_company_id;
    if (opts?.include_deleted) params.include_deleted = true;
    if (opts?.limit !== undefined) params.limit = opts.limit;
    if (opts?.offset !== undefined) params.offset = opts.offset;

    const res = await api.get('/admin/ads/campaigns', { params });
    return res.data;
}

export async function getAdCampaign(id: number): Promise<AdCampaign> {
    const res = await api.get(`/admin/ads/campaigns/${id}`);
    return res.data;
}

// ── Mutations ─────────────────────────────────────────────────────────────
export async function createAdCampaign(input: CreateAdInput): Promise<AdCampaign> {
    // The backend pins kind='ad' regardless of body — we send it explicitly
    // anyway so the Pydantic Create schema's discriminator check passes.
    const res = await api.post('/admin/ads/campaigns', {
        kind: 'ad',
        ...input,
    });
    return res.data;
}

export async function patchAdCampaign(
    id: number,
    patch: PatchAdInput,
): Promise<AdCampaign> {
    const res = await api.patch(`/admin/ads/campaigns/${id}`, patch);
    return res.data;
}

export async function deleteAdCampaign(id: number): Promise<AdCampaign> {
    const res = await api.delete(`/admin/ads/campaigns/${id}`);
    return res.data;
}

// ── Versions / stats / CSV ────────────────────────────────────────────────
export async function listAdVersions(id: number): Promise<AnnouncementVersion[]> {
    const res = await api.get(`/admin/ads/campaigns/${id}/versions`);
    return res.data;
}

export async function getAdStats(
    id: number,
    bucket: 'day' | 'hour' = 'day',
): Promise<AnnouncementStats> {
    const res = await api.get(`/admin/ads/campaigns/${id}/stats`, {
        params: { bucket },
    });
    return res.data;
}

export function adCsvUrl(id: number): string {
    // Streamed by the backend; using an <a download> href is correct.
    return `${api.defaults.baseURL}/admin/ads/campaigns/${id}/export.csv`;
}

// ── Image upload ──────────────────────────────────────────────────────────
export async function uploadAdImage(file: File): Promise<{ url: string }> {
    const fd = new FormData();
    fd.append('file', file);
    const res = await api.post('/admin/ads/upload-image', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data;
}

// ── Per-company master toggle ─────────────────────────────────────────────
export async function setCompanyAdsEnabled(
    companyId: number,
    enabled: boolean,
): Promise<{ company_id: number; ads_enabled: boolean }> {
    const res = await api.post(`/admin/companies/${companyId}/ads-enabled`, {
        enabled,
    });
    return res.data;
}
