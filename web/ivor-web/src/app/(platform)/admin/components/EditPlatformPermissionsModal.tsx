"use client";

/**
 * Platform-side role permission editor.
 *
 * Mirrors the company-side EditPermissionsModal at
 * /dashboard/settings/permissions/components/EditPermissionsModal.tsx but
 * targets the platform endpoints:
 *   GET  /admin/permissions
 *   GET  /admin/roles/{role_id}/permissions
 *   PUT  /admin/roles/{role_id}/permissions
 *
 * Unlike the company side (which embeds richer per-permission metadata),
 * the platform catalogue is just `{ group_name → [code, code, ...] }`.
 * We render the bare codes; the names are self-describing enough at this
 * scale (~25 codes).
 */

import { useEffect, useMemo, useState } from "react";
import { Loader2, ShieldCheck, X } from "lucide-react";
import { api } from "@/services/apiClient";


interface PlatformRole {
  role_id: number;
  name: string;
  system: boolean;
  permissions?: string[];
}

interface CatalogueGroup {
  name: string;
  permissions: string[];
}

interface Props {
  role: PlatformRole;
  onSaved: (roleId: number, permissions: string[]) => void;
  onClose: () => void;
}


export default function EditPlatformPermissionsModal({ role, onSaved, onClose }: Props) {
  const [groups, setGroups] = useState<CatalogueGroup[]>([]);
  const [loadingCatalogue, setLoadingCatalogue] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set(role.permissions ?? []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Fetch catalogue + the role's current permissions in parallel —
        // the latter is authoritative even if the list view's cache is stale.
        const [catResp, roleResp] = await Promise.all([
          api.get("/admin/permissions"),
          api.get(`/admin/roles/${role.role_id}/permissions`),
        ]);
        if (cancelled) return;
        const catData = catResp.data?.data ?? catResp.data;
        const roleData = roleResp.data?.data ?? roleResp.data;
        setGroups(catData?.groups ?? []);
        if (Array.isArray(roleData?.permissions)) {
          setSelected(new Set(roleData.permissions));
        }
      } catch (e: unknown) {
        const err = e as { response?: { data?: { detail?: unknown } }; message?: string };
        setError(
          (typeof err?.response?.data?.detail === "string" && err.response.data.detail)
            || err?.message
            || "Failed to load permissions catalogue.",
        );
      } finally {
        if (!cancelled) setLoadingCatalogue(false);
      }
    })();
    return () => { cancelled = true; };
  }, [role.role_id]);

  function toggle(code: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(code); else next.delete(code);
      return next;
    });
  }

  function toggleGroup(codes: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      codes.forEach((c) => (on ? next.add(c) : next.delete(c)));
      return next;
    });
  }

  const filteredGroups = useMemo(() => {
    if (!search) return groups;
    const q = search.toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        permissions: g.permissions.filter((p) => p.toLowerCase().includes(q)),
      }))
      .filter((g) => g.permissions.length > 0);
  }, [search, groups]);

  const totalSelected = selected.size;
  const totalAvailable = useMemo(
    () => groups.reduce((sum, g) => sum + g.permissions.length, 0),
    [groups],
  );

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await api.put(`/admin/roles/${role.role_id}/permissions`, {
        permissions: Array.from(selected),
      });
      onSaved(role.role_id, Array.from(selected));
      onClose();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: unknown } }; message?: string };
      const detail = err?.response?.data?.detail;
      setError(
        typeof detail === "string" ? detail
          : (Array.isArray(detail) ? detail.map((d: { msg?: string }) => d?.msg).filter(Boolean).join("; ") : err?.message)
          || "Failed to save permissions.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <ShieldCheck size={16} className="text-gray-400" />
                Edit Platform Permissions
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {role.name} · {loadingCatalogue ? "loading…" : `${totalSelected}/${totalAvailable} enabled`}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>

          {/* Search */}
          <div className="px-6 py-3 border-b border-gray-50 dark:border-gray-800">
            <input
              type="text"
              placeholder="Search permission codes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={loadingCatalogue}
              className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
            />
          </div>

          {/* Groups */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {loadingCatalogue ? (
              <div className="flex items-center justify-center py-12 text-gray-400">
                <Loader2 size={18} className="animate-spin" />
              </div>
            ) : (
              filteredGroups.map((g) => (
                <div key={g.name}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                      {g.name}
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => toggleGroup(g.permissions, true)}
                        disabled={role.system}
                        className="text-[10px] text-red-600 dark:text-red-400 hover:underline disabled:opacity-30"
                      >
                        All
                      </button>
                      <button
                        onClick={() => toggleGroup(g.permissions, false)}
                        disabled={role.system}
                        className="text-[10px] text-gray-400 hover:underline disabled:opacity-30"
                      >
                        None
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {g.permissions.map((code) => (
                      <label
                        key={code}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
                          selected.has(code)
                            ? "border-red-200 bg-red-50/40 dark:bg-red-950/30"
                            : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
                        } ${role.system ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:border-gray-300"}`}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(code)}
                          onChange={(e) => toggle(code, e.target.checked)}
                          disabled={role.system}
                          className="accent-red-600"
                        />
                        <span className="font-mono text-xs text-gray-700 dark:text-gray-200">{code}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))
            )}
            {role.system && (
              <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
                System role permissions cannot be edited from this UI. To change them, update the
                seed in <span className="font-mono">core/platform_permissions.py</span> and re-deploy.
              </p>
            )}
            {error && (
              <p className="text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-800">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || role.system || loadingCatalogue}
              className="px-5 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-xl disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving…" : "Update Permissions"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
