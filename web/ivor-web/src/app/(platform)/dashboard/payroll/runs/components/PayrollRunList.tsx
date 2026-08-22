"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { payroll, type PayrollRunSummary, type PayrollRunStatus } from "@/services/payroll-api";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  CircleX,
  Clock,
  Plus,
  RefreshCcw,
  ChevronRight,
  Eye,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { describeFlag } from "@/utils/describeFlag";
import StartRunWizard from "./StartRunWizard";
import PayslipDetailDrawer from "./PayslipDetailDrawer";
import FinalizedRunDrawer from "./FinalizedRunDrawer";
import PayrollGuide from "./PayrollGuide";
import { isError, formatMoney, formatPeriod } from "@/utils/payrollFormat";
import { HelpCircle } from "lucide-react";
import ExampleCallout from "@/components/ui/ExampleCallout";


const STATUS_STYLES: Record<PayrollRunStatus, { label: string; classes: string; icon: typeof Clock }> = {
  draft: {
    label: "Draft",
    classes: "bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30",
    icon: Clock,
  },
  finalized: {
    label: "Finalized",
    classes: "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30",
    icon: CheckCircle2,
  },
  cancelled: {
    label: "Cancelled",
    classes: "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800",
    icon: CircleX,
  },
};


// Run-list flags are the run's compliance_flags: run-level signals
// ("pending_clockins:3") + per-employee reasons prefixed "u<id>:". The shared
// describeFlag handles both; "An employee" names the subject since the run row
// doesn't show which one.
// Group a run's warnings by employee (resolved from warning_subjects) so each
// person appears once with their issues nested; run-level flags (no u<id>:
// prefix) fall into an unnamed group. Messages use who:"" so the subject isn't
// repeated under the name header.
function groupWarnings(flags: string[], subjects?: Record<string, string>, currency?: string) {
  const order: string[] = [];
  const byName = new Map<string, string[]>();
  for (const f of flags) {
    const m = f.match(/^u(\d+):/);
    const name = m ? (subjects?.[m[1]] ?? "An employee") : "";
    const msg = describeFlag(f, { who: "", currency }).replace(/^\s+/, "");
    if (!byName.has(name)) { byName.set(name, []); order.push(name); }
    byName.get(name)!.push(msg);
  }
  return order.map((name) => ({ name, messages: byName.get(name)! }));
}

// Initials for the avatar chip (first letter of the first two words).
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function StatusPill({ status }: { status: PayrollRunStatus }) {
  const cfg = STATUS_STYLES[status];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${cfg.classes}`}>
      <Icon className="h-3 w-3" /> {cfg.label}
    </span>
  );
}


export default function PayrollRunList() {
  const { companyId } = useAuth();

  const [runs, setRuns] = useState<PayrollRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [resumeDraftId, setResumeDraftId] = useState<number | null>(null);
  const [openPayslipId, setOpenPayslipId] = useState<number | null>(null);
  const [viewRunId, setViewRunId] = useState<number | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [rerunningId, setRerunningId] = useState<number | null>(null);
  const [redoingId, setRedoingId] = useState<number | null>(null);
  // Redo is a dev/testing tool (production correction = per-employee payslip
  // fix). Hidden unless explicitly enabled; the backend also hard-403s it.
  const REDO_ENABLED = process.env.NEXT_PUBLIC_ENABLE_PAYROLL_REDO === "true";
  const [guideOpen, setGuideOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    // Silent refresh: preserve the existing rows on failure rather than
    // flashing the table empty with setRuns([]). A transient error should not
    // wipe data the user is already looking at.
    const result = await payroll.listRuns(companyId, { limit: 100 });
    if (isError(result)) {
      toast.error(result.error);
    } else {
      setRuns(result);
    }
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleCancel(runId: number, period: string) {
    if (!confirm(`Cancel the ${period} draft? You'll be able to start a fresh one for the same period afterwards.`)) {
      return;
    }
    setCancellingId(runId);
    const r = await payroll.cancel(runId);
    setCancellingId(null);
    if (isError(r)) {
      toast.error(r.error);
      return;
    }
    toast.success(`${period} draft cancelled`);
    refresh();
  }

  async function handleRerun(runId: number, period: string) {
    setRerunningId(runId);
    const r = await payroll.recompute(runId);
    setRerunningId(null);
    if (isError(r)) {
      toast.error(r.error);
      return;
    }
    const warnings = r.compliance_flags?.length ?? 0;
    toast.success(
      warnings > 0
        ? `${period} re-run — ${warnings} warning${warnings === 1 ? "" : "s"}. Open a payslip to see why.`
        : `${period} re-run — no warnings.`,
    );
    refresh();
  }

  async function handleRedo(runId: number, period: string) {
    if (!confirm(
      `Redo the ${period} payroll?\n\n` +
      `This voids the finalized run (its payslips are kept for audit) and starts a ` +
      `fresh draft for the same period. Employees already notified of the old payslips ` +
      `are NOT automatically un-notified. You'll review and finalize the new draft.`,
    )) {
      return;
    }
    setRedoingId(runId);
    const r = await payroll.redo(runId);
    setRedoingId(null);
    if (isError(r)) {
      toast.error(r.error);
      return;
    }
    toast.success(`${period} reopened as a fresh draft — fix the data, then finalize.`);
    // Open the wizard on the new draft so the admin lands straight in review.
    setResumeDraftId(r.id);
    setWizardOpen(true);
    refresh();
  }

  function handleResume(runId: number) {
    setResumeDraftId(runId);
    setWizardOpen(true);
  }

  if (!companyId) {
    return (
      <div className="p-8 text-center text-zinc-500 dark:text-zinc-400">
        Sign in to a company to view payroll runs.
      </div>
    );
  }

  return (
    <div className="px-6 py-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 pb-5 border-b border-gray-200 dark:border-gray-800">
        <div>
          <h1 className="text-[2rem] font-display font-semibold text-gray-900 dark:text-white leading-tight tracking-tight">Payroll Runs</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Generate, review, and finalize monthly payroll for your team.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setGuideOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50"
            title="Show payroll guide"
          >
            <HelpCircle className="h-4 w-4" />
            Guide
          </button>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 disabled:opacity-50"
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setWizardOpen(true)}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Start payroll
          </button>
        </div>
      </div>

      <ExampleCallout className="mb-4" caption="What a typical month of payroll looks like">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="text-zinc-500 dark:text-zinc-400 uppercase">
              <th className="text-left py-1 font-medium">Period</th>
              <th className="text-left py-1 font-medium">Status</th>
              <th className="text-right py-1 font-medium">Payslips</th>
              <th className="text-right py-1 font-medium">Gross</th>
              <th className="text-right py-1 font-medium">Net</th>
            </tr>
          </thead>
          <tbody className="text-zinc-700 dark:text-zinc-300">
            <tr><td>October 2026</td><td><span className="inline-flex items-center rounded bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 text-[10px] font-medium">Draft</span></td><td className="text-right tabular-nums">23</td><td className="text-right tabular-nums">1,250,000</td><td className="text-right tabular-nums">1,058,400</td></tr>
            <tr><td>September 2026</td><td><span className="inline-flex items-center rounded bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 text-[10px] font-medium">Finalized</span></td><td className="text-right tabular-nums">23</td><td className="text-right tabular-nums">1,205,000</td><td className="text-right tabular-nums">1,020,200</td></tr>
            <tr><td>August 2026</td><td><span className="inline-flex items-center rounded bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 text-[10px] font-medium">Finalized</span></td><td className="text-right tabular-nums">22</td><td className="text-right tabular-nums">1,150,000</td><td className="text-right tabular-nums">973,800</td></tr>
          </tbody>
        </table>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">
          Each month follows the same cycle: <strong>Draft</strong> (generated from current salaries) →
          review → <strong>Finalize</strong> (snapshots rules and locks payslips).
        </p>
      </ExampleCallout>

      {/* Empty / loading state */}
      {loading && runs.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-12 text-center text-zinc-400 dark:text-zinc-500">
          Loading runs...
        </div>
      ) : runs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-12 text-center">
          <Calendar className="h-10 w-10 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
          <h3 className="text-base font-medium text-zinc-700 dark:text-zinc-300">No payroll runs yet</h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 max-w-md mx-auto">
            A payroll run is the monthly draft → finalize cycle that produces payslips for your employees.
            Start your first one below.
          </p>
          <button
            type="button"
            onClick={() => setWizardOpen(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Start your first run
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <table className="min-w-full divide-y divide-zinc-100">
            <thead className="bg-zinc-50 dark:bg-zinc-900/40">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">Period</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">Status</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">Payslips</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">Total Net</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">Created</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {runs.map((r) => {
                const period = formatPeriod(r.period_start, r.period_end);
                const isDraft = r.status === "draft";
                return (
                <Fragment key={r.id}>
                <tr className="hover:bg-zinc-50/50">
                  <td className="px-4 py-3 text-sm text-zinc-900 dark:text-zinc-100 font-medium">
                    {period}
                  </td>
                  <td className="px-4 py-3">
                    <div className="inline-flex items-center gap-1.5">
                      <StatusPill status={r.status} />
                      {r.status !== "cancelled" && (r.warning_count ?? 0) > 0 && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300"
                          title="See details below the row"
                        >
                          <AlertTriangle className="h-3 w-3" />
                          {r.warning_count}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300 text-right tabular-nums">
                    {r.payslip_count}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-900 dark:text-zinc-100 text-right tabular-nums font-medium">
                    {formatMoney(r.total_net, r.currency)}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">
                    {r.created_at ? new Date(r.created_at).toLocaleDateString("en-GB") : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {isDraft ? (
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleResume(r.id)}
                          className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
                          title="Resume the wizard at the review step"
                        >
                          Open <ChevronRight className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRerun(r.id, period)}
                          disabled={rerunningId === r.id}
                          className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-800 px-2.5 py-1 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 disabled:opacity-50"
                          title="Rebuild this draft's payslips from the latest clock-ins, salaries, and rules"
                        >
                          <RefreshCcw className={`h-3 w-3 ${rerunningId === r.id ? "animate-spin" : ""}`} />
                          {rerunningId === r.id ? "Re-running…" : "Re-run"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCancel(r.id, period)}
                          disabled={cancellingId === r.id}
                          className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-800 px-2.5 py-1 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 disabled:opacity-50"
                          title="Discard this draft so the period is free again"
                        >
                          <X className="h-3 w-3" />
                          {cancellingId === r.id ? "Cancelling…" : "Cancel"}
                        </button>
                      </div>
                    ) : r.status === "finalized" ? (
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setViewRunId(r.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                          title="View this run's payslips (and any corrections)"
                        >
                          <Eye className="h-3 w-3" />
                          View
                        </button>
                        {REDO_ENABLED && (
                          <button
                            type="button"
                            onClick={() => handleRedo(r.id, period)}
                            disabled={redoingId === r.id}
                            className="inline-flex items-center gap-1 rounded-md border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-100 disabled:opacity-50"
                            title="Void this finalized run (kept for audit) and start a fresh draft for the same period"
                          >
                            <RefreshCcw className={`h-3 w-3 ${redoingId === r.id ? "animate-spin" : ""}`} />
                            {redoingId === r.id ? "Reopening…" : "Redo run"}
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-300 dark:text-zinc-600">—</span>
                    )}
                  </td>
                </tr>
                {r.status !== "cancelled" && (r.warnings?.length ?? 0) > 0 && (
                  <tr>
                    {/* empty leading cell aligns the panel under the Status column */}
                    <td aria-hidden className="px-4" />
                    <td colSpan={5} className="pb-3 pt-0 pr-4">
                      <div className="max-w-2xl rounded-lg border border-amber-200/80 dark:border-amber-500/25 bg-amber-50/70 dark:bg-amber-500/10 px-3.5 py-3">
                        <p className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          {r.warning_count} {(r.warning_count ?? 0) === 1 ? "thing" : "things"} to resolve{isDraft ? " before finalizing" : ""}
                        </p>
                        <div className="space-y-2">
                          {groupWarnings(r.warnings ?? [], r.warning_subjects, r.currency).map((g, gi) =>
                            g.name ? (
                              <div key={gi} className="flex items-start gap-2.5">
                                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-200/70 dark:bg-amber-500/25 text-[10px] font-bold text-amber-800 dark:text-amber-200">
                                  {initials(g.name)}
                                </span>
                                <div className="min-w-0 leading-snug">
                                  <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">{g.name}</span>
                                  <span className="text-xs text-amber-800/90 dark:text-amber-200/80"> — {g.messages.join(" · ")}</span>
                                </div>
                              </div>
                            ) : (
                              <div key={gi} className="flex items-start gap-2.5">
                                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-200/70 dark:bg-amber-500/25 text-amber-700 dark:text-amber-300">
                                  <AlertTriangle className="h-3 w-3" />
                                </span>
                                <p className="min-w-0 self-center text-xs text-amber-800/90 dark:text-amber-200/80 leading-snug">{g.messages.join(" · ")}</p>
                              </div>
                            )
                          )}
                        </div>
                        {isDraft && (
                          <p className="mt-2.5 border-t border-amber-200/60 dark:border-amber-500/20 pt-2 text-[11px] text-amber-700/70 dark:text-amber-300/50">
                            These won&apos;t be in the run until you act — then Re-run to rebuild it.
                          </p>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <StartRunWizard
        open={wizardOpen}
        resumeDraftId={resumeDraftId}
        onClose={() => {
          setWizardOpen(false);
          setResumeDraftId(null);
        }}
        onCompleted={() => {
          setWizardOpen(false);
          setResumeDraftId(null);
          refresh();
        }}
        onOpenPayslip={(payslipId) => {
          // Keep the Start-payroll wizard open behind the payslip drawer so the
          // admin returns to the review step after closing it (the drawer is
          // z-[60], above the wizard's z-50).
          setOpenPayslipId(payslipId);
        }}
        companyId={companyId}
      />

      {/* Finalized-run viewer (z-30) — lists the run's payslips + corrections.
          Opening one stacks the payslip drawer (z-40) on top; closing it
          returns here rather than to the table. */}
      <FinalizedRunDrawer
        runId={viewRunId}
        companyId={companyId}
        onClose={() => setViewRunId(null)}
        onOpenPayslip={(payslipId) => setOpenPayslipId(payslipId)}
      />

      <PayslipDetailDrawer
        payslipId={openPayslipId}
        onClose={() => setOpenPayslipId(null)}
      />

      <PayrollGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  );
}
