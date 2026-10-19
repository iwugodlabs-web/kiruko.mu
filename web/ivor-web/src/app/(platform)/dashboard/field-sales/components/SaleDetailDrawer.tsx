"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  RotateCcw,
  Ban,
  Receipt,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import {
  reviewSale,
  voidSale,
  reopenSale,
  updateSale,
  type Sale,
} from "@/services/fieldSales";
import SalesReturnModal from "./SalesReturnModal";

export const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "mobile_money", label: "Mobile money" },
  { value: "cheque", label: "Cheque" },
  { value: "credit", label: "Credit (on account)" },
  { value: "other", label: "Other" },
];

const PAYMENT_STATUSES: { value: string; label: string }[] = [
  { value: "paid", label: "Paid" },
  { value: "partial", label: "Partial" },
  { value: "pending", label: "Pending" },
];

export function methodLabel(v?: string | null): string {
  if (!v) return "—";
  return PAYMENT_METHODS.find((m) => m.value === v)?.label ?? v;
}

function money(v: string | number | null | undefined, currency = "MUR"): string {
  if (v == null || v === "") return "—";
  return `${currency} ${Number(v).toFixed(2)}`;
}

function apiErr(e: unknown, fallback: string): string {
  const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return typeof d === "string" ? d : fallback;
}

const STATUS_STYLES: Record<string, string> = {
  submitted: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  void: "bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

export default function SaleDetailDrawer({
  companyId,
  sale: initial,
  repName,
  outlets,
  onClose,
  onChanged,
}: {
  companyId: number;
  sale: Sale;
  repName: (id: number) => string;
  outlets: { id: number; name: string }[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [sale, setSale] = useState<Sale>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [showReturn, setShowReturn] = useState(false);

  const [form, setForm] = useState({
    payment_status: sale.payment_status,
    payment_method: sale.payment_method ?? "",
    collected_amount: sale.collected_amount ?? "",
    outlet_id: sale.outlet_id != null ? String(sale.outlet_id) : "",
    notes: sale.notes ?? "",
  });

  const total = sale.lines.reduce((acc, l) => acc + Number(l.line_total), 0);
  const isVoid = sale.status === "void";
  const isSubmitted = sale.status === "submitted";
  const locked = isVoid;

  async function save() {
    setBusy("save");
    try {
      const updated = await updateSale(companyId, sale.id, {
        payment_status: form.payment_status,
        payment_method: form.payment_method || null,
        collected_amount: form.collected_amount === "" ? null : Number(form.collected_amount),
        outlet_id: form.outlet_id === "" ? null : Number(form.outlet_id),
        notes: form.notes || null,
      });
      setSale(updated);
      toast.success("Sale updated.");
      onChanged();
    } catch (e) {
      toast.error(apiErr(e, "Could not save the sale."));
    } finally {
      setBusy(null);
    }
  }

  async function review(decision: "approve" | "reject") {
    if (decision === "reject" && !rejectNotes.trim()) {
      toast.error("Add a reason before rejecting.");
      return;
    }
    setBusy(decision);
    try {
      const updated = await reviewSale(companyId, sale.id, decision, rejectNotes.trim() || undefined);
      setSale(updated);
      setShowReject(false);
      setRejectNotes("");
      toast.success(decision === "approve" ? "Sale approved." : "Sale rejected.");
      onChanged();
    } catch (e) {
      toast.error(apiErr(e, "Review failed."));
    } finally {
      setBusy(null);
    }
  }

  async function toggleVoid() {
    setBusy("void");
    try {
      if (isVoid) {
        const updated = await reopenSale(companyId, sale.id, "approved");
        setSale(updated);
        toast.success("Sale reopened.");
      } else {
        const updated = await voidSale(companyId, sale.id);
        setSale(updated);
        toast.success("Sale voided.");
      }
      onChanged();
    } catch (e) {
      toast.error(apiErr(e, "Could not change the sale status."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="h-full w-full max-w-xl overflow-y-auto bg-white dark:bg-gray-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-gray-400" />
              <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-white truncate">
                Sale #{sale.id}
              </h2>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[sale.status] ?? "bg-gray-100 text-gray-600"}`}>
                {sale.status}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-gray-500">
              {repName(sale.rep_private_user_id)} · {sale.sold_at?.slice(0, 10)} · {sale.source}
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {/* Visit */}
          <div className="flex items-center gap-2 text-xs">
            {sale.visit_verified == null ? (
              <span className="text-gray-400">No geo visit recorded</span>
            ) : sale.visit_verified ? (
              <span className="inline-flex items-center gap-1 text-emerald-600">
                <ShieldCheck className="h-3.5 w-3.5" /> Visit verified at outlet
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-amber-600">
                <ShieldAlert className="h-3.5 w-3.5" /> Visit flagged
                {sale.visit_distance_m != null ? ` (${Math.round(sale.visit_distance_m)}m away)` : ""}
              </span>
            )}
          </div>

          {/* Line items */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">What was sold</h3>
            <div className="overflow-hidden rounded-lg border border-gray-100 dark:border-gray-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800/50 text-left text-xs uppercase text-gray-400">
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Unit</th>
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {sale.lines.map((l) => (
                    <tr key={l.id} className="border-t border-gray-50 dark:border-gray-800/60">
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900 dark:text-white">
                          {l.product_name ?? `Variant #${l.variant_id}`}
                        </div>
                        <div className="text-xs text-gray-400">
                          {l.variant_sku ?? ""}{l.uom ? ` · per ${l.uom}` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(l.quantity)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(l.unit_price_snapshot, sale.currency)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{money(l.line_total, sale.currency)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                    <td className="px-3 py-2 font-semibold" colSpan={3}>Total</td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold">{money(total, sale.currency)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Payment + details */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Payment &amp; details</h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-gray-500">
                Payment status
                <select
                  disabled={locked}
                  value={form.payment_status}
                  onChange={(e) => setForm((s) => ({ ...s, payment_status: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm text-gray-900 dark:text-white disabled:opacity-50"
                >
                  {PAYMENT_STATUSES.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-gray-500">
                Payment method
                <select
                  disabled={locked}
                  value={form.payment_method}
                  onChange={(e) => setForm((s) => ({ ...s, payment_method: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm text-gray-900 dark:text-white disabled:opacity-50"
                >
                  <option value="">—</option>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-gray-500">
                Collected amount
                <input
                  disabled={locked}
                  inputMode="decimal"
                  value={form.collected_amount}
                  onChange={(e) => setForm((s) => ({ ...s, collected_amount: e.target.value }))}
                  placeholder={form.payment_status === "paid" ? "auto (line total)" : "0.00"}
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm text-gray-900 dark:text-white disabled:opacity-50"
                />
              </label>
              <label className="text-xs text-gray-500">
                Outlet
                <select
                  disabled={locked}
                  value={form.outlet_id}
                  onChange={(e) => setForm((s) => ({ ...s, outlet_id: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm text-gray-900 dark:text-white disabled:opacity-50"
                >
                  <option value="">— none —</option>
                  {outlets.map((o) => (
                    <option key={o.id} value={String(o.id)}>{o.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-xs text-gray-500">
              Notes
              <textarea
                disabled={locked}
                value={form.notes}
                onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))}
                rows={2}
                placeholder="Reference, wallet used (e.g. M-Pesa), etc."
                className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm text-gray-900 dark:text-white disabled:opacity-50"
              />
            </label>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 dark:border-gray-800 pt-4">
            {!locked && (
              <button
                disabled={busy === "save"}
                onClick={save}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-gray-900"
              >
                {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Save changes
              </button>
            )}

            {isSubmitted && (
              <>
                <button
                  disabled={busy === "approve"}
                  onClick={() => review("approve")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 px-3 py-1.5 text-sm font-medium text-emerald-700 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" /> Approve
                </button>
                <button
                  onClick={() => setShowReject((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600"
                >
                  <XCircle className="h-4 w-4" /> Reject
                </button>
              </>
            )}

            {!isVoid && (
              <button
                onClick={() => setShowReturn(true)}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 dark:border-gray-700 dark:text-gray-300"
              >
                <RotateCcw className="h-4 w-4" /> Record return
              </button>
            )}

            <button
              disabled={busy === "void"}
              onClick={toggleVoid}
              className={`${isVoid ? "ml-auto " : ""}inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300`}
            >
              {isVoid ? <RotateCcw className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
              {isVoid ? "Reopen" : "Void"}
            </button>
          </div>

          {showReject && isSubmitted && (
            <div className="rounded-lg border border-red-100 bg-red-50/60 p-3 dark:border-red-900/40 dark:bg-red-900/10">
              <textarea
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                rows={2}
                placeholder="Reason for rejection (required)"
                className="w-full rounded-lg border border-red-200 dark:border-red-800 bg-transparent px-2 py-1.5 text-sm"
              />
              <button
                disabled={busy === "reject"}
                onClick={() => review("reject")}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Confirm rejection
              </button>
            </div>
          )}
        </div>
      </div>

      {showReturn && (
        <SalesReturnModal
          companyId={companyId}
          sale={sale}
          onClose={() => setShowReturn(false)}
          onReturned={onChanged}
        />
      )}
    </div>
  );
}
