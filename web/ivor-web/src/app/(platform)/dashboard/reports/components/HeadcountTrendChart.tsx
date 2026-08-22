"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { HeadcountPoint } from "./types";

interface Props {
  data: HeadcountPoint[];
}

export default function HeadcountTrendChart({ data }: Props) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
        Headcount Trend
      </h3>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
        Total employees and new hires per month
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="headTotal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="headNew" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100 dark:stroke-gray-700" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} className="fill-gray-400" />
          <YAxis tick={{ fontSize: 11 }} className="fill-gray-400" allowDecimals={false} />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              background: "white",
            }}
          />
          <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
          <Area
            type="monotone"
            dataKey="total"
            name="Total Employees"
            stroke="#3b82f6"
            fill="url(#headTotal)"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
          <Area
            type="monotone"
            dataKey="new_hires"
            name="New Hires"
            stroke="#22c55e"
            fill="url(#headNew)"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
