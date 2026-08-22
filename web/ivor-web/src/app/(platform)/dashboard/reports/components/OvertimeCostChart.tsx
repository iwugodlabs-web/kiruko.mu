"use client";

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { useTheme } from "next-themes";
import { OtCostPoint } from "./types";
import { useCompanyCurrency } from "@/hooks/useCompanyCurrency";

interface Props {
  data: OtCostPoint[];
}

// Brand palette: gold for cost ($), teal for hours.
const COST_COLOR = "#F2B705";
const HOURS_COLOR = "#14B8A6";

function fmt(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return v.toFixed(0);
}

// OT cost is money — prefix the company's operating currency code (MUR/TZS/…),
// derived from country, not a hardcoded "Rs". Hours are not money.
function fmtCost(v: number, ccy: string) {
  return `${ccy} ${fmt(v)}`;
}

export default function OvertimeCostChart({ data }: Props) {
  // recharts styles are JS props, not Tailwind classes — switch the tooltip
  // surface on the resolved theme so it doesn't render a white box in dark mode.
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const { currency } = useCompanyCurrency();
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
        Overtime Cost
      </h3>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
        OT hours and estimated cost at 1.5× rate
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={{ top: 4, right: 16, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100 dark:stroke-gray-700" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => fmtCost(v, currency)}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => `${v}h`}
          />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: `1px solid ${dark ? "#374151" : "#e5e7eb"}`,
              background: dark ? "#1f2937" : "white",
            }}
            labelStyle={{ color: dark ? "#f9fafb" : undefined }}
            itemStyle={{ color: dark ? "#e5e7eb" : undefined }}
            formatter={(value, name) =>
              name === "OT Cost"
                ? [fmtCost(Number(value), currency), name as string]
                : [`${Number(value)}h`, name as string]
            }
          />
          <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
          <Bar yAxisId="left" dataKey="ot_cost" name="OT Cost" fill={COST_COLOR} radius={[4, 4, 0, 0]} />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="ot_hours"
            name="OT Hours"
            stroke={HOURS_COLOR}
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
