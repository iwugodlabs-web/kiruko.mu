"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { leaveTypes, type LeaveType } from "@/services/payroll-api";
import { toast } from "sonner";
import { Plus, RefreshCcw, ShieldCheck, Sparkles } from "lucide-react";
import CreateLeaveTypeModal from "./CreateLeaveTypeModal";


function isError<T>(v: T | { error: string; status?: number }): v is { error: string; status?: number } {
  return typeof v === "object" && v !== null && "error" in v;
}


export default function LeaveTypesTable() {
  const { companyId } = useAuth();
  const [rows, setRows] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const r = await leaveTypes.list(companyId, true);
    if (isError(r)) {
      toast.error(r.error);
      setRows([]);
    } else {
      setRows(r);
    }
    setLoading(false);
  }, [companyId]);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleSeed() {
    if (!companyId) return;
    if (!confirm(
      "Seed leave types from country defaults?\n\n" +
      "This adds any missing statutory leave types and refreshes the values of " +
      "country-linked types. Custom types you've created will be left untouched."
    )) return;
    setSeeding(true);
    const r = await leaveTypes.seedFromCountry(companyId);
    setSeeding(false);
    if (isError(r)) {
      toast.error(r.error);
      return;
    }
    const parts: string[] = [];
    if (r.created.length) parts.push(`created ${r.created.length} (${r.created.join(", ")})`);
    if (r.updated.length) parts.push(`refreshed ${r.updated.length}`);
    if (r.skipped.length) parts.push(`skipped ${r.skipped.length} custom`);
    toast.success(parts.length ? parts.join(" · ") : "Already up to date");
    refresh();
  }

  async function toggleActive(lt: LeaveType) {
    if (!companyId) return;
    const r = await leaveTypes.patch(companyId, lt.id, { is_active: !lt.is_active });
    if (isError(r)) {
      toast.error(r.error);
      return;
    }
    setRows((prev) => prev.map((x) => (x.id === lt.id ? { ...x, is_active: r.is_active } : x)));
  }

  if (!companyId) {
    return (
      <div className="px-6 py-12 text-center text-zinc-500 dark:text-gray-400">
        Sign in to a company to manage leave types.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-600 dark:text-gray-400">
          {rows.length} leave type{rows.length !== 1 ? "s" : ""} ·{" "}
          {rows.filter((r) => r.is_active).length} active
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-gray-700 px-3 py-2 text-sm text-zinc-700 dark:text-gray-200 hover:bg-zinc-50 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={handleSeed}
            disabled={seeding}
            className="inline-flex items-center gap-2 rounded-md border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 px-3 py-2 text-sm font-medium text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-950/60 disabled:opacity-50"
          >
            <Sparkles className={`h-4 w-4 ${seeding ? "animate-pulse" : ""}`} />
            Seed from country
          </button>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            New type
          </button>
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-12 text-center text-zinc-400 dark:text-gray-500">
          Loading...
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-12 text-center">
          <h3 className="text-base font-medium text-zinc-700 dark:text-gray-200">No leave types yet</h3>
          <p className="text-sm text-zinc-500 dark:text-gray-400 mt-1">
            Click <strong>Seed from country</strong> to start with the statutory defaults,
            or create your own.
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <button onClick={handleSeed} disabled={seeding}
              className="inline-flex items-center gap-2 rounded-md border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 px-3 py-2 text-sm font-medium text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-950/60 disabled:opacity-50">
              <Sparkles className="h-4 w-4" />
              Seed from country
            </button>
            <button onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
              <Plus className="h-4 w-4" />
              New type
            </button>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-gray-800 bg-white dark:bg-gray-900">
          <table className="min-w-full divide-y divide-zinc-100 dark:divide-gray-800">
            <thead className="bg-zinc-50 dark:bg-gray-800/60">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase">Code</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase">Label</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase">Days/yr</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase">Accrual</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase">Flags</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50 dark:divide-gray-800">
              {rows.map((lt) => (
                <tr key={lt.id} className={lt.is_active ? "" : "opacity-60"}>
                  <td className="px-4 py-3 text-sm font-mono font-medium text-zinc-900 dark:text-white">
                    {lt.code}
                    {lt.is_statutory && (
                      <span className="ml-2 inline-flex items-center gap-0.5 rounded bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 text-[10px] font-medium uppercase" title="Linked to country statutory default">
                        <ShieldCheck className="h-2.5 w-2.5" />
                        statutory
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-700 dark:text-gray-200">{lt.label}</td>
                  <td className="px-4 py-3 text-sm tabular-nums text-zinc-700 dark:text-gray-200 text-right">
                    {lt.days_per_year ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-600 dark:text-gray-400 font-mono text-xs">{lt.accrual_method}</td>
                  <td className="px-4 py-3 text-xs">
                    <div className="flex flex-wrap gap-1 justify-center">
                      {lt.is_paid && <span className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400">paid</span>}
                      {lt.encashable && <span className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400">encashable</span>}
                      {lt.requires_doc && <span className="px-1.5 py-0.5 rounded bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400">doc</span>}
                      {lt.min_service_months > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-gray-800 text-zinc-600 dark:text-gray-400">
                          ≥{lt.min_service_months}mo
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      type="button"
                      onClick={() => toggleActive(lt)}
                      className={`inline-flex items-center justify-center rounded-full transition-colors ${
                        lt.is_active
                          ? "bg-emerald-500 hover:bg-emerald-600"
                          : "bg-zinc-200 hover:bg-zinc-300"
                      }`}
                      style={{ width: 36, height: 20, padding: 2 }}
                      title={lt.is_active ? "Active — click to deactivate" : "Inactive — click to activate"}
                    >
                      <span
                        className={`block bg-white rounded-full shadow transition-transform ${
                          lt.is_active ? "translate-x-[16px]" : "translate-x-0"
                        }`}
                        style={{ width: 16, height: 16 }}
                      />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateLeaveTypeModal
        open={createOpen}
        companyId={companyId}
        existingCodes={new Set(rows.map((r) => r.code))}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          refresh();
        }}
      />
    </div>
  );
}
