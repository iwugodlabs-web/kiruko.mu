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
import { PayrollCostPoint } from "./types";
import { useCompanyCurrency } from "@/hooks/useCompanyCurrency";

interface Props {
  data: PayrollCostPoint[];
}

function fmtCost(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return v.toFixed(0);
}

export default function PayrollCostChart({ data }: Props) {
  const { currency } = useCompanyCurrency();
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
        Payroll Cost Trend
      </h3>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
        Finalized gross payroll per month (Rs)
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="payrollGross" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100 dark:stroke-gray-700" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} className="fill-gray-400" />
          <YAxis tick={{ fontSize: 11 }} className="fill-gray-400" tickFormatter={fmtCost} />
          <Tooltip
            formatter={(value) => [`${currency} ${Number(value).toLocaleString()}`, "Gross"]}
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              background: "white",
            }}
          />
          <Area
            type="monotone"
            dataKey="gross"
            name="Gross Payroll"
            stroke="#14b8a6"
            fill="url(#payrollGross)"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
