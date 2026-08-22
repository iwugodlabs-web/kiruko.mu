"use client";

import { useState } from "react";
import { ComplianceEmployee } from "./types";

interface Props {
  employees: ComplianceEmployee[];
}

function zoneColor(days: number) {
  if (days < 0) return "bg-red-500";
  if (days <= 30) return "bg-red-400";
  if (days <= 60) return "bg-amber-400";
  return "bg-yellow-400";
}

function zoneBg(days: number) {
  if (days < 0) return "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800";
  if (days <= 30) return "bg-red-50 dark:bg-red-900/10 border-red-100 dark:border-red-900";
  if (days <= 60) return "bg-amber-50 dark:bg-amber-900/10 border-amber-100 dark:border-amber-900";
  return "bg-yellow-50 dark:bg-yellow-900/10 border-yellow-100 dark:border-yellow-900";
}

export default function ExpiryTimeline({ employees }: Props) {
  const [tooltip, setTooltip] = useState<ComplianceEmployee | null>(null);

  const withExpiry = employees
    .filter((e) => e.days_until_expiry !== null && e.days_until_expiry <= 90)
    .sort((a, b) => (a.days_until_expiry ?? 0) - (b.days_until_expiry ?? 0));

  if (withExpiry.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-gray-400 dark:text-gray-500">
        No permits expiring in the next 90 days.
      </div>
    );
  }

  const TOTAL_DAYS = 90;

  return (
    <div className="relative">
      {/* Timeline bar */}
      <div className="relative h-8 rounded-full bg-gray-100 dark:bg-gray-700 overflow-visible mb-8">
        {/* Zone backgrounds */}
        <div className="absolute inset-y-0 left-0 w-1/3 bg-red-100 dark:bg-red-900/20 rounded-l-full" title="0-30 days" />
        <div className="absolute inset-y-0 left-1/3 w-1/3 bg-amber-100 dark:bg-amber-900/20" title="30-60 days" />
        <div className="absolute inset-y-0 left-2/3 w-1/3 bg-yellow-100 dark:bg-yellow-900/20 rounded-r-full" title="60-90 days" />

        {/* Zone labels */}
        <div className="absolute inset-0 flex items-center">
          <span className="flex-1 text-center text-[10px] text-red-600 dark:text-red-400 font-medium">0–30d</span>
          <span className="flex-1 text-center text-[10px] text-amber-600 dark:text-amber-400 font-medium">30–60d</span>
          <span className="flex-1 text-center text-[10px] text-yellow-600 dark:text-yellow-500 font-medium">60–90d</span>
        </div>

        {/* Employee dots */}
        {withExpiry.map((emp) => {
          const days = emp.days_until_expiry ?? 0;
          const pct = Math.min(Math.max((days / TOTAL_DAYS) * 100, 1), 99);
          return (
            <button
              key={emp.job_id}
              style={{ left: `${pct}%` }}
              className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full border-2 border-white dark:border-gray-900 ${zoneColor(days)} shadow-sm hover:scale-125 transition-transform z-10`}
              onMouseEnter={() => setTooltip(emp)}
              onMouseLeave={() => setTooltip(null)}
              aria-label={`${emp.employee_name}: ${days} days`}
            />
          );
        })}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div className="absolute -top-14 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
          <div className="bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs rounded-lg px-3 py-2 shadow-lg whitespace-nowrap">
            <p className="font-semibold">{tooltip.employee_name}</p>
            <p className="text-gray-300 dark:text-gray-600">
              {tooltip.expiry_date} · {tooltip.days_until_expiry}d left · {tooltip.permit_type ?? "Unknown permit"}
            </p>
          </div>
        </div>
      )}

      {/* Employee list under timeline */}
      <div className="space-y-2">
        {withExpiry.map((emp) => {
          const days = emp.days_until_expiry ?? 0;
          return (
            <div key={emp.job_id} className={`flex items-center justify-between px-3 py-2 rounded-xl border text-sm ${zoneBg(days)}`}>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${zoneColor(days)}`} />
                <span className="font-medium text-gray-900 dark:text-gray-100">{emp.employee_name}</span>
                {emp.employee_code && <span className="font-mono text-xs text-gray-400 dark:text-gray-500">{emp.employee_code}</span>}
                <span className="text-gray-500 dark:text-gray-400 text-xs">{emp.permit_type ?? "—"}</span>
              </div>
              <div className="text-right">
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  {days < 0 ? `Expired ${Math.abs(days)}d ago` : `${days}d left`}
                </span>
                <p className="text-xs text-gray-400 dark:text-gray-500">{emp.expiry_date}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
