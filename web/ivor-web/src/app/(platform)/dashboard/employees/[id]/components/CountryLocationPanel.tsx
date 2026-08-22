"use client";

import { useCallback, useEffect, useState } from "react";
import { countryAssignments, type EmployeeCountryAssignment } from "@/services/payroll-api";
import { countryLabel, COUNTRY_NAMES } from "@/utils/countryDisplay";
import { Globe, Loader2, MapPin, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { isError } from "@/utils/payrollFormat";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return d;
  }
}

function reasonLabel(reason: string): string {
  switch (reason) {
    case "mission": return "Mission";
    case "transfer_same_company": return "Transfer";
    case "transfer_new_company": return "Transfer (new company)";
    default: return reason;
  }
}

interface Props {
  privateUserId: number;
  companyId: number;
}

/**
 * Location / Country assignments for an employee — missions and transfers.
 * Phase 1: display + record. The payroll engine is NOT country-assignment-aware
 * yet, so this panel is informational; it does not promise statutory tax changes.
 */
export default function CountryLocationPanel({ privateUserId }: Props) {
  const [rows, setRows] = useState<EmployeeCountryAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await countryAssignments.list(privateUserId);
    setRows(isError(r) ? [] : r);
    setLoading(false);
  }, [privateUserId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Active means today falls inside [effective_from, effective_to) AND the row
  // isn't archived — matching the backend's date-aware resolution
  // (PrivateUser.effective_country_code), not just "not ended yet". A future-
  // dated mission must NOT show as active today.
  const today = todayISO();
  const active = rows.find(
    (a) => !a.archived_at
      && a.effective_from <= today
      && (!a.effective_to || a.effective_to >= today),
  );

  async function endAssignment(a: EmployeeCountryAssignment) {
    // Ending a mission that hasn't started yet: put effective_to = effective_from
    // so the window is empty (the backend rejects effective_to < effective_from,
    // and ending a future mission "today" would create a backwards window).
    const endDate = a.effective_from >= todayISO() ? a.effective_from : todayISO();
    const what = a.effective_from >= todayISO()
      ? `the upcoming ${reasonLabel(a.reason)} to ${countryLabel(a.country_code)} (${fmtDate(a.effective_from)})?`
      : `the ${reasonLabel(a.reason)} to ${countryLabel(a.country_code)} today?`;
    if (!confirm(`Cancel ${what}`)) return;
    const r = await countryAssignments.end(privateUserId, a.id, endDate);
    if (isError(r)) {
      toast.error(r.error);
      return;
    }
    toast.success("Assignment ended");
    refresh();
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 dark:text-gray-400">
            <Globe size={15} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Location / Country</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Missions and transfers. Informational for now — no payroll impact yet.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-3.5 w-3.5" />
          New mission
        </button>
      </div>

      <div className="p-5 space-y-4">
        {loading ? (
          <div className="text-center py-6 text-sm text-zinc-400 dark:text-gray-500">Loading…</div>
        ) : active ? (
          <div className="flex items-start gap-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900 p-4">
            <MapPin className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                {countryLabel(active.country_code)}
                <span className="ml-2 px-1.5 py-0.5 rounded bg-blue-600 text-white text-[10px] font-medium align-middle">
                  {reasonLabel(active.reason)}
                </span>
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {fmtDate(active.effective_from)}{active.effective_to ? ` – ${fmtDate(active.effective_to)}` : " — ongoing"}
                {active.country_currency ? ` · ${active.country_currency}` : ""}
              </p>
              <button
                type="button"
                onClick={() => endAssignment(active)}
                className="mt-2 text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
              >
                End today
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-gray-400 text-center py-4">
            No active mission or transfer. Employment country is the company&apos;s.
          </p>
        )}

        {rows.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wide mb-2">History</div>
            <div className="bg-gray-50 dark:bg-gray-800/60 rounded-xl divide-y divide-gray-100 dark:divide-gray-700">
              {rows.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {countryLabel(a.country_code)}
                      <span className="ml-1.5 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-[10px] font-medium align-middle">
                        {reasonLabel(a.reason)}
                      </span>
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      {fmtDate(a.effective_from)}{a.effective_to ? ` – ${fmtDate(a.effective_to)}` : " — ongoing"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-gray-400 dark:text-gray-500">{a.country_currency ?? ""}</span>
                    {!a.archived_at && !a.effective_to ? (
                      <button
                        type="button"
                        onClick={() => endAssignment(a)}
                        className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
                      >
                        End
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showCreate && (
        <NewAssignmentModal
          onClose={() => setShowCreate(false)}
          onSubmit={async (payload) => {
            const r = await countryAssignments.create(privateUserId, payload);
            if (isError(r)) {
              toast.error(r.error);
              return false;
            }
            toast.success(
              payload.reason === "mission" ? "Mission created"
                : payload.reason === "transfer_new_company" ? "Transfer created"
                : "Assignment created",
            );
            refresh();
            return true;
          }}
        />
      )}
    </div>
  );
}

function NewAssignmentModal({
  onClose, onSubmit,
}: {
  onClose: () => void;
  onSubmit: (payload: { country_code: string; reason: "mission" | "transfer_same_company" | "transfer_new_company"; effective_from: string; notes: string | null; new_company_id?: number | null }) => Promise<boolean>;
}) {
  const codes = Object.keys(COUNTRY_NAMES);
  const [countryCode, setCountryCode] = useState(codes[0] ?? "TZ");
  const [reason, setReason] = useState<"mission" | "transfer_same_company" | "transfer_new_company">("mission");
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO());
  const [submitting, setSubmitting] = useState(false);

  // Cross-company transfer → pick a destination company by search.
  const [companyQuery, setCompanyQuery] = useState("");
  const [companyResults, setCompanyResults] = useState<Array<{ company_id: number; company_name: string; brn: string; country_code: string }>>([]);
  const [targetCompanyId, setTargetCompanyId] = useState<number | null>(null);

  useEffect(() => {
    if (reason !== "transfer_new_company") return;
    const q = companyQuery.trim();
    if (!q) { setCompanyResults([]); return; }
    const t = setTimeout(async () => {
      const r = await countryAssignments.searchCompanies(q);
      setCompanyResults(isError(r) ? [] : r);
    }, 250);
    return () => clearTimeout(t);
  }, [reason, companyQuery]);

  if (!countryCode) return null;

  async function handleSubmit() {
    if (!effectiveFrom) {
      toast.error("Pick a start date");
      return;
    }
    if (reason === "transfer_new_company" && !targetCompanyId) {
      toast.error("Choose a destination company");
      return;
    }
    setSubmitting(true);
    const ok = await onSubmit({
      country_code: countryCode,
      reason,
      effective_from: effectiveFrom,
      notes: null,
      new_company_id: reason === "transfer_new_company" ? targetCompanyId : null,
    });
    setSubmitting(false);
    if (ok) onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-gray-800 px-5 py-3.5">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">New country assignment</h2>
          <button onClick={onClose} className="text-zinc-400 dark:text-gray-500 hover:text-zinc-600 dark:hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wide mb-1">Type</label>
            <select
              value={reason}
              onChange={(e) => { setReason(e.target.value as "mission" | "transfer_same_company" | "transfer_new_company"); setTargetCompanyId(null); setCompanyQuery(""); }}
              className="w-full rounded-md border border-zinc-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="mission">Mission (temporary, same employer)</option>
              <option value="transfer_same_company">Transfer (permanent, same company)</option>
              <option value="transfer_new_company">Transfer (new company)</option>
            </select>
          </div>
          {reason === "transfer_new_company" && (
            <div>
              <label className="block text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wide mb-1">Destination company</label>
              <input
                type="text"
                value={companyQuery}
                onChange={(e) => setCompanyQuery(e.target.value)}
                placeholder="Search company name or BRN"
                className="w-full rounded-md border border-zinc-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {companyResults.length > 0 && (
                <div className="mt-2 rounded-md border border-zinc-200 dark:border-gray-700 divide-y divide-zinc-100 dark:divide-gray-700">
                  {companyResults.map((c) => (
                    <button
                      key={c.company_id}
                      type="button"
                      onClick={() => { setTargetCompanyId(c.company_id); setCompanyQuery(c.company_name); }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-gray-800 ${targetCompanyId === c.company_id ? "bg-blue-50 dark:bg-blue-950/40" : ""}`}
                    >
                      <span className="font-medium text-zinc-900 dark:text-white">{c.company_name}</span>
                      <span className="ml-2 text-xs text-zinc-400">{c.country_code} · {c.brn}</span>
                    </button>
                  ))}
                </div>
              )}
              {companyQuery.trim() && companyResults.length === 0 && (
                <p className="mt-1.5 text-xs text-zinc-400">No companies match “{companyQuery}”.</p>
              )}
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wide mb-1">Country</label>
            <select
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
              className="w-full rounded-md border border-zinc-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {codes.map((c) => (
                <option key={c} value={c}>{countryLabel(c)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wide mb-1">Start date</label>
            <input
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              className="w-full rounded-md border border-zinc-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 dark:border-gray-800 px-5 py-3.5">
          <button onClick={onClose} className="rounded-md border border-zinc-200 dark:border-gray-700 px-4 py-2 text-sm text-zinc-700 dark:text-gray-200 hover:bg-zinc-50 dark:hover:bg-gray-800">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}