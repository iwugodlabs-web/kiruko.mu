"use client";

import { useState, useEffect } from "react";
import { X, ShieldCheck } from "lucide-react";
import { CompanyRole, PermissionGroup } from "./types";
import PermissionGroupBlock from "./PermissionGroup";
import { api } from "@/services/apiClient";

interface Props {
  role: CompanyRole;
  groups: PermissionGroup[];
  onSaved: (roleId: number, permissions: string[]) => void;
  onClose: () => void;
}

export default function EditPermissionsModal({ role, groups, onSaved, onClose }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set(role.permissions));
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  // Companies CAN tune their roles' permissions (incl. seeded system roles like
  // Manager/Supervisor) — the backend allows it. The one exception is the Owner
  // role, which stays full-access so a company can't lock itself out.
  const locked = (role.name ?? "").trim().toLowerCase() === "owner";

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function toggle(key: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      checked ? next.add(key) : next.delete(key);
      return next;
    });
  }

  function toggleGroup(perms: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      perms.forEach((p) => (on ? next.add(p) : next.delete(p)));
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.put(`/company/${role.company_id}/roles/${role.role_id}/permissions`, {
        permissions: Array.from(selected),
      });
      onSaved(role.role_id, Array.from(selected));
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const filteredGroups = search
    ? groups.map((g) => ({
        ...g,
        permissions: g.permissions.filter((p) =>
          p.key.toLowerCase().includes(search.toLowerCase())
        ),
      })).filter((g) => g.permissions.length > 0)
    : groups;

  const totalSelected = selected.size;
  const totalPerms = groups.reduce((a, g) => a + g.permissions.length, 0);

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
                Edit Permissions
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {role.name} · {totalSelected}/{totalPerms} permissions enabled
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Search */}
          <div className="px-6 py-3 border-b border-gray-50 dark:border-gray-800">
            <input
              type="text"
              placeholder="Search permissions…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Permission groups */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
            {filteredGroups.map((g) => (
              <div key={g.group}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                    {g.group}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => toggleGroup(g.permissions.map((p) => p.key), true)}
                      className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      All
                    </button>
                    <button
                      onClick={() => toggleGroup(g.permissions.map((p) => p.key), false)}
                      className="text-[10px] text-gray-400 hover:underline"
                    >
                      None
                    </button>
                  </div>
                </div>
                <PermissionGroupBlock
                  group={g.group}
                  permissions={g.permissions}
                  selected={selected}
                  onChange={toggle}
                  readOnly={locked}
                />
              </div>
            ))}
            {locked && (
              <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
                The Owner role always has full access and can&apos;t be changed.
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
              disabled={saving || locked}
              className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-xl disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving…" : "Update Permissions"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
