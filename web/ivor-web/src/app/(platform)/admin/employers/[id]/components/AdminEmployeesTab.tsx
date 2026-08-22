"use client";
import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, ShieldX, Lock, Unlock, Trash2, UserPlus, RefreshCw } from "lucide-react";
import {
  getUsersByCompany,
  getDepartments,
  getCompanyGeofences,
  setUserEnabled,
  setUserVerified,
  setUserDepartment,
  setUserHomeSite,
  setCompanyUserRoles,
  removeCompanyUser,
  inviteCompanyUser,
  CompanyUser,
  CompanyGeofence,
  ShowDepartment,
} from "@/services/api";

type Props = { companyId: number; canManage?: boolean };

const ROLES = ["owner", "admin", "manager", "employee"] as const;

export default function AdminEmployeesTab({ companyId, canManage = true }: Props) {
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [departments, setDepartments] = useState<ShowDepartment[]>([]);
  const [sites, setSites] = useState<CompanyGeofence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [inviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("employee");
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const [u, d, s] = await Promise.all([
      getUsersByCompany(companyId),
      getDepartments(companyId),
      getCompanyGeofences(companyId),
    ]);
    if (Array.isArray(u)) setUsers(u);
    else setError(u.error);
    if (Array.isArray(d)) setDepartments(d);
    if (Array.isArray(s)) setSites(s);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 2500);
  };

  const onToggleEnabled = async (u: CompanyUser) => {
    setBusyId(u.user_id);
    const res = await setUserEnabled(u.user_id, !(u.user_enabled ?? true));
    if ("error" in res) flash(res.error);
    else await load();
    setBusyId(null);
  };

  const onToggleVerified = async (u: CompanyUser) => {
    setBusyId(u.user_id);
    const res = await setUserVerified(u.user_id, !(u.user_verified ?? false));
    if ("error" in res) flash(res.error);
    else await load();
    setBusyId(null);
  };

  const onChangeRole = async (u: CompanyUser, role: string) => {
    setBusyId(u.user_id);
    const res = await setCompanyUserRoles(companyId, u.user_id, [role as (typeof ROLES)[number]]);
    if ("error" in res) flash(res.error);
    else await load();
    setBusyId(null);
  };

  const onChangeDepartment = async (u: CompanyUser, deptId: string) => {
    setBusyId(u.user_id);
    const res = await setUserDepartment(u.user_id, deptId === "" ? null : Number(deptId));
    if ("error" in res) flash(res.error);
    else await load();
    setBusyId(null);
  };

  const onChangeSite = async (u: CompanyUser, siteId: string) => {
    setBusyId(u.user_id);
    const res = await setUserHomeSite(u.user_id, siteId === "" ? null : Number(siteId));
    if ("error" in res) flash(res.error);
    else await load();
    setBusyId(null);
  };

  const onRemove = async (u: CompanyUser) => {
    const name = u.user_name || u.email;
    if (!confirm(`Remove ${name} from this company? Their account is preserved and they can be re-invited later.`)) return;
    setBusyId(u.user_id);
    const res = await removeCompanyUser(companyId, u.user_id);
    if ("error" in res) flash(res.error);
    else {
      flash(`Removed ${name}`);
      await load();
    }
    setBusyId(null);
  };

  const onInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    const res = await inviteCompanyUser(companyId, { email: inviteEmail.trim(), role: inviteRole });
    if (res?.error) flash(res.error);
    else {
      flash(`Invited ${inviteEmail}`);
      setInviteEmail("");
      await load();
    }
    setInviting(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-gray-400 dark:text-gray-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {notice && (
        <div className="px-4 py-2 bg-slate-900 text-white text-xs rounded-lg inline-block">{notice}</div>
      )}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl text-sm text-red-700 dark:text-red-400">{error}</div>
      )}

      {!canManage && (
        <div className="px-4 py-2 bg-slate-50 dark:bg-gray-800/60 border border-slate-200 dark:border-gray-800 rounded-lg text-xs text-slate-500 dark:text-gray-400 inline-block">
          Read-only view — you don&apos;t have permission to manage this company&apos;s employees.
        </div>
      )}

      {/* Invite row */}
      {canManage && (
      <div className="flex flex-wrap items-end gap-3 p-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1">Invite employee</label>
          <input
            type="email"
            placeholder="email@company.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
          />
        </div>
        <select
          value={inviteRole}
          onChange={(e) => setInviteRole(e.target.value)}
          className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 dark:text-white"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <button
          onClick={onInvite}
          disabled={inviting || !inviteEmail.trim()}
          className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
        >
          {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
          Invite
        </button>
        <button onClick={load} className="p-2 text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-white" title="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
      )}

      {/* Employees table */}
      <div className="overflow-x-auto border border-gray-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-800">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3">Site / Branch</th>
              <th className="px-4 py-3">Status</th>
              {canManage && <th className="px-4 py-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr><td colSpan={canManage ? 7 : 6} className="px-4 py-10 text-center text-gray-400 dark:text-gray-500">No employees yet.</td></tr>
            )}
            {users.map((u) => {
              const pu = u.private_user;
              // Prefer real first/last name. user_name is auto-set to the
              // employee's email at invite time, so falling back to it
                  // here is what made the Name column show "iwugod@gmail.com"
              // for unprofiled employees. New priority:
              //   1. "First Last" if either part is filled
              //   2. user_name only if it's NOT an email (rare; legacy data)
              //   3. visible-italic "Awaiting profile" placeholder so the
              //      admin can see the row hasn't been set up
              const realName = pu
                ? [pu.first_name, pu.last_name].filter((s) => s && s.trim()).join(" ").trim()
                : "";
              const userNameIsEmail = !!(u.user_name && u.user_name.includes("@"));
              const hasName = realName || (u.user_name && !userNameIsEmail);
              const name = realName || (userNameIsEmail ? "" : u.user_name) || "";
              const currentRole = pu?.role || "employee";
              const busy = busyId === u.user_id;
              return (
                <tr key={u.user_id} className="border-b border-gray-50 dark:border-gray-800 last:border-0">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                    {hasName
                      ? name
                      : <span className="italic text-gray-400 dark:text-gray-500">Awaiting profile</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{u.email}</td>
                  <td className="px-4 py-3">
                    {canManage ? (
                      <select
                        value={currentRole}
                        disabled={busy}
                        onChange={(e) => onChangeRole(u, e.target.value)}
                        className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 dark:text-white text-xs"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs text-gray-700 dark:text-gray-200 capitalize">{currentRole}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {canManage ? (
                      <select
                        value={pu?.department_id ?? ""}
                        disabled={busy}
                        onChange={(e) => onChangeDepartment(u, e.target.value)}
                        className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 dark:text-white text-xs"
                      >
                        <option value="">— None —</option>
                        {departments.map((d) => (
                          <option key={d.department_id} value={d.department_id}>{d.name}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs text-gray-700 dark:text-gray-200">{departments.find((d) => d.department_id === pu?.department_id)?.name ?? "—"}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {canManage ? (
                      <select
                        value={pu?.home_geofence_id ?? ""}
                        disabled={busy}
                        onChange={(e) => onChangeSite(u, e.target.value)}
                        className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 dark:text-white text-xs"
                      >
                        <option value="">— None —</option>
                        {pu?.home_geofence_id != null && !sites.some((s) => s.geofence_id === pu.home_geofence_id) && (
                          <option value={pu.home_geofence_id} disabled>
                            {(sites.find((s) => s.geofence_id === pu.home_geofence_id)?.name ?? "Old branch")} (removed — reassign)
                          </option>
                        )}
                        {sites.map((s) => (
                          <option key={s.geofence_id} value={s.geofence_id}>{s.name}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs text-gray-700 dark:text-gray-200">{sites.find((s) => s.geofence_id === pu?.home_geofence_id)?.name ?? "—"}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${u.user_verified ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400" : "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400"}`}>
                        {u.user_verified ? "Verified" : "Unverified"}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${u.user_enabled ?? true ? "bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-400" : "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400"}`}>
                        {u.user_enabled ?? true ? "Active" : "Locked"}
                      </span>
                    </div>
                  </td>
                  {canManage && (
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => onToggleVerified(u)} disabled={busy} title={u.user_verified ? "Unverify" : "Verify"} className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-emerald-600">
                        {u.user_verified ? <ShieldX className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                      </button>
                      <button onClick={() => onToggleEnabled(u)} disabled={busy} title={u.user_enabled ?? true ? "Lock" : "Unlock"} className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-amber-600">
                        {u.user_enabled ?? true ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                      </button>
                      <button onClick={() => onRemove(u)} disabled={busy} title="Remove from company" className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-600">
                        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    </div>
                  </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
