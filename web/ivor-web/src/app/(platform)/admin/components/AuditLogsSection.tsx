"use client";
import React, { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import DashboardHeader from "@/components/ui/DashboardHeader";
import { Activity, Search, RefreshCw, Database, ArrowRightLeft, UserX, Clock } from "lucide-react";
import { api } from "@/services/apiClient";

import SolarisBackground from "@/components/ui/SolarisBackground";
import FilterPillGroup from "@/components/ui/FilterPillGroup";

export default function AuditLogsSection() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [actionFilter, setActionFilter] = useState('');
  const [targetFilter, setTargetFilter] = useState('');

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setFetchError(null);
      try {
        const qs = new URLSearchParams();
        qs.set('limit', String(limit));
        qs.set('offset', String(offset));
        if (actionFilter) qs.set('action', actionFilter);
        if (targetFilter) qs.set('target_type', targetFilter);
        const resp = await api.get(`/admin/audit?${qs.toString()}`);
        if (mounted) {
          setLogs(resp.data?.data || resp.data || []);
          setTotal(resp.data?.total ?? null);
        }
      } catch (e: any) {
        if (mounted) setFetchError(e?.response?.data?.detail || 'Failed to load audit logs. Please try again.');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => { mounted = false };
  }, [limit, offset, actionFilter, targetFilter, reloadKey]);

  return (
    <SolarisBackground>
      <div className="w-full space-y-8 py-10 px-6 animate-in fade-in duration-700">
        <DashboardHeader
          title="Audit Logs"
          subtitle={`Activity history • ${user?.email || 'Admin'}`}
          extra={
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                <input
                  value={actionFilter}
                  onChange={(e) => { setActionFilter(e.target.value); setOffset(0); }}
                  placeholder="Search events..."
                  className="pl-9 pr-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-gray-400 transition-colors w-64"
                />
              </div>
              <button
                onClick={() => { setActionFilter(''); setTargetFilter(''); setOffset(0); }}
                className="p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
                title="Clear filters"
              >
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} strokeWidth={2} />
              </button>
            </div>
          }
        />

        {/* Quick filters for the events admins look for most. The backend does a
            substring match on `action`, so these set the same actionFilter the
            search box uses. */}
        <FilterPillGroup
          label="Quick filters:"
          value={actionFilter}
          onChange={(v) => { setActionFilter(v); setOffset(0); }}
          options={[
            { label: "All events", value: "", icon: Activity },
            { label: "Account deletions", value: "account_deleted", icon: UserX },
            { label: "Auto-closed shifts", value: "time_log.auto_closed", icon: Clock },
          ]}
        />

        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center">
                  <Activity size={14} className="text-gray-600 dark:text-gray-400" />
                </div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Activity Log</h2>
              </div>
              <span className="text-xs text-gray-400">{loading ? '—' : `${logs.length} events`}</span>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-800 rounded-full animate-spin" />
              </div>
            ) : fetchError ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 px-6 text-center">
                <Activity className="w-8 h-8 text-red-300 mb-1" />
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{fetchError}</p>
                <button
                  onClick={() => setReloadKey(k => k + 1)}
                  className="px-4 py-2 bg-gray-900 dark:bg-gray-700 text-white text-xs font-medium rounded-lg hover:bg-gray-800 transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16">
                <Activity className="w-8 h-8 text-gray-200 mb-3" />
                <p className="text-sm font-medium text-gray-500">No audit logs found</p>
                <p className="text-xs text-gray-400 mt-1">Try adjusting your search filters</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50 dark:divide-gray-800">
                {logs.map((l) => (
                  <div key={l.id} className="px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center text-gray-500 dark:text-gray-400 shrink-0">
                          <Database size={14} />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-white">{l.action}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="bg-gray-100 dark:bg-gray-800 rounded-md px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-400">{l.resource_type || l.target_type || '—'}</span>
                            <span className="text-xs text-gray-400">ID: {l.resource_id ?? l.target_id ?? '—'}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{new Date(l.created_at).toLocaleDateString()}</p>
                        <p className="text-xs text-gray-400">{new Date(l.created_at).toLocaleTimeString()}</p>
                      </div>
                    </div>
                    {(l.details ?? l.meta) && (
                      <pre className="px-3 py-2.5 bg-gray-900 rounded-lg font-mono text-xs leading-relaxed text-green-400 overflow-x-auto">
                        <code>{typeof (l.details ?? l.meta) === 'string'
                          ? l.details ?? l.meta
                          : JSON.stringify(l.details ?? l.meta, null, 2)}</code>
                      </pre>
                    )}
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-50 dark:border-gray-800">
                      <div className="w-6 h-6 rounded-md bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-[10px] font-semibold text-gray-600 dark:text-gray-400">
                        {String(l.user_id || l.actor_user_id || '?').slice(0, 2).toUpperCase()}
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-400">User {l.user_id || l.actor_user_id || 'System'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between px-4 py-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {total !== null ? `Showing ${offset + 1}–${Math.min(total, offset + logs.length)} of ${total}` : '—'}
            </p>
            <div className="flex items-center gap-2">
              <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))} className="px-3 py-1.5 text-xs font-medium bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">Previous</button>
              <span className="text-xs text-gray-400">Page {Math.floor(offset / limit) + 1}</span>
              <button disabled={total !== null && offset + limit >= (total || 0)} onClick={() => setOffset(offset + limit)} className="px-3 py-1.5 text-xs font-medium bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">Next</button>
            </div>
          </div>
        </div>
      </div>
    </SolarisBackground>
  );
}
