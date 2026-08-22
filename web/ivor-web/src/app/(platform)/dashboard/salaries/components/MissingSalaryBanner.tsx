"use client";

import { AlertTriangle } from "lucide-react";

interface Props {
  count: number;
  onShowMissing: () => void;
}

export default function MissingSalaryBanner({ count, onShowMissing }: Props) {
  if (count === 0) return null;

  return (
    <div className="flex items-center gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3">
      <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 shrink-0" />
      <p className="text-sm text-amber-800 dark:text-amber-300 flex-1">
        <span className="font-semibold">{count} employee{count !== 1 ? "s" : ""}</span>{" "}
        {count !== 1 ? "have" : "has"} no salary configured.
        Accurate payroll and compliance checks require salary data for all employees.
      </p>
      <button
        onClick={onShowMissing}
        className="text-sm font-medium text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200 whitespace-nowrap underline underline-offset-2 transition-colors"
      >
        Show missing
      </button>
    </div>
  );
}
