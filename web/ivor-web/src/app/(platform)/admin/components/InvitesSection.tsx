"use client";
import React, { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import DashboardHeader from "@/components/ui/DashboardHeader";
import FilterSelect from "@/components/ui/FilterSelect";
import { Mail, Search, RefreshCw } from "lucide-react";
import { api } from "@/services/apiClient";

import SolarisBackground from "@/components/ui/SolarisBackground";


/**
 * Coerce an axios error's `detail` into a render-safe string.
 *
 * FastAPI returns three shapes here:
 *   1. A plain string (HTTPException)
 *   2. An array of validation objects {type, loc, msg, input} (422)
 *   3. Undefined / non-string object (network error, unhandled)
 *
 * Rendering shape (2) directly crashes React with "Objects are not valid
 * as a React child". This util flattens (2) into a readable summary and
 * falls back to a default for the rest.
 */
function errorMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { detail?: unknown } }; message?: string };
  const detail = e?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d: { loc?: unknown[]; msg?: string }) => {
        const loc = Array.isArray(d?.loc) ? d.loc.filter((s) => s !== "body" && s !== "query").join(".") : "";
        return loc ? `${loc}: ${d.msg ?? "invalid"}` : (d.msg ?? "invalid");
      })
      .join("; ");
  }
  if (detail && typeof detail === "object" && typeof (detail as { message?: unknown }).message === "string") {
    return (detail as { message: string }).message;
  }
  return e?.message || fallback;
}

export default function InvitesSection() {
  const { user } = useAuth();
  const [invites, setInvites] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [emailFilter, setEmailFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      try {
        const qs = new URLSearchParams();
        qs.set('limit', String(limit));
        qs.set('offset', String(offset));
        if (emailFilter) qs.set('email', emailFilter);
        if (roleFilter) qs.set('role', roleFilter);
        const resp = await api.get(`/company/invites?${qs.toString()}`);
        if (mounted) {
          setInvites(resp.data?.data || resp.data || []);
          setTotal(resp.data?.total ?? null);
        }
      } catch (e: unknown) {
        if (mounted) setActionError(errorMessage(e, 'Failed to load invitations.'));
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => { mounted = false };
  }, [limit, offset, emailFilter, roleFilter]);

  const handleResend = async (id: number) => {
    setActionError(null);
    try {
      await api.post(`/company/invites/${id}/resend`);
    } catch (e: unknown) {
      setActionError(errorMessage(e, 'Failed to resend invitation.'));
    }
  };

  const handleRevoke = async (id: number) => {
    setActionError(null);
    try {
      await api.delete(`/company/invites/${id}`);
      setInvites(prev => prev.filter(inv => inv.invite_id !== id));
    } catch (e: unknown) {
      setActionError(errorMessage(e, 'Failed to revoke invitation.'));
    }
  };

  return (
    <SolarisBackground>
      <div className="w-full space-y-8 py-10 px-6 animate-in fade-in duration-700">
        <DashboardHeader
          title="Invitations"
          subtitle={`Manage pending invites • ${user?.email || 'Admin'}`}
          extra={
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                <input
                  value={emailFilter}
                  onChange={(e) => { setEmailFilter(e.target.value); setOffset(0); }}
                  placeholder="Search by email..."
                  className="pl-9 pr-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-gray-400 transition-colors w-64"
                />
              </div>
              <FilterSelect
                label="Role"
                value={roleFilter}
                onChange={(v) => { setRoleFilter(v); setOffset(0); }}
                options={[
                  { value: "", label: "All roles" },
                  { value: "owner", label: "Owner" },
                  { value: "admin", label: "Admin" },
                  { value: "manager", label: "Manager" },
                  { value: "employee", label: "Employee" },
                ]}
              />
              <button
                onClick={() => { setEmailFilter(''); setRoleFilter(''); setOffset(0); }}
                className="p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
                title="Clear filters"
              >
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} strokeWidth={2} />
              </button>
            </div>
          }
        />

        {actionError && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700 animate-in slide-in-from-top-2 duration-300">
            <span>{actionError}</span>
            <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-600 transition-colors shrink-0">✕</button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
            <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-800 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-sm overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    <th className="px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400">Email</th>
                    <th className="px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400">Role</th>
                    <th className="px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400">Expires</th>
                    <th className="px-5 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {invites.map((inv) => (
                    <tr key={inv.invite_id} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                            <Mail size={14} className="text-gray-500 dark:text-gray-400" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900 dark:text-white">{inv.email}</p>
                            <p className="text-xs text-gray-400">Pending</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-300">{inv.role}</span>
                      </td>
                      <td className="px-5 py-3.5 text-sm text-gray-500 dark:text-gray-400">
                        {new Date(inv.expires_at).toLocaleDateString()}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => handleResend(inv.invite_id)} className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">Resend</button>
                          <button onClick={() => handleRevoke(inv.invite_id)} className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 border border-red-100 rounded-lg hover:bg-red-100 transition-colors">Revoke</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {invites.length === 0 && (
              <div className="py-16 text-center bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
                <Mail className="w-8 h-8 text-gray-200 mx-auto mb-3" />
                <p className="text-sm font-medium text-gray-500">No invitations found</p>
                <p className="text-xs text-gray-400 mt-1">No pending authorization links</p>
              </div>
            )}

            <div className="flex items-center justify-between p-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {total !== null ? `Showing ${offset + 1}–${Math.min(total, offset + invites.length)} of ${total}` : 'Loading...'}
              </p>
              <div className="flex items-center gap-2">
                <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))} className="px-3 py-1.5 text-xs font-medium bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">Previous</button>
                <span className="text-xs text-gray-400">Page {Math.floor(offset / limit) + 1}</span>
                <button disabled={total !== null && offset + limit >= (total || 0)} onClick={() => setOffset(offset + limit)} className="px-3 py-1.5 text-xs font-medium bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">Next</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </SolarisBackground>
  );
}
