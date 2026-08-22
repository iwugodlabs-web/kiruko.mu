"use client";

import { useCallback, useEffect, useState } from "react";
import { salaryStructures, type SalaryComponent } from "@/services/payroll-api";
import { toast } from "sonner";
import { Plus, RefreshCcw, Star } from "lucide-react";
import CreateComponentModal from "./CreateComponentModal";


function isError<T>(v: T | { error: string; status?: number }): v is { error: string; status?: number } {
  return typeof v === "object" && v !== null && "error" in v;
}


const KIND_PILL: Record<"earning" | "deduction", string> = {
  earning: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900",
  deduction: "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 border-red-200 dark:border-red-900",
};


export default function ComponentsCatalog({ companyId }: { companyId: number }) {
  const [components, setComponents] = useState<SalaryComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await salaryStructures.listComponents(companyId);
    if (isError(r)) {
      toast.error(r.error);
      setComponents([]);
    } else {
      setComponents(r);
    }
    setLoading(false);
  }, [companyId]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-zinc-600 dark:text-gray-400">
          {components.length} component{components.length !== 1 ? "s" : ""} defined.
          Components are the building blocks of every salary structure — basic salary,
          allowances, deductions, and bonuses.
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
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            New component
          </button>
        </div>
      </div>

      {loading && components.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-12 text-center text-zinc-400 dark:text-gray-500">
          Loading components...
        </div>
      ) : components.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-12 text-center">
          <h3 className="text-base font-medium text-zinc-700 dark:text-gray-200">No components yet</h3>
          <p className="text-sm text-zinc-500 dark:text-gray-400 mt-1">
            Add your first component (e.g. BASIC, TRANSPORT, HOUSING).
          </p>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            New component
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-gray-800 bg-white dark:bg-gray-900">
          <table className="min-w-full divide-y divide-zinc-100 dark:divide-gray-800">
            <thead className="bg-zinc-50 dark:bg-gray-800/60">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase">Code</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase">Label</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase">Kind</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase">Category</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase">Bases</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase">Flags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50 dark:divide-gray-800">
              {components.map((c) => (
                <tr key={c.id} className="hover:bg-zinc-50/50 dark:hover:bg-gray-800">
                  <td className="px-4 py-3 text-sm font-mono font-medium text-zinc-900 dark:text-white">
                    {c.code}
                    {c.is_basic && (
                      <span className="ml-2 inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400" title="Basic salary component">
                        <Star className="h-3 w-3 fill-amber-400" />
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-700 dark:text-gray-200">{c.label}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${KIND_PILL[c.kind]}`}>
                      {c.kind}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-600 dark:text-gray-400 font-mono text-xs">{c.category}</td>
                  <td className="px-4 py-3 text-xs">
                    {c.statutory_base_codes.length === 0 ? (
                      <span className="text-zinc-400 dark:text-gray-500 italic">inferred</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {c.statutory_base_codes.map((code) => (
                          <span
                            key={code}
                            className="inline-flex rounded bg-zinc-100 dark:bg-gray-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-700 dark:text-gray-200"
                          >
                            {code}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500 dark:text-gray-400">
                    <div className="flex flex-wrap gap-1 justify-center">
                      {c.is_taxable && <span className="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400">taxable</span>}
                      {c.is_recurring && <span className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-gray-800 text-zinc-600 dark:text-gray-400">recurring</span>}
                      {c.is_one_off && <span className="px-1.5 py-0.5 rounded bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400">one-off</span>}
                      {c.prorate_on_partial_month && <span className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400">prorate</span>}
                      {c.frequency === "daily" && <span className="px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400" title="Amount is a per-day rate, scaled by working days in the period">daily</span>}
                      {c.value_type === "percent_of_basic" && <span className="px-1.5 py-0.5 rounded bg-pink-50 dark:bg-pink-950/40 text-pink-700 dark:text-pink-400" title="Amount is percentage points of BASIC">% of basic</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateComponentModal
        open={createOpen}
        companyId={companyId}
        existingCodes={new Set(components.map((c) => c.code))}
        hasBasic={components.some((c) => c.is_basic)}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          refresh();
        }}
      />
    </div>
  );
}
