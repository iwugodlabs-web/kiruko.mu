import { api } from "./apiClient";

// ---------------------------------------------------------------------------
// Types (mirror backend schema/field_sales_schema.py)
// ---------------------------------------------------------------------------

export interface ProductVariant {
  id: number;
  product_id: number;
  sku: string;
  barcode?: string | null;
  unit_price: string;
  currency: string;
  is_default: boolean;
  sell_uom_id?: number | null;
  status: string;
}

export interface Product {
  id: number;
  company_id: number;
  name: string;
  brand?: string | null;
  category?: string | null;
  status: string;
  variants: ProductVariant[];
}

export interface ProductCategory {
  id: number;
  company_id: number;
  parent_id?: number | null;
  name: string;
}

export interface UnitOfMeasure {
  id: number;
  company_id: number;
  code: string;
  name: string;
  base_uom_id?: number | null;
  factor: string;
}

export interface Outlet {
  id: number;
  company_id: number;
  name: string;
  code?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  radius_meters: number;
  assigned_rep_private_user_id?: number | null;
}

export interface SaleLine {
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

export interface Sale {
  id: number;
  company_id: number;
  rep_private_user_id: number;
  credited_to_private_user_id?: number | null;
  outlet_id?: number | null;
  sold_at: string;
  status: string;
  payment_status: string;
  payment_method?: string | null;
  collected_amount?: string | null;
  collected_at?: string | null;
  currency: string;
  source: string;
  client_uuid?: string | null;
  visit_verified?: boolean | null;
  visit_distance_m?: number | null;
  reviewed_by_user_id?: number | null;
  reviewed_at?: string | null;
  notes?: string | null;
  lines: SaleLine[];
}

export interface CommissionRule {
  id: number;
  plan_id: number;
  rule_type: string;
  params: Record<string, unknown>;
  scope_category?: string | null;
  scope_product_id?: number | null;
  scope_variant_id?: number | null;
  scope_option_value_id?: number | null;
  effective_from?: string | null;
  effective_to?: string | null;
}

export interface CommissionPlan {
  id: number;
  company_id: number;
  name: string;
  description?: string | null;
  trigger: string;
  status: string;
  version: number;
  family_id?: number | null;
  effective_from?: string | null;
  effective_to?: string | null;
  created_by_user_id?: number | null;
  approved_by_user_id?: number | null;
  approved_at?: string | null;
  rules: CommissionRule[];
}

export interface PlanAssignment {
  id: number;
  plan_id: number;
  private_user_id: number;
  effective_from?: string | null;
  effective_to?: string | null;
}

export interface CommissionRunSummary {
  id: number;
  company_id: number;
  period_start: string;
  period_end: string;
  status: string;
  currency: string;
  computed_at?: string | null;
  approved_at?: string | null;
  payable_total: string;
}

export interface CommissionLineItem {
  id: number;
  run_id: number;
  private_user_id: number;
  rule_id?: number | null;
  amount: string;
  currency: string;
  trace?: Record<string, unknown> | null;
}

export interface CommissionPayable {
  id: number;
  company_id: number;
  private_user_id: number;
  run_id: number;
  amount: string;
  currency: string;
  payout_channel: string;
  status: string;
  one_off_allowance_id?: number | null;
  settled_at?: string | null;
}

export interface CommissionRun extends CommissionRunSummary {
  line_items: CommissionLineItem[];
  payables: CommissionPayable[];
}

export interface LeaderboardEntry {
  private_user_id: number;
  name?: string | null;
  amount: string;
}

export interface Leaderboard {
  period_start?: string | null;
  period_end?: string | null;
  entries: LeaderboardEntry[];
}

export interface LiabilityAccrual {
  company_id: number;
  pending_payroll: string;
  settled_pending_payslip: string;
  total_outstanding: string;
  currency: string;
}

export interface SalesTarget {
  id: number;
  company_id: number;
  private_user_id: number;
  period_start: string;
  period_end: string;
  scope_category?: string | null;
  target_amount?: string | null;
  target_units?: string | null;
  accelerators?: Array<Record<string, unknown>> | null;
}

export interface CreditAssignment {
  id: number;
  company_id: number;
  private_user_id: number;
  outlet_id?: number | null;
  territory?: string | null;
  account?: string | null;
  split_percent: string;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export async function listProducts(companyId: number, includeArchived = false): Promise<Product[]> {
  const res = await api.get(`/companies/${companyId}/products`, {
    params: { include_archived: includeArchived },
  });
  return res.data;
}

export async function createProduct(companyId: number, input: Record<string, unknown>): Promise<Product> {
  const res = await api.post(`/companies/${companyId}/products`, input);
  return res.data;
}

export async function updateProduct(
  companyId: number,
  productId: number,
  input: { name?: string; brand?: string | null; category?: string | null; status?: string },
): Promise<Product> {
  const res = await api.patch(`/companies/${companyId}/products/${productId}`, input);
  return res.data;
}

export async function listCategories(companyId: number): Promise<ProductCategory[]> {
  const res = await api.get(`/companies/${companyId}/product-categories`);
  return res.data;
}

export async function createCategory(companyId: number, input: { name: string; parent_id?: number | null }): Promise<ProductCategory> {
  const res = await api.post(`/companies/${companyId}/product-categories`, input);
  return res.data;
}

export async function updateCategory(
  companyId: number,
  categoryId: number,
  input: { name?: string; parent_id?: number | null },
): Promise<ProductCategory> {
  const res = await api.patch(`/companies/${companyId}/product-categories/${categoryId}`, input);
  return res.data;
}

export async function deleteCategory(
  companyId: number,
  categoryId: number,
  reassignTo?: string | null,
): Promise<{ deleted: number; reparented_children: number; products_retagged: number }> {
  const res = await api.delete(`/companies/${companyId}/product-categories/${categoryId}`, {
    params: reassignTo ? { reassign_to: reassignTo } : undefined,
  });
  return res.data;
}

export async function archiveProduct(companyId: number, productId: number, archived: boolean): Promise<Product> {
  const action = archived ? "archive" : "unarchive";
  const res = await api.post(`/companies/${companyId}/products/${productId}/${action}`);
  return res.data;
}

export async function deleteProduct(companyId: number, productId: number): Promise<void> {
  await api.delete(`/companies/${companyId}/products/${productId}`);
}

export async function deleteUom(companyId: number, uomId: number): Promise<void> {
  await api.delete(`/companies/${companyId}/units-of-measure/${uomId}`);
}

export async function listUoms(companyId: number): Promise<UnitOfMeasure[]> {
  const res = await api.get(`/companies/${companyId}/units-of-measure`);
  return res.data;
}

export async function createUom(companyId: number, input: Record<string, unknown>): Promise<UnitOfMeasure> {
  const res = await api.post(`/companies/${companyId}/units-of-measure`, input);
  return res.data;
}

export async function createVariant(companyId: number, productId: number, input: Record<string, unknown>): Promise<ProductVariant> {
  const res = await api.post(`/companies/${companyId}/products/${productId}/variants`, input);
  return res.data;
}

export async function updateVariant(
  companyId: number,
  productId: number,
  variantId: number,
  input: {
    sku?: string;
    barcode?: string | null;
    unit_price?: string;
    currency?: string;
    is_default?: boolean;
    sell_uom_id?: number | null;
    status?: string;
  },
): Promise<ProductVariant> {
  const res = await api.patch(`/companies/${companyId}/products/${productId}/variants/${variantId}`, input);
  return res.data;
}

export async function deleteVariant(companyId: number, productId: number, variantId: number): Promise<void> {
  await api.delete(`/companies/${companyId}/products/${productId}/variants/${variantId}`);
}

export interface ProductPrice {
  id: number;
  company_id: number;
  variant_id: number;
  amount: string;
  currency: string;
  territory?: string | null;
  effective_from?: string | null;
  effective_to?: string | null;
  reference?: string | null;
}

export async function listPrices(companyId: number, productId: number, variantId: number): Promise<ProductPrice[]> {
  const res = await api.get(`/companies/${companyId}/products/${productId}/variants/${variantId}/prices`);
  return res.data;
}

export async function createPrice(companyId: number, input: Record<string, unknown>): Promise<ProductPrice> {
  const res = await api.post(`/companies/${companyId}/product-prices`, input);
  return res.data;
}

// ---------------------------------------------------------------------------
// Outlets
// ---------------------------------------------------------------------------

export async function listOutlets(companyId: number, includeArchived = false): Promise<Outlet[]> {
  const res = await api.get(`/companies/${companyId}/outlets`, {
    params: { include_archived: includeArchived },
  });
  return res.data;
}

export async function createOutlet(companyId: number, input: Record<string, unknown>): Promise<Outlet> {
  const res = await api.post(`/companies/${companyId}/outlets`, input);
  return res.data;
}

export async function updateOutlet(
  companyId: number,
  outletId: number,
  input: Record<string, unknown>,
): Promise<Outlet> {
  const res = await api.patch(`/companies/${companyId}/outlets/${outletId}`, input);
  return res.data;
}

export async function archiveOutlet(companyId: number, outletId: number, archived: boolean): Promise<Outlet> {
  const action = archived ? "archive" : "unarchive";
  const res = await api.post(`/companies/${companyId}/outlets/${outletId}/${action}`);
  return res.data;
}

export async function deleteOutlet(companyId: number, outletId: number): Promise<void> {
  await api.delete(`/companies/${companyId}/outlets/${outletId}`);
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

export interface SaleListFilters {
  period_start?: string;
  period_end?: string;
  rep_private_user_id?: number;
  status?: string;
  outlet_id?: number;
  payment_status?: string;
  payment_method?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export async function listSales(companyId: number, opts?: SaleListFilters): Promise<Sale[]> {
  const res = await api.get(`/companies/${companyId}/sales`, { params: opts });
  return res.data;
}

// Server-side paged variant: uses the X-Total-Count header the backend sets
// when limit/offset is present so the pager can show "x–y of n".
export async function pageSales(
  companyId: number,
  opts: SaleListFilters,
): Promise<{ items: Sale[]; total: number }> {
  const res = await api.get(`/companies/${companyId}/sales`, { params: opts });
  const total = Number(res.headers["x-total-count"] ?? res.data.length);
  return { items: res.data, total };
}

export async function createSale(
  companyId: number,
  input: {
    rep_private_user_id: number;
    credited_to_private_user_id?: number | null;
    outlet_id?: number | null;
    sold_at: string;
    payment_status?: string;
    payment_method?: string | null;
    collected_amount?: number | null;
    currency?: string;
    notes?: string | null;
    lines: Array<{ variant_id: number; quantity: number; unit_price?: number }>;
  },
): Promise<Sale> {
  const res = await api.post(`/companies/${companyId}/sales`, input);
  return res.data;
}

export interface SaleBulkReviewResult {
  decision: string;
  succeeded: number;
  failed: number;
  results: Array<{ sale_id: number; ok: boolean; status?: string | null; detail?: string | null }>;
}

export async function bulkReviewSales(
  companyId: number,
  saleIds: number[],
  decision: "approve" | "reject",
  notes?: string,
): Promise<SaleBulkReviewResult> {
  const res = await api.post(`/companies/${companyId}/sales/review-bulk`, {
    sale_ids: saleIds,
    decision,
    notes,
  });
  return res.data;
}

export async function listPendingSales(companyId: number): Promise<Sale[]> {
  const res = await api.get(`/companies/${companyId}/sales/pending`);
  return res.data;
}

export async function getSale(companyId: number, saleId: number): Promise<Sale> {
  const res = await api.get(`/companies/${companyId}/sales/${saleId}`);
  return res.data;
}

export interface SaleUpdateInput {
  payment_status?: string;
  payment_method?: string | null;
  collected_amount?: number | null;
  outlet_id?: number | null;
  notes?: string | null;
}

export async function updateSale(
  companyId: number,
  saleId: number,
  input: SaleUpdateInput,
): Promise<Sale> {
  const res = await api.patch(`/companies/${companyId}/sales/${saleId}`, input);
  return res.data;
}

export async function reopenSale(
  companyId: number,
  saleId: number,
  status: "approved" | "submitted" = "approved",
): Promise<Sale> {
  const res = await api.post(`/companies/${companyId}/sales/${saleId}/reopen`, { status });
  return res.data;
}

export async function reviewSale(
  companyId: number,
  saleId: number,
  decision: "approve" | "reject",
  notes?: string,
): Promise<Sale> {
  const res = await api.post(`/companies/${companyId}/sales/${saleId}/review`, { decision, notes });
  return res.data;
}

export async function voidSale(companyId: number, saleId: number): Promise<Sale> {
  const res = await api.post(`/companies/${companyId}/sales/${saleId}/void`);
  return res.data;
}

// ---------------------------------------------------------------------------
// Commission plans + assignments
// ---------------------------------------------------------------------------

export async function listPlans(companyId: number, includeArchived = false): Promise<CommissionPlan[]> {
  const res = await api.get(`/companies/${companyId}/commission-plans`, {
    params: { include_archived: includeArchived },
  });
  return res.data;
}

export async function createPlan(companyId: number, input: Record<string, unknown>): Promise<CommissionPlan> {
  const res = await api.post(`/companies/${companyId}/commission-plans`, input);
  return res.data;
}

export async function listAssignments(companyId: number, planId: number): Promise<PlanAssignment[]> {
  const res = await api.get(`/companies/${companyId}/commission-plans/${planId}/assignments`);
  return res.data;
}

export async function assignPlan(companyId: number, planId: number, input: Record<string, unknown>): Promise<PlanAssignment> {
  const res = await api.post(`/companies/${companyId}/commission-plans/${planId}/assignments`, input);
  return res.data;
}

export async function listPlanVersions(companyId: number, planId: number): Promise<CommissionPlan[]> {
  const res = await api.get(`/companies/${companyId}/commission-plans/${planId}/versions`);
  return res.data;
}

export async function revisePlan(companyId: number, planId: number, input: Record<string, unknown>): Promise<CommissionPlan> {
  const res = await api.put(`/companies/${companyId}/commission-plans/${planId}`, input);
  return res.data;
}

export async function activatePlan(companyId: number, planId: number, effectiveFrom?: string | null): Promise<CommissionPlan> {
  const res = await api.post(
    `/companies/${companyId}/commission-plans/${planId}/activate`,
    effectiveFrom ? { effective_from: effectiveFrom } : {},
  );
  return res.data;
}

export async function archivePlan(companyId: number, planId: number): Promise<CommissionPlan> {
  const res = await api.post(`/companies/${companyId}/commission-plans/${planId}/archive`);
  return res.data;
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export async function listRuns(companyId: number): Promise<CommissionRunSummary[]> {
  const res = await api.get(`/companies/${companyId}/commission-runs`);
  return res.data;
}

export async function getRun(companyId: number, runId: number): Promise<CommissionRun> {
  const res = await api.get(`/companies/${companyId}/commission-runs/${runId}`);
  return res.data;
}

export async function computeRun(companyId: number, periodStart: string, periodEnd: string): Promise<CommissionRun> {
  const res = await api.post(`/companies/${companyId}/commission-runs`, {
    period_start: periodStart,
    period_end: periodEnd,
  });
  return res.data;
}

export async function approveRun(companyId: number, runId: number): Promise<CommissionRun> {
  const res = await api.post(`/companies/${companyId}/commission-runs/${runId}/approve`);
  return res.data;
}

export async function pushRun(
  companyId: number,
  runId: number,
  input?: { payable_in_year?: number; payable_in_month?: number },
): Promise<Record<string, unknown>> {
  const res = await api.post(`/companies/${companyId}/commission-runs/${runId}/push-to-payroll`, input ?? {});
  return res.data;
}

export function statementPdfUrl(companyId: number, runId: number, privateUserId: number): string {
  return `/api/v1/companies/${companyId}/commission-runs/${runId}/statement/${privateUserId}.pdf`;
}

// ---------------------------------------------------------------------------
// Targets, leaderboard, liability, returns, credit, clawbacks
// ---------------------------------------------------------------------------

export async function listTargets(companyId: number, privateUserId?: number): Promise<SalesTarget[]> {
  const res = await api.get(`/companies/${companyId}/sales-targets`, {
    params: privateUserId ? { private_user_id: privateUserId } : undefined,
  });
  return res.data;
}

export async function createTarget(companyId: number, input: Record<string, unknown>): Promise<SalesTarget> {
  const res = await api.post(`/companies/${companyId}/sales-targets`, input);
  return res.data;
}

export async function getLeaderboard(companyId: number, periodStart: string, periodEnd: string): Promise<Leaderboard> {
  const res = await api.get(`/companies/${companyId}/commission-leaderboard`, {
    params: { period_start: periodStart, period_end: periodEnd },
  });
  return res.data;
}

export async function getLiability(companyId: number): Promise<LiabilityAccrual> {
  const res = await api.get(`/companies/${companyId}/commission-liability`);
  return res.data;
}

export async function listCreditAssignments(companyId: number): Promise<CreditAssignment[]> {
  const res = await api.get(`/companies/${companyId}/credit-assignments`);
  return res.data;
}

export async function createCreditAssignment(companyId: number, input: Record<string, unknown>): Promise<CreditAssignment> {
  const res = await api.post(`/companies/${companyId}/credit-assignments`, input);
  return res.data;
}

export async function createClawback(companyId: number, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await api.post(`/companies/${companyId}/commission-clawbacks`, input);
  return res.data;
}

// ---------------------------------------------------------------------------
// Returns / credit-notes
// ---------------------------------------------------------------------------

export interface SalesReturnLine {
  id: number;
  sale_line_id: number;
  variant_id: number;
  quantity: string;
  unit_price_snapshot: string;
  line_total: string;
}

export interface SalesReturn {
  id: number;
  company_id: number;
  sale_id: number;
  returned_at: string;
  reason?: string | null;
  currency: string;
  lines: SalesReturnLine[];
}

export async function createSalesReturn(
  companyId: number,
  input: {
    sale_id: number;
    returned_at: string;
    reason?: string | null;
    lines: Array<{ sale_line_id: number; quantity: number }>;
  },
): Promise<SalesReturn> {
  const res = await api.post(`/companies/${companyId}/sales-returns`, input);
  return res.data;
}

export async function listSalesReturns(companyId: number, saleId?: number): Promise<SalesReturn[]> {
  const res = await api.get(`/companies/${companyId}/sales-returns`, {
    params: saleId ? { sale_id: saleId } : undefined,
  });
  return res.data;
}

// ---------------------------------------------------------------------------
// ERP reconcile
// ---------------------------------------------------------------------------

export interface ErpReconcileItem {
  external_id: string;
  sku: string;
  quantity: number;
  sold_at: string;
  rep_private_user_id?: number | null;
}

export interface ErpReconcileResult {
  received: number;
  new: number;
  duplicates: number;
  unmatched_sku: number;
  created: number;
  unmatched: Array<Record<string, unknown>>;
}

export async function erpReconcile(
  companyId: number,
  items: ErpReconcileItem[],
  commit = false,
): Promise<ErpReconcileResult> {
  const res = await api.post(`/companies/${companyId}/sales/erp-reconcile`, { items, commit });
  return res.data;
}
