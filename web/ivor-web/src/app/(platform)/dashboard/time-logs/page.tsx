"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import {
  timeLogReview,
  type TimeLogReviewItem,
  type TimeLogSource,
  type TimeLogStatus,
} from "@/services/payroll-api";
import { toast } from "sonner";
import DashboardHeader from "@/components/ui/DashboardHeader";
import GroupedTimeLogs from "./GroupedTimeLogs";
import { EditTimeLogButton } from "./EditTimeLogModal";
import { groupByEmployeeDay } from "./grouping";
import {
  RefreshCcw,
  CheckCircle2,
  XCircle,
  Download,
  AlertTriangle,
  ShieldAlert,
  Tablet,
  Clock,
  Rows3,
  LayoutList,
  Info,
  Zap,
  ShieldQuestion,
  Timer,
} from "lucide-react";
import RoleGuard from "../../components/RoleGuard";


function isError<T>(v: T | { error: string; status?: number }): v is { error: string; status?: number } {
  return typeof v === "object" && v !== null && "error" in v;
}


function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}


// ---------------------------------------------------------------------------
// Reject reason modal — required min_length=20.
// ---------------------------------------------------------------------------

function RejectReasonModal({
  open,
  count,
  onConfirm,
  onClose,
}: {
  open: boolean;
  count: number;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  if (!open) return null;
  const tooShort = reason.trim().length < 20;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-gray-800 flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-amber-600" />
          <h3 className="text-base font-semibold text-zinc-900 dark:text-white">
            Reject {count} clock-in{count === 1 ? "" : "s"}
          </h3>
        </div>
        <div className="px-6 py-4 space-y-3">
          <p className="text-sm text-zinc-600 dark:text-gray-400">
            Rejections are visible to the affected employee with the reason
            below. They can dispute it. Be specific.
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are you rejecting? At least 20 characters."
            rows={4}
            className="w-full rounded-md border border-zinc-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          <p className={`text-xs ${tooShort ? "text-amber-700" : "text-emerald-700"}`}>
            {reason.trim().length}/20 characters minimum
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 dark:border-gray-800 px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-zinc-200 dark:border-gray-700 px-3 py-1.5 text-sm text-zinc-700 dark:text-gray-200 hover:bg-zinc-50 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={tooShort || submitting}
            onClick={async () => {
              setSubmitting(true);
              await onConfirm(reason.trim());
              setSubmitting(false);
              setReason("");
            }}
            className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {submitting ? "Rejecting…" : "Reject"}
          </button>
        </div>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Dispute resolve modal
// ---------------------------------------------------------------------------

function DisputeResolveModal({
  open,
  log,
  onResolved,
  onClose,
}: {
  open: boolean;
  log: TimeLogReviewItem | null;
  onResolved: () => void;
  onClose: () => void;
}) {
  const [response, setResponse] = useState("");
  const [submitting, setSubmitting] = useState(false);
  if (!open || !log) return null;

  async function resolve(decision: "approved" | "rejection_upheld") {
    if (!response.trim()) {
      toast.error("Add a short note for the employee");
      return;
    }
    setSubmitting(true);
    const r = await timeLogReview.resolveDispute(log!.timelog_id, decision, response.trim());
    setSubmitting(false);
    if (isError(r)) { toast.error(r.error); return; }
    toast.success(decision === "approved" ? "Approved" : "Rejection upheld");
    setResponse("");
    onResolved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-gray-800">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-white">Resolve dispute</h3>
          <p className="text-xs text-zinc-500 dark:text-gray-400 mt-1">
            {log.employee_name} · {log.day} · {log.hours_worked}h
          </p>
        </div>
        <div className="px-6 py-4 space-y-3 text-sm">
          {log.admin_rejected_reason && (
            <div className="rounded bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 px-3 py-2">
              <p className="text-xs text-amber-700 dark:text-amber-400 uppercase font-semibold mb-1">Original rejection reason</p>
              <p className="text-zinc-700 dark:text-gray-200">{log.admin_rejected_reason}</p>
            </div>
          )}
          <textarea
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            placeholder="Note to employee (will appear in their notification)"
            rows={3}
            className="w-full rounded-md border border-zinc-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 dark:border-gray-800 px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-zinc-200 dark:border-gray-700 px-3 py-1.5 text-sm text-zinc-700 dark:text-gray-200 hover:bg-zinc-50 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => resolve("rejection_upheld")}
            disabled={submitting}
            className="rounded-md border border-amber-300 dark:border-amber-900 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 disabled:opacity-50"
          >
            Uphold rejection
          </button>
          <button
            type="button"
            onClick={() => resolve("approved")}
            disabled={submitting}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Skeleton row — matches the 7-column review table while logs load.
// ---------------------------------------------------------------------------

function SkeletonRow() {
  return (
    <tr className="border-t border-zinc-100 dark:border-gray-800">
      {[...Array(7)].map((_, i) => (
        <td key={i} className="px-3 py-3">
          <div className="h-4 bg-zinc-200 dark:bg-gray-700 rounded animate-pulse" />
        </td>
      ))}
    </tr>
  );
}


// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TimeLogsPage() {
  // Use the resolved companyId from useAuth (handles delegated management
  // employees, whose company lives on private_user — not the owner `company`
  // row). Computing `user?.company?.company_id` here returned undefined for an
  // HR/Supervisor, which dropped them into the "no company" branch BELOW the
  // RoleGuard, bypassing the permission check entirely.
  const { companyId } = useAuth();

  const [month, setMonth] = useState(currentMonth());
  const [status, setStatus] = useState<TimeLogStatus>("pending");
  // M30 — source filter: "all" maps to "no filter" when calling the API.
  const [source, setSource] = useState<TimeLogSource | "all">("all");
  // Auto-clockout — client-side toggle to isolate sessions the system closed
  // (max-shift or scheduled-end) rather than the employee. The backend has no
  // dedicated filter param, so we narrow the already-fetched month locally.
  const [autoClosedOnly, setAutoClosedOnly] = useState(false);
  const [logs, setLogs] = useState<TimeLogReviewItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [rejectOpen, setRejectOpen] = useState(false);
  const [disputeLog, setDisputeLog] = useState<TimeLogReviewItem | null>(null);
  const [bulkApproving, setBulkApproving] = useState(false);
  // #20 — grouped-by-employee/day view (default) vs the legacy flat table.
  const [view, setView] = useState<"grouped" | "flat">("grouped");
  // "Why this screen" explainer — dismissible, remembered so it doesn't nag.
  const [showHelp, setShowHelp] = useState(true);
  useEffect(() => {
    try { setShowHelp(localStorage.getItem("kiruko_timelog_help_dismissed") !== "1"); } catch { /* ignore */ }
  }, []);
  function dismissHelp() {
    setShowHelp(false);
    try { localStorage.setItem("kiruko_timelog_help_dismissed", "1"); } catch { /* ignore */ }
  }
  const [confirmingId, setConfirmingId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const r = await timeLogReview.list(companyId, month, {
      status,
      source: source === "all" ? undefined : source,
    });
    setLoading(false);
    if (isError(r)) { toast.error(r.error); setLogs([]); return; }
    setLogs(r);
    setSelected(new Set());
  }, [companyId, month, status, source]);

  useEffect(() => { refresh(); }, [refresh]);

  const totals = useMemo(() => {
    const t = { rows: logs.length, hours: 0, approved: 0, rejected: 0, disputed: 0, pending: 0 };
    for (const l of logs) {
      t.hours += l.hours_worked ?? 0;
      if (l.dispute_status === "pending") t.disputed += 1;
      if (l.admin_approved) t.approved += 1;
      else if (l.admin_rejected) t.rejected += 1;
      else t.pending += 1;
    }
    return t;
  }, [logs]);

  // Rows actually rendered, after the client-side auto-closed narrowing.
  const visible = useMemo(
    () => (autoClosedOnly ? logs.filter((l) => l.auto_closed) : logs),
    [logs, autoClosedOnly],
  );
  const autoClosedCount = useMemo(() => logs.filter((l) => l.auto_closed).length, [logs]);

  // #20 — per-employee/day blocks, each split by activity type.
  const groups = useMemo(() => groupByEmployeeDay(visible), [visible]);

  function toggleSelect(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }

  function selectMany(ids: number[], on: boolean) {
    const next = new Set(selected);
    for (const id of ids) {
      if (on) next.add(id); else next.delete(id);
    }
    setSelected(next);
  }

  // #20 — confirm an overtime session's premium. Separate from approving the
  // clock-in: payroll only pays the OT premium once overtime_confirmed_by_employer
  // is set AND the clock-in is approved.
  async function confirmOvertime(id: number) {
    setConfirmingId(id);
    const r = await timeLogReview.patch(id, { overtime_confirmed_by_employer: true });
    setConfirmingId(null);
    if (isError(r)) { toast.error(r.error); return; }
    toast.success("Overtime confirmed");
    refresh();
  }

  function toggleSelectAll() {
    if (selected.size === visible.length) setSelected(new Set());
    else setSelected(new Set(visible.map((l) => l.timelog_id)));
  }

  async function approveSelected() {
    if (!companyId || selected.size === 0) return;
    const r = await timeLogReview.approve(companyId, Array.from(selected));
    if (isError(r)) { toast.error(r.error); return; }
    toast.success(`Approved ${r.approved_count}`);
    refresh();
  }

  async function rejectSelected(reason: string) {
    if (!companyId || selected.size === 0) return;
    const r = await timeLogReview.reject(companyId, Array.from(selected), reason);
    if (isError(r)) { toast.error(r.error); return; }
    toast.success(`Rejected ${r.rejected_count} · ${r.notifications_sent} notifications sent`);
    setRejectOpen(false);
    refresh();
  }

  async function downloadAudit() {
    if (!companyId) return;
    const [y, m] = month.split("-").map(Number);
    const fromDate = `${month}-01`;
    const toDate = `${y}-${String(m).padStart(2, "0")}-${new Date(y, m, 0).getDate()}`;
    const r = await timeLogReview.auditExport(companyId, fromDate, toDate);
    if (isError(r)) { toast.error(r.error); return; }
    const url = URL.createObjectURL(r as Blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `timelog_audit_${companyId}_${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!companyId) {
    // Keep the RoleGuard outermost even on this branch so an unpermissioned
    // user is redirected rather than shown the page chrome.
    return (
      <RoleGuard companyPermissions={["edit_hours"]}>
        <div className="p-8 text-center text-zinc-500 dark:text-gray-400">Sign in to a company to review clock-ins.</div>
      </RoleGuard>
    );
  }

  return (
    <RoleGuard companyPermissions={["edit_hours"]}>
    <div className="px-6 py-8 max-w-7xl mx-auto">
      <DashboardHeader
        title="Clock-in review"
        subtitle="Approve or reject employee clock-ins. Approved hours feed payroll. Rejections require a reason ≥ 20 characters and are visible to the employee."
        extra={
          <button
            type="button"
            onClick={downloadAudit}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-gray-700 px-3 py-2 text-sm text-zinc-700 dark:text-gray-200 hover:bg-zinc-50 dark:hover:bg-gray-800"
          >
            <Download className="h-4 w-4" /> Audit CSV
          </button>
        }
      />

      {/* Why this screen matters — dismissible explainer */}
      {showHelp ? (
        <div className="mb-5 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/60 dark:bg-blue-950/30 px-5 py-4">
          <div className="flex items-start gap-3">
            <ShieldQuestion className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-blue-900 dark:text-blue-200">
                This is the trust gate between attendance and pay
              </p>
              <p className="text-xs text-blue-800/80 dark:text-blue-300/80 mt-1 leading-relaxed">
                When clock-driven payroll is on, <strong>only what you approve here feeds the payroll run</strong>. Sessions are grouped by employee and day, then split by type so each gets the right decision:
              </p>
              <ul className="mt-2.5 grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-blue-900/90 dark:text-blue-200/90">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span><strong>Normal</strong> — within the scheduled shift. Approve to pay.</span>
                </li>
                <li className="flex items-start gap-2">
                  <Zap className="h-3.5 w-3.5 mt-0.5 shrink-0 text-violet-600 dark:text-violet-400" />
                  <span><strong>Overtime</strong> — beyond schedule. <em>Confirm overtime</em> is a separate decision from approving, so the premium can&apos;t be paid without your sign-off. To review all OT with its cost and bulk-confirm, use the <Link href="/dashboard/overtime" className="font-medium text-violet-700 dark:text-violet-300 hover:underline">Overtime</Link> view — same data, both stay in sync.</span>
                </li>
                <li className="flex items-start gap-2">
                  <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0 text-yellow-600 dark:text-yellow-400" />
                  <span><strong>Off-schedule</strong> — clocked outside the shift window. Verify it was legitimate.</span>
                </li>
                <li className="flex items-start gap-2">
                  <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-orange-600 dark:text-orange-400" />
                  <span><strong>Auto-closed</strong> — the system closed a session the employee forgot to clock out of; hours are capped — review first.</span>
                </li>
              </ul>
              <p className="text-xs text-blue-800/80 dark:text-blue-300/80 mt-2.5 leading-relaxed">
                <strong>Rejecting</strong> a clock-in marks that day as an absence (the employee is notified and can dispute). Kiosk selfies appear as evidence against buddy-punching.
              </p>
            </div>
            <button
              type="button"
              onClick={dismissHelp}
              className="shrink-0 text-xs font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded-md px-2 py-1"
            >
              Got it
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowHelp(true)}
          className="mb-4 inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-gray-400 hover:text-zinc-700 dark:hover:text-gray-200"
        >
          <Info className="h-3.5 w-3.5" /> What is this screen?
        </button>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm text-zinc-600 dark:text-gray-400">Month</label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-md border border-zinc-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white px-3 py-1.5 text-sm"
          />
        </div>
        <div className="flex items-center gap-1 text-sm">
          {(["all", "pending", "approved", "rejected", "disputed"] as TimeLogStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`px-3 py-1.5 rounded-md ${
                status === s
                  ? "bg-blue-600 text-white"
                  : "text-zinc-600 dark:text-gray-400 hover:bg-zinc-100 dark:hover:bg-gray-800"
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        {/* M30 — source filter. Distinct visual treatment (border + neutral
            color when active) so it doesn't compete with the primary status
            chips above. */}
        <div className="flex items-center gap-1 text-sm border-l border-zinc-200 dark:border-gray-800 pl-3 ml-1">
          <span className="text-xs text-zinc-500 dark:text-gray-400 mr-1">Source:</span>
          {(["all", "mobile", "web", "kiosk", "admin"] as Array<TimeLogSource | "all">).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSource(s)}
              className={`px-2.5 py-1 rounded-md inline-flex items-center gap-1 ${
                source === s
                  ? "bg-zinc-900 dark:bg-white text-white dark:text-gray-900"
                  : "text-zinc-600 dark:text-gray-400 hover:bg-zinc-100 dark:hover:bg-gray-800"
              }`}
            >
              {s === "kiosk" && <Tablet className="h-3 w-3" />}
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        {/* Auto-clockout — toggle to isolate system-closed sessions. Hidden
            when the month has none, so it doesn't add noise. */}
        {autoClosedCount > 0 && (
          <button
            type="button"
            onClick={() => setAutoClosedOnly((v) => !v)}
            title="Show only sessions the system closed automatically (max-shift reached or scheduled end + grace). The employee did not clock out."
            className={`px-2.5 py-1 rounded-md inline-flex items-center gap-1 text-sm border-l border-zinc-200 dark:border-gray-800 pl-3 ml-1 ${
              autoClosedOnly
                ? "bg-orange-600 text-white"
                : "text-orange-700 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/40"
            }`}
          >
            <Clock className="h-3 w-3" />
            Auto-closed ({autoClosedCount})
          </button>
        )}
        {/* #20 — grouped vs flat view toggle. */}
        <div className="ml-auto inline-flex items-center rounded-md border border-zinc-200 dark:border-gray-700 overflow-hidden text-sm">
          <button
            type="button"
            onClick={() => setView("grouped")}
            title="Group by employee and day, split by activity type"
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 ${
              view === "grouped"
                ? "bg-blue-600 text-white"
                : "text-zinc-600 dark:text-gray-400 hover:bg-zinc-100 dark:hover:bg-gray-800"
            }`}
          >
            <Rows3 className="h-4 w-4" /> Grouped
          </button>
          <button
            type="button"
            onClick={() => setView("flat")}
            title="Flat list of every session"
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 ${
              view === "flat"
                ? "bg-blue-600 text-white"
                : "text-zinc-600 dark:text-gray-400 hover:bg-zinc-100 dark:hover:bg-gray-800"
            }`}
          >
            <LayoutList className="h-4 w-4" /> Flat
          </button>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-gray-700 px-3 py-1.5 text-sm text-zinc-700 dark:text-gray-200 hover:bg-zinc-50 dark:hover:bg-gray-800 disabled:opacity-50"
        >
          <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Summary chips */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <div className="rounded-lg border border-zinc-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
          <p className="text-xs text-zinc-500 dark:text-gray-400">Rows</p>
          <p className="text-xl font-semibold text-zinc-900 dark:text-white">{totals.rows}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
          <p className="text-xs text-zinc-500 dark:text-gray-400">Hours</p>
          <p className="text-xl font-semibold text-zinc-900 dark:text-white">{totals.hours.toFixed(2)}</p>
        </div>
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3">
          <p className="text-xs text-emerald-700 dark:text-emerald-400">Approved</p>
          <p className="text-xl font-semibold text-emerald-900 dark:text-emerald-400">{totals.approved}</p>
        </div>
        <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 py-3">
          <p className="text-xs text-amber-700 dark:text-amber-400">Rejected</p>
          <p className="text-xl font-semibold text-amber-900 dark:text-amber-400">{totals.rejected}</p>
        </div>
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3">
          <p className="text-xs text-red-700 dark:text-red-400">Disputed</p>
          <p className="text-xl font-semibold text-red-900 dark:text-red-400">{totals.disputed}</p>
        </div>
      </div>

      {/* M30 — Kiosk fast-track approval banner. Shows when the source
          filter is 'kiosk' and there are pending kiosk entries in view.
          One click approves every visible kiosk-pending row via the
          existing bulk-approve plumbing — no new endpoint required. */}
      {source === "kiosk" && totals.pending > 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 mb-4 flex items-center gap-3">
          <Tablet className="h-5 w-5 text-amber-700 dark:text-amber-400 flex-shrink-0" />
          <div className="text-sm text-amber-900 dark:text-amber-400 flex-1">
            <strong>{totals.pending}</strong> kiosk entr{totals.pending === 1 ? "y" : "ies"} pending approval.
            Drill into individual rows below to review, or approve them all at once.
          </div>
          <button
            type="button"
            onClick={async () => {
              if (!companyId) return;
              const kioskPendingIds = logs
                .filter((l) => !l.admin_approved && !l.admin_rejected)
                .map((l) => l.timelog_id);
              if (kioskPendingIds.length === 0) return;
              setBulkApproving(true);
              const r = await timeLogReview.approve(companyId, kioskPendingIds);
              setBulkApproving(false);
              if (isError(r)) { toast.error(r.error); return; }
              toast.success(`Approved ${r.approved_count} kiosk entr${r.approved_count === 1 ? "y" : "ies"}`);
              refresh();
            }}
            disabled={bulkApproving}
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" /> Approve all {totals.pending}
          </button>
        </div>
      )}

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 px-4 py-2 mb-4 flex items-center gap-3">
          <span className="text-sm font-medium text-blue-900 dark:text-blue-400">{selected.size} selected</span>
          <button
            type="button"
            onClick={approveSelected}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
          >
            <CheckCircle2 className="h-4 w-4" /> Approve
          </button>
          <button
            type="button"
            onClick={() => setRejectOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
          >
            <XCircle className="h-4 w-4" /> Reject
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-sm text-blue-700 dark:text-blue-400 hover:underline"
          >
            Clear
          </button>
        </div>
      )}

      {/* #20 — grouped view (default): per-employee/day blocks split by type. */}
      {view === "grouped" ? (
        loading && logs.length === 0 ? (
          <div className="rounded-lg border border-zinc-200 dark:border-gray-800 bg-white dark:bg-gray-900 py-8 text-center text-zinc-400 dark:text-gray-500">
            Loading…
          </div>
        ) : (
          <GroupedTimeLogs
            groups={groups}
            selected={selected}
            onToggleSelect={toggleSelect}
            onSelectMany={selectMany}
            onConfirmOvertime={confirmOvertime}
            onResolveDispute={setDisputeLog}
            onEdited={refresh}
            confirmingId={confirmingId}
          />
        )
      ) : (
      /* Flat table */
      <div className="rounded-lg border border-zinc-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-gray-800/60">
            <tr className="text-xs text-zinc-500 dark:text-gray-400 uppercase">
              <th className="px-3 py-2 text-left w-10">
                <input
                  type="checkbox"
                  checked={visible.length > 0 && selected.size === visible.length}
                  onChange={toggleSelectAll}
                />
              </th>
              <th className="px-3 py-2 text-left">Employee</th>
              <th className="px-3 py-2 text-left">Day</th>
              <th className="px-3 py-2 text-left">Start → End</th>
              <th className="px-3 py-2 text-right">Hours</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading && logs.length === 0 ? (
              [...Array(6)].map((_, i) => <SkeletonRow key={i} />)
            ) : visible.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-zinc-400 dark:text-gray-500 py-8">No clock-ins for this filter.</td></tr>
            ) : visible.map((l) => {
              const isDisputed = l.dispute_status === "pending";
              return (
                <tr key={l.timelog_id} className={`border-t border-zinc-100 dark:border-gray-800 ${isDisputed ? "bg-red-50/40 dark:bg-red-950/20" : l.out_of_schedule ? "bg-yellow-50/40 dark:bg-yellow-950/20" : ""}`}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(l.timelog_id)}
                      onChange={() => toggleSelect(l.timelog_id)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    {/* v1.7 — kiosk selfie thumbnail (buddy-punching evidence).
                        Click to open full-size in a new tab. NULL on
                        non-kiosk logs OR when capture failed. */}
                    <div className="inline-flex items-center gap-2">
                      {l.kiosk_photo_path ? (
                        <a
                          href={`/uploads/${l.kiosk_photo_path}`}
                          target="_blank"
                          rel="noreferrer"
                          title="Open full-size photo"
                          className="block"
                        >
                          <img
                            src={`/uploads/${l.kiosk_photo_path}`}
                            alt=""
                            className="w-8 h-8 rounded-full object-cover ring-1 ring-zinc-200 dark:ring-gray-700"
                          />
                        </a>
                      ) : null}
                      <span>
                        {l.employee_name}
                        {l.employee_code && (
                          <span className="ml-1.5 font-mono text-xs text-zinc-400 dark:text-gray-500">{l.employee_code}</span>
                        )}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-gray-400">{l.day ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-zinc-500 dark:text-gray-400">
                    {l.start_time ? new Date(l.start_time).toLocaleTimeString() : "—"}
                    {" → "}
                    {l.end_time ? new Date(l.end_time).toLocaleTimeString() : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.hours_worked?.toFixed(2) ?? "—"}</td>
                  <td className="px-3 py-2">
                    <div className="inline-flex items-center gap-1 flex-wrap">
                      {isDisputed ? (
                        <span className="inline-flex items-center gap-1 rounded bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-400 px-2 py-0.5 text-xs">
                          <AlertTriangle className="h-3 w-3" /> Disputed
                        </span>
                      ) : l.admin_approved ? (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-400 px-2 py-0.5 text-xs">
                          <CheckCircle2 className="h-3 w-3" /> Approved
                        </span>
                      ) : l.admin_rejected ? (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400 px-2 py-0.5 text-xs">
                          <XCircle className="h-3 w-3" /> Rejected
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-zinc-100 dark:bg-gray-800 text-zinc-700 dark:text-gray-200 px-2 py-0.5 text-xs">
                          Pending
                        </span>
                      )}
                      {/* v1.7 — out-of-schedule flag. Buddy-punching signal:
                          clock-in fell outside the employee's job hours. */}
                      {l.out_of_schedule && (
                        <span
                          className="inline-flex items-center gap-1 rounded bg-yellow-100 dark:bg-yellow-950/40 text-yellow-800 dark:text-yellow-400 px-2 py-0.5 text-xs"
                          title="Clock-in time fell outside this employee's configured work hours (with grace). Review against the employee's schedule."
                        >
                          <ShieldAlert className="h-3 w-3" /> Off-schedule
                        </span>
                      )}
                      {/* Late start — distinct from off_schedule. */}
                      {l.is_late && (
                        <span className="inline-flex items-center gap-1 rounded bg-yellow-100 dark:bg-yellow-950/40 text-yellow-800 dark:text-yellow-400 px-2 py-0.5 text-xs">
                          <Timer className="h-3 w-3" /> Late
                        </span>
                      )}
                      {/* Auto-clockout — the session was closed by the system,
                          not the employee. End time was set to max-shift or the
                          scheduled end + grace; hours should be reviewed. */}
                      {l.auto_closed && (
                        <span
                          className="inline-flex items-center gap-1 rounded bg-orange-100 dark:bg-orange-950/40 text-orange-800 dark:text-orange-400 px-2 py-0.5 text-xs"
                          title="Closed automatically by the system — the employee did not clock out. End time was capped at max-shift or the scheduled end + grace. Review the hours before approving."
                        >
                          <Clock className="h-3 w-3" /> Auto-closed
                        </span>
                      )}
                    </div>
                    {/* Employee's own explanation, shown directly — not a
                        hover tooltip — so HR doesn't miss it during review. */}
                    {l.is_late && (
                      <div className="mt-1 rounded bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-900 px-2 py-1 text-[11px] text-yellow-800 dark:text-yellow-400 max-w-[220px]">
                        <span className="font-semibold">Reason:</span> {l.late_reason || "No reason given"}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex items-center gap-2">
                      <EditTimeLogButton log={l} onSaved={refresh} />
                      {isDisputed && (
                        <button
                          type="button"
                          onClick={() => setDisputeLog(l)}
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          Resolve
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      <RejectReasonModal
        open={rejectOpen}
        count={selected.size}
        onConfirm={rejectSelected}
        onClose={() => setRejectOpen(false)}
      />
      <DisputeResolveModal
        open={!!disputeLog}
        log={disputeLog}
        onResolved={() => { setDisputeLog(null); refresh(); }}
        onClose={() => setDisputeLog(null)}
      />
    </div>
    </RoleGuard>
  );
}
