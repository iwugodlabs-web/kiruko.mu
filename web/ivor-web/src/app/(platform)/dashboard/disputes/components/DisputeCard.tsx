"use client";

import { InternalDispute, URGENCY_CONFIG } from "./types";
import { Clock, User, AlertTriangle } from "lucide-react";

interface Props {
  dispute: InternalDispute;
  onClick: () => void;
}

const CATEGORY_ICONS: Record<string, string> = {
  wages: "💰",
  safety: "⚠️",
  harassment: "🛑",
  discrimination: "⚖️",
  hours: "🕐",
  contract: "📄",
  other: "📋",
};

export default function DisputeCard({ dispute, onClick }: Props) {
  const urgency = URGENCY_CONFIG[dispute.urgency_level] ?? URGENCY_CONFIG.low;
  const emoji = CATEGORY_ICONS[dispute.category?.toLowerCase()] ?? "📋";
  const isStale = dispute.days_open > 7 && !dispute.closed_at;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 border-l-4 ${urgency.border} p-3 shadow-sm hover:shadow-md transition-all space-y-2 group`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-tight line-clamp-2 group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors">
          {emoji} {dispute.title}
        </span>
        <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${urgency.classes}`}>
          {urgency.label}
        </span>
      </div>

      {/* Employee */}
      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <User size={11} />
        <span className="truncate">{dispute.employee_name}</span>
      </div>

      {/* Category */}
      <div className="text-xs text-gray-500 dark:text-gray-400 capitalize">
        {dispute.category?.replace(/_/g, " ")}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1">
        <span className={`flex items-center gap-1 text-[11px] font-medium ${isStale ? "text-red-500" : "text-gray-400 dark:text-gray-500"}`}>
          <Clock size={10} />
          {isStale
            ? `${dispute.days_open}d — overdue`
            : dispute.days_open === 0
            ? "Today"
            : `${dispute.days_open}d open`}
        </span>
        {dispute.assigned_to && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded-full">
            Assigned
          </span>
        )}
      </div>
    </button>
  );
}
