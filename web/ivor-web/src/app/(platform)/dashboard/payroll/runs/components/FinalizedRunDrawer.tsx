"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { payroll, type PayrollRun, type Payslip } from "@/services/payroll-api";
import { fetchCompanyUsers, type User } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { isError, formatMoney as fmtMoneyBase } from "@/utils/payrollFormat";
import { FileText, Loader2, X, ChevronRight, RefreshCw, Download, FileArchive } from "lucide-react";


interface Props {
  runId: number | null;
  companyId: number;
  onClose: () => void;
  onOpenPayslip: (payslipId: number) => void;
}


function formatMoney(amount: string | number, currency: string): string {
  return fmtMoneyBase(amount, currency, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatSigned(amount: string | number, currency: string): { text: string; positive: boolean } {
  const n = Number(amount);
  const v = Number.isNaN(n) ? 0 : n;
  const positive = v >= 0;
  return { text: `${positive ? "+" : "−"}${formatMoney(Math.abs(v), currency)}`, positive };
}

function nameOf(u: User): string {
  const first = u.private_user?.first_name?.trim() ?? "";
  const last = u.private_user?.last_name?.trim() ?? "";
  const full = `${first} ${last}`.trim();
  return full || u.user_name || u.email || "";
}
function privateIdOf(u: User): number | undefined {
  return u.private_user?.private_user_id ?? u.private_user_id;
}


export default function FinalizedRunDrawer({ runId, companyId, onClose, onOpenPayslip }: Props) {
  const { user } = useAuth();
  const canExport = !!user?.hasCompanyPermission?.("export_payroll");
  const [run, setRun] = useState<PayrollRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [nameById, setNameById] = useState<Record<number, string>>({});
  const [downloading, setDownloading] = useState<null | "csv" | "zip">(null);

  async function handleDownload(kind: "csv" | "zip") {
    if (runId === null) return;
    setDownloading(kind);
    try {
      const res = kind === "csv"
        ? await payroll.runCsvExport(runId)
        : await payroll.runPayslipsZip(runId);
      if (!(res instanceof Blob)) {
        toast.error((res as { error?: string })?.error || "Download failed.");
        return;
      }
      const url = URL.createObjectURL(res);
      const link = document.createElement("a");
      link.href = url;
      link.download = kind === "csv"
        ? `payroll_run_${runId}.csv`
        : `payroll_run_${runId}_payslips.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(null);
    }
  }

  useEffect(() => {
    if (runId === null) {
      setRun(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    payroll.getRun(runId).then((r) => {
      if (cancelled) return;
      setLoading(false);
      setRun(isError(r) ? null : r);
    });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    if (runId === null) return;
    let cancelled = false;
    (async () => {
      const res = await fetchCompanyUsers(companyId);
      if (cancelled || !Array.isArray(res)) return;
      const map: Record<number, string> = {};
      for (const u of res as User[]) {
        const pid = privateIdOf(u);
        if (pid != null) map[pid] = nameOf(u);
      }
      setNameById(map);
    })();
    return () => { cancelled = true; };
  }, [runId, companyId]);

  const currency = run?.currency ?? "MUR";
  // Originals first, each immediately followed by its corrections — so a
  // reader sees "April payslip for Ben Ten" then its "Correction" right below.
  const ordered = useMemo(() => {
    const slips = run?.payslips ?? [];
    const originals = slips.filter((p) => !p.is_adjustment);
    const adjByParent: Record<number, Payslip[]> = {};
    for (const a of slips.filter((p) => p.is_adjustment)) {
      const key = a.parent_payslip_id ?? -1;
      (adjByParent[key] ??= []).push(a);
    }
    const out: Payslip[] = [];
    for (const o of originals) {
      out.push(o);
      for (const a of adjByParent[o.id] ?? []) out.push(a);
    }
    // Any orphan adjustments (parent not in this run) get appended.
    const placed = new Set(out.map((p) => p.id));
    for (const a of slips) if (!placed.has(a.id)) out.push(a);
    return out;
  }, [run]);

  if (runId === null) return null;

  const period = run
    ? `${new Date(run.period_start).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`
    : "";

  return (
    <div className="fixed inset-0 z-30">
      <button aria-label="Close" type="button" onClick={onClose} className="absolute inset-0 bg-black/30" />

      <div className="absolute right-0 top-0 h-full w-full max-w-xl bg-white dark:bg-zinc-900 shadow-xl flex flex-col">
        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-zinc-500 dark:text-zinc-400" />
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Payslips {period && <span className="text-zinc-400 dark:text-zinc-500 font-normal">· {period}</span>}
            </h2>
            <span className="ml-1 inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
              Finalized
            </span>
          </div>
          <div className="flex items-center gap-2">
            {run && canExport && (
              <>
                <button
                  onClick={() => handleDownload("csv")}
                  disabled={downloading !== null}
                  title="Download this run as CSV"
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
                >
                  {downloading === "csv" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  CSV
                </button>
                <button
                  onClick={() => handleDownload("zip")}
                  disabled={downloading !== null}
                  title="Download all payslip PDFs as a ZIP"
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
                >
                  {downloading === "zip" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileArchive className="h-3.5 w-3.5" />}
                  Payslips
                </button>
              </>
            )}
            <button onClick={onClose} className="text-zinc-400 dark:text-zinc-500 hover:text-zinc-600">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-zinc-400 dark:text-zinc-500 gap-2">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading…
            </div>
          ) : run === null ? (
            <div className="text-zinc-500 dark:text-zinc-400 text-sm">Run not found.</div>
          ) : (
            <div className="rounded-md border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              <table className="min-w-full divide-y divide-zinc-100 dark:divide-zinc-800">
                <thead className="bg-zinc-50 dark:bg-zinc-900/40">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">Employee</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">Net</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800/60">
                  {ordered.map((p) => {
                    const isAdj = !!p.is_adjustment;
                    const signed = isAdj ? formatSigned(p.net_pay, currency) : null;
                    return (
                      <tr
                        key={p.id}
                        className={`cursor-pointer hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40 ${isAdj ? "bg-violet-50/40 dark:bg-violet-500/5" : ""}`}
                        onClick={() => onOpenPayslip(p.id)}
                      >
                        <td className="px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300">
                          <div className="flex items-center gap-2">
                            {isAdj && <RefreshCw className="h-3 w-3 text-violet-500 shrink-0" />}
                            <span className={isAdj ? "pl-1" : ""}>
                              {p.employee_name || nameById[p.private_user_id] || `#${p.private_user_id}`}
                              {p.employee_code && (
                                <span className="ml-1.5 font-mono text-xs text-zinc-400">{p.employee_code}</span>
                              )}
                            </span>
                            {isAdj && (
                              <span className="inline-flex items-center rounded-full bg-violet-100 dark:bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                                Correction
                              </span>
                            )}
                          </div>
                        </td>
                        <td className={`px-3 py-2 text-sm tabular-nums text-right font-medium ${
                          isAdj
                            ? (signed!.positive ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400")
                            : "text-zinc-900 dark:text-zinc-100"
                        }`}>
                          {isAdj ? signed!.text : formatMoney(p.net_pay, currency)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <ChevronRight className="h-4 w-4 text-zinc-300 dark:text-zinc-600 inline" />
                        </td>
                      </tr>
                    );
                  })}
                  {ordered.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-3 py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">
                        No payslips in this run.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
