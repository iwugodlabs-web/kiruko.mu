"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, RotateCcw, X } from "lucide-react";
import {
  createSalesReturn,
  listSalesReturns,
  type Sale,
} from "@/services/fieldSales";

function localNow(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

function money(v: string | number, currency: string): string {
  return `${currency} ${Number(v).toFixed(2)}`;
}

export default function SalesReturnModal({
  companyId,
  sale,
  onClose,
  onReturned,
}: {
  companyId: number;
  sale: Sale;
  onClose: () => void;
  onReturned: () => void;
}) {
  const [alreadyReturned, setAlreadyReturned] = useState<Record<number, number>>({});
  const [qty, setQty] = useState<Record<number, string>>({});
  const [returnedAt, setReturnedAt] = useState(localNow());
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listSalesReturns(companyId, sale.id)
      .then((returns) => {
        const agg: Record<number, number> = {};
        for (const r of returns) {
          for (const line of r.lines) {
            agg[line.sale_line_id] = (agg[line.sale_line_id] ?? 0) + Number(line.quantity);
          }
        }
        setAlreadyReturned(agg);
      })
      .catch(() => {});
  }, [companyId, sale.id]);

  const rows = useMemo(
    () =>
      sale.lines.map((l) => {
        const remaining = Number(l.quantity) - (alreadyReturned[l.id] ?? 0);
        return { line: l, remaining: Math.max(0, remaining) };
      }),
    [sale.lines, alreadyReturned],
  );

  const total = rows.reduce((acc, { line, remaining }) => {
    const q = Math.min(Number(qty[line.id] || 0), remaining);
    return acc + q * Number(line.unit_price_snapshot);
  }, 0);

  async function submit() {
    const lines = Object.entries(qty)
      .map(([saleLineId, value]) => ({ sale_line_id: Number(saleLineId), quantity: Number(value) }))
      .filter((l) => l.quantity > 0);
    if (lines.length === 0) {
      toast.error("Enter a quantity to return.");
      return;
    }
    setSaving(true);
    try {
      await createSalesReturn(companyId, {
        sale_id: sale.id,
        returned_at: new Date(returnedAt).toISOString(),
        reason: reason || null,
        lines,
      });
      toast.success("Return recorded — it flows into this period's commission.");
      onReturned();
      onClose();
    } catch (e) {
      const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Could not record the return.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-white">Record a return</h2>
          <button onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-4 text-xs text-gray-500">
          Against sale #{sale.id}. The refunded value becomes a <strong>negative</strong> commission in the
          return&apos;s period — the original sale is never rewritten.
        </p>

        <div className="space-y-3">
          {rows.map(({ line, remaining }) => (
            <div key={line.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 p-2 dark:border-gray-800">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-gray-900 dark:text-white">
                  {line.product_name ?? `Variant #${line.variant_id}`}
                </div>
                <div className="text-xs text-gray-400">
                  Sold {Number(line.quantity)}{line.uom ? ` ${line.uom}` : ""} · {money(line.unit_price_snapshot, sale.currency)}
                  {alreadyReturned[line.id] ? ` · ${alreadyReturned[line.id]} already returned` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  inputMode="decimal"
                  disabled={remaining <= 0}
                  value={qty[line.id] ?? ""}
                  onChange={(e) => setQty((m) => ({ ...m, [line.id]: e.target.value }))}
                  placeholder="0"
                  className="w-20 rounded-lg border border-gray-200 bg-transparent px-2 py-1.5 text-sm text-gray-900 disabled:opacity-40 dark:border-gray-700 dark:text-white"
                />
                <span className="text-xs text-gray-400">/ {remaining}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="text-xs text-gray-500">
            Returned at
            <input
              type="datetime-local"
              value={returnedAt}
              onChange={(e) => setReturnedAt(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 bg-transparent px-2 py-1.5 text-sm text-gray-900 dark:border-gray-700 dark:text-white"
            />
          </label>
          <label className="text-xs text-gray-500">
            Reason
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Damaged, expired…"
              className="mt-1 w-full rounded-lg border border-gray-200 bg-transparent px-2 py-1.5 text-sm text-gray-900 dark:border-gray-700 dark:text-white"
            />
          </label>
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-gray-100 pt-4 dark:border-gray-800">
          <span className="text-sm text-gray-500">
            Credit <span className="font-semibold text-gray-900 dark:text-white">{money(total, sale.currency)}</span>
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-300">
              Cancel
            </button>
            <button
              disabled={saving}
              onClick={submit}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-gray-900"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Record return
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
