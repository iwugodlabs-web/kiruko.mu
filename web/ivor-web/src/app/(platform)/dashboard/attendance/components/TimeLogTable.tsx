"use client";

import { TimeLogRow } from "./types";
import StatusBadge from "./StatusBadge";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Props {
  logs: TimeLogRow[];
  total: number;
  limit: number;
  offset: number;
  loading: boolean;
  onPageChange: (offset: number) => void;
  onRowClick: (log: TimeLogRow) => void;
}

function fmt(iso: string | null, type: "date" | "time" = "time"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return type === "date"
    ? d.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" })
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function TimeLogTable({ logs, total, limit, offset, loading, onPageChange, onRowClick }: Props) {
  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit);

  // Page-level aggregates
  const pageHours = logs.reduce((s, l) => s + (l.hours_worked ?? 0), 0);
  const pageBreakMins = logs.reduce((s, l) => s + (l.break_minutes ?? 0), 0);
  const pageOtCount = logs.filter((l) => l.is_overtime).length;

  const columns = [
    "Employee", "Dept", "Date", "Clock In", "Clock Out", "Break", "Total Hrs", "OT", "Status",
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-700">
              {columns.map((h) => (
                <th key={h} className="text-left py-2 px-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50 dark:border-gray-800">
                    {columns.map((__, j) => (
                      <td key={j} className="py-3 px-3">
                        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-20" />
                      </td>
                    ))}
                  </tr>
                ))
              : logs.length === 0
              ? (
                <tr>
                  <td colSpan={columns.length} className="text-center py-12 text-gray-500 dark:text-gray-400 text-sm">
                    No time logs found for the selected period.
                  </td>
                </tr>
              )
              : logs.map((log) => (
                  <tr
                    key={log.timelog_id}
                    onClick={() => onRowClick(log)}
                    className="border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-3 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">
                      <div className="flex items-center gap-2.5">
                        {log.kiosk_photo_path ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`/uploads/${log.kiosk_photo_path}`}
                            alt=""
                            className="w-7 h-7 rounded-full object-cover ring-1 ring-gray-200 dark:ring-gray-700 shrink-0"
                          />
                        ) : null}
                        <span>
                          {log.employee_name}
                          {log.employee_code && <span className="ml-1.5 font-mono text-xs text-gray-400 dark:text-gray-500">{log.employee_code}</span>}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-gray-600 dark:text-gray-400">{log.department ?? "—"}</td>
                    <td className="py-3 px-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">{fmt(log.start_time, "date")}</td>
                    <td className="py-3 px-3 font-mono text-gray-700 dark:text-gray-300">{fmt(log.start_time)}</td>
                    <td className="py-3 px-3 font-mono text-gray-700 dark:text-gray-300">{fmt(log.end_time)}</td>
                    <td className="py-3 px-3 text-gray-500 dark:text-gray-400">
                      {log.break_minutes > 0 ? `${log.break_minutes}m` : "—"}
                    </td>
                    <td className="py-3 px-3 font-medium text-gray-900 dark:text-gray-100">
                      {log.hours_worked != null ? `${log.hours_worked.toFixed(2)}h` : "—"}
                    </td>
                    <td className="py-3 px-3">
                      {log.is_overtime ? (
                        <span className={`text-xs font-semibold ${log.overtime_confirmed_by_employer ? "text-amber-600 dark:text-amber-400" : "text-amber-500 dark:text-amber-300"}`}>
                          {log.overtime_confirmed_by_employer ? "Approved" : "Pending"}
                        </span>
                      ) : log.auto_overtime ? (
                        <span className="text-xs font-semibold text-sky-600 dark:text-sky-400" title="Detected from worked hours beyond the daily limit — paid by payroll">
                          Auto{log.overtime_hours ? ` +${log.overtime_hours}h` : ""}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1.5">
                        <StatusBadge status={log.status} />
                        {log.is_late && (
                          <span
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md border border-orange-300 dark:border-orange-500/30 bg-orange-50 dark:bg-orange-500/15 text-orange-700 dark:text-orange-300"
                            title={log.late_reason ? `Late start — ${log.late_reason}` : "Late start (no reason given)"}
                          >
                            Late
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
          </tbody>
          {/* Summary row — only shown when there are logs */}
          {!loading && logs.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
                <td colSpan={5} className="py-2.5 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400">
                  Page total ({logs.length} records)
                </td>
                <td className="py-2.5 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400">
                  {pageBreakMins > 0 ? `${pageBreakMins}m` : "—"}
                </td>
                <td className="py-2.5 px-3 text-xs font-bold text-gray-900 dark:text-gray-100">
                  {pageHours.toFixed(2)}h
                </td>
                <td className="py-2.5 px-3 text-xs font-semibold text-amber-600 dark:text-amber-400">
                  {pageOtCount > 0 ? `${pageOtCount} OT` : "—"}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {offset + 1}–{Math.min(offset + limit, total)} of {total} records
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPageChange(Math.max(0, offset - limit))}
              disabled={offset === 0}
              className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs text-gray-700 dark:text-gray-300 px-2">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => onPageChange(offset + limit)}
              disabled={offset + limit >= total}
              className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
