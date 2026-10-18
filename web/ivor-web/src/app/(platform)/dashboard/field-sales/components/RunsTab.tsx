"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Play, CheckCircle2, Upload, FileText, RefreshCcw, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  listRuns,
  computeRun,
  getRun,
  approveRun,
  pushRun,
  statementPdfUrl,
  type CommissionRunSummary,
  type CommissionRun,
} from "@/services/fieldSales";

function monthBounds(d = new Date()): { start: string; end: string } {
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-blue-50 text-blue-700 border-blue-200",
  pushed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  closed: "bg-gray-100 text-gray-600 border-gray-200",
};

export default function RunsTab() {
  const { companyId } = useAuth();
  const [runs, setRuns] = useState<CommissionRunSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState(() => monthBounds());
  const [computing, setComputing] = useState(false);
  const [detail, setDetail] = useState<CommissionRun | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!companyId) return;
    setLoading(true);
    try {
      setRuns(await listRuns(companyId));
    } catch {
      toast.error("Failed to load commission runs.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  async function handleCompute() {
    if (!companyId) return;
    setComputing(true);
    try {
      const run = await computeRun(companyId, period.start, period.end);
      toast.success("Run computed.");
      setDetail(run);
      load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      toast.error(err.response?.data?.detail || "Compute failed.");
    } finally {
      setComputing(false);
    }
  }

  async function openDetail(runId: number) {
    if (!companyId) return;
    try {
      setDetail(await getRun(companyId, runId));
    } catch {
      toast.error("Failed to open run.");
    }
  }

  async function handleApprove() {
    if (!companyId || !detail) return;
    setBusy(true);
    try {
      setDetail(await approveRun(companyId, detail.id));
      toast.success("Run approved.");
      load();
    } catch {
      toast.error("Approval failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handlePush() {
    if (!companyId || !detail) return;
    setBusy(true);
    try {
      const res = await pushRun(companyId, detail.id, {
        payable_in_year: new Date(detail.period_end).getFullYear(),
        payable_in_month: new Date(detail.period_end).getMonth() + 1,
      });
      const skipped = (res as { skipped?: unknown[] })?.skipped?.length ?? 0;
      toast.success(skipped ? `Pushed — ${skipped} rep(s) skipped (off-payroll).` : "Pushed to payroll.");
      setDetail(await getRun(companyId, detail.id));
      load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      toast.error(err.response?.data?.detail || "Push failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5">
        <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-white mb-4">Compute a run</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={period.start}
            onChange={(e) => setPeriod((p) => ({ ...p, start: e.target.value }))}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm"
          />
          <span className="text-gray-400">→</span>
          <input
            type="date"
            value={period.end}
            onChange={(e) => setPeriod((p) => ({ ...p, end: e.target.value }))}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm"
          />
          <button
            onClick={handleCompute}
            disabled={computing}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            {computing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Compute
          </button>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm font-medium"
          >
            <RefreshCcw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5">
        <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-white mb-4">Runs</h2>
        {loading ? (
          <div className="py-8 text-center text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
        ) : runs.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">No runs yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-400 border-b border-gray-100 dark:border-gray-800">
                  <th className="py-2 pr-3">Period</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3 text-right">Payable</th>
                  <th className="py-2 pr-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-gray-50 dark:border-gray-800/60">
                    <td className="py-2 pr-3">{r.period_start} → {r.period_end}</td>
                    <td className="py-2 pr-3">
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLES[r.status] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.currency} {Number(r.payable_total).toFixed(2)}</td>
                    <td className="py-2 pr-3 text-right">
                      <button
                        onClick={() => openDetail(r.id)}
                        className="rounded-md border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs font-medium"
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setDetail(null)}>
          <div
            className="h-full w-full max-w-xl bg-white dark:bg-gray-900 shadow-xl overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-display text-lg font-semibold text-gray-900 dark:text-white">
                  Run #{detail.id}
                </h3>
                <p className="text-xs text-gray-500">{detail.period_start} → {detail.period_end}</p>
              </div>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-700">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex flex-wrap gap-2 mb-5">
              <button
                onClick={handleApprove}
                disabled={busy || detail.status !== "draft"}
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 text-blue-700 px-3 py-1.5 text-sm font-medium disabled:opacity-40"
              >
                <CheckCircle2 className="h-4 w-4" /> Approve
              </button>
              <button
                onClick={handlePush}
                disabled={busy || detail.status !== "approved"}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 text-emerald-700 px-3 py-1.5 text-sm font-medium disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Push to payroll
              </button>
            </div>

            <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Line items</h4>
            <div className="mb-5 divide-y divide-gray-100 dark:divide-gray-800 rounded-lg border border-gray-100 dark:border-gray-800">
              {detail.line_items.map((li) => (
                <div key={li.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="text-gray-600 dark:text-gray-300">Rep #{li.private_user_id}</span>
                  <span className="tabular-nums">{li.currency} {Number(li.amount).toFixed(2)}</span>
                </div>
              ))}
              {detail.line_items.length === 0 && (
                <div className="px-3 py-4 text-sm text-gray-500">No line items.</div>
              )}
            </div>

            <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Payables</h4>
            <div className="divide-y divide-gray-100 dark:divide-gray-800 rounded-lg border border-gray-100 dark:border-gray-800">
              {detail.payables.map((p) => (
                <div key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <div>
                    <span className="text-gray-600 dark:text-gray-300">Rep #{p.private_user_id}</span>
                    <span className="ml-2 text-xs text-gray-400">{p.status}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tabular-nums">{p.currency} {Number(p.amount).toFixed(2)}</span>
                    {companyId && (
                      <a
                        href={statementPdfUrl(companyId, detail.id, p.private_user_id)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900"
                      >
                        <FileText className="h-3.5 w-3.5" /> Statement
                      </a>
                    )}
                  </div>
                </div>
              ))}
              {detail.payables.length === 0 && (
                <div className="px-3 py-4 text-sm text-gray-500">No payables.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
