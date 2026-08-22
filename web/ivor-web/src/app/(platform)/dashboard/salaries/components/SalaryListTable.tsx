"use client";

import { SalaryRow, MIN_WAGE } from "./types";
import { AlertTriangle, ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import { formatMoney } from "@/utils/payrollFormat";

interface Props {
  rows: SalaryRow[];
  total: number;
  limit: number;
  offset: number;
  loading: boolean;
  onEdit: (row: SalaryRow) => void;
  onPageChange: (offset: number) => void;
}

type ConfigStatus = "configured" | "missing" | "below_min_wage";

function allowanceOf(row: SalaryRow): number {
  // Mobile writes to `allowance`, legacy web writes went to `revenue` — read
  // whichever has a non-empty value. See types.ts for the rationale.
  return parseFloat(row.allowance ?? row.revenue ?? "0");
}

function getStatus(row: SalaryRow): ConfigStatus {
  if (!row.has_salary) return "missing";
  const total = parseFloat(row.salary ?? "0") + allowanceOf(row);
  const minWage = row.currency ? MIN_WAGE[row.currency] : null;
  if (minWage && total > 0 && total < minWage.amount) return "below_min_wage";
  return "configured";
}

const STATUS_CHIP: Record<ConfigStatus, { label: string; classes: string }> = {
  configured: { label: "Configured", classes: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  missing: { label: "Missing", classes: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
  below_min_wage: { label: "Below Min Wage", classes: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" },
};

/** Two-letter initials from a full name string */
function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

/** Friendly tenure string from ISO date */
function tenure(isoDate: string | null | undefined): string {
  if (!isoDate) return "—";
  const ms = Date.now() - new Date(isoDate).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months}mo`;
  const years = (days / 365.25).toFixed(1);
  return `${years}y`;
}

// Decorative avatar palette. Red is reserved for semantic states (missing
// salary), so it is intentionally absent here — index 0 uses a brand teal.
const AVATAR_COLORS = [
  "bg-teal-100 text-teal-700",
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-violet-100 text-violet-700",
  "bg-amber-100 text-amber-700",
  "bg-sky-100 text-sky-700",
];

export default function SalaryListTable({ rows, total, limit, offset, loading, onEdit, onPageChange }: Props) {
  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit);

  const COLS = ["Employee", "Job & Department", "Contracted", "Base Pay", "Allowances", "Total/Mo", "Rate/Hr", "Status", ""];

  return (
    <div className="flex flex-col gap-4">
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
              ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50 dark:border-gray-800">
                    {COLS.map((__, j) => (
                      <td key={j} className="py-3 px-3">
                        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-20" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.length === 0
              ? (
                <tr>
                  <td colSpan={COLS.length} className="text-center py-12 text-gray-500 dark:text-gray-400 text-sm">
                    No employees found.
                  </td>
                </tr>
              )
              : rows.map((row, idx) => {
                  const status = getStatus(row);
                  const chip = STATUS_CHIP[status];
                  const rowAllowance = allowanceOf(row);
                  const rowTotal = row.has_salary ? parseFloat(row.salary ?? "0") + rowAllowance : null;
                  // Calculate hourly rate from base salary (not including allowances)
                  const calculatedHourlyRate =
                    row.has_salary && row.salary && row.monthly_hours
                      ? parseFloat(row.salary) / parseFloat(row.monthly_hours)
                      : null;
                  const avatarColor = AVATAR_COLORS[idx % AVATAR_COLORS.length];

                  return (
                    <tr
                      key={row.job_id}
                      className={`border-b border-gray-50 dark:border-gray-800 transition-colors ${
                        status === "missing"
                          ? "bg-red-50/40 dark:bg-red-900/10"
                          : status === "below_min_wage"
                          ? "bg-amber-50/40 dark:bg-amber-900/10"
                          : "hover:bg-gray-50 dark:hover:bg-gray-800/50"
                      }`}
                    >
                      {/* Employee column — avatar + name + email */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${avatarColor}`}>
                            {initials(row.employee_name) || "?"}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              {(status === "missing" || status === "below_min_wage") && (
                                <AlertTriangle size={12} className={status === "missing" ? "text-red-400" : "text-amber-400"} />
                              )}
                              <span className="font-medium text-gray-900 dark:text-gray-100">{row.employee_name}</span>
                              {row.employee_code && <span className="font-mono text-xs text-gray-400 dark:text-gray-500">{row.employee_code}</span>}
                            </div>
                            {row.email && (
                              <p className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-[180px]">{row.email}</p>
                            )}
                            {row.phone && !row.email && (
                              <p className="text-xs text-gray-400 dark:text-gray-500">{row.phone}</p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Job + Dept + tenure */}
                      <td className="py-3 px-3">
                        <p className="text-sm text-gray-700 dark:text-gray-300 font-medium">{row.job_title ?? "—"}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {row.department && (
                            <span className="text-xs text-gray-400">{row.department}</span>
                          )}
                          {row.first_date_of_employment && (
                            <>
                              {row.department && <span className="text-gray-200 dark:text-gray-700">·</span>}
                              <span className="text-xs text-gray-400" title={`Started ${new Date(row.first_date_of_employment).toLocaleDateString()}`}>
                                {tenure(row.first_date_of_employment)}
                              </span>
                            </>
                          )}
                        </div>
                      </td>

                      {/* Contracted hours + work days */}
                      <td className="py-3 px-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {row.monthly_hours ? (
                          <div>
                            <p className="text-sm">{row.monthly_hours} hrs/mo</p>
                            {row.days_of_work_per_month && (
                              <p className="text-xs text-gray-400">{row.days_of_work_per_month} days</p>
                            )}
                          </div>
                        ) : "—"}
                      </td>

                      <td className="py-3 px-3 font-mono text-gray-700 dark:text-gray-300">
                        {row.salary && row.currency ? formatMoney(parseFloat(row.salary), row.currency) : "—"}
                      </td>
                      <td className="py-3 px-3 font-mono text-gray-500 dark:text-gray-400">
                        {rowAllowance > 0 && row.currency
                          ? formatMoney(rowAllowance, row.currency)
                          : "—"}
                      </td>
                      <td className="py-3 px-3 font-mono font-medium text-gray-900 dark:text-gray-100">
                        {rowTotal != null && row.currency ? formatMoney(rowTotal, row.currency) : "—"}
                      </td>
                      <td className="py-3 px-3 font-mono text-gray-500 dark:text-gray-400">
                        {calculatedHourlyRate != null && row.currency
                          ? formatMoney(calculatedHourlyRate, row.currency, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                          : "—"}
                      </td>
                      <td className="py-3 px-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${chip.classes}`}>
                          {chip.label}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <button
                          onClick={() => onEdit(row)}
                          className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors px-2 py-1 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20"
                        >
                          <Pencil size={12} />
                          {row.has_salary ? "Edit" : "Configure"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {offset + 1}–{Math.min(offset + limit, total)} of {total} employees
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPageChange(Math.max(0, offset - limit))}
              disabled={offset === 0}
              className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs text-gray-700 dark:text-gray-300 px-2">{page} / {totalPages}</span>
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
