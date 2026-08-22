"use client";

import { Users, Clock, UserX, AlertTriangle } from "lucide-react";
import { TimeLogRow } from "./types";

interface Props {
  // Expects the FULL set of logs for the date range (not a single paginated
  // page) so range-based counts are accurate.
  logs: TimeLogRow[];
  // Currently-active session count, fetched independently of the date range.
  // When provided, drives "Clocked In Now" so it reflects reality rather than
  // only active sessions that happen to fall inside the selected window.
  activeCount?: number;
  loading: boolean;
}

interface Card {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
  pulse?: boolean;
}

export default function AttendanceSummaryCards({ logs, activeCount, loading }: Props) {
  const active = activeCount ?? logs.filter((l) => l.status === "active").length;
  const complete = logs.filter((l) => l.status === "complete").length;
  const incomplete = logs.filter((l) => l.status === "incomplete").length;
  const overtime = logs.filter((l) => l.status === "overtime").length;

  const totalHoursToday = logs
    .filter((l) => l.date === new Date().toISOString().split("T")[0])
    .reduce((sum, l) => sum + (l.hours_worked ?? 0), 0);

  const cards: Card[] = [
    {
      label: "Clocked In Now",
      value: active,
      icon: <Users size={20} />,
      color: "text-green-600 dark:text-green-400",
      pulse: active > 0,
    },
    {
      label: "Total Hours Today",
      value: `${totalHoursToday.toFixed(1)}h`,
      icon: <Clock size={20} />,
      color: "text-blue-600 dark:text-blue-400",
    },
    {
      label: "Incomplete Sessions",
      value: incomplete,
      icon: <UserX size={20} />,
      color: "text-amber-600 dark:text-amber-400",
    },
    {
      label: "Overtime",
      value: overtime,
      icon: <AlertTriangle size={20} />,
      color: "text-amber-600 dark:text-amber-400",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4 flex items-center gap-4"
        >
          <div className={`${card.color} relative`}>
            {card.icon}
            {card.pulse && (
              <span className="absolute -top-0.5 -right-0.5 block h-2 w-2 rounded-full bg-green-500 ring-2 ring-white dark:ring-gray-800 animate-pulse" />
            )}
          </div>
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
