"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Cell,
} from "recharts";
import { LeaveRow, LEAVE_TYPE_LABELS, LEAVE_COLORS } from "./types";

interface Props {
  data: LeaveRow[];
}

export default function LeaveUtilizationChart({ data }: Props) {
  const formatted = data.map((r, i) => ({
    ...r,
    label: LEAVE_TYPE_LABELS[r.type] ?? r.type,
    color: LEAVE_COLORS[i % LEAVE_COLORS.length],
  }));

  if (formatted.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5 flex flex-col">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
          Leave Utilization
        </h3>
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
          No leave data for this period
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
        Leave Utilization
      </h3>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
        Approved vs pending vs rejected by leave type
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={formatted} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100 dark:stroke-gray-700" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb", background: "white" }}
          />
          <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="approved" name="Approved" fill="#22c55e" radius={[4, 4, 0, 0]} stackId="a" />
          <Bar dataKey="pending" name="Pending" fill="#f59e0b" radius={[0, 0, 0, 0]} stackId="a" />
          <Bar dataKey="rejected" name="Rejected" fill="#ef4444" radius={[0, 0, 4, 4]} stackId="a" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
