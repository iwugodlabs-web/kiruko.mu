"use client";

/**
 * Employer-facing edit for a job's work schedule (start/end time + which
 * days of the week are worked). Modal, not inline — mirrors the Salary
 * card's edit pattern (SalaryConfigModal) rather than the page-wide
 * "Edit Profile" inline toggle Job Title uses, since this is a
 * multi-field structured input (day picker + two time pickers), same
 * reasoning that led Salary to a dedicated modal.
 *
 * Saves via PUT /job/simple/{job_id} — accepts a raw dict and sets any
 * matching Job attribute, already used elsewhere on this page (see
 * MaxShiftPanel's PATCH /job/{id}/details for the analogous single-field
 * pattern). No new backend endpoint needed.
 */

import { useEffect, useState } from "react";
import { X, Clock, Calendar, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../../services/apiClient";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export interface ScheduleValue {
  work_start_time: string | null;
  work_end_time: string | null;
  work_days: Record<string, string> | null;
}

interface Props {
  jobId: number;
  initial: ScheduleValue;
  onClose: () => void;
  onSaved: (value: ScheduleValue) => void;
}

// job.work_start_time/work_end_time are stored as "HH:MM:SS" (SQL TIME);
// <input type="time"> wants "HH:MM".
function toInputTime(t: string | null): string {
  return t ? t.slice(0, 5) : "";
}

export default function ScheduleEditModal({ jobId, initial, onClose, onSaved }: Props) {
  const [startTime, setStartTime] = useState(toInputTime(initial.work_start_time));
  const [endTime, setEndTime] = useState(toInputTime(initial.work_end_time));
  const [activeDays, setActiveDays] = useState<Set<string>>(
    new Set(Object.entries(initial.work_days || {}).filter(([, v]) => v).map(([d]) => d)),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  function toggleDay(day: string) {
    setActiveDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!startTime || !endTime) {
      setError("Both start and end time are required.");
      return;
    }
    if (activeDays.size === 0) {
      setError("Select at least one work day.");
      return;
    }
    setSaving(true);
    setError(null);
    const work_days: Record<string, string> = {};
    for (const day of DAYS) {
      if (activeDays.has(day)) work_days[day] = "8";
    }
    try {
      await api.put(`/job/simple/${jobId}`, {
        work_start_time: startTime,
        work_end_time: endTime,
        work_days,
      });
      onSaved({ work_start_time: startTime, work_end_time: endTime, work_days });
      toast.success("Schedule updated");
      onClose();
    } catch (err: unknown) {
      const e2 = err as { response?: { data?: { detail?: string } } };
      const msg = e2.response?.data?.detail ?? "Failed to save schedule.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Edit Schedule</h2>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors">
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                  <Clock size={12} /> Start time
                </label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                  <Clock size={12} /> End time
                </label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                <Calendar size={12} /> Work days
              </label>
              <div className="flex flex-wrap gap-2">
                {DAYS.map((day) => {
                  const active = activeDays.has(day);
                  return (
                    <button
                      type="button"
                      key={day}
                      onClick={() => toggleDay(day)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        active
                          ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 border-gray-900 dark:border-gray-100"
                          : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700"
                      }`}
                    >
                      {day.slice(0, 3)}
                    </button>
                  );
                })}
              </div>
            </div>

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          </form>

          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 rounded-b-2xl">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit as unknown as React.MouseEventHandler}
              disabled={saving}
              className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving ? "Saving…" : "Save Schedule"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
