"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  MapPin,
  Plus,
  ClipboardCheck,
  Download,
  Pencil,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { fetchCompanyUsers, type User } from "@/services/api";
import {
  listPendingSales,
  listSales,
  pageSales,
  reviewSale,
  bulkReviewSales,
  listOutlets,
  createOutlet,
  updateOutlet,
  type Sale,
  type Outlet,
  type SaleListFilters,
} from "@/services/fieldSales";
import EmptyState from "@/components/ui/EmptyState";
import Hint from "./Hint";
import SaleDetailDrawer, { methodLabel } from "./SaleDetailDrawer";
import ManualSaleModal from "./ManualSaleModal";
import type { NavigateTab } from "./types";

const PAGE_SIZE = 25;

function money(v?: string | null, currency = "MUR"): string {
  if (v == null) return "—";
  return `${currency} ${Number(v).toFixed(2)}`;
}

function linesSummary(sale: Sale): string {
  const lines = sale.lines ?? [];
  if (lines.length === 0) return "—";
  const first = lines[0];
  const name = first.product_name ?? `Variant #${first.variant_id}`;
  const head = `${name} ×${Number(first.quantity)}`;
  return lines.length > 1 ? `${head}  +${lines.length - 1} more` : head;
}

function saleTotal(sale: Sale): number {
  return (sale.lines ?? []).reduce((acc, l) => acc + Number(l.line_total), 0);
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function SalesTab({ onNavigate }: { onNavigate: NavigateTab }) {
  const { companyId } = useAuth();
  const [pending, setPending] = useState<Sale[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [total, setTotal] = useState(0);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [reps, setReps] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Sale | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [newOutlet, setNewOutlet] = useState({ name: "", code: "", address: "", latitude: "", longitude: "" });
  const [editingOutlet, setEditingOutlet] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState({ q: "", rep: "", outlet: "", status: "", payment: "", from: "", to: "" });
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkNotes, setBulkNotes] = useState("");
  const [tick, setTick] = useState(0);

  function toParams(paging: boolean): SaleListFilters {
    return {
      q: filters.q.trim() || undefined,
      rep_private_user_id: filters.rep ? Number(filters.rep) : undefined,
      outlet_id: filters.outlet ? Number(filters.outlet) : undefined,
      status: filters.status || undefined,
      payment_status: filters.payment || undefined,
      period_start: filters.from || undefined,
      period_end: filters.to || undefined,
      ...(paging ? { limit: PAGE_SIZE, offset: page * PAGE_SIZE } : {}),
    };
  }

  // Static lists (pending queue, outlets, reps) — loaded per company / refresh.
  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    Promise.all([
      listPendingSales(companyId),
      listOutlets(companyId, true),
      fetchCompanyUsers(companyId),
    ])
      .then(([p, o, u]) => {
        setPending(p);
        setOutlets(o);
        if (Array.isArray(u)) setReps(u);
      })
      .catch(() => toast.error("Failed to load sales."))
      .finally(() => setLoading(false));
  }, [companyId, tick]);

  // Recent sales — server-side filtered + paged.
  useEffect(() => {
    if (!companyId) return;
    let alive = true;
    pageSales(companyId, toParams(true))
      .then(({ items, total: t }) => {
        if (!alive) return;
        setSales(items);
        setTotal(t);
      })
      .catch(() => {
        if (alive) toast.error("Failed to load sales.");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, page, filters, tick]);

  useEffect(() => {
    setPage(0);
    setChecked(new Set());
  }, [filters]);

  function refresh() {
    setTick((t) => t + 1);
  }

  function repName(id: number): string {
    const u = reps.find((r) => r.private_user?.private_user_id === id);
    return u ? `${u.private_user?.first_name ?? ""} ${u.private_user?.last_name ?? ""}`.trim() || u.email : `Rep #${id}`;
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const displayCurrency = sales[0]?.currency ?? "MUR";

  async function exportCsv() {
    if (!companyId) return;
    try {
      const all = await listSales(companyId, toParams(false));
      const header = [
        "id", "sold_at", "rep", "outlet", "status", "payment_status", "payment_method",
        "currency", "total", "products",
      ];
      const rows = all.map((s) => [
        s.id,
        s.sold_at,
        repName(s.rep_private_user_id),
        s.outlet_id != null ? outlets.find((o) => o.id === s.outlet_id)?.name ?? "" : "",
        s.status,
        s.payment_status,
        s.payment_method ? methodLabel(s.payment_method) : "",
        s.currency,
        saleTotal(s).toFixed(2),
        (s.lines ?? [])
          .map((l) => `${l.product_name ?? `Variant #${l.variant_id}`} x${Number(l.quantity)}`)
          .join("; "),
      ]);
      const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `field-sales-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${all.length} sale${all.length === 1 ? "" : "s"}.`);
    } catch {
      toast.error("Export failed.");
    }
  }

  async function handleReview(sale: Sale, decision: "approve" | "reject") {
    if (!companyId) return;
    setBusyId(sale.id);
    try {
      await reviewSale(companyId, sale.id, decision);
      toast.success(decision === "approve" ? "Sale approved." : "Sale rejected.");
      refresh();
    } catch {
      toast.error("Review failed.");
    } finally {
      setBusyId(null);
    }
  }

  function toggleChecked(id: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setChecked((prev) => (prev.size === pending.length ? new Set() : new Set(pending.map((s) => s.id))));
  }

  async function handleBulk(decision: "approve" | "reject") {
    if (!companyId || checked.size === 0) return;
    if (decision === "reject" && !bulkNotes.trim()) {
      toast.error("Add a reason before rejecting.");
      return;
    }
    setBulkBusy(true);
    try {
      const res = await bulkReviewSales(companyId, Array.from(checked), decision, bulkNotes.trim() || undefined);
      if (res.failed > 0) {
        toast.warning(`${res.succeeded} ${decision}d, ${res.failed} skipped.`);
      } else {
        toast.success(`${res.succeeded} sale${res.succeeded === 1 ? "" : "s"} ${decision}d.`);
      }
      setChecked(new Set());
      setBulkRejectOpen(false);
      setBulkNotes("");
      refresh();
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Bulk review failed.");
    } finally {
      setBulkBusy(false);
    }
  }

  function resetOutletForm() {
    setNewOutlet({ name: "", code: "", address: "", latitude: "", longitude: "" });
    setEditingOutlet(null);
  }

  function startEditOutlet(o: Outlet) {
    setEditingOutlet(o.id);
    setNewOutlet({
      name: o.name,
      code: o.code ?? "",
      address: o.address ?? "",
      latitude: o.latitude != null ? String(o.latitude) : "",
      longitude: o.longitude != null ? String(o.longitude) : "",
    });
  }

  async function handleSaveOutlet() {
    if (!companyId || !newOutlet.name.trim()) {
      toast.error("Outlet name is required.");
      return;
    }
    const body = {
      name: newOutlet.name.trim(),
      code: newOutlet.code || null,
      address: newOutlet.address || null,
      latitude: newOutlet.latitude ? Number(newOutlet.latitude) : null,
      longitude: newOutlet.longitude ? Number(newOutlet.longitude) : null,
    };
    try {
      if (editingOutlet != null) {
        await updateOutlet(companyId, editingOutlet, body);
        toast.success("Outlet updated.");
      } else {
        await createOutlet(companyId, body);
        toast.success("Outlet created.");
      }
      resetOutletForm();
      refresh();
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Could not save outlet.");
    }
  }

  const allChecked = pending.length > 0 && checked.size === pending.length;

  return (
    <div className="space-y-6">
      <Hint
        title="Reps capture sales in the mobile app — you approve them here"
        action={
          <button
            type="button"
            onClick={() => setShowManual(true)}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-white dark:border-gray-700 dark:text-gray-300"
          >
            <Plus className="h-3.5 w-3.5" /> Record a sale
          </button>
        }
      >
        A sale only counts toward commission once it&apos;s <strong>approved</strong>. Sales captured
        offline sync automatically when the rep is back online. Use <strong>Record a sale</strong> to enter a
        walk-in the rep missed; the <strong>Visit</strong> column shows whether they were on-site.
      </Hint>

      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-white">
            Pending approval <span className="text-sm font-normal text-gray-500">({pending.length})</span>
          </h2>
          {pending.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleBulk("approve")}
                disabled={bulkBusy || checked.size === 0}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-2.5 py-1 text-xs font-medium text-emerald-700 disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Approve selected{checked.size ? ` (${checked.size})` : ""}
              </button>
              <button
                onClick={() => setBulkRejectOpen((v) => !v)}
                disabled={bulkBusy || checked.size === 0}
                className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 disabled:opacity-50"
              >
                <XCircle className="h-3.5 w-3.5" /> Reject selected
              </button>
            </div>
          )}
        </div>

        {bulkRejectOpen && checked.size > 0 && (
          <div className="mb-3 rounded-lg border border-red-100 bg-red-50/60 p-3 dark:border-red-900/40 dark:bg-red-900/10">
            <textarea
              value={bulkNotes}
              onChange={(e) => setBulkNotes(e.target.value)}
              rows={2}
              placeholder="Reason for rejecting all selected (required)"
              className="w-full rounded-lg border border-red-200 dark:border-red-800 bg-transparent px-2 py-1.5 text-sm"
            />
            <button
              onClick={() => handleBulk("reject")}
              disabled={bulkBusy}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Confirm rejection
            </button>
          </div>
        )}

        {loading ? (
          <div className="py-8 text-center text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
        ) : pending.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title={sales.length > 0 ? "You're all caught up" : "No sales to review yet"}
            description={
              sales.length > 0
                ? "Approved sales are ready — head to Runs to compute commissions for this period."
                : "When reps record sales in the mobile Field Sales screen, they'll appear here for approval."
            }
            actionLabel={sales.length > 0 ? "Go to Runs" : "Check your catalog"}
            onAction={() => onNavigate(sales.length > 0 ? "runs" : "catalog")}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-400 border-b border-gray-100 dark:border-gray-800">
                  <th className="py-2 pr-3">
                    <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Select all" />
                  </th>
                  <th className="py-2 pr-3">Rep</th>
                  <th className="py-2 pr-3">Sold</th>
                  <th className="py-2 pr-3">Outlet</th>
                  <th className="py-2 pr-3">Products</th>
                  <th className="py-2 pr-3 text-right">Total</th>
                  <th className="py-2 pr-3">Visit</th>
                  <th className="py-2 pr-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((s) => (
                  <tr
                    key={s.id}
                    className="cursor-pointer border-b border-gray-50 hover:bg-gray-50 dark:border-gray-800/60 dark:hover:bg-gray-800/50"
                    onClick={() => setSelected(s)}
                  >
                    <td className="py-2 pr-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={checked.has(s.id)}
                        onChange={() => toggleChecked(s.id)}
                        aria-label={`Select sale ${s.id}`}
                      />
                    </td>
                    <td className="py-2 pr-3">{repName(s.rep_private_user_id)}</td>
                    <td className="py-2 pr-3 text-gray-500">{s.sold_at?.slice(0, 10)}</td>
                    <td className="py-2 pr-3 text-gray-500">{outlets.find((o) => o.id === s.outlet_id)?.name ?? "—"}</td>
                    <td className="py-2 pr-3 text-gray-600 dark:text-gray-300">{linesSummary(s)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money(String(saleTotal(s)), s.currency)}</td>
                    <td className="py-2 pr-3 text-gray-500">
                      {s.visit_verified == null ? "—" : s.visit_verified ? (
                        <span className="text-emerald-600">verified</span>
                      ) : (
                        <span className="text-amber-600">flagged{s.visit_distance_m != null ? ` (${Math.round(s.visit_distance_m)}m)` : ""}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-2">
                        <button
                          disabled={busyId === s.id}
                          onClick={() => handleReview(s, "approve")}
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-200 text-emerald-700 px-2 py-1 text-xs font-medium disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                        </button>
                        <button
                          disabled={busyId === s.id}
                          onClick={() => handleReview(s, "reject")}
                          className="inline-flex items-center gap-1 rounded-md border border-red-200 text-red-600 px-2 py-1 text-xs font-medium disabled:opacity-50"
                        >
                          <XCircle className="h-3.5 w-3.5" /> Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-white">Recent sales</h2>
            <button
              onClick={exportCsv}
              disabled={total === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <Download className="h-3.5 w-3.5" /> Export CSV
            </button>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <input
              placeholder="Search product or notes…"
              value={filters.q}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
              className="col-span-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm sm:col-span-4"
            />
            <select
              value={filters.rep}
              onChange={(e) => setFilters((f) => ({ ...f, rep: e.target.value }))}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm text-gray-600 dark:text-gray-300"
            >
              <option value="">All reps</option>
              {reps
                .filter((r) => r.private_user?.private_user_id != null)
                .map((r) => (
                  <option key={r.private_user!.private_user_id} value={String(r.private_user!.private_user_id)}>
                    {repName(r.private_user!.private_user_id)}
                  </option>
                ))}
            </select>
            <select
              value={filters.outlet}
              onChange={(e) => setFilters((f) => ({ ...f, outlet: e.target.value }))}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm text-gray-600 dark:text-gray-300"
            >
              <option value="">All outlets</option>
              {outlets.map((o) => (
                <option key={o.id} value={String(o.id)}>{o.name}</option>
              ))}
            </select>
            <select
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm text-gray-600 dark:text-gray-300"
            >
              <option value="">Any status</option>
              {["draft", "submitted", "approved", "rejected", "void"].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
            <select
              value={filters.payment}
              onChange={(e) => setFilters((f) => ({ ...f, payment: e.target.value }))}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm text-gray-600 dark:text-gray-300"
            >
              <option value="">Any payment</option>
              {["paid", "partial", "pending"].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
            <input
              type="date"
              value={filters.from}
              onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm text-gray-600 dark:text-gray-300"
            />
            <input
              type="date"
              value={filters.to}
              onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm text-gray-600 dark:text-gray-300"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-400 border-b border-gray-100 dark:border-gray-800">
                  <th className="py-2 pr-3">Rep</th>
                  <th className="py-2 pr-3">Sold</th>
                  <th className="py-2 pr-3">Products</th>
                  <th className="py-2 pr-3 text-right">Total</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Payment</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => setSelected(s)}
                    className="cursor-pointer border-b border-gray-50 hover:bg-gray-50 dark:border-gray-800/60 dark:hover:bg-gray-800/50"
                  >
                    <td className="py-2 pr-3">{repName(s.rep_private_user_id)}</td>
                    <td className="py-2 pr-3 text-gray-500">{s.sold_at?.slice(0, 10)}</td>
                    <td className="py-2 pr-3 text-gray-600 dark:text-gray-300">{linesSummary(s)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money(String(saleTotal(s)), s.currency)}</td>
                    <td className="py-2 pr-3">
                      <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs">{s.status}</span>
                    </td>
                    <td className="py-2 pr-3 text-gray-500">
                      {s.payment_method ? `${methodLabel(s.payment_method)} · ` : ""}{s.payment_status}
                    </td>
                  </tr>
                ))}
                {sales.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-gray-500">
                      {total === 0 && !filters.q && !filters.rep && !filters.outlet && !filters.status && !filters.payment && !filters.from && !filters.to
                        ? "No sales yet."
                        : "No sales match these filters."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {total > 0 && (
            <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
              <span>
                {page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)} of {total}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="rounded-md border border-gray-200 px-2 py-1 disabled:opacity-40 dark:border-gray-700"
                >
                  Prev
                </button>
                <button
                  disabled={page >= pageCount - 1}
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  className="rounded-md border border-gray-200 px-2 py-1 disabled:opacity-40 dark:border-gray-700"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5">
          <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <MapPin className="h-4 w-4" /> Outlets
          </h2>
          <p className="mb-3 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
            Outlets are the shops your reps visit. Add the geo-coordinates so the app can confirm reps
            are on-site when they record a sale.
          </p>
          <div className="space-y-2 mb-3">
            <input
              placeholder="Outlet name"
              value={newOutlet.name}
              onChange={(e) => setNewOutlet((s) => ({ ...s, name: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm"
            />
            <div className="flex gap-2">
              <input
                placeholder="Code"
                value={newOutlet.code}
                onChange={(e) => setNewOutlet((s) => ({ ...s, code: e.target.value }))}
                className="w-24 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm"
              />
              <input
                placeholder="Address"
                value={newOutlet.address}
                onChange={(e) => setNewOutlet((s) => ({ ...s, address: e.target.value }))}
                className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <input
                placeholder="Latitude"
                value={newOutlet.latitude}
                onChange={(e) => setNewOutlet((s) => ({ ...s, latitude: e.target.value }))}
                className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm"
              />
              <input
                placeholder="Longitude"
                value={newOutlet.longitude}
                onChange={(e) => setNewOutlet((s) => ({ ...s, longitude: e.target.value }))}
                className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSaveOutlet}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm font-medium"
              >
                {editingOutlet != null ? (
                  <>
                    <CheckCircle2 className="h-4 w-4" /> Save changes
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" /> Add outlet
                  </>
                )}
              </button>
              {editingOutlet != null && (
                <button onClick={resetOutletForm} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800">
                  <X className="h-3.5 w-3.5" /> Cancel
                </button>
              )}
            </div>
          </div>
          <ul className="space-y-1 text-sm max-h-72 overflow-y-auto">
            {outlets.map((o) => (
              <li
                key={o.id}
                className={`flex items-center justify-between rounded-md px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-800 ${
                  editingOutlet === o.id ? "bg-gray-100 dark:bg-gray-800" : ""
                }`}
              >
                <span className="truncate">{o.name}</span>
                <span className="ml-2 flex items-center gap-2">
                  <span className="text-xs text-gray-400">
                    {o.latitude != null && o.longitude != null
                      ? `${Number(o.latitude).toFixed(4)}, ${Number(o.longitude).toFixed(4)}`
                      : "no geo"}
                  </span>
                  <button title="Edit outlet" onClick={() => startEditOutlet(o)} className="text-gray-400 hover:text-gray-700">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </span>
              </li>
            ))}
            {outlets.length === 0 && (
              <li className="py-2 text-xs text-gray-400">No outlets yet — add one above.</li>
            )}
          </ul>
        </div>
      </div>

      {showManual && companyId && (
        <ManualSaleModal
          companyId={companyId}
          reps={reps}
          outlets={outlets}
          baseCurrency={displayCurrency}
          onClose={() => setShowManual(false)}
          onCreated={refresh}
        />
      )}

      {selected && (
        <SaleDetailDrawer
          companyId={companyId!}
          sale={selected}
          repName={repName}
          outlets={outlets}
          onClose={() => setSelected(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}
