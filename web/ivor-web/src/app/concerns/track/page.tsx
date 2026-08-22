"use client";
/**
 * M3 — Public reporter portal at /concerns/track.
 *
 * Anonymous (and named) reporters return to a concern using case_id + PIN,
 * read the case substance + message thread, post replies, and trigger
 * appeals. No auth wall (this page lives OUTSIDE `(platform)/`) — auth is
 * the case_id + PIN pair, exchanged for a short-lived scoped JWT.
 *
 * Backend endpoints (mounted under /api/v1/portal/concerns/):
 *   POST /lookup                   → 200 {ok, captcha_required, token?, expires_at?}
 *   GET  /{case_id}                → 200 case + thread (requires scoped token)
 *   POST /{case_id}/messages       → 201
 *   POST /{case_id}/appeal         → 200
 *
 * The lookup endpoint ALWAYS returns 200 with a uniform body — unknown
 * case / wrong PIN / rate-limited / locked are indistinguishable. Only
 * `captcha_required=true` is leaked, and only because the UI needs to
 * render the widget on the next attempt.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Shield, ArrowRight, Send, RefreshCw, AlertTriangle, MessageSquare, Lock, Paperclip } from "lucide-react";
import { isImageUrl } from "@/utils/attachment";

const API_BASE = "/api/v1/portal/concerns";

type LookupResponse = {
  ok: boolean;
  captcha_required: boolean;
  token?: string;
  expires_at?: string;
};

type CaseMessage = {
  message_id: number;
  author_kind: "reporter" | "employer" | "kontokaz" | "system";
  body: string;
  attachment_url?: string | null;
  created_at: string | null;
};

type CaseData = {
  case_id: number;
  title: string;
  category: string;
  status: string;
  channel: "internal" | "external" | string;
  urgency_level: string;
  is_anonymous: boolean;
  issue_description: string;
  expected_outcome: string;
  occurrence_description?: string;
  date_of_occurrence?: string | null;
  attachment_url?: string | null;
  attachment_scan_result?: string | null;
  resolution?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  acknowledged_at?: string | null;
  closed_at?: string | null;
  escalated_to_external_at?: string | null;
  escalated_reason?: string | null;
  messages: CaseMessage[];
};

export default function ConcernsTrackPage() {
  const [token, setToken] = useState<string | null>(null);
  const [caseData, setCaseData] = useState<CaseData | null>(null);

  if (token && caseData) {
    return (
      <CaseView
        token={token}
        initialCase={caseData}
        onSignOut={() => {
          setToken(null);
          setCaseData(null);
        }}
      />
    );
  }

  return (
    <LookupForm
      onAuthenticated={(t, data) => {
        setToken(t);
        setCaseData(data);
      }}
    />
  );
}

// ── Lookup form ────────────────────────────────────────────────────────────
function LookupForm({
  onAuthenticated,
}: {
  onAuthenticated: (token: string, data: CaseData) => void;
}) {
  const [caseId, setCaseId] = useState("");
  const [pin, setPin] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Generic error message — never leaks WHY (uniform-body design).
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const lookupRes = await fetch(`${API_BASE}/lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          case_id: Number(caseId),
          pin: pin.trim(),
          captcha_token: captchaRequired ? captchaToken : undefined,
        }),
      });

      if (!lookupRes.ok) {
        // The portal lookup endpoint is supposed to ALWAYS return 200 with a
        // uniform body. A non-200 means the server is unreachable or the
        // kill-switch is active — surface a generic outage message.
        setError("Service is temporarily unavailable. Please try again later.");
        return;
      }

      const lookup: LookupResponse = await lookupRes.json();
      if (!lookup.ok) {
        setCaptchaRequired(!!lookup.captcha_required);
        setError("Invalid case ID or PIN.");
        return;
      }

      // Fetch the case using the scoped token.
      const caseRes = await fetch(`${API_BASE}/${Number(caseId)}`, {
        headers: { Authorization: `Bearer ${lookup.token}` },
      });
      if (!caseRes.ok) {
        setError("Could not load the case. Try again.");
        return;
      }
      const caseData: CaseData = await caseRes.json();
      onAuthenticated(lookup.token!, caseData);
    } catch {
      setError("Service is temporarily unavailable. Please try again later.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
        <div className="bg-gradient-to-br from-indigo-600 to-violet-700 px-6 py-8 text-white">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold">Reporter portal</h1>
              <p className="text-xs text-indigo-100">Kiruko Concerns</p>
            </div>
          </div>
          <p className="text-sm text-indigo-100 mt-3">
            Enter your case ID and PIN to read updates, reply, or appeal a decision.
            Your PIN is shown only once at submission — we cannot recover it.
          </p>
        </div>

        <form onSubmit={onSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Case ID
            </label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={caseId}
              onChange={(e) => setCaseId(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="e.g. 1247"
              required
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-900"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              PIN
            </label>
            <input
              type="text"
              value={pin}
              onChange={(e) => setPin(e.target.value.toUpperCase())}
              placeholder="8-character code"
              required
              maxLength={32}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-900 font-mono tracking-widest uppercase"
            />
          </div>

          {captchaRequired && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-start gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="text-xs text-amber-900">
                  Repeated failed attempts detected. Please complete the verification below.
                </div>
              </div>
              {/* Real hCaptcha widget integration is pending (see
                  CONCERNS_INCIDENTS.md). For dark launch we accept any
                  non-empty string; the backend ignores the token when
                  HCAPTCHA_SECRET is unset. */}
              <input
                type="text"
                value={captchaToken}
                onChange={(e) => setCaptchaToken(e.target.value)}
                placeholder="Type 'i-am-human' to continue"
                className="w-full px-3 py-2 border border-amber-300 rounded text-sm text-gray-900 bg-white"
              />
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !caseId || !pin}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white font-semibold rounded-lg transition-colors"
          >
            {submitting ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <span>Open my case</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          <p className="text-xs text-gray-500 text-center pt-2 flex items-center justify-center gap-1.5">
            <Lock className="w-3 h-3" />
            We do not log who lands on this page until you submit credentials.
          </p>
        </form>
      </div>
    </div>
  );
}

// ── Case view ──────────────────────────────────────────────────────────────
function CaseView({
  token,
  initialCase,
  onSignOut,
}: {
  token: string;
  initialCase: CaseData;
  onSignOut: () => void;
}) {
  const [caseData, setCaseData] = useState<CaseData>(initialCase);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [appealing, setAppealing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/${caseData.case_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        // Token expired (30 min TTL) — kick the user back to the lookup form.
        onSignOut();
        return;
      }
      if (!res.ok) return;
      const fresh: CaseData = await res.json();
      setCaseData(fresh);
    } catch {
      // Silent — refresh is best-effort.
    }
  }, [token, caseData.case_id, onSignOut]);

  // Poll every 30s so handler replies appear without manual refresh.
  useEffect(() => {
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  const onSend = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/${caseData.case_id}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ body }),
      });
      if (res.status === 401) {
        onSignOut();
        return;
      }
      if (!res.ok) {
        setError("Could not send your message. Try again.");
        return;
      }
      setDraft("");
      await refresh();
    } finally {
      setSending(false);
    }
  };

  const onAppeal = async () => {
    if (appealing) return;
    if (!confirm("File an appeal on this case?")) return;
    setAppealing(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/${caseData.case_id}/appeal`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        onSignOut();
        return;
      }
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        setError(detail?.detail || "Could not file appeal.");
        return;
      }
      await refresh();
    } finally {
      setAppealing(false);
    }
  };

  const channelLabel =
    caseData.channel === "external"
      ? "Routed to Kiruko Compliance"
      : "Routed to your employer";

  const canAppeal =
    caseData.status === "resolved" || caseData.status === "rejected";

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center">
              <Shield className="w-4 h-4 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-gray-900">
                Case #{caseData.case_id}
              </h1>
              <p className="text-xs text-gray-500">{channelLabel}</p>
            </div>
          </div>
          <button
            onClick={onSignOut}
            className="text-xs font-semibold text-gray-500 hover:text-gray-900"
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Identity & status */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-gray-900 mb-1">
                {caseData.title}
              </h2>
              <p className="text-xs text-gray-500 uppercase tracking-wide">
                {caseData.category} · urgency {caseData.urgency_level}
              </p>
            </div>
            <StatusBadge status={caseData.status} />
          </div>
          {caseData.is_anonymous && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold uppercase tracking-wide">
              <Shield className="w-3 h-3" />
              Identity protected
            </div>
          )}
          {caseData.escalated_to_external_at && (
            <div className="mt-3 text-xs text-violet-700 bg-violet-50 border border-violet-100 rounded-md px-3 py-2">
              <strong>Auto-escalated to Kiruko</strong>
              {caseData.escalated_reason && <> — {caseData.escalated_reason}</>}
            </div>
          )}
          {/* Plan §Notification copy reporter-facing portal-banner column —
              "Acknowledged on {date}". Renders once a handler has opened
              the case (acknowledged_at is stamped on the first transition
              out of `received`). */}
          {caseData.acknowledged_at && (
            <div className="mt-3 text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-md px-3 py-2">
              <strong>Acknowledged on</strong>{" "}
              {new Date(caseData.acknowledged_at).toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </div>
          )}
        </div>

        {/* Substance */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <Field label="Issue description" value={caseData.issue_description} />
          <Field label="Expected outcome" value={caseData.expected_outcome} />
          {caseData.occurrence_description && (
            <Field label="Occurrence details" value={caseData.occurrence_description} />
          )}
          {caseData.resolution && (
            <div>
              <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">
                Resolution
              </div>
              <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-3 text-sm text-emerald-900 whitespace-pre-wrap">
                {caseData.resolution}
              </div>
            </div>
          )}
          {caseData.attachment_url && (
            <Field
              label="Attachment"
              value={
                <div className="flex flex-col gap-2">
                  {isImageUrl(caseData.attachment_url) && (
                    <a href={caseData.attachment_url} target="_blank" rel="noopener noreferrer" className="block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={caseData.attachment_url}
                        alt="Concern evidence attachment"
                        className="max-h-64 w-auto rounded-lg border border-gray-200 object-contain cursor-zoom-in"
                      />
                    </a>
                  )}
                  <a
                    href={caseData.attachment_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 underline"
                  >
                    Open file
                  </a>
                </div>
              }
            />
          )}
        </div>

        {/* Thread */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-gray-400" />
              Conversation
            </h3>
            <button
              onClick={refresh}
              className="text-xs text-gray-500 hover:text-gray-900 flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
          </div>
          <Thread messages={caseData.messages} />
          <div className="p-4 border-t border-gray-100 bg-slate-50">
            {error && (
              <div className="mb-2 text-sm text-red-600">{error}</div>
            )}
            <div className="flex gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Write a reply…"
                rows={2}
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900 resize-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                disabled={sending}
              />
              <button
                onClick={onSend}
                disabled={sending || !draft.trim()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white text-sm font-semibold rounded-lg flex items-center gap-1 self-start"
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
          </div>
        </div>

        {/* Appeal */}
        {canAppeal && (
          <div className="bg-white rounded-xl border border-amber-200 p-5">
            <h3 className="text-sm font-bold text-amber-900 mb-1">
              Disagree with the outcome?
            </h3>
            <p className="text-xs text-gray-600 mb-3">
              File an appeal to reopen the case for further investigation. Only
              you can trigger this — handlers cannot appeal on your behalf.
            </p>
            <button
              onClick={onAppeal}
              disabled={appealing}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 text-white text-sm font-semibold rounded-lg"
            >
              {appealing ? "Filing…" : "File an appeal"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value && value !== 0) return null;
  return (
    <div>
      <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">
        {label}
      </div>
      <div className="text-sm text-gray-900 whitespace-pre-wrap">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = (status || "").toLowerCase();
  const colors: Record<string, string> = {
    received: "bg-amber-50 text-amber-700 border-amber-100",
    triaged: "bg-blue-50 text-blue-700 border-blue-100",
    investigating: "bg-blue-50 text-blue-700 border-blue-100",
    action_taken: "bg-indigo-50 text-indigo-700 border-indigo-100",
    resolved: "bg-emerald-50 text-emerald-700 border-emerald-100",
    rejected: "bg-red-50 text-red-700 border-red-100",
    appealed: "bg-violet-50 text-violet-700 border-violet-100",
    closed: "bg-gray-100 text-gray-600 border-gray-200",
  };
  const klass = colors[s] || colors.received;
  return (
    <span className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize border ${klass}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function Thread({ messages }: { messages: CaseMessage[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="px-5 py-10 text-center">
        <MessageSquare className="w-8 h-8 text-gray-300 mx-auto mb-3" />
        <p className="text-sm font-medium text-gray-900">No messages yet</p>
        <p className="text-xs text-gray-500 mt-1">
          When your handler responds, the conversation will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="max-h-[420px] overflow-y-auto px-5 py-4 space-y-3">
      {messages.map((m) => {
        const mine = m.author_kind === "reporter";
        return (
          <div
            key={m.message_id}
            className={`flex ${mine ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-xl p-3 ${
                mine
                  ? "bg-indigo-600 text-white"
                  : "bg-white border border-gray-200 text-gray-900"
              }`}
            >
              <div
                className={`text-[10px] uppercase tracking-wide font-bold mb-1 ${
                  mine ? "text-indigo-100" : "text-gray-500"
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
                      mine ? "text-white" : "text-indigo-600"
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
                    mine ? "text-indigo-200" : "text-gray-400"
                  }`}
                >
                  {new Date(m.created_at).toLocaleString()}
                </div>
              )}
            </div>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}

function authorLabel(kind: CaseMessage["author_kind"]): string {
  switch (kind) {
    case "reporter":
      return "You";
    case "employer":
      return "Your employer";
    case "kontokaz":
      return "Kiruko Compliance";
    case "system":
      return "System";
    default:
      return kind;
  }
}
