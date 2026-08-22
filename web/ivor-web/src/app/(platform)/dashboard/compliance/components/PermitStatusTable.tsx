"use client";

import { ComplianceEmployee, PERMIT_STATUS_CONFIG, PermitStatus } from "./types";
import { ExternalLink, Mail, AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";

interface Props {
  employees: ComplianceEmployee[];
  loading: boolean;
  filterStatus: PermitStatus | "all";
  onRowClick: (emp: ComplianceEmployee) => void;
  onSendReminder: (emp: ComplianceEmployee) => void;
}

const COLS = ["Employee", "Nationality/Passport", "Permit Type", "Expiry Date", "Days Left", "Status", "Document", "Action"];

function DaysCell({ days }: { days: number | null }) {
  if (days === null) return <span className="text-gray-400">—</span>;
  if (days < 0) return <span className="text-red-600 dark:text-red-400 font-medium">Expired</span>;
  if (days <= 30) return <span className="text-red-500 dark:text-red-400 font-semibold">{days}d</span>;
  if (days <= 60) return <span className="text-amber-600 dark:text-amber-400 font-medium">{days}d</span>;
  return <span className="text-gray-700 dark:text-gray-300">{days}d</span>;
}

export default function PermitStatusTable({ employees, loading, filterStatus, onRowClick, onSendReminder }: Props) {
  const LIMIT = 50;
  const filtered = filterStatus === "all" ? employees : employees.filter((e) => e.permit_status === filterStatus);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 dark:border-gray-700">
            {COLS.map((h) => (
              <th key={h} className="text-left py-2 px-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-50 dark:border-gray-800">
                  {COLS.map((__, j) => (
                    <td key={j} className="py-3 px-3">
                      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-20" />
                    </td>
                  ))}
                </tr>
              ))
            : filtered.length === 0
            ? (
              <tr>
                <td colSpan={COLS.length} className="py-12 text-center text-gray-400 dark:text-gray-500 text-sm">
                  No employees match this filter.
                </td>
              </tr>
            )
            : filtered.slice(0, LIMIT).map((emp) => {
                const cfg = PERMIT_STATUS_CONFIG[emp.permit_status];
                const isRisk = emp.permit_status === "tourist_visa" || emp.permit_status === "expired";
                return (
                  <tr
                    key={emp.job_id}
                    onClick={() => onRowClick(emp)}
                    className={`border-b border-gray-50 dark:border-gray-800 cursor-pointer transition-colors ${
                      isRisk
                        ? "bg-red-50/50 dark:bg-red-900/10 hover:bg-red-50 dark:hover:bg-red-900/20"
                        : emp.permit_status === "expiring_soon"
                        ? "bg-amber-50/40 dark:bg-amber-900/10 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                        : "hover:bg-gray-50 dark:hover:bg-gray-800/50"
                    }`}
                  >
                    <td className="py-3 px-3 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">
                      <span className="flex items-center gap-1.5">
                        {isRisk && <AlertTriangle size={13} className="text-red-400 shrink-0" />}
                        {emp.employee_name}
                        {emp.employee_code && <span className="font-mono text-xs font-normal text-gray-400 dark:text-gray-500">{emp.employee_code}</span>}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-gray-500 dark:text-gray-400 text-xs font-mono">
                      {emp.passport_number ?? "—"}
                    </td>
                    <td className="py-3 px-3 text-gray-600 dark:text-gray-400 capitalize">
                      {emp.permit_type ? emp.permit_type.replace(/_/g, " ") : "—"}
                    </td>
                    <td className="py-3 px-3 font-mono text-gray-700 dark:text-gray-300">
                      {emp.expiry_date ?? "—"}
                    </td>
                    <td className="py-3 px-3">
                      <DaysCell days={emp.days_until_expiry} />
                    </td>
                    <td className="py-3 px-3">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.classes}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotColor}`} />
                        {cfg.label}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      {emp.permit_doc_url ? (
                        <a
                          href={emp.permit_doc_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline text-xs"
                        >
                          <ExternalLink size={11} />
                          View
                        </a>
                      ) : (
                        <span className="text-gray-400 text-xs">No doc</span>
                      )}
                    </td>
                    <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => onSendReminder(emp)}
                        className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                      >
                        <Mail size={11} />
                        Remind
                      </button>
                    </td>
                  </tr>
                );
              })}
        </tbody>
      </table>
      {filtered.length > LIMIT && (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-3">
          Showing first {LIMIT} of {filtered.length} employees. Use the filter to narrow results.
        </p>
      )}
    </div>
  );
}
