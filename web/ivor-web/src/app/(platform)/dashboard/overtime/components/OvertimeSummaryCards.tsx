"use client";

import { OvertimeRow } from "./types";
import { Clock, DollarSign, CheckCircle, XCircle } from "lucide-react";

interface Props {
  pending: OvertimeRow[];
  approved: OvertimeRow[];
  rejected: OvertimeRow[];
  loading: boolean;
}

function Skeleton() {
  return <div className="h-7 w-16 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mt-1" />;
}

export default function OvertimeSummaryCards({ pending, approved, rejected, loading }: Props) {
  const pendingHours = pending.reduce((s, r) => s + (r.hours_worked ?? 0), 0);
  const pendingCost = pending.reduce((s, r) => s + (r.estimated_cost ?? 0), 0);
  const currency = pending[0]?.currency ?? approved[0]?.currency ?? "MUR";

  // Data is scoped to the selected period (see the month navigator), so the
  // approved count is simply all approved rows in that period — no separate
  // current-calendar-month filter (which broke when viewing other months).
  const approvedInPeriod = approved.length;

  const cards = [
    {
      label: "Pending Approval",
      value: pending.length,
      sub: `${pendingHours.toFixed(1)} hrs`,
      icon: <Clock size={18} />,
      color: pending.length > 0 ? "text-amber-500" : "text-gray-400 dark:text-gray-500",
    },
    {
      label: "Estimated Cost",
      value: pendingCost > 0 ? `${currency} ${pendingCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—",
      sub: "at 1.5× rate",
      icon: <DollarSign size={18} />,
      color: "text-violet-500 dark:text-violet-400",
    },
    {
      label: "Approved",
      value: approvedInPeriod,
      sub: null,
      icon: <CheckCircle size={18} />,
      color: "text-green-500 dark:text-green-400",
    },
    {
      label: "Rejected",
      value: rejected.length,
      sub: null,
      icon: <XCircle size={18} />,
      color: rejected.length > 0 ? "text-red-500 dark:text-red-400" : "text-gray-400 dark:text-gray-500",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <div key={card.label} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4 flex items-start gap-3">
          <div className={`mt-0.5 ${card.color}`}>{card.icon}</div>
          <div className="min-w-0">
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{card.label}</p>
            {loading ? <Skeleton /> : (
              <>
                <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{card.value}</p>
                {card.sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{card.sub}</p>}
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
