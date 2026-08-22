"use client";

import { useEffect } from "react";
import { X, User, Clock, MapPin, DollarSign, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { OvertimeRow } from "./types";

interface Props {
  row: OvertimeRow | null;
  onClose: () => void;
  onApprove: (id: number) => Promise<void>;
  onReject: (id: number) => Promise<void>;
  acting: boolean;
}

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString([], { dateStyle: "medium" });
}

export default function OvertimeDetailModal({ row, onClose, onApprove, onReject, acting }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!row) return null;

  const isPending = row.ot_status === "pending";
  const isApproved = row.ot_status === "approved";
  const isRejected = row.ot_status === "rejected";

  const locationStr = row.location
    ? [row.location.latitude, row.location.longitude].filter(Boolean).join(", ") ||
      JSON.stringify(row.location)
    : null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg">
          {/* Header */}
          <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
            <div>
              <div className="flex items-center gap-2">
                {isPending && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                    Pending
                  </span>
                )}
                {isApproved && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                    Approved
                  </span>
                )}
                {isRejected && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                    Rejected
                  </span>
                )}
                <span className="text-xs text-gray-400 dark:text-gray-500">#{row.timelog_id}</span>
              </div>
              <h2 className="mt-1 font-semibold text-gray-900 dark:text-gray-100">Overtime Session</h2>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors">
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div className="px-6 py-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wider mb-1">Employee</p>
                <p className="flex items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-gray-100">
                  <User size={13} className="text-gray-400" />{row.employee_name}
                  {row.employee_code && <span className="font-mono text-xs font-normal text-gray-400 dark:text-gray-500">{row.employee_code}</span>}
                </p>
                {row.job_title && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{row.job_title}</p>}
                {row.department && <p className="text-xs text-gray-400 dark:text-gray-500">{row.department}</p>}
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wider mb-1">Date</p>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{fmtDate(row.date)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wider mb-1">Clock In</p>
                <p className="flex items-center gap-1.5 text-sm text-gray-900 dark:text-gray-100">
                  <Clock size={13} className="text-gray-400" />{fmt(row.start_time)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wider mb-1">Clock Out</p>
                <p className="flex items-center gap-1.5 text-sm text-gray-900 dark:text-gray-100">
                  <Clock size={13} className="text-gray-400" />{fmt(row.end_time)}
                </p>
              </div>
            </div>

            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">OT Hours</p>
                <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {row.hours_worked != null ? `${row.hours_worked.toFixed(1)}h` : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Hourly Rate</p>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {row.hourly_rate != null
                    ? `${row.currency ?? ""} ${row.hourly_rate.toFixed(2)}`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Est. Cost (1.5×)</p>
                <p className="text-sm font-bold text-violet-600 dark:text-violet-400 flex items-center gap-1">
                  <DollarSign size={12} />
                  {row.estimated_cost != null
                    ? `${row.currency ?? ""} ${row.estimated_cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                    : "—"}
                </p>
              </div>
            </div>

            {row.overtime_reason && (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wider mb-1">Employee&apos;s Reason</p>
                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{row.overtime_reason}</p>
              </div>
            )}

            {locationStr && (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wider mb-1">GPS Location</p>
                <p className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
                  <MapPin size={13} />{locationStr}
                </p>
              </div>
            )}

            {row.marked_as_overtime_at && (
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Marked as OT: {fmt(row.marked_as_overtime_at)}
              </p>
            )}

            {isPending && (
              <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 rounded-xl px-4 py-3">
                <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Approving will notify the employee and lock the overtime rate at 1.5×.
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          {isPending && (
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-800">
              <button
                onClick={() => onReject(row.timelog_id)}
                disabled={acting}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
              >
                <XCircle size={14} />
                Reject
              </button>
              <button
                onClick={() => onApprove(row.timelog_id)}
                disabled={acting}
                className="flex items-center gap-1.5 px-5 py-2 text-sm font-medium bg-green-600 hover:bg-green-700 text-white rounded-xl disabled:opacity-50 transition-colors"
              >
                <CheckCircle size={14} />
                {acting ? "Saving…" : "Approve"}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
