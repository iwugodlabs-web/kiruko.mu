"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { TrendingUp, ArrowRight, ArrowUp, ArrowDown } from "lucide-react";
import { api } from "@/services/apiClient";
import { useCompanyCurrency } from "@/hooks/useCompanyCurrency";

interface TrendMetric {
  current: number;
  delta_pct: number | null;
}

export interface DashboardTrends {
  hours_worked: TrendMetric;
  payroll_gross: TrendMetric;
  leave_requests: TrendMetric;
}

interface Props {
  companyId?: number;
  trends?: DashboardTrends | null;
}

interface HeadcountPoint {
  label: string;
  total: number;
}

// Compact money for the trend rows, prefixed with the company's operating
// currency code (MUR/TZS/…) instead of a hardcoded "Rs" — Intl's currency style
// doesn't do compact "M/k", so we prefix the code by hand.
function fmtCost(v: number, ccy: string): string {
  if (v >= 1_000_000) return `${ccy} ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${ccy} ${(v / 1_000).toFixed(1)}k`;
  return `${ccy} ${v.toFixed(0)}`;
}

function DeltaBadge({ deltaPct }: { deltaPct: number | null }) {
  if (deltaPct === null) {
    return <span className="text-[11px] text-gray-400">—</span>;
  }
  const isUp = deltaPct > 0;
  const isFlat = deltaPct === 0;
  if (isFlat) {
    return <span className="text-[11px] text-gray-400">0%</span>;
  }
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${isUp ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
      {isUp ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
      {Math.abs(deltaPct)}%
    </span>
  );
}

function TrendRow({ label, value, deltaPct }: { label: string; value: string; deltaPct: number | null }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-50 dark:border-gray-800 last:border-0">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-gray-900 dark:text-white tabular-nums">{value}</span>
        <DeltaBadge deltaPct={deltaPct} />
      </div>
    </div>
  );
}

export default function TrendsWidget({ companyId, trends }: Props) {
  const router = useRouter();
  const { currency } = useCompanyCurrency();
  const [headcountTrend, setHeadcountTrend] = useState<HeadcountPoint[]>([]);

  useEffect(() => {
    if (!companyId) return;
    let mounted = true;
    api
      .get(`/reports/company/${companyId}`, { params: { months: 6 } })
      .then((res) => {
        if (mounted && Array.isArray(res.data?.headcount_trend)) {
          setHeadcountTrend(res.data.headcount_trend);
        }
      })
      .catch(() => {
        // Sparkline is a nice-to-have — silently skip on failure rather than
        // surfacing an error banner for a small chart on an otherwise-loaded page.
      });
    return () => { mounted = false };
  }, [companyId]);

  return (
    <div className="self-start bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-blue-50 dark:bg-blue-500/10 rounded-lg flex items-center justify-center">
            <TrendingUp size={14} className="text-blue-600" />
          </div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Trends</h2>
        </div>
      </div>

      {headcountTrend.length > 1 && (
        <div className="px-5 pt-4">
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-1">Headcount, last 6 months</p>
          <ResponsiveContainer width="100%" height={48}>
            <AreaChart data={headcountTrend} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="trendsHeadcount" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="total" stroke="#3b82f6" strokeWidth={2} fill="url(#trendsHeadcount)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="px-5 py-1">
        {trends ? (
          <>
            <TrendRow label="Hours worked" value={`${trends.hours_worked.current.toLocaleString()}h`} deltaPct={trends.hours_worked.delta_pct} />
            <TrendRow label="Payroll (gross)" value={fmtCost(trends.payroll_gross.current, currency)} deltaPct={trends.payroll_gross.delta_pct} />
            <TrendRow label="Leave requests" value={String(trends.leave_requests.current)} deltaPct={trends.leave_requests.delta_pct} />
          </>
        ) : (
          <div className="py-4 text-xs text-gray-400 text-center">No trend data yet</div>
        )}
      </div>

      <div className="px-5 py-2.5 bg-gray-50/50 dark:bg-gray-800/40 border-t border-gray-100 dark:border-gray-800">
        <button
          onClick={() => router.push('/dashboard/reports')}
          className="text-[11px] font-medium text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition-colors flex items-center gap-1"
        >
          View full reports <ArrowRight size={10} />
        </button>
      </div>
    </div>
  );
}
