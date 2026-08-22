"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/services/apiClient";
import { fetchCompanyUsers } from "@/services/api";
import { toast } from "sonner";
import {
  Shield, Plus, Pencil, Trash2, RefreshCw,
  Users, ShieldCheck, Lock, RotateCcw,
} from "lucide-react";
import {
  CompanyRole, PermissionsResponse, CompanyUser,
  permLabel, roleBadgeColor,
} from "./types";
import EditPermissionsModal from "./EditPermissionsModal";
import CreateRoleModal from "./CreateRoleModal";

type Tab = "roles" | "permissions" | "users";

interface RawUser {
  private_user?: {
    private_user_id: number;
    first_name?: string;
    last_name?: string;
    role?: string;
  };
  job?: { job_title?: string };
}

export default function PermissionManagerSection() {
  const { user } = useAuth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const companyId = (user as any)?.company?.company_id as number | undefined;
  // Self-guard — a user can't change their OWN role from this table (the
  // backend also rejects it). Closes the self-escalation path.
  const myPrivateUserId = user?.private_user?.private_user_id;

  const [tab, setTab] = useState<Tab>("roles");
  const [roles, setRoles] = useState<CompanyRole[]>([]);
  const [permsData, setPermsData] = useState<PermissionsResponse | null>(null);
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);

  // Modals
  const [editRole, setEditRole] = useState<CompanyRole | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [assigningUser, setAssigningUser] = useState<number | null>(null);

  const fetchAll = useCallback(
    async (silent = false) => {
      if (!companyId) return;
      if (!silent) setLoading(true);

      // Fetch each resource independently so a single failure doesn't break the whole page
      const results = await Promise.allSettled([
        api.get(`/company/${companyId}/roles`),
        api.get(`/company/${companyId}/permissions`),
        fetchCompanyUsers(companyId),
      ]);

      const [rolesResult, permsResult, usersResult] = results;

      if (rolesResult.status === "fulfilled") {
        setRoles(rolesResult.value.data ?? []);
      } else {
        if (!silent) console.warn("Roles endpoint unavailable:", rolesResult.reason);
        setRoles([]);
      }

      if (permsResult.status === "fulfilled") {
        setPermsData(permsResult.value.data ?? null);
      } else {
        if (!silent) console.warn("Permissions endpoint unavailable:", permsResult.reason);
        setPermsData(null);
      }

      if (usersResult.status === "fulfilled") {
        // fetchCompanyUsers returns array directly (not an axios Response)
        const usersData = usersResult.value;
        if (Array.isArray(usersData)) {
          const base = (usersData as RawUser[])
            .filter((u) => u.private_user?.private_user_id)
            .map((u) => ({
              private_user_id: u.private_user!.private_user_id,
              first_name: u.private_user!.first_name ?? "",
              last_name: u.private_user!.last_name ?? "",
              role: "",
              job_title: u.job?.job_title ?? null,
            }));
          // Drive the displayed/assignable role from the SYSTEM role catalogue
          // (company_user_roles), not the legacy private_user.role scalar.
          const enriched = await Promise.all(
            base.map(async (u) => {
              try {
                const res = await api.get(
                  `/user/company/${companyId}/users/${u.private_user_id}/roles`
                );
                const cat: string | undefined = (res.data?.roles ?? [])[0];
                return { ...u, role: cat ?? "" };
              } catch {
                return u;
              }
            })
          );
          setCompanyUsers(enriched);
        }
      } else {
        if (!silent) console.warn("Users fetch failed:", usersResult.reason);
        setCompanyUsers([]);
      }

      if (!silent) setLoading(false);
    },
    [companyId]
  );

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function handleCreateRole(name: string, description: string, permissions: string[]) {
    await api.post(`/company/${companyId}/roles`, { name, description, permissions });
    toast.success(`Role "${name}" created.`);
    fetchAll(true).catch(() => {}); // refresh in background; don't propagate to modal
  }

  async function handleDeleteRole(role: CompanyRole) {
    if (!confirm(`Delete role "${role.name}"? This cannot be undone.`)) return;
    setDeletingId(role.role_id);
    try {
      await api.delete(`/company/${companyId}/roles/${role.role_id}`);
      setRoles((prev) => prev.filter((r) => r.role_id !== role.role_id));
      toast.success(`"${role.name}" deleted.`);
    } catch {
      toast.error("Could not delete role.");
    } finally {
      setDeletingId(null);
    }
  }

  function handlePermsSaved(roleId: number, permissions: string[]) {
    setRoles((prev) =>
      prev.map((r) =>
        r.role_id === roleId
          ? { ...r, permissions, permission_count: permissions.length }
          : r
      )
    );
    toast.success("Permissions updated.");
  }

  async function handleRoleChange(privateUserId: number, newRole: string) {
    setAssigningUser(privateUserId);
    try {
      // The role endpoint lives on the user router (prefix /user) → its real
      // path is /user/company/{id}/users/{id}/role. Calling /company/... 404s.
      await api.patch(`/user/company/${companyId}/users/${privateUserId}/role`, { role: newRole });
      setCompanyUsers((prev) =>
        prev.map((u) => (u.private_user_id === privateUserId ? { ...u, role: newRole } : u))
      );
      toast.success("Role updated.");
    } catch {
      toast.error("Failed to update role.");
    } finally {
      setAssigningUser(null);
    }
  }

  if (!companyId) return null;

  const totalUsers = companyUsers.length;
  const usersWithRole = companyUsers.filter((u) => u.role).length;

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "roles", label: "Roles Management", icon: <Shield size={14} /> },
    { id: "permissions", label: "Permissions Overview", icon: <ShieldCheck size={14} /> },
    { id: "users", label: "User Management", icon: <Users size={14} /> },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Shield size={18} className="text-gray-400" />
            Permission Manager
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Manage roles, permissions, and user access across your company.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => { setSpinning(true); await fetchAll(true); setSpinning(false); }}
            disabled={spinning}
            title="Sync permissions"
            className="flex items-center gap-1.5 p-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          >
            <RotateCcw size={14} className={spinning ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors"
          >
            <Plus size={14} />
            Create Role
          </button>
        </div>
      </div>

      {/* KPI cards */}
      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Total Roles", value: roles.length, color: "text-blue-600 dark:text-blue-400" },
            { label: "Permissions", value: permsData?.total ?? 0, color: "text-indigo-600 dark:text-indigo-400" },
            { label: "Total Users", value: totalUsers, color: "text-green-600 dark:text-green-400" },
            { label: "With Custom Role", value: usersWithRole, color: "text-amber-600 dark:text-amber-400" },
          ].map((card) => (
            <div key={card.label} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
              <p className="text-xs text-gray-500 dark:text-gray-400">{card.label}</p>
              <p className={`text-2xl font-bold mt-1 ${card.color}`}>{card.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-100 dark:border-gray-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? "border-blue-600 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── Tab: Roles Management ─────────────────────────────────────────── */}
      {tab === "roles" && (
        <div className="space-y-2">
          {loading ? (
            [...Array(4)].map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
            ))
          ) : roles.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-gray-400 text-sm">
              No roles yet. Create your first role above.
            </div>
          ) : (
            roles.map((role) => (
              <div
                key={role.role_id}
                className="flex items-center gap-4 px-4 py-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 group"
              >
                <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center shrink-0">
                  {role.is_system ? (
                    <Lock size={15} className="text-gray-400" />
                  ) : (
                    <Shield size={15} className="text-gray-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{role.name}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${roleBadgeColor(role.name)}`}>
                      {role.is_system ? "System" : "Custom"}
                    </span>
                  </div>
                  {role.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{role.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-gray-400">{role.permission_count} perms</span>
                  <span className="text-xs text-gray-400">{role.user_count} users</span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => setEditRole(role)}
                      className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                      title="Edit permissions"
                    >
                      <Pencil size={13} />
                    </button>
                    {!role.is_system && (
                      <button
                        onClick={() => handleDeleteRole(role)}
                        disabled={deletingId === role.role_id}
                        className="p-2 rounded-lg text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 transition-colors disabled:opacity-40"
                        title="Delete role"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ─── Tab: Permissions Overview ─────────────────────────────────────── */}
      {tab === "permissions" && (
        <div className="space-y-4">
          {loading ? (
            <div className="h-64 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
          ) : permsData ? (
            permsData.groups.map((g) => (
              <div key={g.group} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
                <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{g.group}</p>
                  <span className="text-[10px] text-gray-400">{g.permissions.length} permissions</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-0 divide-y divide-gray-50 dark:divide-gray-800/60">
                  {g.permissions.map((perm) => (
                    <div
                      key={perm.key}
                      className="flex items-center justify-between px-3 py-2.5"
                    >
                      <span className="text-xs text-gray-700 dark:text-gray-300">{permLabel(perm.key)}</span>
                      {perm.used_by_roles > 0 ? (
                        <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 rounded-md shrink-0">
                          {perm.used_by_roles} role{perm.used_by_roles !== 1 ? "s" : ""}
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-300 dark:text-gray-600">unused</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : null}
        </div>
      )}

      {/* ─── Tab: User Management ─────────────────────────────────────────── */}
      {tab === "users" && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
          {loading ? (
            <div className="h-64 animate-pulse bg-gray-100 dark:bg-gray-800" />
          ) : companyUsers.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
              No employees found.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-100 dark:border-gray-700">
                <tr>
                  {["Employee", "Job Title", "Current Role", "Change Role"].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {companyUsers.map((emp) => (
                  <tr key={emp.private_user_id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase shrink-0">
                          {emp.first_name?.[0]}{emp.last_name?.[0]}
                        </div>
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {emp.first_name} {emp.last_name}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                      {emp.job_title ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-1 rounded-md ${emp.role ? roleBadgeColor(emp.role) : "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400"}`}>
                        {roles.find((r) => r.name.toLowerCase().replace(/ /g, "_") === emp.role)?.name ?? (emp.role || "Unassigned")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {emp.private_user_id === myPrivateUserId ? (
                        <span className="text-xs italic text-gray-400 dark:text-gray-500">
                          You — another admin must change your role
                        </span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <select
                            defaultValue={emp.role}
                            disabled={assigningUser === emp.private_user_id}
                            onChange={(e) => handleRoleChange(emp.private_user_id, e.target.value)}
                            className="text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          >
                            {/* All roles come from the company catalogue in the DB
                                (system + custom). The backend accepts any of these
                                by normalized name (user.py set_company_user_role). */}
                            {roles.length === 0 && <option value={emp.role}>{emp.role}</option>}
                            {roles.map((r) => (
                              <option key={r.role_id} value={r.name.toLowerCase().replace(/ /g, "_")}>
                                {r.name}
                              </option>
                            ))}
                          </select>
                          {assigningUser === emp.private_user_id && (
                            <div className="w-3.5 h-3.5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Modals */}
      {editRole && permsData && (
        <EditPermissionsModal
          role={editRole}
          groups={permsData.groups}
          onSaved={handlePermsSaved}
          onClose={() => setEditRole(null)}
        />
      )}

      {showCreate && (
        <CreateRoleModal
          groups={permsData?.groups ?? []}
          companyId={companyId!}
          onCreated={handleCreateRole}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
