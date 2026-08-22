/**
 * Typed wrappers for the company-side announcements API.
 *
 * Backed by backend/api/v1/announcements.py. Routes through the shared
 * `apiClient` axios instance so auth cookies + silent refresh work uniformly.
 *
 * All endpoints require the caller to be a company admin of their own
 * company; the backend resolves the company_id from the session and returns
 * 403 for cross-company reads/writes.
 */

import { api } from '@/services/apiClient';

// ── Types ─────────────────────────────────────────────────────────────────
export type AnnouncementKind = 'employer' | 'ad' | 'house';
export type AnnouncementStatus = 'draft' | 'active' | 'paused' | 'ended';

export interface AnnouncementTargeting {
  department_ids?: number[];
  job_titles?: string[];
}

export interface Announcement {
  sponsored_content_id: number;
  kind: AnnouncementKind;
  funding_company_id: number | null;
  title: string;
  body: string;
  image_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
  current_version_id: number | null;
  status: AnnouncementStatus;
  surfaces: string[];
  targeting: AnnouncementTargeting;
  start_at: string;
  end_at: string | null;
  base_priority: number;
  paid_amount_cents: number | null;
  paid_currency: string | null;
  payment_notes: string | null;
  variant_group: string | null;
  variant_label: string | null;
  view_count: number;
  click_count: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface AnnouncementVersion {
  version_id: number;
  version_number: number;
  title: string;
  body: string;
  image_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
  created_at: string;
  created_by_user_id: number | null;
}

export interface StatsBucket {
  bucket: string;
  views: number;
  clicks: number;
  dismissals: number;
}

export interface AnnouncementStats {
  sponsored_content_id: number;
  bucket_size: 'day' | 'hour';
  total_views: number;
  total_clicks: number;
  total_dismissals: number;
  ctr: number;
  buckets: StatsBucket[];
}

export interface CreateAnnouncementInput {
  // The backend forces kind='employer' regardless of what's sent, but the
  // schema accepts it for symmetry with /admin/ads/* (Phase 2).
  title: string;
  body: string;
  image_url?: string | null;
  cta_label?: string | null;
  cta_url?: string | null;
  surfaces?: string[];
  targeting?: AnnouncementTargeting;
  start_at?: string | null;
  end_at?: string | null;
  variant_group?: string | null;
  variant_label?: string | null;
}

export interface PatchAnnouncementInput {
  title?: string;
  body?: string;
  image_url?: string | null;
  cta_label?: string | null;
  cta_url?: string | null;
  status?: AnnouncementStatus;
  surfaces?: string[];
  targeting?: AnnouncementTargeting;
  start_at?: string | null;
  end_at?: string | null;
  variant_group?: string | null;
  variant_label?: string | null;
}

// ── Calls ─────────────────────────────────────────────────────────────────
export async function listAnnouncements(opts?: {
  status?: AnnouncementStatus;
  include_deleted?: boolean;
  limit?: number;
  offset?: number;
}): Promise<Announcement[]> {
  const res = await api.get('/announcements', { params: opts });
  return res.data;
}

export async function getAnnouncement(id: number): Promise<Announcement> {
  const res = await api.get(`/announcements/${id}`);
  return res.data;
}

export async function createAnnouncement(
  input: CreateAnnouncementInput,
): Promise<Announcement> {
  const res = await api.post('/announcements', {
    kind: 'employer',
    // funding_company_id is required by the Pydantic schema but the route
    // ignores the value and uses the caller's company_id. Send a sentinel
    // so client-side validation passes; the server overrides.
    funding_company_id: 0,
    ...input,
  });
  return res.data;
}

export async function patchAnnouncement(
  id: number,
  patch: PatchAnnouncementInput,
): Promise<Announcement> {
  const res = await api.patch(`/announcements/${id}`, patch);
  return res.data;
}

export async function deleteAnnouncement(id: number): Promise<Announcement> {
  const res = await api.delete(`/announcements/${id}`);
  return res.data;
}

export async function listAnnouncementVersions(
  id: number,
): Promise<AnnouncementVersion[]> {
  const res = await api.get(`/announcements/${id}/versions`);
  return res.data;
}

export async function getAnnouncementStats(
  id: number,
  bucket: 'day' | 'hour' = 'day',
): Promise<AnnouncementStats> {
  const res = await api.get(`/announcements/${id}/stats`, { params: { bucket } });
  return res.data;
}

export function announcementCsvUrl(id: number): string {
  // Returned as a URL so callers can use it as an <a download> href — the
  // browser streams the response without buffering it in axios.
  return `${api.defaults.baseURL}/announcements/${id}/export.csv`;
}

export async function uploadAnnouncementImage(
  file: File,
): Promise<{ url: string }> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await api.post('/announcements/upload-image', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
}
