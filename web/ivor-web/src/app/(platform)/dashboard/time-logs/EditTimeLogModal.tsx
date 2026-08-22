"use client";

import { useState } from "react";
import { AlertTriangle, Pencil } from "lucide-react";
import { timeLogReview, type TimeLogReviewItem } from "@/services/payroll-api";
import { toast } from "sonner";

function isError<T>(v: T | { error: string; status?: number }): v is { error: string; status?: number } {
  return typeof v === "object" && v !== null && "error" in v;
}

/** ISO string -> value for <input type="datetime-local"> (browser-local time). */
function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EditTimeLogButton({
  log,
  onSaved,
}: {
  log: TimeLogReviewItem;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(() => toLocalInputValue(log.start_time));
  const [end, setEnd] = useState(() => toLocalInputValue(log.end_time));
  const [submitting, setSubmitting] = useState(false);

  function openModal() {
    setStart(toLocalInputValue(log.start_time));
    setEnd(toLocalInputValue(log.end_time));
    setOpen(true);
  }

  async function save() {
    if (!start || !end) {
      toast.error("Both clock-in and clock-out times are required");
      return;
    }
    const startIso = new Date(start).toISOString();
    const endIso = new Date(end).toISOString();
    if (new Date(endIso) <= new Date(startIso)) {
      toast.error("Clock-out must be after clock-in");
      return;
    }
    setSubmitting(true);
    const r = await timeLogReview.patch(log.timelog_id, {
      start_time: startIso,
      end_time: endIso,
    });
    setSubmitting(false);
    if (isError(r)) { toast.error(r.error); return; }
    toast.success("Clock-in updated");
    setOpen(false);
    onSaved();
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        title="Edit clock-in / clock-out time"
        className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-gray-700 px-2 py-0.5 text-xs text-zinc-600 dark:text-gray-300 hover:bg-zinc-50 dark:hover:bg-gray-800"
      >
        <Pencil className="h-3 w-3" /> Edit
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-sm">
            <div className="px-6 py-4 border-b border-zinc-100 dark:border-gray-800">
              <h3 className="text-base font-semibold text-zinc-900 dark:text-white">Edit clock-in</h3>
              <p className="text-xs text-zinc-500 dark:text-gray-400 mt-1">
                {log.employee_name} · {log.day}
              </p>
            </div>
            <div className="px-6 py-4 space-y-3 text-sm">
              {log.admin_approved && (
                <div className="flex items-start gap-2 rounded bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 px-3 py-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800 dark:text-amber-400">
                    This entry is already approved. Saving a change will move it
                    back to Pending — you&apos;ll need to re-approve it.
                  </p>
                </div>
              )}
              <label className="block">
                <span className="text-xs text-zinc-500 dark:text-gray-400">Clock in</span>
                <input
                  type="datetime-local"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  className="mt-1 w-full rounded-md border border-zinc-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs text-zinc-500 dark:text-gray-400">Clock out</span>
                <input
                  type="datetime-local"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  className="mt-1 w-full rounded-md border border-zinc-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white px-3 py-2 text-sm"
                />
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-zinc-100 dark:border-gray-800 px-6 py-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={submitting}
                className="rounded-md border border-zinc-200 dark:border-gray-700 px-3 py-1.5 text-sm text-zinc-700 dark:text-gray-200 hover:bg-zinc-50 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={submitting}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
