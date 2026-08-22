"use client";

import { InternalDispute } from "./types";
import { Scale, Clock, CheckCircle, TrendingDown } from "lucide-react";

interface Props {
  disputes: InternalDispute[];
  loading: boolean;
}

export default function DisputeStatsCards({ disputes, loading }: Props) {
  const open = disputes.filter((d) => !d.closed_at).length;
  const resolved = disputes.filter((d) => d.status === "resolved").length;

  const closedWithDays = disputes.filter(
    (d) => d.closed_at && d.created_at
  );
  const avgResolutionDays =
    closedWithDays.length > 0
      ? Math.round(
          closedWithDays.reduce((sum, d) => {
            const ms = new Date(d.closed_at!).getTime() - new Date(d.created_at!).getTime();
            return sum + ms / 86400000;
          }, 0) / closedWithDays.length
        )
      : null;

  const thisMonth = disputes.filter((d) => {
    if (!d.closed_at) return false;
    const closed = new Date(d.closed_at);
    const now = new Date();
    return closed.getMonth() === now.getMonth() && closed.getFullYear() === now.getFullYear();
  }).length;

  const cards = [
    { label: "Total Disputes", value: disputes.length, icon: <Scale size={18} />, color: "text-blue-600 dark:text-blue-400" },
    { label: "Open", value: open, icon: <Clock size={18} />, color: open > 0 ? "text-amber-600 dark:text-amber-400" : "text-gray-400" },
    { label: "Avg Resolution", value: avgResolutionDays != null ? `${avgResolutionDays}d` : "—", icon: <TrendingDown size={18} />, color: "text-violet-600 dark:text-violet-400" },
    { label: "Resolved This Month", value: thisMonth, icon: <CheckCircle size={18} />, color: "text-green-600 dark:text-green-400" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <div key={card.label} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4 flex items-center gap-3">
          <div className={card.color}>{card.icon}</div>
          <div className="min-w-0">
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{card.label}</p>
            {loading ? (
              <div className="h-6 w-10 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mt-1" />
            ) : (
              <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{card.value}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
