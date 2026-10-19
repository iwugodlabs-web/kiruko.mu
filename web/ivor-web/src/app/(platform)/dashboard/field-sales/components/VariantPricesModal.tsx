"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { X, Tag, Loader2, Plus } from "lucide-react";
import {
  listPrices,
  createPrice,
  approvePrice,
  rejectPrice,
  type ProductPrice,
  type ProductVariant,
} from "@/services/fieldSales";

interface Props {
  companyId: number;
  productId: number;
  productName: string;
  variant: ProductVariant;
  onClose: () => void;
}

const EMPTY = { amount: "", effective_from: "", effective_to: "", territory: "" };

/** Effective-dated prices for one variant. A sale snapshots the price effective
 * on its date, falling back to the variant's inline unit_price when no row
 * applies — so this panel is how an admin controls pricing without editing the
 * raw unit price (Step B1). */
export default function VariantPricesModal({ companyId, productId, productName, variant, onClose }: Props) {
  const [prices, setPrices] = useState<ProductPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...EMPTY, amount: variant.unit_price });

  async function load() {
    setLoading(true);
    try {
      setPrices(await listPrices(companyId, productId, variant.id));
    } catch {
      toast.error("Could not load prices.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, productId, variant.id]);

  async function handleAdd() {
    if (!form.amount) {
      toast.error("Enter an amount.");
      return;
    }
    setSaving(true);
    try {
      const created = await createPrice(companyId, {
        variant_id: variant.id,
        amount: form.amount,
        currency: variant.currency,
        effective_from: form.effective_from || null,
        effective_to: form.effective_to || null,
        territory: form.territory || null,
      });
      toast.success(
        created.status === "pending"
          ? "Price sent for approval by a second admin."
          : "Price added.",
      );
      setForm({ ...EMPTY, amount: variant.unit_price });
      load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      toast.error(err.response?.data?.detail || "Could not add price.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDecision(priceId: number, action: "approve" | "reject") {
    try {
      if (action === "approve") {
        await approvePrice(companyId, priceId);
        toast.success("Price approved.");
      } else {
        await rejectPrice(companyId, priceId);
        toast.success("Price rejected.");
      }
      load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      toast.error(err.response?.data?.detail || `Could not ${action} price.`);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-xl mx-4 bg-white dark:bg-zinc-900 rounded-xl shadow-2xl flex flex-col max-h-[88vh]">
        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-2 min-w-0">
            <Tag className="h-5 w-5 text-zinc-500" />
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                Prices · {variant.sku}
              </h2>
              <p className="text-[11px] text-zinc-500 truncate">{productName}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600"><X className="h-5 w-5" /></button>
        </div>

        <div className="px-5 py-5 overflow-y-auto space-y-4">
          <p className="rounded-lg bg-zinc-50 dark:bg-zinc-800/60 px-3 py-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            A sale uses the price <strong>effective on the sale date</strong>. With no rows here, sales
            fall back to the variant price{" "}
            <strong>{variant.currency} {variant.unit_price}</strong>. Nothing is rewritten retroactively —
            a correction is a new future-dated row.
          </p>

          <div>
            {loading ? (
              <div className="py-6 text-center text-sm text-zinc-500"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" />Loading…</div>
            ) : prices.length === 0 ? (
              <p className="text-xs text-zinc-500">No price rows — using the variant price.</p>
            ) : (
              <ul className="space-y-1.5">
                {prices.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 rounded-md border border-zinc-100 dark:border-zinc-800 px-2.5 py-1.5 text-xs">
                    <span className="flex items-center gap-2 font-medium text-zinc-800 dark:text-zinc-200">
                      {p.currency} {p.amount}
                      <StatusBadge status={p.status || "active"} />
                    </span>
                    <span className="flex items-center gap-2 text-zinc-400">
                      <span>
                        {p.territory ? `${p.territory} · ` : ""}
                        {p.effective_from ?? "open"} → {p.effective_to ?? "open"}
                      </span>
                      {p.status && p.status !== "active" && p.status !== "rejected" && (
                        <>
                          <button
                            onClick={() => handleDecision(p.id, "approve")}
                            className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-700"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleDecision(p.id, "reject")}
                            className="rounded border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:text-zinc-300"
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 space-y-2">
            <p className="text-xs font-medium text-zinc-700 dark:text-zinc-200">Add a price</p>
            <div className="flex flex-wrap gap-2">
              <input
                placeholder="Amount"
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                className="w-28 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1.5 text-sm"
              />
              <input
                type="date"
                title="Effective from"
                value={form.effective_from}
                onChange={(e) => setForm((f) => ({ ...f, effective_from: e.target.value }))}
                className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1.5 text-sm"
              />
              <input
                type="date"
                title="Effective to"
                value={form.effective_to}
                onChange={(e) => setForm((f) => ({ ...f, effective_to: e.target.value }))}
                className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1.5 text-sm"
              />
              <input
                placeholder="Territory (optional)"
                value={form.territory}
                onChange={(e) => setForm((f) => ({ ...f, territory: e.target.value }))}
                className="w-40 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1.5 text-sm"
              />
              <button
                onClick={handleAdd}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-white px-3 py-1.5 text-sm font-medium text-white dark:text-zinc-900 disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add
              </button>
            </div>
            <p className="text-[11px] text-zinc-400">Leave the dates blank for an open-ended price. Overlapping rows: the latest start wins.</p>
          </div>
        </div>
      </div>
    </div>
  );
}


function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
    pending: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
    rejected: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  };
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize ${styles[status] || styles.rejected}`}>
      {status}
    </span>
  );
}
