"use client";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Clock,
  Loader2,
  MessageSquare,
  Paperclip,
  RefreshCw,
  Send,
  Shield,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/apiClient";
import {
  AuditLogRow,
  AuditLogQuery,
  DisputeMessage,
  concernAuditLogCsvUrl,
  fetchConcernAuditLog,
  fetchDisputeThread,
  patchDispute,
  patchTriageAction,
  postDisputeMessage,
} from "@/services/api";
import { ConcernStatus, nextStatesFor } from "@/services/concernStates";
import { ALL_COUNTRIES, useCountry } from "@/contexts/CountryContext";
import { COUNTRY_FLAGS } from "@/utils/countryDisplay";
import { isImageUrl } from "@/utils/attachment";
import FilterSelect from "@/components/ui/FilterSelect";
import DashboardHeader from "@/components/ui/DashboardHeader";
import SolarisBackground from "@/components/ui/SolarisBackground";

type Dispute = {
  right_id: number;
  employee_name: string;
  private_user_id: number | null;
  is_anonymous: boolean;
  company_id: number | null;
  company_name: string | null;
  country_code: string | null;
  title: string;
  category: string | null;
  urgency_level: string | null;
  status: string;
  channel: "internal" | "external";
  issue_description: string | null;
  expected_outcome: string | null;
  occurrence_description: string | null;
  date_of_occurrence: string | null;
  attachment_url: string | null;
  assigned_to: number | null;
  internal_notes: string | null;
  resolution: string | null;
  closed_at: string | null;
  closed_by: number | null;
  days_open: number;
  created_at: string | null;
  updated_at: string | null;
  // M4 additions:
  escalated_to_external_at?: string | null;
  escalated_reason?: string | null;
  acknowledged_at?: string | null;
};

type Tab = "queue" | "triage" | "audit";

const STATUSES_FOR_SELECT = [
  "received",
  "triaged",
  "investigating",
  "action_taken",
  "resolved",
  "rejected",
  "appealed",
  "closed",
];

export default function ComplianceSection() {
  // The switcher in the admin bar is the only country control — no local
  // copy here. ALL_COUNTRIES means "no filter."
  const { activeCountry } = useCountry();
  const [tab, setTab] = useState<Tab>("queue");
  const [items, setItems] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(false);
  const [channel, setChannel] = useState<"all" | "internal" | "external">("external");
  const [onlyAging, setOnlyAging] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [companyId, setCompanyId] = useState<string>("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Distinct companies seen across the (cross-company) queue, persisted so the
  // dropdown doesn't collapse once a company filter narrows the result set.
  const [companyOptions, setCompanyOptions] = useState<{ id: number; name: string }[]>([]);
  const [selected, setSelected] = useState<Dispute | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { channel };
      if (statusFilter) params.status = statusFilter;
      if (onlyAging) params.only_aging = "true";
      if (companyId) params.company_id = companyId;
      if (activeCountry !== ALL_COUNTRIES) params.country_code = activeCountry;
      if (dateFrom) params.since = dateFrom;
      if (dateTo) params.until = `${dateTo}T23:59:59`;
      const resp = await api.get("/user/disputes/compliance", { params });
      const disputes: Dispute[] = resp.data?.disputes ?? [];
      setItems(disputes);
      // Refresh the company options only from an unnarrowed fetch so the full
      // cross-company list stays available while a company filter is applied.
      // Scoped by the same country_code param as the main fetch, so a
      // company from a different country never shows up as a selectable
      // option while a specific country is active.
      if (!companyId) {
        const seen = new Map<number, string>();
        for (const d of disputes) {
          if (d.company_id != null) seen.set(d.company_id, d.company_name || `Company #${d.company_id}`);
        }
        setCompanyOptions([...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)));
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } }; message?: string };
      toast.error(err?.response?.data?.detail || err?.message || "Failed to load reports");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, onlyAging, statusFilter, companyId, activeCountry, dateFrom, dateTo]);

  // M4 — Triage queue is the subset of items that auto-escalated from a
  // company due to conflict-of-interest and haven't been acknowledged yet.
  // Kiruko reviews them and either accepts (handles as a normal external
  // case) or dismisses back to internal (the named admin's privilege issue
  // turned out to be frivolous).
  const triageItems = useMemo(
    () => items.filter((d) => d.escalated_to_external_at && !d.acknowledged_at),
    [items],
  );
  // Country scoping now happens server-side (country_code param above), so
  // `items`/`triageItems` are already the right set — no client-side
  // re-filter needed (and no risk of a null country_code silently dropping
  // an independent reporter's case, since the backend no longer leaves that
  // field null either).
  const visibleItems = tab === "triage" ? triageItems : items;

  return (
    <SolarisBackground>
      <div className="w-full space-y-8 py-10 px-6 animate-in fade-in duration-700">
        <DashboardHeader
          title="Compliance Queue"
          subtitle="External concerns routed to your team for independent resolution, plus the triage queue for cases auto-escalated from employers due to conflict-of-interest. Anonymous reporters’ identities are visible here for legal record-keeping — exercise the same discretion as a clinician. Scoped to the country in the switcher above."
          extra={
            <button
              onClick={load}
              className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-900 dark:text-white rounded-lg text-sm font-medium transition-colors"
              title="Reload"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              Reload
            </button>
          }
        />

      <div className="mb-4 flex items-center gap-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-0.5 w-fit">
        <TabButton active={tab === "queue"} onClick={() => setTab("queue")}>
          Active queue
          <span className="ml-2 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-[10px] tabular-nums">
            {items.length}
          </span>
        </TabButton>
        <TabButton active={tab === "triage"} onClick={() => setTab("triage")}>
          Triage
          {triageItems.length > 0 && (
            <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-200 dark:bg-amber-950/40 text-amber-900 dark:text-amber-400 text-[10px] tabular-nums">
              {triageItems.length}
            </span>
          )}
        </TabButton>
        <TabButton active={tab === "audit"} onClick={() => setTab("audit")}>
          Audit log
        </TabButton>
      </div>

      {tab === "queue" && (
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <FilterSelect
            label="Channel"
            value={channel}
            onChange={setChannel}
            options={[
              { value: "external", label: "External (employer-blind)" },
              { value: "internal", label: "Internal" },
              { value: "all", label: "All" },
            ]}
          />

          <FilterSelect
            label="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "", label: "Any" },
              ...STATUSES_FOR_SELECT.map((s) => ({ value: s, label: s.replace(/_/g, " ") })),
            ]}
          />

          <FilterSelect
            label="Company"
            value={companyId}
            onChange={setCompanyId}
            options={[
              { value: "", label: "All companies" },
              ...companyOptions.map((c) => ({ value: String(c.id), label: c.name })),
            ]}
          />

          <label className="flex items-center gap-2 shrink-0">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">From</span>
            <input
              type="date"
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-gray-900/5 dark:focus:ring-white/10 cursor-pointer"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 shrink-0">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">To</span>
            <input
              type="date"
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-gray-900/5 dark:focus:ring-white/10 cursor-pointer"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>

          <label className="ml-auto flex items-center gap-2">
            <input
              type="checkbox"
              checked={onlyAging}
              onChange={(e) => setOnlyAging(e.target.checked)}
            />
            <span className="inline-flex items-center gap-1">
              <Clock size={14} /> Past 5-day SLA only
            </span>
          </label>
        </div>
      )}

      {tab === "audit" && <AuditLogView />}

      {tab !== "audit" && loading && (
        <div className="flex items-center gap-2 py-6 text-sm text-gray-500 dark:text-gray-400">
          <Loader2 className="animate-spin" size={16} /> Loading reports…
        </div>
      )}

      {tab !== "audit" && !loading && visibleItems.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-8 text-center text-sm text-gray-600 dark:text-gray-400">
          {tab === "triage" ? "Nothing waiting for triage." : "No reports match the current filters."}
        </div>
      )}

      {tab !== "audit" && !loading && visibleItems.length > 0 && (
        <div className="overflow-x-auto bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/60 text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Filed</th>
                <th className="px-3 py-2">Channel</th>
                <th className="px-3 py-2">Employee</th>
                <th className="px-3 py-2">Company</th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Urgency</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Days open</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((d) => (
                <tr
                  key={d.right_id}
                  onClick={() => setSelected(d)}
                  className="cursor-pointer border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <td className="px-3 py-2 font-mono text-xs">{d.right_id}</td>
                  <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
                    {d.created_at ? new Date(d.created_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {d.escalated_to_external_at ? (
                      <span className="inline-flex items-center gap-1 rounded bg-violet-100 dark:bg-violet-950/40 px-2 py-0.5 text-[10px] font-medium text-violet-800 dark:text-violet-400">
                        <AlertTriangle size={10} /> auto-escalated
                      </span>
                    ) : d.channel === "external" ? (
                      <span className="inline-flex items-center gap-1 rounded bg-teal-100 dark:bg-teal-950/40 px-2 py-0.5 text-[10px] font-medium text-teal-800 dark:text-teal-400">
                        <Shield size={10} /> external
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500 dark:text-gray-400">internal</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{d.employee_name}</div>
                    {d.is_anonymous && (
                      <div className="text-[10px] text-amber-700 dark:text-amber-400">filed anonymously</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-700 dark:text-gray-200">
                    {d.company_name ?? "—"}
                    {d.country_code && <span className="ml-1.5" title={d.country_code}>{COUNTRY_FLAGS[d.country_code] ?? d.country_code}</span>}
                  </td>
                  <td className="px-3 py-2 max-w-xs truncate" title={d.title}>{d.title}</td>
                  <td className="px-3 py-2">{urgencyBadge(d.urgency_level)}</td>
                  <td className="px-3 py-2">{statusBadge(d.status)}</td>
                  <td className="px-3 py-2 text-right text-xs font-mono">{d.days_open}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <DetailDrawer
          dispute={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            load();
          }}
        />
      )}
      </div>
    </SolarisBackground>
  );
}

// ── Drawer ──────────────────────────────────────────────────────────────────
function DetailDrawer({
  dispute,
  onClose,
  onChanged,
}: {
  dispute: Dispute;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [d, setD] = useState<Dispute>(dispute);

  // Triage state.
  const [triageReason, setTriageReason] = useState("");
  const [triaging, setTriaging] = useState<"dismiss" | "accept" | null>(null);

  // Admin-action state.
  const [statusEdit, setStatusEdit] = useState<string>(d.status || "received");
  const [newNote, setNewNote] = useState("");
  const [resolutionEdit, setResolutionEdit] = useState(d.resolution || "");
  const [saving, setSaving] = useState(false);

  // Thread state.
  const [messages, setMessages] = useState<DisputeMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);

  const isClosed = !!d.closed_at;
  const isExternal = d.channel === "external";
  const inTriage = !!d.escalated_to_external_at && !d.acknowledged_at;
  // Kiruko only mutates external cases — internal cases the compliance
  // dashboard can see (when channel=internal or all) are read-only here.
  const canEdit = isExternal && !isClosed;

  const loadThread = async () => {
    const res = await fetchDisputeThread(d.right_id);
    if ("error" in res) {
      setThreadError(res.error);
    } else {
      setThreadError(null);
      setMessages(res.messages);
    }
  };

  useEffect(() => {
    loadThread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.right_id]);

  const onTriage = async (action: "dismiss" | "accept") => {
    if (triaging) return;
    if (action === "dismiss" && !triageReason.trim()) {
      toast.error("Please provide a reason for dismissal.");
      return;
    }
    setTriaging(action);
    const res = await patchTriageAction(d.right_id, action, triageReason.trim());
    setTriaging(null);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    toast.success(action === "dismiss" ? "Case dismissed back to employer." : "Case accepted into Kiruko queue.");
    setD({
      ...d,
      channel: res.channel as Dispute["channel"],
      acknowledged_at: new Date().toISOString(),
    });
    onChanged();
  };

  const onSave = async () => {
    setSaving(true);
    const body: Parameters<typeof patchDispute>[1] = {};
    if (statusEdit !== d.status) body.status = statusEdit;
    if (newNote.trim()) {
      const stamp = `[${new Date().toISOString()}]`;
      const existing = d.internal_notes ? `${d.internal_notes}\n\n` : "";
      body.internal_notes = `${existing}${stamp} ${newNote.trim()}`;
    }
    if (!isClosed && resolutionEdit !== (d.resolution || "")) {
      body.resolution = resolutionEdit;
    }
    if (Object.keys(body).length === 0) {
      setSaving(false);
      toast.info("Nothing to save.");
      return;
    }
    const res = await patchDispute(d.right_id, body);
    setSaving(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    toast.success("Case updated.");
    setD({ ...d, ...body, status: body.status ?? d.status });
    setNewNote("");
    onChanged();
  };

  const onSendMessage = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    const res = await postDisputeMessage(d.right_id, draft.trim());
    setSending(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    setDraft("");
    await loadThread();
  };

  const subline = inTriage
    ? `Auto-escalated from ${d.company_name ?? "company"} — triage required`
    : isExternal
    ? "External case — routed to Kiruko Compliance"
    : "Internal case — read-only here";

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40">
      <div className="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white dark:bg-gray-900 shadow-xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">Case #{d.right_id}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">{subline}</p>
            {d.is_anonymous && (
              <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5">filed anonymously to employer</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {/* Triage banner (only for auto-escalated cases pre-ack) */}
          {inTriage && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-4 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
                <div className="text-xs text-amber-900 dark:text-amber-400">
                  <strong>Triage required.</strong> This case was auto-routed to
                  Kiruko because the reporter named a company admin. Accept it to
                  handle as an external case, or dismiss it back to internal (use this
                  if the naming was frivolous — the named admin will not be informed).
                </div>
              </div>
              {d.escalated_reason && (
                <div className="text-[11px] text-amber-800 dark:text-amber-400 italic">
                  Reason: {d.escalated_reason}
                </div>
              )}
              <input
                type="text"
                value={triageReason}
                onChange={(e) => setTriageReason(e.target.value)}
                placeholder="Required for dismiss; optional for accept"
                className="w-full px-3 py-1.5 border border-amber-300 dark:border-amber-900 rounded text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => onTriage("accept")}
                  disabled={!!triaging}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-amber-700 hover:bg-amber-800 disabled:bg-gray-300 text-white text-xs font-semibold rounded"
                >
                  {triaging === "accept" ? (
                    <RefreshCw className="w-3 h-3 animate-spin" />
                  ) : (
                    <>
                      <Check className="w-3 h-3" />
                      Accept into queue
                    </>
                  )}
                </button>
                <button
                  onClick={() => onTriage("dismiss")}
                  disabled={!!triaging || !triageReason.trim()}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:bg-gray-100 disabled:text-gray-400 text-amber-900 dark:text-amber-400 border border-amber-300 dark:border-amber-900 text-xs font-semibold rounded"
                >
                  {triaging === "dismiss" ? <RefreshCw className="w-3 h-3 animate-spin" /> : "Dismiss to employer"}
                </button>
              </div>
            </div>
          )}

          {/* Identity */}
          <Section title="Reporter">
            <div className="flex items-center gap-3 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 p-3">
              <div className="w-10 h-10 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 flex items-center justify-center text-xs font-semibold text-gray-700 dark:text-gray-200 shrink-0">
                {(d.employee_name || "?").slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{d.employee_name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{d.company_name ?? "—"}</p>
              </div>
            </div>
          </Section>

          {/* Substance */}
          <Section title="Subject">
            <div className="text-sm font-medium text-gray-900 dark:text-white">{d.title || "—"}</div>
            <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 mt-1">
              {d.category} · urgency {d.urgency_level}
            </div>
          </Section>

          <Section title="Issue description">
            <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
              {d.issue_description || "—"}
            </p>
          </Section>

          {d.expected_outcome && (
            <Section title="Expected outcome">
              <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{d.expected_outcome}</p>
            </Section>
          )}

          {d.occurrence_description && (
            <Section title="Occurrence details">
              <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                {d.occurrence_description}
              </p>
            </Section>
          )}

          {d.attachment_url && (
            <Section title="Attachment">
              <div className="flex flex-col gap-2">
                {isImageUrl(d.attachment_url) && (
                  <a href={d.attachment_url} target="_blank" rel="noopener noreferrer" className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={d.attachment_url}
                      alt="Concern evidence attachment"
                      className="max-h-64 w-auto rounded-lg border border-gray-200 dark:border-gray-700 object-contain cursor-zoom-in"
                    />
                  </a>
                )}
                <a
                  href={d.attachment_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-indigo-600 dark:text-indigo-400 underline"
                >
                  <Paperclip className="w-3.5 h-3.5" />
                  Open file
                </a>
              </div>
            </Section>
          )}

          {/* Timeline */}
          <Section title="Timeline">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <TimelineRow label="Filed" value={d.created_at} />
              <TimelineRow label="Last updated" value={d.updated_at} />
              <TimelineRow label="Days open" value={String(d.days_open)} isPlain />
              {d.acknowledged_at && (
                <TimelineRow label="Acknowledged" value={d.acknowledged_at} />
              )}
              {d.escalated_to_external_at && (
                <TimelineRow label="Auto-escalated" value={d.escalated_to_external_at} />
              )}
              {d.closed_at && <TimelineRow label="Closed" value={d.closed_at} />}
            </dl>
          </Section>

          {/* Admin actions — only on editable external cases */}
          {canEdit && !inTriage && (
            <Section title="Admin actions">
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5 mt-2">
                Status
              </label>
              <select
                value={statusEdit}
                onChange={(e) => setStatusEdit(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md text-sm text-gray-900 dark:text-white capitalize bg-white dark:bg-gray-800"
              >
                {/* M8 closeout — only show next-legal states for the
                    current status (kontokaz actor). */}
                {nextStatesFor((d.status || "received") as ConcernStatus, "kontokaz").map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>

              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5 mt-4">
                Resolution
              </label>
              <textarea
                value={resolutionEdit}
                onChange={(e) => setResolutionEdit(e.target.value)}
                rows={3}
                placeholder="Outcome of the investigation."
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md text-sm text-gray-900 dark:text-white dark:bg-gray-800 dark:placeholder-gray-500 resize-none"
              />

              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5 mt-4">
                Internal notes (append-only)
              </label>
              {d.internal_notes && (
                <div className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800 rounded-md p-2 mb-2 max-h-40 overflow-y-auto">
                  {d.internal_notes}
                </div>
              )}
              <textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                rows={3}
                placeholder="Add a new note."
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md text-sm text-gray-900 dark:text-white dark:bg-gray-800 dark:placeholder-gray-500 resize-none"
              />

              <button
                onClick={onSave}
                disabled={saving}
                className="mt-3 w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white text-sm font-semibold rounded-md"
              >
                {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : "Save changes"}
              </button>
            </Section>
          )}

          {isClosed && (
            <Section title="Resolution">
              <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{d.resolution || "—"}</p>
            </Section>
          )}

          {/* Thread */}
          <Section title="Conversation with reporter">
            {threadError ? (
              <div className="text-xs text-red-600 dark:text-red-400">{threadError}</div>
            ) : messages.length === 0 ? (
              <div className="rounded-md border border-dashed border-gray-200 dark:border-gray-800 p-4 text-center text-xs text-gray-500 dark:text-gray-400">
                <MessageSquare className="w-5 h-5 text-gray-300 dark:text-gray-600 mx-auto mb-1.5" />
                No messages yet.
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {messages.map((m) => {
                  const fromReporter = m.author_kind === "reporter";
                  return (
                    <div
                      key={m.message_id}
                      className={`flex ${fromReporter ? "justify-start" : "justify-end"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-lg p-2.5 ${
                          fromReporter
                            ? "bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white"
                            : "bg-indigo-600 text-white"
                        }`}
                      >
                        <div
                          className={`text-[10px] uppercase tracking-wide font-semibold mb-0.5 ${
                            fromReporter ? "text-gray-500 dark:text-gray-400" : "text-indigo-100"
                          }`}
                        >
                          {m.author_kind}
                        </div>
                        {m.body && <div className="text-sm whitespace-pre-wrap">{m.body}</div>}
                        {m.attachment_url && (
                          isImageUrl(m.attachment_url) ? (
                            <a
                              href={m.attachment_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`block ${m.body ? "mt-1.5" : ""}`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={m.attachment_url}
                                alt="Message attachment"
                                className="max-h-40 w-auto rounded-md object-contain cursor-zoom-in"
                              />
                            </a>
                          ) : (
                            <a
                              href={m.attachment_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`inline-flex items-center gap-1 text-xs underline ${
                                fromReporter ? "text-indigo-600 dark:text-indigo-400" : "text-white"
                              } ${m.body ? "mt-1.5" : ""}`}
                            >
                              <Paperclip className="w-3 h-3" />
                              Open attachment
                            </a>
                          )
                        )}
                        {m.created_at && (
                          <div
                            className={`text-[10px] mt-1 ${
                              fromReporter ? "text-gray-400 dark:text-gray-500" : "text-indigo-200"
                            }`}
                          >
                            {new Date(m.created_at).toLocaleString()}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {canEdit && (
              <div className="mt-3 flex gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={2}
                  placeholder="Reply to the reporter…"
                  className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md text-sm text-gray-900 dark:text-white dark:bg-gray-800 dark:placeholder-gray-500 resize-none"
                  disabled={sending}
                />
                <button
                  onClick={onSendMessage}
                  disabled={sending || !draft.trim()}
                  className="px-3 py-2 self-start bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white text-sm rounded-md inline-flex items-center gap-1"
                >
                  {sending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <><Send className="w-3 h-3" />Send</>}
                </button>
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

// ── Small helpers ───────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
        {title}
      </h3>
      {children}
    </div>
  );
}

function TimelineRow({
  label,
  value,
  isPlain,
}: {
  label: string;
  value: string | null | undefined;
  isPlain?: boolean;
}) {
  if (!value) return null;
  return (
    <>
      <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="text-gray-900 dark:text-white flex items-center gap-1">
        {!isPlain && <Clock className="w-3 h-3 text-gray-400 dark:text-gray-500" />}
        {isPlain ? value : new Date(value).toLocaleString()}
      </dd>
    </>
  );
}

function TabButton({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors inline-flex items-center ${
        active ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900" : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function urgencyBadge(u?: string | null) {
  const norm = (u || "normal").toLowerCase();
  const cls =
    norm === "urgent" || norm === "high" || norm === "critical"
      ? "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 border-red-200 dark:border-red-900"
      : norm === "medium"
      ? "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-900"
      : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700";
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {norm}
    </span>
  );
}

function statusBadge(s?: string | null) {
  const v = (s || "received").toLowerCase();
  const styles: Record<string, string> = {
    received: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-900",
    triaged: "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border-blue-100 dark:border-blue-900",
    investigating: "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border-blue-100 dark:border-blue-900",
    action_taken: "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 border-indigo-100 dark:border-indigo-900",
    resolved: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900",
    rejected: "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 border-red-100 dark:border-red-900",
    appealed: "bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400 border-violet-100 dark:border-violet-900",
    closed: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700",
  };
  const cls = styles[v] || styles.received;
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium capitalize ${cls}`}>
      {v.replace(/_/g, " ")}
    </span>
  );
}

// ── Audit-log viewer ───────────────────────────────────────────────────────
function AuditLogView() {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState<AuditLogQuery>({
    limit: 100,
    offset: 0,
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    const res = await fetchConcernAuditLog(filter);
    if ("error" in res) {
      setError(res.error || "Failed to load audit log");
      setRows([]);
      setTotal(0);
    } else {
      setRows(res.rows);
      setTotal(res.total);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.limit, filter.offset]);

  const apply = (next: AuditLogQuery) => {
    setFilter({ ...next, offset: 0 });
    // Trigger load via the dep array.
    setTimeout(load, 0);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          Read-only forensic log. Every action on every concern is recorded here, including
          views, status changes, messages, escalations, and purges. Export as CSV for
          legal review.
        </p>
        <AuditFilterRow current={filter} onApply={apply} />
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-6 text-sm text-gray-500 dark:text-gray-400">
          <Loader2 className="animate-spin" size={16} /> Loading audit rows…
        </div>
      )}

      {error && (
        <div className="rounded border border-red-100 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="rounded border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-8 text-center text-sm text-gray-600 dark:text-gray-400">
          No audit entries match the current filters.
        </div>
      )}

      {!loading && rows.length > 0 && (
        <>
          <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/60 text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Case #</th>
                  <th className="px-3 py-2">Actor</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">IP</th>
                  <th className="px-3 py-2">Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.audit_id} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400 tabular-nums whitespace-nowrap">
                      {r.created_at ? new Date(r.created_at).toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{r.right_id}</td>
                    <td className="px-3 py-2 text-xs">
                      <div className="font-medium text-gray-900 dark:text-white capitalize">{r.actor_kind}</div>
                      {r.actor_user_id !== null && (
                        <div className="text-gray-500 dark:text-gray-400 font-mono">#{r.actor_user_id}</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex rounded bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                        {r.action}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 font-mono">{r.ip || "—"}</td>
                    <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-200 max-w-md">
                      <pre className="whitespace-pre-wrap break-words font-mono text-[10px]">
                        {r.details ? JSON.stringify(r.details) : "—"}
                      </pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
            <div>
              Showing <strong>{rows.length}</strong> of <strong>{total}</strong>{" "}
              {total === 1 ? "row" : "rows"}.
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setFilter((f) => ({ ...f, offset: Math.max(0, (f.offset ?? 0) - (f.limit ?? 100)) }))}
                disabled={(filter.offset ?? 0) === 0}
                className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-200 px-2 py-1 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40"
              >
                Prev
              </button>
              <button
                onClick={() => setFilter((f) => ({ ...f, offset: (f.offset ?? 0) + (f.limit ?? 100) }))}
                disabled={(filter.offset ?? 0) + (filter.limit ?? 100) >= total}
                className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-200 px-2 py-1 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40"
              >
                Next
              </button>
              <a
                href={concernAuditLogCsvUrl({ ...filter, limit: 1000 })}
                className="rounded border border-indigo-300 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 px-2 py-1 text-xs hover:bg-indigo-100"
              >
                Download CSV
              </a>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AuditFilterRow({
  current,
  onApply,
}: {
  current: AuditLogQuery;
  onApply: (next: AuditLogQuery) => void;
}) {
  const [draft, setDraft] = useState<AuditLogQuery>(current);
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
      <input
        type="number"
        placeholder="Case # (right_id)"
        value={draft.right_id ?? ""}
        onChange={(e) => setDraft({ ...draft, right_id: e.target.value ? Number(e.target.value) : undefined })}
        className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-gray-900/5 dark:focus:ring-white/10"
      />
      <input
        type="text"
        placeholder="Action (e.g. status_changed)"
        value={draft.action ?? ""}
        onChange={(e) => setDraft({ ...draft, action: e.target.value || undefined })}
        className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-gray-900/5 dark:focus:ring-white/10"
      />
      <FilterSelect
        label="Actor"
        value={draft.actor_kind ?? ""}
        onChange={(v) => setDraft({ ...draft, actor_kind: v || undefined })}
        options={[
          { value: "", label: "Any actor" },
          { value: "reporter", label: "Reporter" },
          { value: "employer", label: "Employer" },
          { value: "kontokaz", label: "Kiruko" },
          { value: "system", label: "System" },
        ]}
      />
      <input
        type="datetime-local"
        value={draft.since ?? ""}
        onChange={(e) => setDraft({ ...draft, since: e.target.value || undefined })}
        className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-gray-900/5 dark:focus:ring-white/10"
      />
      <div className="flex gap-2">
        <input
          type="datetime-local"
          value={draft.until ?? ""}
          onChange={(e) => setDraft({ ...draft, until: e.target.value || undefined })}
          className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-gray-900/5 dark:focus:ring-white/10"
        />
        <button
          onClick={() => onApply(draft)}
          className="rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 px-3 py-1.5 text-xs font-semibold hover:bg-gray-800 dark:hover:bg-gray-100"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
