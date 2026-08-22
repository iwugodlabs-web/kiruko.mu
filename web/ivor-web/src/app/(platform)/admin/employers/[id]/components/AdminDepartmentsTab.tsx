"use client";
import { useEffect, useState } from "react";
import { Loader2, Plus, Pencil, Trash2, Check, X } from "lucide-react";
import {
  getDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  ShowDepartment,
} from "@/services/api";

type Props = { companyId: number; canManage?: boolean };

export default function AdminDepartmentsTab({ companyId, canManage = true }: Props) {
  const [departments, setDepartments] = useState<ShowDepartment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const d = await getDepartments(companyId);
    if (Array.isArray(d)) setDepartments(d);
    else setError(d.error);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const onCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    const res = await createDepartment(companyId, newName.trim());
    if ("error" in res) setError(res.error);
    else {
      setNewName("");
      await load();
    }
    setCreating(false);
  };

  const onSaveEdit = async (id: number) => {
    if (!editName.trim()) return;
    setBusyId(id);
    const res = await updateDepartment(companyId, id, editName.trim());
    if ("error" in res) setError(res.error);
    else {
      setEditingId(null);
      await load();
    }
    setBusyId(null);
  };

  const onDelete = async (d: ShowDepartment) => {
    if (!confirm(`Delete department "${d.name}"?`)) return;
    setBusyId(d.department_id);
    const res = await deleteDepartment(companyId, d.department_id);
    if ("error" in res) setError(res.error);
    else await load();
    setBusyId(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-gray-400 dark:text-gray-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl text-sm text-red-700 dark:text-red-400">{error}</div>
      )}

      {!canManage && (
        <div className="px-4 py-2 bg-slate-50 dark:bg-gray-800/60 border border-slate-200 dark:border-gray-800 rounded-lg text-xs text-slate-500 dark:text-gray-400 inline-block">
          Read-only view — you don&apos;t have permission to manage this company&apos;s departments.
        </div>
      )}

      {canManage && (
      <div className="flex items-end gap-3 p-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
        <div className="flex-1">
          <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1">New department</label>
          <input
            placeholder="e.g. Engineering"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onCreate()}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
          />
        </div>
        <button
          onClick={onCreate}
          disabled={creating || !newName.trim()}
          className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
        >
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Add
        </button>
      </div>
      )}

      <div className="border border-gray-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900 divide-y divide-gray-50 dark:divide-gray-800">
        {departments.length === 0 && (
          <div className="px-4 py-10 text-center text-gray-400 dark:text-gray-500 text-sm">No departments yet.</div>
        )}
        {departments.map((d) => {
          const busy = busyId === d.department_id;
          const editing = editingId === d.department_id;
          return (
            <div key={d.department_id} className="flex items-center justify-between px-4 py-3">
              {editing ? (
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onSaveEdit(d.department_id)}
                  autoFocus
                  className="flex-1 mr-3 px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-800 dark:text-white"
                />
              ) : (
                <span className="font-medium text-gray-900 dark:text-white">{d.name}</span>
              )}
              {canManage && (
              <div className="flex items-center gap-1">
                {editing ? (
                  <>
                    <button onClick={() => onSaveEdit(d.department_id)} disabled={busy} className="p-1.5 text-emerald-600 hover:text-emerald-700">
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    </button>
                    <button onClick={() => setEditingId(null)} className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-white">
                      <X className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => { setEditingId(d.department_id); setEditName(d.name); }} className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-slate-900 dark:hover:text-white">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => onDelete(d)} disabled={busy} className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-600">
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </>
                )}
              </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
