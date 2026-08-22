"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { countryAssignments } from "@/services/payroll-api";
import { isError } from "@/utils/payrollFormat";
import { countryLabel } from "@/utils/countryDisplay";
import { Download, Globe, Loader2, RefreshCw } from "lucide-react";

interface AssignmentReportRow {
  assignment_id: number;
  private_user_id: number;
  employee_name: string | null;
  country_code: string;
  country_name: string | null;
  country_currency: string | null;
  reason: string;
  effective_from: string | null;
  effective_to: string | null;
  new_company_id: number | null;
  notes: string | null;
  archived_at: string | null;
  status: string;
  host_days: number;
  residency_qualified: boolean;
}

const REASON_LABELS: Record<string, string> = {
  mission: "Mission",
  transfer_same_company: "Transfer",
  transfer_new_company: "Transfer (new company)",
};

const STATUS_STYLE: Record<string, string> = {
  active: "bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400",
  upcoming: "bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400",
  ended: "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300",
  archived: "bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-400",
};

function fmtDate(d: string | null | undefined): string {
  if (!d) return "";
  try { return new Date(d).toLocaleDateString(); } catch { return d; }
}

/**
 * Phase 3 — company-wide country assignment history & reporting.
 * Answers "who is / has been on assignment where", filtered by status/host
 * country/type, with a residency indicator (>183 days in-host, informational —
 * NOT enforced by the payroll engine) and CSV export.
 */
export default function CountryAssignmentsReport() {
  const { companyId } = useAuth();
  const [rows, setRows] = useState<AssignmentReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [status, setStatus] = useState("");
  const [reason, setReason] = useState("");

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const r = await countryAssignments.companyReport(companyId, {
      status: status || undefined,
      reason: reason || undefined,
    });
    setRows(isError(r) ? [] : r);
    setLoading(false);
  }, [companyId, status, reason]);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleDownload() {
    if (!companyId) return;
    try {
      const blob = await countryAssignments.companyReport(companyId, {
        status: status || undefined,
        reason: reason || undefined,
        format: "csv",
      });
      // csv streamed as an HTTP Response whose body is the CSV text.
      const text = typeof blob === "string" ? blob : JSON.stringify(blob);
      const url = URL.createObjectURL(
        new Blob([text], { type: "text/csv" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `country_assignments_${companyId}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  }

  async function handleRefresh() {
    setSpinning(true);
    await refresh();
    setSpinning(false);
  }

  const activeCount = useMemo(
    () => rows.filter((r) => r.status === "active").length,
    [rows],
  );
  const residencyCount = useMemo(
    () => rows.filter((r) => r.residency_qualified).length,
    [rows],
  );

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-950/40 flex items-center justify-center text-blue-600 dark:text-blue-400">
            <Globe size={15} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Country assignments</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Mission & transfer history. Residency = 183+ days in-host (informational, not payroll-enforced).
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-md border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="upcoming">Upcoming</option>
            <option value="ended">Ended</option>
            <option value="archived">Archived</option>
          </select>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="rounded-md border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All types</option>
            <option value="mission">Mission</option>
            <option value="transfer_same_company">Transfer</option>
            <option value="transfer_new_company">Transfer (new company)</option>
          </select>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={spinning}
            className="p-2 rounded-md border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <RefreshCw size={14} className={spinning ? "animate-spin" : ""} />
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {!companyId ? (
        <div className="p-6 text-sm text-gray-400 dark:text-gray-500">No company associated with your account.</div>
      ) : loading ? (
        <div className="p-8 flex items-center justify-center text-sm text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 px-5 pt-4">
            <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 px-3 py-2">
              <p className="text-[11px] text-gray-400 dark:text-gray-500 uppercase tracking-wide">Currently active</p>
              <p className="text-lg font-bold text-gray-900 dark:text-white">{activeCount}</p>
            </div>
            <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 px-3 py-2">
              <p className="text-[11px] text-gray-400 dark:text-gray-500 uppercase tracking-wide">Residency (&gt;183d)</p>
              <p className="text-lg font-bold text-amber-600 dark:text-amber-400">{residencyCount}</p>
            </div>
            <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 px-3 py-2">
              <p className="text-[11px] text-gray-400 dark:text-gray-500 uppercase tracking-wide">Total on record</p>
              <p className="text-lg font-bold text-gray-900 dark:text-white">{rows.length}</p>
            </div>
          </div>

          <div className="p-5">
            {rows.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
                No country assignments match these filters.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-gray-700">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800/60 text-left">
                    <tr className="text-[11px] uppercase tracking-wider text-gray-400 dark:text-gray-500">
                      <th className="px-4 py-2.5 font-semibold">Employee</th>
                      <th className="px-4 py-2.5 font-semibold">Country</th>
                      <th className="px-4 py-2.5 font-semibold">Type</th>
                      <th className="px-4 py-2.5 font-semibold">Status</th>
                      <th className="px-4 py-2.5 font-semibold">Window</th>
                      <th className="px-4 py-2.5 font-semibold">Host days</th>
                      <th className="px-4 py-2.5 font-semibold">Residency</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {rows.map((r) => (
                      <tr key={r.assignment_id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                        <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">
                          {r.employee_name || `#${r.private_user_id}`}
                        </td>
                        <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">
                          {countryLabel(r.country_code)}
                          {r.country_currency ? <span className="ml-1 text-gray-400">· {r.country_currency}</span> : null}
                        </td>
                        <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{REASON_LABELS[r.reason] ?? r.reason}</td>
                        <td className="px-4 py-2.5">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_STYLE[r.status] ?? ""}`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">
                          {fmtDate(r.effective_from)}{r.effective_to ? ` – ${fmtDate(r.effective_to)}` : " — ongoing"}
                        </td>
                        <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{r.host_days}</td>
                        <td className="px-4 py-2.5">
                          {r.residency_qualified ? (
                            <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 text-[10px] font-medium">
                              Yes — review
                            </span>
                          ) : (
                            <span className="text-gray-400 dark:text-gray-500">No</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}