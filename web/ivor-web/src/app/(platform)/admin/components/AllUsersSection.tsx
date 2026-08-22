"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/services/apiClient";
import { toast } from "sonner";
import { Users, Search, Clock, RefreshCw, Eye, Ban, RotateCcw, X, ChevronLeft, ChevronRight } from "lucide-react";
import { ALL_COUNTRIES, useCountry } from "@/contexts/CountryContext";
import { countryLabel } from "@/utils/countryDisplay";

interface ApiUser {
  user_id: number;
  email: string;
  user_type?: string;
  onboard_complete?: boolean;
  user_verified?: boolean;
  user_enabled?: boolean;
  is_superuser?: boolean;
  created_at?: string;
  roles?: string[];
  country_code?: string | null;
  company?: { company_name?: string; country_code?: string } | null;
  private_user?: {
    private_user_id?: number;
    employee_code?: string | null;
    first_name?: string;
    last_name?: string;
    phone?: string;
    gender?: string;
    date_of_birth?: string;
    pass_port_number?: string;
    department?: { department_name?: string; name?: string } | null;
    jobs?: { job_title?: string }[] | null;
    company?: { company_name?: string; country_code?: string } | null;
    country_code?: string | null;
  } | null;
}

const PAGE_SIZE = 50;

// Platform staff (super admin / support / engineer / compliance) are managed on
// the "Users" page — the All Users directory is end-users only, so exclude them.
const PLATFORM_ROLES = new Set(["platform_admin", "support", "engineer", "platform_engineer", "compliance_officer"]);
function isPlatformStaff(u: ApiUser): boolean {
  if (u.is_superuser) return true;
  return Array.isArray(u.roles) && u.roles.some((r) => PLATFORM_ROLES.has(r));
}

function displayName(u: ApiUser): string {
  const full = `${u.private_user?.first_name?.trim() || ""} ${u.private_user?.last_name?.trim() || ""}`.trim();
  return full || u.company?.company_name || u.email;
}
function typeLabel(u: ApiUser): string {
  return u.user_type === "company" ? "Employer" : "Employee";
}
function companyName(u: ApiUser): string {
  return u.company?.company_name || u.private_user?.company?.company_name || "—";
}
function fmtDate(s?: string): string {
  return s ? new Date(s).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" }) : "—";
}
function userCountry(u: ApiUser): string | null {
  return u.country_code || u.private_user?.country_code || null;
}

export default function AllUsersSection() {
  // The switcher in the admin bar is the only country control — no local
  // copy here. ALL_COUNTRIES means "no filter."
  const { activeCountry } = useCountry();
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<ApiUser | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Switching country while on page 2+ fires two effects: one still holding
  // the stale page number against the new country, one resetting to page 1.
  // Both call load(); nothing otherwise stops the stale request's response
  // from landing after the fresh one and clobbering it. This sequence
  // number makes only the most-recently-STARTED request's response ever
  // get applied, regardless of which one's network response arrives last.
  const loadSeq = useRef(0);

  const load = async (targetPage: number) => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      // /admin/all-users already excludes platform staff server-side; the
      // client filter is a harmless belt-and-suspenders. country_code is
      // applied server-side too, before pagination, so `total`/`totalPages`
      // below stay consistent with what's actually on screen — a client-
      // side-only filter on top of server pagination would make the
      // displayed total describe a different set than the visible rows.
      const params: Record<string, string | number> = { limit: PAGE_SIZE, offset: (targetPage - 1) * PAGE_SIZE };
      if (activeCountry !== ALL_COUNTRIES) params.country_code = activeCountry;
      const resp = await api.get("/admin/all-users", { params });
      if (seq !== loadSeq.current) return;
      const body = resp.data as { data?: ApiUser[]; total?: number };
      const all: ApiUser[] = Array.isArray(body?.data) ? body.data : [];
      setUsers(all.filter((u) => !isPlatformStaff(u)));
      setTotal(body?.total ?? all.length);
    } catch {
      if (seq !== loadSeq.current) return;
      setError("Could not load users.");
      setUsers([]);
      setTotal(0);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  };

  // Switching country while deep in the list would otherwise leave `page`
  // pointing past the end of the newly-scoped result set.
  useEffect(() => {
    setPage(1);
  }, [activeCountry]);

  useEffect(() => {
    load(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, activeCountry]);

  // Search filters the currently loaded page only — the directory is paginated
  // server-side, so a full cross-page search would need a backend search param
  // that doesn't exist yet. Country is already scoped server-side (see load
  // above), so it's not re-checked here.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (!q) return true;
      return (
        displayName(u).toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        companyName(u).toLowerCase().includes(q)
      );
    });
  }, [users, query]);

  const toggleEnabled = async (u: ApiUser) => {
    const next = !(u.user_enabled ?? true);
    if (!window.confirm(`${next ? "Enable" : "Disable"} ${displayName(u)}'s account?`)) return;
    setBusyId(u.user_id);
    try {
      await api.patch(`/admin/users/${u.user_id}/enabled`, { enabled: next });
      setUsers((prev) => prev.map((x) => (x.user_id === u.user_id ? { ...x, user_enabled: next } : x)));
      setDetail((d) => (d && d.user_id === u.user_id ? { ...d, user_enabled: next } : d));
      toast.success(`${displayName(u)} ${next ? "enabled" : "disabled"}.`);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Could not update the account.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto py-8 px-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">All Users</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Every onboarded user across the platform. Platform staff are managed under “Users”.
            Scoped to the country in the switcher above.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, email, company…"
              className="pl-9 pr-4 py-2 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-gray-400 transition-colors"
            />
          </div>
          <button
            onClick={() => load(page)}
            className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-900 dark:text-white rounded-lg text-sm font-medium transition-colors"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 flex items-center gap-2.5 w-fit">
        <div className="w-7 h-7 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center">
          <Users size={13} className="text-gray-600 dark:text-gray-300" />
        </div>
        <span className="text-xs font-medium text-gray-500">Total users</span>
        <span className="text-xl font-bold text-gray-900 dark:text-white tabular-nums ml-1">{loading ? "—" : total}</span>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[820px]">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800">
                <th className="px-5 py-3.5 text-xs font-medium text-gray-500">Name</th>
                <th className="px-5 py-3.5 text-xs font-medium text-gray-500">Type</th>
                <th className="px-5 py-3.5 text-xs font-medium text-gray-500">Company</th>
                <th className="px-5 py-3.5 text-xs font-medium text-gray-500">Country</th>
                <th className="px-5 py-3.5 text-xs font-medium text-gray-500">Onboarded</th>
                <th className="px-5 py-3.5 text-xs font-medium text-gray-500">Account</th>
                <th className="px-5 py-3.5 text-xs font-medium text-gray-500 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {loading ? (
                <tr><td colSpan={7} className="py-16 text-center text-sm text-gray-400"><div className="flex items-center justify-center gap-2"><Clock size={14} /> Loading users…</div></td></tr>
              ) : error ? (
                <tr><td colSpan={7} className="py-16 text-center text-sm text-red-500">{error}</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="py-16 text-center text-sm text-gray-400">No users found.</td></tr>
              ) : (
                filtered.map((u) => {
                  const enabled = u.user_enabled ?? true;
                  return (
                    <tr key={u.user_id} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                      <td className="px-5 py-4">
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {displayName(u)}
                          {u.private_user?.employee_code && (
                            <span className="ml-2 font-mono text-xs font-normal text-gray-400">{u.private_user.employee_code}</span>
                          )}
                        </p>
                        <p className="text-xs text-gray-400">{u.email}</p>
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-700 dark:text-gray-300">{typeLabel(u)}</td>
                      <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-400">{companyName(u)}</td>
                      <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-400">
                        {userCountry(u) ? countryLabel(userCountry(u) as string) : "—"}
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${u.onboard_complete ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-gray-100 text-gray-600 border border-gray-200"}`}>
                          {u.onboard_complete ? "Yes" : "No"}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium ${enabled ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-red-50 text-red-700 border border-red-100"}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${enabled ? "bg-emerald-500" : "bg-red-500"}`} />
                          {enabled ? "Enabled" : "Disabled"}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setDetail(u)} title="View details" className="w-8 h-8 inline-flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors">
                            <Eye size={15} />
                          </button>
                          <button
                            onClick={() => toggleEnabled(u)}
                            disabled={busyId === u.user_id}
                            title={enabled ? "Disable account" : "Enable account"}
                            className={`w-8 h-8 inline-flex items-center justify-center rounded-lg transition-colors disabled:opacity-50 ${enabled ? "text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" : "text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"}`}
                          >
                            {enabled ? <Ban size={15} /> : <RotateCcw size={15} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-t border-gray-100 dark:border-gray-800">
          <p className="text-xs text-gray-400">
            {total === 0 ? "No users" : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={loading || page <= 1}
              className="w-8 h-8 inline-flex items-center justify-center text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="text-xs font-medium text-gray-600 dark:text-gray-300 tabular-nums">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={loading || page >= totalPages}
              className="w-8 h-8 inline-flex items-center justify-center text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </div>

      {detail && (
        <div className="fixed inset-0 z-30">
          <button aria-label="Close" onClick={() => setDetail(null)} className="absolute inset-0 bg-black/30" />
          <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white dark:bg-zinc-900 shadow-xl flex flex-col">
            <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  {displayName(detail)}
                  {detail.private_user?.employee_code && (
                    <span className="ml-2 font-mono text-xs font-normal text-zinc-400">{detail.private_user.employee_code}</span>
                  )}
                </h2>
                <p className="text-xs text-zinc-400">{detail.email}</p>
              </div>
              <button onClick={() => setDetail(null)} className="text-zinc-400 hover:text-zinc-600"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-3 text-sm">
              {([
                ["Type", typeLabel(detail)],
                ["Employee code", detail.private_user?.employee_code || "—"],
                ["Company", companyName(detail)],
                ["Department", detail.private_user?.department?.department_name || detail.private_user?.department?.name || "—"],
                ["Job title", detail.private_user?.jobs?.[0]?.job_title || "—"],
                ["Phone", detail.private_user?.phone || "—"],
                ["Date of birth", detail.private_user?.date_of_birth ? fmtDate(detail.private_user.date_of_birth) : "—"],
                ["Passport / permit", detail.private_user?.pass_port_number || "—"],
                ["Onboarded", detail.onboard_complete ? "Yes" : "No"],
                ["Verified", detail.user_verified ? "Yes" : "No"],
                ["Account", (detail.user_enabled ?? true) ? "Enabled" : "Disabled"],
                ["Joined", fmtDate(detail.created_at)],
                ["User ID", String(detail.user_id)],
                ["Employee ID", detail.private_user?.private_user_id != null ? String(detail.private_user.private_user_id) : "—"],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-4 border-b border-zinc-50 dark:border-zinc-800/60 pb-2">
                  <span className="text-zinc-400">{label}</span>
                  <span className="text-zinc-900 dark:text-zinc-100 text-right font-medium">{value}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-zinc-100 dark:border-zinc-800 px-5 py-4">
              <button
                onClick={() => toggleEnabled(detail)}
                disabled={busyId === detail.user_id}
                className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 ${
                  (detail.user_enabled ?? true)
                    ? "bg-red-50 text-red-700 hover:bg-red-100 border border-red-100"
                    : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-100"
                }`}
              >
                {(detail.user_enabled ?? true) ? <><Ban size={15} /> Disable account</> : <><RotateCcw size={15} /> Enable account</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
