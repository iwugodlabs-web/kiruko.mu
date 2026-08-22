"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/services/apiClient";
import { X, ExternalLink, Clock, User, AlertTriangle, CheckCircle, XCircle, MessageSquare, FileText, History, RefreshCw } from "lucide-react";
import { InternalDispute, DisputeStatus, URGENCY_CONFIG, STATUS_LABELS, NEXT_STATUSES } from "./types";
import { isImageUrl } from "@/utils/attachment";

interface Props {
  dispute: InternalDispute | null;
  onClose: () => void;
  onUpdate: (rightId: number, updates: Partial<InternalDispute>) => Promise<void>;
}

const TABS = ["report", "investigation", "resolution", "audit"] as const;
type Tab = typeof TABS[number];

// Dry-run result from POST …/adjustment {preview:true}. Each diff entry is a
// money field that moved: was (current settled) → now (recomputed) + delta.
type CorrectionPreview = {
  diff: Record<string, { was: string; now: string; delta: string }>;
  statutory_employee: Record<string, string>;
  statutory_employer: Record<string, string>;
  net_delta: string;
  current_net_pay: string;
  settled_net_pay: string;
  currency: string;
  prior_adjustments: number;
};

const CORRECTION_FIELD_LABELS: Record<string, string> = {
  gross: "Gross",
  net_pay: "Net pay",
  paye: "PAYE",
  taxable_income: "Taxable income",
  allowances_total: "Allowances",
  bonus: "Bonus",
  loan_repayments: "Loan repayments",
  leave_impact: "Leave impact",
  deductions_total: "Deductions",
};

const TAB_LABELS: Record<Tab, string> = {
  report: "Report",
  investigation: "Investigation",
  resolution: "Resolution",
  audit: "Audit Log",
};

const TAB_ICONS: Record<Tab, React.ReactNode> = {
  report: <FileText size={14} />,
  investigation: <MessageSquare size={14} />,
  resolution: <CheckCircle size={14} />,
  audit: <History size={14} />,
};

export default function DisputeDetailModal({ dispute, onClose, onUpdate }: Props) {
  const [tab, setTab] = useState<Tab>("report");
  const [notes, setNotes] = useState("");
  const [resolution, setResolution] = useState("");
  const [newStatus, setNewStatus] = useState<DisputeStatus | "">("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<CorrectionPreview | null>(null);

  // Two-way conversation with the employee (GET/POST /disputes/{id}/messages).
  const [messages, setMessages] = useState<{ message_id: number; author_kind: string; body: string; created_at: string | null }[]>([]);
  const [msgDraft, setMsgDraft] = useState("");
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [sendingMsg, setSendingMsg] = useState(false);

  const correctionUrl = dispute
    ? `/payroll/runs/${dispute.payroll_run_id}/payslips/${dispute.payslip_id}/adjustment`
    : "";
  const correctionReason = dispute
    ? `Dispute #${dispute.right_id}: ${dispute.title}`.slice(0, 255)
    : "";

  const msgAuthor = (k: string) =>
    k === "reporter" ? "Employee" : k === "employer" ? "You (employer)" : k === "kontokaz" ? "Kiruko Compliance" : k === "system" ? "System" : k;

  // Load the thread whenever the open dispute changes.
  useEffect(() => {
    if (!dispute?.right_id) { setMessages([]); return; }
    let cancelled = false;
    (async () => {
      setLoadingMsgs(true);
      try {
        const r = await api.get(`/user/disputes/${dispute.right_id}/messages`);
        if (!cancelled) setMessages(r.data?.messages ?? []);
      } catch { if (!cancelled) setMessages([]); }
      finally { if (!cancelled) setLoadingMsgs(false); }
    })();
    return () => { cancelled = true; };
  }, [dispute?.right_id]);

  async function sendReply() {
    const text = msgDraft.trim();
    if (!text || !dispute?.right_id || sendingMsg) return;
    setSendingMsg(true);
    try {
      await api.post(`/user/disputes/${dispute.right_id}/messages`, { body: text });
      setMsgDraft("");
      const r = await api.get(`/user/disputes/${dispute.right_id}/messages`);
      setMessages(r.data?.messages ?? []);
      toast.success("Reply sent — the employee has been notified.");
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Could not send reply.");
    } finally {
      setSendingMsg(false);
    }
  }

  // Step 1 — DRY RUN. Recompute the linked payslip against current data and
  // show the employer the exact before/after diff WITHOUT booking anything, so
  // they confirm a conscious correction rather than a blind one-click.
  async function handlePreview() {
    if (!dispute?.payroll_run_id || !dispute?.payslip_id) return;
    setPreviewing(true);
    try {
      const r = await api.post(correctionUrl, { preview: true, reason: correctionReason });
      const d = r.data;
      if (d?.status === "no_change") {
        toast.info("Recompute matches the current payslip — fix the salary/clock-ins first, then retry.");
        setPreview(null);
      } else if (d?.status === "preview") {
        setPreview(d as CorrectionPreview);
      }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Could not compute the correction.");
    } finally {
      setPreviewing(false);
    }
  }

  // Step 2 — APPLY. Books the adjustment, notifies the employee, generates the
  // correction note. Only reachable after the employer reviewed the preview.
  async function handleApply() {
    if (!dispute?.payroll_run_id || !dispute?.payslip_id) return;
    setCorrecting(true);
    try {
      const r = await api.post(correctionUrl, { reason: correctionReason });
      const d = r.data;
      if (d?.status === "no_change") {
        toast.info("Nothing to apply — the payslip already matches.");
      } else {
        toast.success(`Correction applied (net Δ ${d.delta?.net_pay}). Settle ${d.settled_net_pay} with the employee — they've been notified.`);
      }
      setPreview(null);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Could not apply the correction.");
    } finally {
      setCorrecting(false);
    }
  }

  useEffect(() => {
    if (dispute) {
      setNotes(dispute.internal_notes ?? "");
      setResolution(dispute.resolution ?? "");
      setNewStatus(dispute.status as DisputeStatus);
      setTab("report");
      setPreview(null);
    }
  }, [dispute]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!dispute) return null;

  const urgency = URGENCY_CONFIG[dispute.urgency_level] ?? URGENCY_CONFIG.low;
  const isClosed = !!dispute.closed_at;

  async function handleSave() {
    if (!dispute) return;
    setSaving(true);
    try {
      // Only include `status` when it actually changed — sending the current
      // status is a no-op transition the backend state machine rejects (409),
      // which broke "Save Changes" when the user only edited notes.
      const updates: Partial<InternalDispute> = {
        internal_notes: notes,
        resolution: resolution || undefined,
      };
      if (newStatus && newStatus !== dispute.status) {
        updates.status = newStatus as DisputeStatus;
      }
      await onUpdate(dispute.right_id, updates);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // onUpdate surfaces its own error toast; keep the modal open so the
      // user can retry without losing their edits.
    } finally {
      setSaving(false);
    }
  }

  function fmt(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
            <div className="flex-1 min-w-0 pr-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${urgency.classes}`}>
                  {urgency.label}
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">#{dispute.right_id}</span>
                {dispute.days_open > 7 && !isClosed && (
                  <span className="flex items-center gap-1 text-xs text-red-500">
                    <AlertTriangle size={11} /> Overdue
                  </span>
                )}
              </div>
              <h2 className="mt-1 font-semibold text-gray-900 dark:text-gray-100 leading-tight">{dispute.title}</h2>
              <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
                <span className="flex items-center gap-1"><User size={11} />{dispute.employee_name}</span>
                <span className="flex items-center gap-1"><Clock size={11} />{fmt(dispute.created_at)}</span>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors">
              <X size={18} />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-gray-100 dark:border-gray-800 px-6">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex items-center gap-1.5 py-2.5 px-3 text-xs font-medium border-b-2 -mb-px transition-colors ${
                  tab === t
                    ? "border-blue-600 text-blue-600 dark:text-blue-400"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                }`}
              >
                {TAB_ICONS[t]}
                {TAB_LABELS[t]}
              </button>
            ))}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {tab === "report" && (
              <div className="space-y-4">
                {dispute.payroll_run_id && (
                  <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5">
                    <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-widest mb-1">About a payslip</p>
                    <Link
                      href="/dashboard/payroll/runs"
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-800 dark:text-amber-300 hover:underline"
                    >
                      <FileText size={14} /> Open payroll run #{dispute.payroll_run_id}
                      <ExternalLink size={12} className="opacity-60" />
                    </Link>
                    {dispute.payslip_id && (
                      <div className="mt-2">
                        {!preview ? (
                          <>
                            <button
                              type="button"
                              onClick={handlePreview}
                              disabled={previewing}
                              className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 dark:border-amber-600/40 bg-white dark:bg-amber-900/30 px-2.5 py-1 text-xs font-medium text-amber-800 dark:text-amber-200 hover:bg-amber-100 disabled:opacity-50"
                            >
                              <RefreshCw size={12} className={previewing ? "animate-spin" : ""} />
                              {previewing ? "Checking…" : "Review correction"}
                            </button>
                            <p className="mt-1 text-[10px] text-amber-700/70 dark:text-amber-300/60">
                              Fix the salary/clock-ins first, then review exactly what changes before applying it.
                            </p>
                          </>
                        ) : (
                          <div className="rounded-md border border-amber-300 dark:border-amber-600/40 bg-white dark:bg-amber-900/20 p-2.5">
                            <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-200 mb-1.5">
                              Review what will change{preview.prior_adjustments > 0 ? ` (after ${preview.prior_adjustments} prior correction${preview.prior_adjustments === 1 ? "" : "s"})` : ""}
                            </p>
                            <table className="w-full text-[11px]">
                              <thead>
                                <tr className="text-zinc-400 dark:text-zinc-500">
                                  <th className="text-left font-medium pb-1">Item</th>
                                  <th className="text-right font-medium pb-1">Was</th>
                                  <th className="text-right font-medium pb-1">Now</th>
                                  <th className="text-right font-medium pb-1">Change</th>
                                </tr>
                              </thead>
                              <tbody className="text-zinc-700 dark:text-zinc-300">
                                {Object.entries(preview.diff).map(([k, v]) => {
                                  const dn = Number(v.delta);
                                  return (
                                    <tr key={k}>
                                      <td className="py-0.5">{CORRECTION_FIELD_LABELS[k] ?? k}</td>
                                      <td className="text-right tabular-nums py-0.5">{v.was}</td>
                                      <td className="text-right tabular-nums py-0.5">{v.now}</td>
                                      <td className={`text-right tabular-nums font-semibold py-0.5 ${dn >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                                        {dn >= 0 ? "+" : "−"}{Math.abs(dn).toFixed(2)}
                                      </td>
                                    </tr>
                                  );
                                })}
                                {Object.entries(preview.statutory_employee ?? {}).map(([k, v]) => {
                                  const dn = Number(v);
                                  return (
                                    <tr key={k} className="text-zinc-500 dark:text-zinc-400">
                                      <td className="py-0.5">{k}</td>
                                      <td className="text-right py-0.5">—</td>
                                      <td className="text-right py-0.5">—</td>
                                      <td className={`text-right tabular-nums font-semibold py-0.5 ${dn >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                                        {dn >= 0 ? "+" : "−"}{Math.abs(dn).toFixed(2)}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                            <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-700/40 text-[11px] text-zinc-700 dark:text-zinc-300">
                              Net pay <span className="tabular-nums">{preview.current_net_pay}</span> →{" "}
                              <strong className="tabular-nums">{preview.settled_net_pay} {preview.currency}</strong>
                              <span className={`ml-1 font-semibold ${Number(preview.net_delta) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                                ({Number(preview.net_delta) >= 0 ? "+" : "−"}{Math.abs(Number(preview.net_delta)).toFixed(2)})
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-2">
                              <button
                                type="button"
                                onClick={handleApply}
                                disabled={correcting}
                                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                              >
                                <CheckCircle size={12} className={correcting ? "animate-spin" : ""} />
                                {correcting ? "Applying…" : "Confirm & apply correction"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setPreview(null)}
                                disabled={correcting}
                                className="rounded-md border border-zinc-200 dark:border-zinc-700 px-2.5 py-1 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
                              >
                                Cancel
                              </button>
                            </div>
                            <p className="mt-1.5 text-[10px] text-amber-700/70 dark:text-amber-300/60">
                              Applying books a correction, notifies the employee, and generates a correction note. Settle the net difference outside the app.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <div>
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">Category</p>
                  <p className="text-sm text-gray-900 dark:text-gray-100 capitalize">{dispute.category?.replace(/_/g, " ")}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">Description</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{dispute.issue_description}</p>
                </div>
                {dispute.occurrence_description && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">Occurrence Details</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{dispute.occurrence_description}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">Expected Outcome</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{dispute.expected_outcome}</p>
                </div>
                {dispute.attachment_url && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">Attachment</p>
                    {isImageUrl(dispute.attachment_url) && (
                      <a href={dispute.attachment_url} target="_blank" rel="noopener noreferrer" className="block mb-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={dispute.attachment_url}
                          alt="Concern evidence attachment"
                          className="max-h-64 w-auto rounded-lg border border-gray-200 dark:border-gray-700 object-contain cursor-zoom-in"
                        />
                      </a>
                    )}
                    <a href={dispute.attachment_url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline">
                      <ExternalLink size={13} /> View attachment
                    </a>
                  </div>
                )}
                {dispute.date_of_occurrence && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">Date of Occurrence</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300">{dispute.date_of_occurrence}</p>
                  </div>
                )}
              </div>
            )}

            {tab === "investigation" && (
              <div className="space-y-4">
                {/* Two-way conversation — visible to the employee. */}
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">
                    <MessageSquare size={12} /> Conversation with employee
                  </label>
                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 p-3 max-h-64 overflow-y-auto space-y-2">
                    {loadingMsgs ? (
                      <p className="text-xs text-gray-400 text-center py-4">Loading…</p>
                    ) : messages.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-4">No messages yet — send the first reply below.</p>
                    ) : messages.map((m) => {
                      const mine = m.author_kind !== "reporter";
                      return (
                        <div key={m.message_id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${mine ? "bg-red-500/10 border border-red-200 dark:border-red-500/30 text-gray-900 dark:text-gray-100" : "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200"}`}>
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-0.5">{msgAuthor(m.author_kind)}</div>
                            <p className="whitespace-pre-wrap">{m.body}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {!isClosed && (
                    <div className="mt-2 flex gap-2">
                      <input
                        value={msgDraft}
                        onChange={(e) => setMsgDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                        placeholder="Reply to the employee…"
                        className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                      />
                      <button
                        onClick={sendReply}
                        disabled={sendingMsg || !msgDraft.trim()}
                        className="inline-flex items-center gap-1 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-3 py-2 disabled:opacity-50"
                      >
                        <MessageSquare size={14} /> {sendingMsg ? "Sending…" : "Send"}
                      </button>
                    </div>
                  )}
                  <p className="mt-1 text-[10px] text-gray-400">This conversation is visible to the employee. The internal notes below are private.</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">
                    Internal Notes (HR only — not visible to employee)
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={6}
                    disabled={isClosed}
                    placeholder="Add investigation notes, actions taken, evidence gathered…"
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-red-500 resize-none disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">
                    Status
                  </label>
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value as DisputeStatus)}
                    disabled={isClosed}
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
                  >
                    {/* Current state + only the transitions the backend allows
                        from it, so the dropdown can't request an illegal move. */}
                    <option value={dispute.status}>
                      {STATUS_LABELS[dispute.status] ?? dispute.status} (current)
                    </option>
                    {(NEXT_STATUSES[dispute.status] ?? []).map((s) => (
                      <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {tab === "resolution" && (
              <div className="space-y-4">
                {isClosed ? (
                  <div className="flex items-start gap-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl px-4 py-3">
                    <CheckCircle size={16} className="text-green-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-green-800 dark:text-green-300">
                        Closed on {fmt(dispute.closed_at)}
                      </p>
                      <p className="text-sm text-green-700 dark:text-green-400 mt-1 leading-relaxed">
                        {dispute.resolution || "No resolution note recorded."}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">
                      Resolution Description
                    </label>
                    <textarea
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value)}
                      rows={5}
                      placeholder="Describe the action taken, outcome, and any compensation…"
                      className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                    />
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
                      Set status to &ldquo;Resolved&rdquo; or &ldquo;Rejected&rdquo; to close this dispute.
                    </p>
                  </div>
                )}
              </div>
            )}

            {tab === "audit" && (
              <div className="space-y-3">
                <div className="space-y-2">
                  {[
                    { label: "Dispute created", time: dispute.created_at, icon: <FileText size={13} className="text-blue-500" /> },
                    { label: "Last updated", time: dispute.updated_at, icon: <Clock size={13} className="text-amber-500" /> },
                    dispute.closed_at ? { label: "Closed", time: dispute.closed_at, icon: <CheckCircle size={13} className="text-green-500" /> } : null,
                  ].filter(Boolean).map((entry, i) => (
                    <div key={i} className="flex items-center gap-3 bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-2.5">
                      {entry!.icon}
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{entry!.label}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{fmt(entry!.time)}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 pt-2">
                  Full audit trail including who made each change will be available in a future update.
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          {!isClosed && (tab === "investigation" || tab === "resolution") && (
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-800">
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-xl disabled:opacity-50 transition-colors flex items-center gap-2"
              >
                {saving ? "Saving…" : saved ? <><CheckCircle size={14} /> Saved</> : "Save Changes"}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
