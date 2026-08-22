"use client";

import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { StatusCounts } from "./types";

interface Props {
  statusCounts: StatusCounts;
  belowMinWageCount: number;
}

export default function ComplianceFlagBanner({ statusCounts, belowMinWageCount }: Props) {
  const [dismissed, setDismissed] = useState(false);

  const urgentCount = statusCounts.expired + statusCounts.tourist_visa;
  const warningCount = statusCounts.expiring_soon + belowMinWageCount;

  if (dismissed || (urgentCount === 0 && warningCount === 0)) return null;

  const issues: string[] = [];
  if (statusCounts.expired > 0)
    issues.push(`${statusCounts.expired} expired permit${statusCounts.expired !== 1 ? "s" : ""}`);
  if (statusCounts.tourist_visa > 0)
    issues.push(`${statusCounts.tourist_visa} tourist visa${statusCounts.tourist_visa !== 1 ? "s" : ""} (illegal work risk)`);
  if (statusCounts.expiring_soon > 0)
    issues.push(`${statusCounts.expiring_soon} permit${statusCounts.expiring_soon !== 1 ? "s" : ""} expiring within 30 days`);
  if (belowMinWageCount > 0)
    issues.push(`${belowMinWageCount} employee${belowMinWageCount !== 1 ? "s" : ""} below minimum wage`);

  const isUrgent = urgentCount > 0;

  return (
    <div className={`flex items-start gap-3 rounded-xl px-4 py-3 border ${
      isUrgent
        ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
        : "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800"
    }`}>
      <AlertTriangle size={16} className={`shrink-0 mt-0.5 ${isUrgent ? "text-red-500" : "text-amber-500"}`} />
      <div className="flex-1">
        <p className={`text-sm font-semibold ${isUrgent ? "text-red-800 dark:text-red-300" : "text-amber-800 dark:text-amber-300"}`}>
          {issues.length} compliance issue{issues.length !== 1 ? "s" : ""} require{issues.length === 1 ? "s" : ""} action
        </p>
        <ul className={`mt-1 space-y-0.5 text-xs ${isUrgent ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
          {issues.map((issue) => (
            <li key={issue}>• {issue}</li>
          ))}
        </ul>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className={`p-1 rounded-md transition-colors ${
          isUrgent ? "text-red-400 hover:text-red-700 dark:hover:text-red-200" : "text-amber-400 hover:text-amber-700 dark:hover:text-amber-200"
        }`}
      >
        <X size={14} />
      </button>
    </div>
  );
}
