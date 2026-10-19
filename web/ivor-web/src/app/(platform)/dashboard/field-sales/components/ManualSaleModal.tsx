"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import {
  createSale,
  listProducts,
  type Outlet,
  type Product,
} from "@/services/fieldSales";
import type { User } from "@/services/api";
import { PAYMENT_METHODS } from "./SaleDetailDrawer";

interface DraftLine {
  variantId: string;
  quantity: string;
  unitPrice: string;
}

function localNow(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

export default function ManualSaleModal({
  companyId,
  reps,
  outlets,
  baseCurrency = "MUR",
  onClose,
  onCreated,
}: {
  companyId: number;
  reps: User[];
  outlets: Outlet[];
  baseCurrency?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [repId, setRepId] = useState("");
  const [outletId, setOutletId] = useState("");
  const [soldAt, setSoldAt] = useState(localNow());
  const [paymentStatus, setPaymentStatus] = useState("paid");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ variantId: "", quantity: "1", unitPrice: "" }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listProducts(companyId)
      .then((p) => setProducts(p.filter((x) => x.status !== "archived")))
      .catch(() => toast.error("Could not load the catalog."));
  }, [companyId]);

  // Flat variant list so a single <select> picks the exact SKU being sold.
  const variants = useMemo(
    () =>
      products.flatMap((p) =>
        (p.variants ?? [])
          .filter((v) => v.status !== "archived")
          .map((v) => ({
            id: v.id,
            price: v.unit_price,
            label: `${p.name}${v.sku ? ` — ${v.sku}` : ""}`,
          })),
      ),
    [products],
  );

  function updateLine(idx: number, patch: Partial<DraftLine>) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function pickVariant(idx: number, variantId: string) {
    const v = variants.find((x) => String(x.id) === variantId);
    updateLine(idx, { variantId, unitPrice: v ? String(v.price) : "" });
  }

  const total = lines.reduce(
    (acc, l) => acc + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0),
    0,
  );

  async function submit() {
    if (!repId) {
      toast.error("Pick the rep who made the sale.");
      return;
    }
    const clean = lines
      .filter((l) => l.variantId && Number(l.quantity) > 0)
      .map((l) => ({
        variant_id: Number(l.variantId),
        quantity: Number(l.quantity),
        ...(l.unitPrice !== "" ? { unit_price: Number(l.unitPrice) } : {}),
      }));
    if (clean.length === 0) {
      toast.error("Add at least one product line.");
      return;
    }
    setSaving(true);
    try {
      await createSale(companyId, {
        rep_private_user_id: Number(repId),
        outlet_id: outletId ? Number(outletId) : null,
        sold_at: new Date(soldAt).toISOString(),
        payment_status: paymentStatus,
        payment_method: paymentMethod || null,
        notes: notes || null,
        lines: clean,
      });
      toast.success("Sale recorded.");
      onCreated();
      onClose();
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Could not record the sale.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-white">Record a sale</h2>
          <button onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-gray-500">
            Rep *
            <select
              value={repId}
              onChange={(e) => setRepId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm text-gray-900 dark:text-white"
            >
              <option value="">— pick rep —</option>
              {reps
                .filter((r) => r.private_user?.private_user_id != null)
                .map((r) => (
                  <option key={r.private_user!.private_user_id} value={String(r.private_user!.private_user_id)}>
                    {`${r.private_user?.first_name ?? ""} ${r.private_user?.last_name ?? ""}`.trim() || r.email}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-xs text-gray-500">
            Outlet
            <select
              value={outletId}
              onChange={(e) => setOutletId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm text-gray-900 dark:text-white"
            >
              <option value="">— none —</option>
              {outlets.map((o) => (
                <option key={o.id} value={String(o.id)}>{o.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-500">
            Sold at
            <input
              type="datetime-local"
              value={soldAt}
              onChange={(e) => setSoldAt(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm text-gray-900 dark:text-white"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-gray-500">
              Payment
              <select
                value={paymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm text-gray-900 dark:text-white"
              >
                {["paid", "partial", "pending"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-gray-500">
              Method
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm text-gray-900 dark:text-white"
              >
                <option value="">—</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Products</h3>
            <button
              onClick={() => setLines((ls) => [...ls, { variantId: "", quantity: "1", unitPrice: "" }])}
              className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 dark:text-gray-300"
            >
              <Plus className="h-3.5 w-3.5" /> Add line
            </button>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={l.variantId}
                  onChange={(e) => pickVariant(i, e.target.value)}
                  className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm text-gray-900 dark:text-white"
                >
                  <option value="">— pick product —</option>
                  {variants.map((v) => (
                    <option key={v.id} value={String(v.id)}>{v.label}</option>
                  ))}
                </select>
                <input
                  inputMode="decimal"
                  value={l.quantity}
                  onChange={(e) => updateLine(i, { quantity: e.target.value })}
                  placeholder="Qty"
                  className="w-20 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm text-gray-900 dark:text-white"
                />
                <input
                  inputMode="decimal"
                  value={l.unitPrice}
                  onChange={(e) => updateLine(i, { unitPrice: e.target.value })}
                  placeholder="Unit"
                  className="w-24 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm text-gray-900 dark:text-white"
                />
                <button
                  onClick={() => setLines((ls) => ls.filter((_, x) => x !== i))}
                  disabled={lines.length === 1}
                  className="text-gray-400 hover:text-red-600 disabled:opacity-30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          {variants.length === 0 && (
            <p className="mt-2 text-xs text-amber-600">
              No products yet — add them in the Catalog tab first.
            </p>
          )}
        </div>

        <label className="mt-4 block text-xs text-gray-500">
          Notes
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm text-gray-900 dark:text-white"
          />
        </label>

        <div className="mt-5 flex items-center justify-between border-t border-gray-100 pt-4 dark:border-gray-800">
          <span className="text-sm text-gray-500">
            Total <span className="font-semibold text-gray-900 dark:text-white">{baseCurrency} {total.toFixed(2)}</span>
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
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Record sale
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
