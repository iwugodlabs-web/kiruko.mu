"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Undo2, DatabaseZap, ChevronDown } from "lucide-react";
import { createClawback, erpReconcile, type ErpReconcileResult } from "@/services/fieldSales";
import type { User } from "@/services/api";

const ERP_PLACEHOLDER = `[
  { "external_id": "INV-1001", "sku": "CC-Z-500-1", "quantity": 24, "sold_at": "2026-10-05T09:00:00Z", "rep_private_user_id": 12 },
  { "external_id": "INV-1002", "sku": "CC-C-15L-1", "quantity": 6,  "sold_at": "2026-10-06T11:30:00Z", "rep_private_user_id": 12 }
]`;

export default function AdjustmentsPanel({
  companyId,
  reps,
}: {
  companyId: number;
  reps: User[];
}) {
  const [open, setOpen] = useState(false);

  // Clawback
  const [claw, setClaw] = useState({ privateUserId: "", amount: "", reason: "" });
  const [clawBusy, setClawBusy] = useState(false);

  // ERP reconcile
  const [erpText, setErpText] = useState("");
  const [erpBusy, setErpBusy] = useState(false);
  const [erpResult, setErpResult] = useState<ErpReconcileResult | null>(null);

  async function submitClawback() {
    const amount = Number(claw.amount);
    if (!claw.privateUserId) {
      toast.error("Pick the rep to recover from.");
      return;
    }
    if (!(amount > 0)) {
      toast.error("Enter a positive amount to recover.");
      return;
    }
    if (!claw.reason.trim()) {
      toast.error("A reason is required.");
      return;
    }
    setClawBusy(true);
    try {
      await createClawback(companyId, {
        private_user_id: Number(claw.privateUserId),
        amount,
        reason: claw.reason.trim(),
      });
      toast.success("Clawback recorded — it lands as a negative earning on the next payslip.");
      setClaw({ privateUserId: "", amount: "", reason: "" });
    } catch (e) {
      const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Could not record the clawback.");
    } finally {
      setClawBusy(false);
    }
  }

  async function runErp(commit: boolean) {
    let items: unknown;
    try {
      items = JSON.parse(erpText || "[]");
    } catch {
      toast.error("That isn't valid JSON.");
      return;
    }
    if (!Array.isArray(items) || items.length === 0) {
      toast.error("Paste at least one row.");
      return;
    }
    setErpBusy(true);
    try {
      const res = await erpReconcile(companyId, items as never, commit);
      setErpResult(res);
      toast.success(
        commit
          ? `Committed — ${res.created} new sale(s) created.`
          : `Dry run — ${res.new} new, ${res.duplicates} duplicate, ${res.unmatched_sku} unmatched SKU.`,
      );
    } catch (e) {
      const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Reconcile failed.");
    } finally {
      setErpBusy(false);
    }
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-white">
          Adjustments &amp; data sync
        </h2>
        <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        Recover over-paid commission (clawback) and reconcile an external sales feed against your catalog.
      </p>

      {open && (
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          {/* Clawback */}
          <div className="rounded-lg border border-gray-100 p-4 dark:border-gray-800">
            <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
              <Undo2 className="h-4 w-4" /> Clawback
            </h3>
            <p className="mb-3 text-xs text-gray-500">
              A signed negative earning on the rep&apos;s next payslip. Closed periods are never rewritten.
            </p>
            <label className="text-xs text-gray-500">
              Rep *
              <select
                value={claw.privateUserId}
                onChange={(e) => setClaw((s) => ({ ...s, privateUserId: e.target.value }))}
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
            <label className="mt-2 block text-xs text-gray-500">
              Amount *
              <input
                inputMode="decimal"
                value={claw.amount}
                onChange={(e) => setClaw((s) => ({ ...s, amount: e.target.value }))}
                placeholder="0.00"
                className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm text-gray-900 dark:text-white"
              />
            </label>
            <label className="mt-2 block text-xs text-gray-500">
              Reason *
              <input
                value={claw.reason}
                onChange={(e) => setClaw((s) => ({ ...s, reason: e.target.value }))}
                placeholder="Over-paid October run"
                className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm text-gray-900 dark:text-white"
              />
            </label>
            <button
              onClick={submitClawback}
              disabled={clawBusy}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-gray-900"
            >
              {clawBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />} Record clawback
            </button>
          </div>

          {/* ERP reconcile */}
          <div className="rounded-lg border border-gray-100 p-4 dark:border-gray-800">
            <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
              <DatabaseZap className="h-4 w-4" /> ERP reconcile
            </h3>
            <p className="mb-3 text-xs text-gray-500">
              Paste a JSON feed of external sales. Dry-run first; commit imports new rows as approved
              sales (idempotent on <code>external_id</code>).
            </p>
            <textarea
              value={erpText}
              onChange={(e) => setErpText(e.target.value)}
              rows={6}
              placeholder={ERP_PLACEHOLDER}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 font-mono text-xs text-gray-900 dark:text-white"
            />
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => runErp(false)}
                disabled={erpBusy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300"
              >
                {erpBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Dry run
              </button>
              <button
                onClick={() => runErp(true)}
                disabled={erpBusy || !erpResult || erpResult.new === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-gray-900"
              >
                Commit {erpResult ? `(${erpResult.new})` : ""}
              </button>
            </div>
            {erpResult && (
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-300">
                <div>Received: <span className="font-medium">{erpResult.received}</span></div>
                <div>New: <span className="font-medium">{erpResult.new}</span></div>
                <div>Duplicates: <span className="font-medium">{erpResult.duplicates}</span></div>
                <div>Unmatched SKU: <span className="font-medium">{erpResult.unmatched_sku}</span></div>
                {erpResult.created > 0 && (
                  <div className="col-span-2">Created: <span className="font-medium">{erpResult.created}</span></div>
                )}
              </dl>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
