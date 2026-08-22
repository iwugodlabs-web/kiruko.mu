"use client";

import { OvertimeRow, OtStatus } from "./types";
import { CheckCircle, XCircle, ChevronRight } from "lucide-react";

interface Props {
  rows: OvertimeRow[];
  loading: boolean;
  onRowClick: (row: OvertimeRow) => void;
}

const STATUS_CHIP: Record<OtStatus, string> = {
  pending: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400",
  approved: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400",
  rejected: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400",
};

function SkeletonRow() {
  return (
    <tr className="border-t border-gray-100 dark:border-gray-700">
      {[...Array(8)].map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        </td>
      ))}
    </tr>
  );
}

export default function OvertimeHistoryTable({ rows, loading, onRowClick }: Props) {
  if (!loading && rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
        <p className="font-medium">No history yet</p>
        <p className="text-sm mt-1">Approved and rejected overtime will appear here.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
            <th className="px-4 py-3 font-semibold">Employee</th>
            <th className="px-4 py-3 font-semibold">Dept</th>
            <th className="px-4 py-3 font-semibold">Date</th>
            <th className="px-4 py-3 font-semibold">Hours</th>
            <th className="px-4 py-3 font-semibold">Cost (1.5×)</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            <th className="px-4 py-3 font-semibold">Actioned</th>
            <th className="px-4 py-3 w-6" />
          </tr>
        </thead>
        <tbody>
          {loading
            ? [...Array(5)].map((_, i) => <SkeletonRow key={i} />)
            : rows.map((row) => (
                <tr
                  key={row.timelog_id}
                  onClick={() => onRowClick(row)}
                  className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 dark:text-gray-100">
                      {row.employee_name}
                      {row.employee_code && <span className="ml-1.5 font-mono text-xs font-normal text-gray-400 dark:text-gray-500">{row.employee_code}</span>}
                    </p>
                    {row.job_title && (
                      <p className="text-xs text-gray-400 dark:text-gray-500">{row.job_title}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{row.department ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                    {row.date
                      ? new Date(row.date).toLocaleDateString([], { dateStyle: "medium" })
                      : "—"}
                  </td>
                  <td className="px-4 py-3 font-semibold text-gray-900 dark:text-gray-100">
                    {row.hours_worked != null ? `${row.hours_worked.toFixed(1)}h` : "—"}
                  </td>
                  <td className="px-4 py-3 text-violet-600 dark:text-violet-400 font-semibold">
                    {row.estimated_cost != null
                      ? `${row.currency ?? ""} ${row.estimated_cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_CHIP[row.ot_status]}`}>
                      {row.ot_status === "approved" && <CheckCircle size={10} />}
                      {row.ot_status === "rejected" && <XCircle size={10} />}
                      {row.ot_status.charAt(0).toUpperCase() + row.ot_status.slice(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
                    {row.marked_as_overtime_at
                      ? new Date(row.marked_as_overtime_at).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <ChevronRight size={14} className="text-gray-400" />
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}
