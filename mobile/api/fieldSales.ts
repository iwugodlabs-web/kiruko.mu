/**
 * Mobile API client for the field-sales capture surface.
 *
 * Wraps the rep-facing endpoints of `api/v1/commissions.py`:
 *   GET  /companies/{id}/products            (catalog + variants for the picker)
 *   GET  /companies/{id}/outlets             (outlets assigned to the rep)
 *   POST /companies/{id}/sales/sync          (idempotent offline batch flush)
 *   GET  /companies/{id}/sales               (the rep's own submitted sales)
 *   GET  /companies/{id}/commission-leaderboard
 *
 * Routes through the shared `services/apiClient.tsx` axios instance so the
 * mobile-audience JWT header, refresh-on-401, device-binding and platform
 * tagging all apply uniformly (per CLAUDE.md).
 */

import { api } from "../services/apiClient";

export type ApiError = { error: string; status?: number };

export function isApiError(r: unknown): r is ApiError {
  return typeof r === "object" && r !== null && "error" in (r as Record<string, unknown>);
}

export interface CatalogVariant {
  id: number;
  product_id: number;
  sku: string;
  barcode: string | null;
  unit_price: string;
  currency: string;
  is_default: boolean;
}

export interface CatalogProduct {
  id: number;
  name: string;
  category: string | null;
  status: string;
  variants: CatalogVariant[];
}

export interface FieldOutlet {
  id: number;
  name: string;
  code: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number;
}

export interface SyncSaleLine {
  variant_id: number;
  quantity: number;
}

export interface SyncSaleItem {
  client_uuid: string;
  rep_private_user_id: number;
  outlet_id: number | null;
  sold_at: string;
  geo?: { latitude: number; longitude: number } | null;
  currency?: string | null;
  payment_method?: string | null;
  notes?: string | null;
  lines: SyncSaleLine[];
}

export interface SyncItemResult {
  client_uuid: string;
  sale_id: number | null;
  outcome: "created" | "duplicate" | "error";
  detail?: string | null;
}

export interface SyncResult {
  accepted: number;
  duplicates: number;
  errors: number;
  results: SyncItemResult[];
}

export interface RepSaleLine {
  id: number;
  variant_id: number;
  quantity: string;
  unit_price_snapshot: string;
  line_total: string;
  product_id?: number | null;
  product_name?: string | null;
  variant_sku?: string | null;
  uom?: string | null;
}

export interface RepSale {
  id: number;
  outlet_id: number | null;
  sold_at: string;
  status: string;
  payment_status: string;
  payment_method?: string | null;
  currency: string;
  client_uuid: string | null;
  visit_verified: boolean | null;
  visit_distance_m: number | null;
  notes?: string | null;
  lines: RepSaleLine[];
}

export interface LeaderboardRow {
  private_user_id: number;
  name?: string | null;
  amount: string;
}

async function wrap<T>(p: Promise<{ data: T }>): Promise<T | ApiError> {
  try {
    const res = await p;
    return res.data;
  } catch (e: unknown) {
    const err = e as { response?: { data?: { detail?: string }; status?: number }; message?: string };
    return {
      error: err.response?.data?.detail ?? err.message ?? "Request failed",
      status: err.response?.status,
    };
  }
}

export function listCatalog(companyId: number): Promise<CatalogProduct[] | ApiError> {
  return wrap(api.get(`/companies/${companyId}/products`) as Promise<{ data: CatalogProduct[] }>);
}

export function listOutlets(
  companyId: number,
  assignedRepPrivateUserId?: number,
): Promise<FieldOutlet[] | ApiError> {
  const params = assignedRepPrivateUserId
    ? { assigned_rep_private_user_id: assignedRepPrivateUserId }
    : undefined;
  return wrap(api.get(`/companies/${companyId}/outlets`, { params }) as Promise<{ data: FieldOutlet[] }>);
}

/**
 * Flush a batch of captured sales. The endpoint is idempotent on `client_uuid`,
 * so replaying the same item after a dropped response never double-counts.
 */
export function syncSales(
  companyId: number,
  items: SyncSaleItem[],
): Promise<SyncResult | ApiError> {
  return wrap(api.post(`/companies/${companyId}/sales/sync`, { items }) as Promise<{ data: SyncResult }>);
}

export function listMySales(
  companyId: number,
  repPrivateUserId: number,
): Promise<RepSale[] | ApiError> {
  return wrap(
    api.get(`/companies/${companyId}/sales`, {
      params: { rep_private_user_id: repPrivateUserId },
    }) as Promise<{ data: RepSale[] }>,
  );
}

/**
 * Correct a sale's payment method / notes after capture (e.g. the wallet used).
 * Line items are immutable server-side, so this can't change the commission math.
 */
export function updateSale(
  companyId: number,
  saleId: number,
  input: { payment_method?: string | null; notes?: string | null },
): Promise<RepSale | ApiError> {
  return wrap(
    api.patch(`/companies/${companyId}/sales/${saleId}`, input) as Promise<{ data: RepSale }>,
  );
}

/**
 * Void one of the rep's own sales (e.g. a wrong quantity that can't be edited).
 * Voided sales drop out of commission; re-log the corrected sale.
 */
export function voidSale(companyId: number, saleId: number): Promise<RepSale | ApiError> {
  return wrap(
    api.post(`/companies/${companyId}/sales/${saleId}/void`) as Promise<{ data: RepSale }>,
  );
}

export function getLeaderboard(
  companyId: number,
  periodStart: string,
  periodEnd: string,
): Promise<{ period_start?: string; period_end?: string; entries: LeaderboardRow[] } | ApiError> {
  return wrap(
    api.get(`/companies/${companyId}/commission-leaderboard`, {
      params: { period_start: periodStart, period_end: periodEnd },
    }) as Promise<{ data: { entries: LeaderboardRow[] } }>,
  );
}

/**
 * Per-company paid-module entitlements. Returns `null` on network/other error
 * so callers can fail OPEN (keep showing the entry) rather than hiding a paid
 * feature on a transient blip. The backend still 403s if it's really off.
 */
export interface CompanyModuleInfo {
  module_key: string;
  label: string;
  description: string;
  enabled: boolean;
}

export async function getCompanyModules(
  companyId: number,
): Promise<CompanyModuleInfo[] | null> {
  try {
    const res = await api.get(`/companies/${companyId}/modules`);
    return (res.data?.modules ?? []) as CompanyModuleInfo[];
  } catch {
    return null;
  }
}

export async function isFieldSalesEnabled(companyId: number): Promise<boolean> {
  const mods = await getCompanyModules(companyId);
  if (!mods) return true; // fail open
  const m = mods.find((x) => x.module_key === "field_sales");
  return m ? m.enabled : true;
}
