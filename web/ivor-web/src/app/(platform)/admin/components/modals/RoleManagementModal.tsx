"use client";

import { useEffect, useState } from "react";
import { User, ShieldCheck, X, AlertTriangle, Loader2, CheckCircle2 } from "lucide-react";
import { fetchCompanyUsers, setCompanyUserRole } from "@/services/api";

export default function RoleManagementModal({ companyId, onClose }: { companyId: number; onClose: () => void }) {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchCompanyUsers(companyId);
        if ((res as any)?.error) {
          setError((res as any).error || 'Failed to fetch users');
          setUsers([]);
        } else {
          setUsers(res as any);
        }
      } catch (e: any) {
        setError(e?.message || String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => { mounted = false };
  }, [companyId]);

  const changeRole = async (userId: number, role: string) => {
    setError(null);
    setUpdatingUserId(userId);
    try {
      const res = await setCompanyUserRole(companyId, userId, { role });
      if ((res as any)?.error) {
        setError((res as any).error || 'Failed to set role');
        return;
      }
      setUsers((prev) => prev.map(u => u.user_id === userId ? { ...u, private_user: { ...u.private_user, role } } : u));
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setUpdatingUserId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white dark:bg-gray-900 rounded-[2.5rem] shadow-2xl max-w-2xl w-full overflow-hidden animate-in zoom-in-95 duration-300 border border-slate-200 dark:border-gray-800">
        <div className="p-8 md:p-10">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-slate-900 dark:bg-gray-100 rounded-xl flex items-center justify-center text-white dark:text-gray-900 shadow-sm">
                <ShieldCheck className="w-6 h-6" strokeWidth={1.5} />
              </div>
              <div>
                <h3 className="font-display text-xl font-bold text-slate-900 dark:text-white uppercase tracking-tight leading-none">Authority Control</h3>
                <p className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest mt-1.5">Manage user access & permissions</p>
              </div>
            </div>
            <button onClick={onClose} className="w-10 h-10 rounded-xl hover:bg-slate-50 dark:hover:bg-gray-800 flex items-center justify-center transition-all group">
              <X size={18} className="text-slate-400 dark:text-gray-500 group-hover:text-slate-900 dark:group-hover:text-white" />
            </button>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900/50 rounded-2xl flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-[10px] font-black text-red-800 dark:text-red-300 uppercase tracking-widest leading-relaxed">{error}</p>
            </div>
          )}

          <div className="max-h-[50vh] overflow-y-auto pr-2 custom-scrollbar">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
                <p className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest">Retrieving entity users...</p>
              </div>
            ) : users.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest">No users found for this entity</p>
              </div>
            ) : (
              <div className="space-y-3">
                {users.map((u) => (
                  <div key={u.user_id} className="group flex items-center justify-between p-4 bg-slate-50 dark:bg-gray-800 border border-slate-100 dark:border-gray-700 rounded-2xl hover:border-red-100 dark:hover:border-red-900/40 hover:bg-white dark:hover:bg-gray-800/70 transition-all shadow-sm">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 flex items-center justify-center text-slate-400 dark:text-gray-400 font-bold text-xs uppercase shadow-sm">
                        {u.private_user?.first_name?.[0] || u.email?.[0] || "?"}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-slate-900 dark:text-white leading-none">
                          {u.private_user?.first_name} {u.private_user?.last_name || ""}
                        </div>
                        <div className="text-[10px] font-bold text-slate-400 dark:text-gray-500 mt-1 uppercase tracking-tight">{u.email}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {updatingUserId === u.user_id ? (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 dark:bg-red-950/40 rounded-xl border border-red-100 dark:border-red-900/50 animate-pulse">
                          <Loader2 size={12} className="text-primary-500 animate-spin" />
                          <span className="text-[8px] font-black text-red-600 dark:text-red-400 uppercase tracking-widest">Processing</span>
                        </div>
                      ) : (
                        <select
                          value={u.private_user?.role || 'employee'}
                          onChange={(e) => changeRole(u.user_id, e.target.value)}
                          className="appearance-none bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-red-600/5 focus:border-red-600/20 cursor-pointer hover:border-slate-300 dark:hover:border-gray-600 transition-all text-center min-w-[120px]"
                        >
                          <option value="owner">Owner</option>
                          <option value="admin">Admin</option>
                          <option value="manager">Manager</option>
                          <option value="employee">Employee</option>
                        </select>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-10 py-8 border-t border-slate-100 dark:border-gray-800 bg-slate-50 dark:bg-gray-800/40 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="text-emerald-500" />
            <span className="text-[9px] font-bold text-slate-400 dark:text-gray-500 uppercase tracking-widest">All changes auto-save</span>
          </div>
          <button
            onClick={onClose}
            className="px-8 py-3 rounded-2xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 text-[10px] font-black text-slate-600 dark:text-gray-300 uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-gray-800 hover:text-slate-900 dark:hover:text-white transition-all shadow-sm"
          >
            Finish Review
          </button>
        </div>
      </div>
    </div>
  );
}
