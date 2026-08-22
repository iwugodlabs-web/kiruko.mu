"use client";

import { TimeLogStatus } from "./types";

const CONFIG: Record<TimeLogStatus, { label: string; classes: string; dot?: string }> = {
  active: {
    label: "Active",
    classes: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    dot: "bg-green-500 animate-pulse",
  },
  complete: {
    label: "Complete",
    classes: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
  },
  incomplete: {
    label: "Incomplete",
    classes: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  },
  overtime: {
    label: "Overtime",
    classes: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  },
};

export default function StatusBadge({ status }: { status: TimeLogStatus }) {
  const cfg = CONFIG[status] ?? CONFIG.complete;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.classes}`}>
      {cfg.dot && <span className={`block h-1.5 w-1.5 rounded-full ${cfg.dot}`} />}
      {cfg.label}
    </span>
  );
}
