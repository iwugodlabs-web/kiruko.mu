"use client";

import { useState, useEffect } from "react";
import { X, Plus } from "lucide-react";
import { PermissionGroup } from "./types";
import PermissionGroupBlock from "./PermissionGroup";

interface Props {
  groups: PermissionGroup[];
  companyId: number;
  onCreated: (name: string, description: string, permissions: string[]) => Promise<void>;
  onClose: () => void;
}

const inputCls =
  "w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 " +
  "text-sm text-gray-900 dark:text-gray-100 px-3 py-2.5 focus:outline-none focus:ring-2 " +
  "focus:ring-blue-500 placeholder:text-gray-400 dark:placeholder:text-gray-600";

export default function CreateRoleModal({ groups, onCreated, onClose }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onCreated(name.trim(), description.trim(), Array.from(selected));
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Failed to create role.");
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
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Plus size={16} className="text-gray-400" />
              Create Role
            </h2>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors">
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleCreate} className="flex-1 flex flex-col overflow-hidden">
            {/* Name + description */}
            <div className="px-6 py-4 border-b border-gray-50 dark:border-gray-800 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                    Role Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    autoFocus
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Payroll Accountant"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                    Description
                  </label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What does this role do?"
                    className={inputCls}
                  />
                </div>
              </div>
              <p className="text-xs text-gray-400">
                {selected.size} permission{selected.size !== 1 ? "s" : ""} selected
              </p>
            </div>

            {/* Permissions */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {groups.map((g) => (
                <PermissionGroupBlock
                  key={g.group}
                  group={g.group}
                  permissions={g.permissions}
                  selected={selected}
                  onChange={toggle}
                />
              ))}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800">
              {error && <p className="text-xs text-red-600 dark:text-red-400 mb-3">{error}</p>}
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !name.trim()}
                  className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-xl disabled:opacity-50 transition-colors"
                >
                  {saving ? "Creating…" : "Create Role"}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
