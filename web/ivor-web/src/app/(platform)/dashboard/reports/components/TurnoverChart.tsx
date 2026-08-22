"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { TurnoverPoint } from "./types";

interface Props {
  data: TurnoverPoint[];
}

export default function TurnoverChart({ data }: Props) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
        Turnover
      </h3>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
        Terminations per month, as a % of that month&apos;s headcount
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="turnoverRate" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#dc2626" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#dc2626" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100 dark:stroke-gray-700" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} className="fill-gray-400" />
          <YAxis tick={{ fontSize: 11 }} className="fill-gray-400" unit="%" />
          <Tooltip
            formatter={(value) => [`${Number(value)}%`, "Turnover Rate"]}
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              background: "white",
            }}
          />
          <Area
            type="monotone"
            dataKey="rate"
            name="Turnover Rate"
            stroke="#dc2626"
            fill="url(#turnoverRate)"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
