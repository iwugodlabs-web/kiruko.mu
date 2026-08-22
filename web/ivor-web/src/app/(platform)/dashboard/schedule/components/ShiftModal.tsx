"use client";

import { useState, useEffect, useMemo } from "react";
import { X, Trash2, CheckCircle, MapPin, Clock, Users, FileText, Timer } from "lucide-react";
import { Shift, ShiftFormData, ScheduleEmployee, STATUS_CONFIG, toLocalDatetimeStr } from "./types";

interface Props {
  shift: Shift | null;          // null = create mode
  defaultDate: string | null;   // YYYY-MM-DD for new shifts
  employees: ScheduleEmployee[];
  companyId: number;
  onSave: (data: ShiftFormData, shiftId?: number) => Promise<void>;
  onDelete: (shiftId: number) => Promise<void>;
  onClose: () => void;
}

const inputCls = "w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-400 dark:placeholder:text-gray-600";
const labelCls = "block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5";

function buildDefault(shift: Shift | null, defaultDate: string | null): ShiftFormData {
  if (shift) {
    return {
      title: shift.title,
      location: shift.location,
      hours: shift.hours ?? "",
      notes: shift.notes ?? "",
      start_time: toLocalDatetimeStr(shift.start_time),
      end_time: toLocalDatetimeStr(shift.end_time),
      assigned_employee_ids: shift.assigned_employees.map((e) => e.private_user_id),
      status: shift.status,
    };
  }
  const base = defaultDate ?? new Date().toISOString().slice(0, 10);
  return {
    title: "",
    location: "",
    hours: "",
    notes: "",
    start_time: `${base}T08:00`,
    end_time: `${base}T16:00`,
    assigned_employee_ids: [],
    status: "pending",
  };
}

function computeDuration(start: string, end: string): string {
  try {
    const diff = new Date(end).getTime() - new Date(start).getTime();
    if (diff <= 0) return "";
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    return h > 0 ? `${h}h ${m > 0 ? `${m}m` : ""}`.trim() : `${m}m`;
  } catch { return ""; }
}

export default function ShiftModal({ shift, defaultDate, employees, onSave, onDelete, onClose }: Props) {
  const [form, setForm] = useState<ShiftFormData>(() => buildDefault(shift, defaultDate));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const duration = useMemo(() => computeDuration(form.start_time, form.end_time), [form.start_time, form.end_time]);

  useEffect(() => {
    setForm(buildDefault(shift, defaultDate));
    setConfirmDelete(false);
  }, [shift, defaultDate]);

  // Lock body scroll while modal is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function patch(updates: Partial<ShiftFormData>) {
    setForm((prev) => ({ ...prev, ...updates }));
  }

  function toggleEmployee(id: number) {
    setForm((prev) => {
      const ids = prev.assigned_employee_ids;
      return {
        ...prev,
        assigned_employee_ids: ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id],
      };
    });
  }

  async function handleSave() {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      await onSave(form, shift?.schedule_id);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!shift) return;
    setDeleting(true);
    try {
      await onDelete(shift.schedule_id);
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  const isCreate = !shift;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">
              {isCreate ? "New Shift" : "Edit Shift"}
            </h2>
            <div className="flex items-center gap-2">
              {!isCreate && !confirmDelete && (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              )}
              <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors">
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {confirmDelete && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 space-y-3">
                <p className="text-sm font-semibold text-red-700 dark:text-red-400">Delete this shift?</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Assigned employees will be notified.</p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmDelete(false)} className="flex-1 px-3 py-2 text-xs font-medium border border-red-200 dark:border-red-800 rounded-lg text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors">
                    Cancel
                  </button>
                  <button onClick={handleDelete} disabled={deleting} className="flex-1 px-3 py-2 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50 transition-colors">
                    {deleting ? "Deleting…" : "Confirm Delete"}
                  </button>
                </div>
              </div>
            )}

            <div>
              <label className={labelCls}>Shift Title <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => patch({ title: e.target.value })}
                placeholder="Morning Housekeeping"
                className={inputCls}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className={labelCls + " mb-0"}><Clock size={10} className="inline mr-1" />Time</label>
                {duration && (
                  <span className="flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 px-2 py-0.5 rounded-lg">
                    <Timer size={10} />
                    {duration}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-1">Start</p>
                  <input type="datetime-local" value={form.start_time} onChange={(e) => patch({ start_time: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-1">End</p>
                  <input type="datetime-local" value={form.end_time} onChange={(e) => patch({ end_time: e.target.value })} className={inputCls} />
                </div>
              </div>
            </div>

            <div>
              <label className={labelCls}><MapPin size={10} className="inline mr-1" />Location</label>
              <input type="text" value={form.location} onChange={(e) => patch({ location: e.target.value })} placeholder="Main building, Floor 2" className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Status</label>
              <select value={form.status} onChange={(e) => patch({ status: e.target.value as ShiftFormData["status"] })} className={inputCls}>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelCls}><FileText size={10} className="inline mr-1" />Notes</label>
              <textarea value={form.notes} onChange={(e) => patch({ notes: e.target.value })} rows={2} placeholder="Any notes for the team…" className={`${inputCls} resize-none`} />
            </div>

            {/* Employee assignment */}
            <div>
              <label className={labelCls}><Users size={10} className="inline mr-1" />Assign Employees</label>
              {employees.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-gray-500">No employees in this company yet.</p>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {employees.map((emp) => {
                    const selected = form.assigned_employee_ids.includes(emp.private_user_id);
                    return (
                      <label key={emp.private_user_id} className={`flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer transition-colors ${selected ? "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800" : "hover:bg-gray-50 dark:hover:bg-gray-800 border border-transparent"}`}>
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleEmployee(emp.private_user_id)}
                          className="accent-blue-600"
                        />
                        <div className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-600 dark:text-gray-300 uppercase shrink-0">
                          {emp.first_name?.[0]}{emp.last_name?.[0]}
                        </div>
                        <span className="text-sm text-gray-800 dark:text-gray-200">{emp.first_name} {emp.last_name}</span>
                        {selected && <CheckCircle size={14} className="text-blue-500 ml-auto shrink-0" />}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-800">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !form.title.trim()}
              className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-xl disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving…" : isCreate ? "Create Shift" : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
