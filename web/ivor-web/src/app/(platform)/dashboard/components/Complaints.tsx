"use client";
/**
 * M4 — Employer Concerns view: table + slide-out drawer + admin actions + thread.
 *
 * Data source: GET /user/disputes/company/{id}?channel=internal (server-masked
 * payload). Auto-routes named-admin reports to Kiruko via the COI gate, so
 * cases naming the calling admin never appear here.
 *
 * Anonymity rules (defense in depth — backend also masks):
 *   1. Branch on `is_anonymous === true` BEFORE rendering any identity field.
 *   2. Never render initials from the masked "Anonymous" string.
 *   3. Show the "Identity protected" pill in both the row and the drawer.
 *   4. Substance fields render identically regardless of anonymity.
 */
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Clock,
  Lock,
  MessageSquare,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  Shield,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import {
  ConcernDispute,
  CompanyDisputesResponse,
  DisputeMessage,
  fetchCompanyDisputes,
  fetchDisputeThread,
  patchDispute,
  postDisputeMessage,
} from "../../../../services/api";
import {
  ConcernStatus,
  nextStatesFor,
} from "../../../../services/concernStates";
import FilterSelect from "@/components/ui/FilterSelect";
import { isImageUrl } from "@/utils/attachment";

type SubTab = "internal" | "external_aggregate";
type StatusFilter =
  | "all"
  | "received"
  | "triaged"
  | "investigating"
  | "action_taken"
  | "resolved"
  | "rejected"
  | "appealed"
  | "closed";
type UrgencyFilter = "all" | "low" | "medium" | "high" | "urgent";
type VisibilityFilter = "all" | "anonymous" | "named";

const STATUSES_FOR_SELECT: StatusFilter[] = [
  "received",
  "triaged",
  "investigating",
  "action_taken",
  "resolved",
  "rejected",
  "appealed",
  "closed",
];

export default function Complaints({ refreshKey }: { refreshKey?: number }) {
  const { user } = useAuth();
  const companyId =
    (user as { company?: { company_id?: number }; private_user?: { company_id?: number } })?.company?.company_id ??
    (user as { private_user?: { company_id?: number } })?.private_user?.company_id ??
    undefined;
  // M8 closeout — UI defense-in-depth for the conflict-of-interest gate.
  // Backend already filters cases naming the calling admin out of
  // GET /disputes/company/{id}, but a stale-cache scenario or an
  // implementation regression could surface a COI'd row in this list.
  // The UI fail-closes by also hiding any case where the current user
  // appears in named_parties.
  const currentUserId = (user as { user_id?: number })?.user_id;

  const [subTab, setSubTab] = useState<SubTab>("internal");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>("all");
  const [visibility, setVisibility] = useState<VisibilityFilter>("all");
  const [search, setSearch] = useState("");
  // Date-range filter on created_at (server-side). `dateTo` is inclusive from
  // the user's perspective; we send it as end-of-day since the backend's
  // `until` bound is exclusive.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [data, setData] = useState<CompanyDisputesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ConcernDispute | null>(null);

  const load = async () => {
    if (!companyId) {
      setError("No company context available");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const res = await fetchCompanyDisputes(companyId, {
      // External cases are aggregate-only on the employer side; fetch the
      // external channel when that sub-tab is active so external_stats fills.
      channel: subTab === "external_aggregate" ? "external" : "internal",
      status: statusFilter === "all" ? undefined : statusFilter,
      since: dateFrom || undefined,
      until: dateTo ? `${dateTo}T23:59:59` : undefined,
    });
    if ("error" in res) {
      setError(res.error || "Failed to load concerns");
      setData(null);
    } else {
      setData(res);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, companyId, statusFilter, subTab, dateFrom, dateTo]);

  const filtered = useMemo(() => {
    if (!data) return [] as ConcernDispute[];
    return data.internal.filter((c) => {
      // M8 closeout — defensive COI filter. If the calling admin appears
      // in named_parties for this case, hide it. Backend already filters
      // server-side; this is a fail-closed second layer.
      if (currentUserId && Array.isArray(c.named_parties)) {
        if (c.named_parties.some((p) => p.user_id === currentUserId)) return false;
      }
      if (urgencyFilter !== "all" && (c.urgency_level || "").toLowerCase() !== urgencyFilter) return false;
      if (visibility === "anonymous" && !c.is_anonymous) return false;
      if (visibility === "named" && c.is_anonymous) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = `${c.title || ""} ${c.category || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, urgencyFilter, visibility, search, currentUserId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
        <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-800 rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl text-center">
        <AlertCircle className="w-6 h-6 text-red-500 mx-auto mb-3" />
        <p className="text-sm font-medium text-gray-900 dark:text-white mb-3">{error}</p>
        <button
          onClick={load}
          className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex items-center gap-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-0.5 w-fit">
        <SubTabButton active={subTab === "internal"} onClick={() => setSubTab("internal")}>
          Internal cases
        </SubTabButton>
        <SubTabButton active={subTab === "external_aggregate"} onClick={() => setSubTab("external_aggregate")}>
          External (Kiruko) — aggregate
        </SubTabButton>
      </div>

      {/* Date-range filter — applies to both sub-tabs (filters on created_at). */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
          From
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900/5 dark:focus:ring-white/10 cursor-pointer"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
          To
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900/5 dark:focus:ring-white/10 cursor-pointer"
          />
        </label>
        {(dateFrom || dateTo) && (
          <button
            onClick={() => {
              setDateFrom("");
              setDateTo("");
            }}
            className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white underline"
          >
            Clear dates
          </button>
        )}
      </div>

      {subTab === "internal" && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              label="Status"
              value={statusFilter}
              options={["all", ...STATUSES_FOR_SELECT].map((s) => ({ value: s, label: s.replace(/_/g, " ") }))}
              onChange={(v) => setStatusFilter(v as StatusFilter)}
            />
            <FilterSelect
              label="Urgency"
              value={urgencyFilter}
              options={["all", "low", "medium", "high", "urgent"].map((u) => ({ value: u, label: u }))}
              onChange={(v) => setUrgencyFilter(v as UrgencyFilter)}
            />
            <FilterSelect
              label="Visibility"
              value={visibility}
              options={[
                { value: "all", label: "all" },
                { value: "anonymous", label: "anonymous only" },
                { value: "named", label: "named only" },
              ]}
              onChange={(v) => setVisibility(v as VisibilityFilter)}
            />
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title or category…"
                className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900/5 dark:focus:ring-white/10"
              />
            </div>
            <p className="ml-auto text-sm text-gray-500 dark:text-gray-400">
              <span className="font-semibold text-gray-900 dark:text-white tabular-nums">{filtered.length}</span>{" "}
              concern{filtered.length !== 1 ? "s" : ""}
            </p>
          </div>

          {/* Table */}
          {filtered.length > 0 ? (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-left">
                <thead className="border-b border-gray-100 dark:border-gray-800">
                  <tr>
                    <th className="px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400">#</th>
                    <th className="px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400">Subject</th>
                    <th className="px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400">Filed by</th>
                    <th className="px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400">Urgency</th>
                    <th className="px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400">Status</th>
                    <th className="px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 tabular-nums">Days open</th>
                    <th className="px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400">Filed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {filtered.map((c) => (
                    <tr
                      key={c.right_id}
                      onClick={() => setSelected(c)}
                      className="hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors"
                    >
                      <td className="px-5 py-3 text-sm text-gray-500 dark:text-gray-400 tabular-nums">#{c.right_id}</td>
                      <td className="px-5 py-3">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate max-w-[260px]">
                          {c.title || "General concern"}
                        </p>
                        <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 mt-0.5">{c.category}</p>
                      </td>
                      <td className="px-5 py-3">
                        <FiledBy item={c} />
                      </td>
                      <td className="px-5 py-3">
                        <UrgencyBadge urgency={c.urgency_level} />
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={c.status || "received"} />
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-500 dark:text-gray-400 tabular-nums">
                        {c.closed_at ? "—" : c.days_open}
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-500 dark:text-gray-400 tabular-nums">
                        {c.created_at
                          ? new Date(c.created_at).toLocaleDateString("en-GB", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState />
          )}
        </>
      )}

      {subTab === "external_aggregate" && (
        <ExternalAggregate stats={data?.external_stats} />
      )}

      {selected && (
        <DetailDrawer
          dispute={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            // Refetch the list when the drawer reports a change so badges stay in sync.
            load();
          }}
        />
      )}
    </div>
  );
}

// ── Drawer ──────────────────────────────────────────────────────────────────
function DetailDrawer({
  dispute,
  onClose,
  onChanged,
}: {
  dispute: ConcernDispute;
  onClose: () => void;
  onChanged: () => void;
}) {
  // Local mutable copy so the drawer reflects edits without a full refetch.
  const [d, setD] = useState<ConcernDispute>(dispute);

  // Admin-action form state.
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

  const onSave = async () => {
    setSaving(true);
    const body: Parameters<typeof patchDispute>[1] = {};
    if (statusEdit !== d.status) body.status = statusEdit;
    if (newNote.trim()) {
      // Append-only semantics: prefix with timestamp so the audit trail is
      // legible inside one big text field. The DB trigger also enforces
      // this, but doing it client-side keeps the UI honest.
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
    toast.success("Concern updated.");
    setD({
      ...d,
      ...body,
      status: body.status ?? d.status,
    });
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

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40">
      <div className="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white dark:bg-gray-900 shadow-xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">Case #{d.right_id}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {d.channel === "external" ? "External — routed to Kiruko Compliance" : "Internal"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {d.is_anonymous && <IdentityProtectedPill />}
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="space-y-5 p-5">
          {isClosed && (
            <div className="flex items-start gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-3 text-xs text-gray-700 dark:text-gray-200">
              <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                This case was closed on{" "}
                <strong>{new Date(d.closed_at!).toLocaleString()}</strong>. You can only
                append internal notes — status, resolution, and other fields are locked.
              </span>
            </div>
          )}

          {/* Identity */}
          <Section title="Filed by">
            <div className="flex items-center gap-3 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 p-3">
              <IdentityAvatar item={d} size="lg" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {d.is_anonymous ? "Anonymous reporter" : d.employee_name}
                </p>
                {d.is_anonymous && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    This employee filed without revealing their identity. You can still
                    investigate based on the substance below.
                  </p>
                )}
              </div>
            </div>
          </Section>

          {/* Substance */}
          <Section title="Subject">
            <div className="text-sm font-medium text-gray-900 dark:text-white">{d.title || "General concern"}</div>
            <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 mt-1">
              {d.category} · urgency {d.urgency_level}
            </div>
          </Section>

          <Section title="Issue description">
            <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{d.issue_description || "—"}</p>
          </Section>

          {d.expected_outcome && (
            <Section title="Expected outcome">
              <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{d.expected_outcome}</p>
            </Section>
          )}

          {d.occurrence_description && (
            <Section title="Occurrence details">
              <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{d.occurrence_description}</p>
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
                <div className="flex items-center gap-2 flex-wrap">
                  <a
                    href={d.attachment_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-indigo-600 underline"
                  >
                    <Paperclip className="w-3.5 h-3.5" />
                    Open file
                  </a>
                  <ScanResultBadge value={(d as ConcernDispute & { attachment_scan_result?: string | null }).attachment_scan_result} />
                </div>
              </div>
            </Section>
          )}

          {/* Timeline */}
          <Section title="Timeline">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <TimelineRow label="Filed" value={d.created_at} />
              <TimelineRow label="Last updated" value={d.updated_at} />
              <TimelineRow
                label="Days open"
                value={d.closed_at ? "—" : String(d.days_open)}
                isPlain
              />
              {d.closed_at && <TimelineRow label="Closed" value={d.closed_at} />}
            </dl>
          </Section>

          {/* Admin actions */}
          <Section title="Admin actions">
            {!isClosed ? (
              <>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5 mt-2">
                  Status
                </label>
                <select
                  value={statusEdit}
                  onChange={(e) => setStatusEdit(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md text-sm text-gray-900 dark:text-white capitalize bg-white dark:bg-gray-800"
                >
                  {/* M8 closeout — only show next-legal states for the current
                      status (employer actor). Backend still enforces the
                      transition with HTTP 409; this just keeps the UI honest. */}
                  {nextStatesFor((d.status || "received") as ConcernStatus, "employer").map((s) => (
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
                  placeholder="What was done to resolve this concern?"
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 placeholder-gray-400 dark:placeholder-gray-500 resize-none"
                />
              </>
            ) : null}

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
              placeholder="Add a new note. The timestamp + your account will be recorded."
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 placeholder-gray-400 dark:placeholder-gray-500 resize-none"
            />

            <button
              onClick={onSave}
              disabled={saving}
              className="mt-3 w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white text-sm font-semibold rounded-md"
            >
              {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : "Save changes"}
            </button>
          </Section>

          {/* Thread */}
          <Section title="Conversation with reporter">
            {threadError ? (
              <div className="text-xs text-red-600">{threadError}</div>
            ) : messages.length === 0 ? (
              <div className="rounded-md border border-dashed border-gray-200 dark:border-gray-700 p-4 text-center text-xs text-gray-500 dark:text-gray-400">
                <MessageSquare className="w-5 h-5 text-gray-300 dark:text-gray-600 mx-auto mb-1.5" />
                No messages yet. Your reply will be visible to the reporter (anonymously
                if they filed without identity).
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
                          {authorLabel(m.author_kind)}
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
                                fromReporter ? "text-indigo-600" : "text-white"
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

            <div className="mt-3 flex gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                placeholder="Reply to the reporter…"
                className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 placeholder-gray-400 dark:placeholder-gray-500 rounded-md text-sm text-gray-900 dark:text-white resize-none"
                disabled={sending}
              />
              <button
                onClick={onSendMessage}
                disabled={sending || !draft.trim()}
                className="px-3 py-2 self-start bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white text-sm rounded-md inline-flex items-center gap-1"
              >
                {sending ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <>
                    <Send className="w-3 h-3" />
                    Send
                  </>
                )}
              </button>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function authorLabel(kind: DisputeMessage["author_kind"]): string {
  switch (kind) {
    case "reporter":
      return "Reporter";
    case "employer":
      return "You";
    case "kontokaz":
      return "Kiruko Compliance";
    case "system":
      return "System";
    default:
      return kind;
  }
}

// ── External aggregate ──────────────────────────────────────────────────────
function ExternalAggregate({ stats }: { stats: CompanyDisputesResponse["external_stats"] | undefined }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-4 text-sm text-amber-900 dark:text-amber-400">
        These reports were routed to Kiruko Compliance and are confidential. You see
        aggregate trends only — for case-by-case detail, contact Kiruko.
      </div>
      {!stats || stats.total === 0 ? (
        <EmptyState message="No external reports for this company." />
      ) : (
        <>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total external reports</p>
            <p className="text-3xl font-bold text-gray-900 dark:text-white tabular-nums mt-1">{stats.total}</p>
          </div>
          {Object.keys(stats.by_category).length > 0 && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">By category</p>
              <ul className="space-y-1.5">
                {Object.entries(stats.by_category)
                  .sort((a, b) => b[1] - a[1])
                  .map(([cat, n]) => (
                    <li key={cat} className="flex items-center justify-between text-sm">
                      <span className="text-gray-700 dark:text-gray-200 capitalize">{cat.replace(/_/g, " ")}</span>
                      <span className="font-semibold text-gray-900 dark:text-white tabular-nums">{n}</span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
          {stats.by_month && Object.keys(stats.by_month).length > 0 && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">By month</p>
              <ul className="space-y-1.5">
                {Object.entries(stats.by_month)
                  .sort((a, b) => a[0].localeCompare(b[0]))
                  .map(([month, n]) => (
                    <li key={month} className="flex items-center justify-between text-sm">
                      <span className="text-gray-700 dark:text-gray-200 tabular-nums">{month}</span>
                      <span className="font-semibold text-gray-900 dark:text-white tabular-nums">{n}</span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Small components ────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">{title}</h3>
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

function FiledBy({ item }: { item: ConcernDispute }) {
  return (
    <div className="flex items-center gap-3">
      <IdentityAvatar item={item} size="sm" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
          {item.is_anonymous ? "Anonymous" : item.employee_name}
        </p>
        {item.is_anonymous && (
          <p className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400 font-semibold">
            Identity protected
          </p>
        )}
      </div>
    </div>
  );
}

function IdentityAvatar({ item, size }: { item: ConcernDispute; size: "sm" | "lg" }) {
  const dim = size === "sm" ? "w-8 h-8" : "w-10 h-10";
  if (item.is_anonymous) {
    return (
      <div
        className={`${dim} rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-900 flex items-center justify-center shrink-0`}
      >
        <Shield className={size === "sm" ? "w-4 h-4" : "w-5 h-5"} strokeWidth={2} color="#b45309" />
      </div>
    );
  }
  const initials = (item.employee_name || "").slice(0, 2).toUpperCase() || "?";
  return (
    <div
      className={`${dim} rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xs font-semibold text-gray-700 dark:text-gray-200 shrink-0`}
    >
      {initials}
    </div>
  );
}

function IdentityProtectedPill() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] uppercase tracking-wide font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400 border border-amber-200 dark:border-amber-900">
      <Shield className="w-3 h-3" />
      Identity protected
    </span>
  );
}

function UrgencyBadge({ urgency }: { urgency: string }) {
  const u = (urgency || "").toLowerCase();
  const styles: Record<string, string> = {
    urgent: "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 border-red-100 dark:border-red-900",
    high: "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 border-red-100 dark:border-red-900",
    medium: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-900",
    low: "bg-gray-50 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700",
  };
  const klass = styles[u] || styles.low;
  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded text-[10px] font-semibold uppercase border ${klass}`}
    >
      {urgency || "low"}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const v = (status || "").toLowerCase();
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
  return (
    <span
      className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize border ${
        styles[v] || styles.received
      }`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function SubTabButton({
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
      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
        active ? "bg-gray-900 text-white" : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function ScanResultBadge({ value }: { value?: string | null }) {
  if (!value) return null;
  const lower = value.toLowerCase();
  let klass = "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700";
  let label = value;
  if (lower === "clean") {
    klass = "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900";
    label = "Scanned · clean";
  } else if (lower.startsWith("rejected")) {
    klass = "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 border-red-100 dark:border-red-900";
    label = "Rejected — re-upload required";
  } else if (lower.startsWith("skipped")) {
    klass = "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-900";
    label = "Scan skipped";
  }
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase border ${klass}`}
      title={value}
    >
      {label}
    </span>
  );
}

function EmptyState({ message }: { message?: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl py-16 text-center">
      <div className="w-12 h-12 mx-auto bg-gray-50 dark:bg-gray-800/60 rounded-lg flex items-center justify-center mb-4">
        <MessageSquare className="w-6 h-6 text-gray-300 dark:text-gray-600" />
      </div>
      <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">No concerns</p>
      <p className="text-sm text-gray-500 dark:text-gray-400">{message || "There are no active concerns to display."}</p>
    </div>
  );
}
