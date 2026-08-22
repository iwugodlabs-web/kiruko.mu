"use client";

import { OvertimeRow } from "./types";
import { CheckCircle, XCircle, ChevronRight } from "lucide-react";

interface Props {
  rows: OvertimeRow[];
  loading: boolean;
  selected: Set<number>;
  onToggle: (id: number) => void;
  onToggleAll: () => void;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
  onRowClick: (row: OvertimeRow) => void;
}

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

export default function OvertimePendingTable({
  rows, loading, selected, onToggle, onToggleAll, onApprove, onReject, onRowClick,
}: Props) {
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.timelog_id));

  if (!loading && rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
        <CheckCircle size={32} className="mb-3 text-green-400" />
        <p className="font-medium">No pending overtime</p>
        <p className="text-sm mt-1">All overtime sessions have been reviewed.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
            <th className="px-4 py-3 w-8">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleAll}
                className="rounded border-gray-300 dark:border-gray-600 accent-amber-500"
              />
            </th>
            <th className="px-4 py-3 font-semibold">Employee</th>
            <th className="px-4 py-3 font-semibold">Dept</th>
            <th className="px-4 py-3 font-semibold">Date</th>
            <th className="px-4 py-3 font-semibold">OT Hours</th>
            <th className="px-4 py-3 font-semibold">Est. Cost (1.5×)</th>
            <th className="px-4 py-3 font-semibold">Actions</th>
            <th className="px-4 py-3 w-6" />
          </tr>
        </thead>
        <tbody>
          {loading
            ? [...Array(5)].map((_, i) => <SkeletonRow key={i} />)
            : rows.map((row) => {
                const isSelected = selected.has(row.timelog_id);
                return (
                  <tr
                    key={row.timelog_id}
                    className={`border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer ${
                      isSelected ? "bg-amber-50 dark:bg-amber-900/10" : ""
                    }`}
                    onClick={() => onRowClick(row)}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggle(row.timelog_id)}
                        className="rounded border-gray-300 dark:border-gray-600 accent-amber-500"
                      />
                    </td>
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
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onApprove(row.timelog_id)}
                          title="Approve"
                          className="p-1.5 rounded-lg text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors"
                        >
                          <CheckCircle size={16} />
                        </button>
                        <button
                          onClick={() => onReject(row.timelog_id)}
                          title="Reject"
                          className="p-1.5 rounded-lg text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        >
                          <XCircle size={16} />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <ChevronRight size={14} className="text-gray-400" />
                    </td>
                  </tr>
                );
              })}
        </tbody>
      </table>
    </div>
  );
}
