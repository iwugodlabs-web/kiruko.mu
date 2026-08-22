"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { AttendancePoint } from "./types";

interface Props {
  data: AttendancePoint[];
}

export default function AttendanceRateChart({ data }: Props) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
        Hours Worked
      </h3>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
        Total hours logged per month
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100 dark:stroke-gray-700" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} className="fill-gray-400" />
          <YAxis tick={{ fontSize: 11 }} className="fill-gray-400" />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              background: "white",
            }}
            formatter={(value) => [`${Number(value).toLocaleString()} hrs`, "Hours Worked"]}
          />
          <Bar dataKey="hours" name="Hours Worked" fill="#6366f1" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
