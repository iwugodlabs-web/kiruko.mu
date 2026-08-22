"use client";

import { TimeLogRow } from "./types";
import StatusBadge from "./StatusBadge";
import { MapPin, Clock } from "lucide-react";

interface Props {
  // Expects the FULL set of logs for the date range (not a single paginated
  // page) so every active session is shown, not just those on page 1.
  logs: TimeLogRow[];
  loading: boolean;
  onRowClick: (log: TimeLogRow) => void;
}

function formatDuration(startIso: string): string {
  const start = new Date(startIso);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  if (diffMs < 0) return "—";
  const h = Math.floor(diffMs / 3600000);
  const m = Math.floor((diffMs % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function LiveSessionsTable({ logs, loading, onRowClick }: Props) {
  const active = logs.filter((l) => l.status === "active");

  if (!loading && active.length === 0) {
    return (
      <div className="text-center py-10 text-gray-500 dark:text-gray-400 text-sm">
        No employees currently clocked in.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 dark:border-gray-700">
            {["Employee", "Job Title", "Department", "Clocked In", "Duration", "Location", "Status"].map((h) => (
              <th key={h} className="text-left py-2 px-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-50 dark:border-gray-800">
                  {Array.from({ length: 7 }).map((__, j) => (
                    <td key={j} className="py-3 px-3">
                      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-24" />
                    </td>
                  ))}
                </tr>
              ))
            : active.map((log) => {
                const locationStr =
                  log.location && typeof log.location === "object"
                    ? (log.location as Record<string, unknown>).address as string ?? "GPS recorded"
                    : null;
                return (
                  <tr
                    key={log.timelog_id}
                    onClick={() => onRowClick(log)}
                    className="border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-3 font-medium text-gray-900 dark:text-gray-100">
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
                    <td className="py-3 px-3 text-gray-600 dark:text-gray-400">{log.job_title ?? "—"}</td>
                    <td className="py-3 px-3 text-gray-600 dark:text-gray-400">{log.department ?? "—"}</td>
                    <td className="py-3 px-3 text-gray-600 dark:text-gray-400">
                      <span className="flex items-center gap-1">
                        <Clock size={12} className="text-gray-400" />
                        {formatTime(log.start_time)}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono text-gray-700 dark:text-gray-300">
                      {log.start_time ? formatDuration(log.start_time) : "—"}
                    </td>
                    <td className="py-3 px-3 text-gray-500 dark:text-gray-400 max-w-[140px] truncate">
                      {locationStr ? (
                        <span className="flex items-center gap-1">
                          <MapPin size={12} className="shrink-0 text-gray-400" />
                          <span className="truncate">{locationStr}</span>
                        </span>
                      ) : "—"}
                    </td>
                    <td className="py-3 px-3">
                      <StatusBadge status={log.status} />
                    </td>
                  </tr>
                );
              })}
        </tbody>
      </table>
    </div>
  );
}
