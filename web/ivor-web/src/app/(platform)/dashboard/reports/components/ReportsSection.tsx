"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanyCurrency } from "@/hooks/useCompanyCurrency";
import { api } from "@/services/apiClient";
import { getDepartments, type ShowDepartment } from "@/services/api";
import { toast } from "sonner";
import { BarChart2, RefreshCw, SlidersHorizontal } from "lucide-react";
import { ReportsData } from "./types";
import HeadcountTrendChart from "./HeadcountTrendChart";
import AttendanceRateChart from "./AttendanceRateChart";
import LeaveUtilizationChart from "./LeaveUtilizationChart";
import OvertimeCostChart from "./OvertimeCostChart";
import DisputeResolutionChart from "./DisputeResolutionChart";
import PayrollCostChart from "./PayrollCostChart";
import TurnoverChart from "./TurnoverChart";
import ExportReportButton from "./ExportReportButton";
import RemittanceSummary from "./RemittanceSummary";
import CountryAssignmentsReport from "./CountryAssignmentsReport";
import DashboardHeader from "@/components/ui/DashboardHeader";
import FilterSelect from "@/components/ui/FilterSelect";

const PERIOD_OPTIONS = [
  { label: "1M", value: 1 },
  { label: "3M", value: 3 },
  { label: "6M", value: 6 },
  { label: "12M", value: 12 },
];

const THIS_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [THIS_YEAR, THIS_YEAR - 1, THIS_YEAR - 2].map((y) => ({ label: String(y), value: y }));

function KpiCard({
  label,
  value,
  sub,
  color,
  loading,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color: string;
  loading: boolean;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      {loading ? (
        <div className="h-7 w-20 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mt-1" />
      ) : (
        <>
          <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
          {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
        </>
      )}
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5 h-[300px] flex items-center justify-center">
      <div className="flex flex-col items-center gap-2">
        <div className="w-10 h-10 rounded-full border-4 border-gray-200 dark:border-gray-700 border-t-blue-500 animate-spin" />
        <p className="text-xs text-gray-400">Loading chart…</p>
      </div>
    </div>
  );
}

// OT cost is money — prefix the company's operating currency code (MUR/TZS/…),
// derived from country, so the KPI doesn't read as a bare count and isn't wrong
// for non-MU companies. Kept abbreviated (k/M) for the compact card.
function fmtCost(v: number, ccy: string): string {
  let body: string;
  if (v >= 1_000_000) body = `${(v / 1_000_000).toFixed(1)}M`;
  else if (v >= 1_000) body = `${(v / 1_000).toFixed(1)}k`;
  else body = v.toFixed(0);
  return `${ccy} ${body}`;
}

export default function ReportsSection() {
  const { user, companyId } = useAuth();
  const { currency } = useCompanyCurrency();

  const [months, setMonths] = useState(6);
  const [selectedYear, setSelectedYear] = useState<number | null>(null); // null = rolling window
  const [departments, setDepartments] = useState<ShowDepartment[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);

  const fetchReports = useCallback(
    async (silent = false) => {
      if (!companyId) return;
      if (!silent) setLoading(true);
      try {
        const params: Record<string, string | number> = { months };
        if (selectedYear) params.year = selectedYear;
        if (departmentId) params.department_id = Number(departmentId);
        const res = await api.get(`/reports/company/${companyId}`, { params });
        setData(res.data);
      } catch {
        if (!silent) toast.error("Failed to load reports.");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [companyId, months, selectedYear, departmentId]
  );

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  useEffect(() => {
    if (!companyId) return;
    getDepartments(companyId).then((d) => { if (Array.isArray(d)) setDepartments(d); });
  }, [companyId]);

  async function handleRefresh() {
    setSpinning(true);
    await fetchReports(true);
    setSpinning(false);
  }

  if (!companyId) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 dark:text-gray-500">
        No company associated with your account.
      </div>
    );
  }

  const summary = data?.summary;

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col gap-6 p-6">
      <DashboardHeader
        title="Reports & Analytics"
        subtitle="Aggregated workforce trends across attendance, leave, overtime, and compliance."
        extra={
          <>
            <div className="flex items-center rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
              {PERIOD_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => { setMonths(opt.value); setSelectedYear(null); }}
                  className={`px-3 py-2 text-xs font-medium transition-colors ${
                    months === opt.value && !selectedYear
                      ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900"
                      : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <button
              onClick={() => setShowFilters((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-colors ${
                showFilters || selectedYear || departmentId
                  ? "border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20"
                  : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
              }`}
            >
              <SlidersHorizontal size={13} />
              Filters{selectedYear ? ` · ${selectedYear}` : ""}{departmentId ? ` · ${departments.find(d => String(d.department_id) === departmentId)?.name ?? ""}` : ""}
            </button>

            <button
              onClick={handleRefresh}
              disabled={spinning}
              className="p-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <RefreshCw size={15} className={spinning ? "animate-spin" : ""} />
            </button>

            {data && <ExportReportButton data={data} months={months} />}
          </>
        }
      />

      {/* Filter panel */}
      {showFilters && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 px-5 py-4 flex flex-wrap items-end gap-5">
          {/* Year */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Year</label>
            <div className="flex items-center gap-1 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <button
                onClick={() => setSelectedYear(null)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  !selectedYear ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900" : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
              >
                Rolling
              </button>
              {YEAR_OPTIONS.map((y) => (
                <button
                  key={y.value}
                  onClick={() => setSelectedYear(y.value)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    selectedYear === y.value ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900" : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                  }`}
                >
                  {y.label}
                </button>
              ))}
            </div>
          </div>

          {/* Months (only applies in rolling mode) */}
          {!selectedYear && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Window</label>
              <div className="flex items-center gap-1 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                {[1, 2, 3, 6, 9, 12].map((m) => (
                  <button
                    key={m}
                    onClick={() => setMonths(m)}
                    className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      months === m ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900" : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                    }`}
                  >
                    {m}M
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Department */}
          {departments.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Department</label>
              <FilterSelect
                label=""
                value={departmentId}
                onChange={setDepartmentId}
                options={[
                  { value: "", label: "All departments" },
                  ...departments.map((d) => ({ value: String(d.department_id), label: d.name })),
                ]}
              />
            </div>
          )}

          <p className="text-xs text-gray-400 dark:text-gray-500 ml-auto self-center">
            {selectedYear
              ? `Showing all of ${selectedYear}`
              : `Rolling last ${months} month${months !== 1 ? "s" : ""}`}
          </p>
        </div>
      )}

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <KpiCard
          label="Total Employees"
          value={summary?.total_employees ?? 0}
          color="text-blue-600 dark:text-blue-400"
          loading={loading}
        />
        <KpiCard
          label="Hours Worked"
          value={summary ? `${summary.total_hours_period.toLocaleString()}h` : "0h"}
          sub={`Last ${months} months`}
          color="text-indigo-600 dark:text-indigo-400"
          loading={loading}
        />
        <KpiCard
          label="OT Cost"
          value={summary ? fmtCost(summary.total_ot_cost_period, currency) : "0"}
          sub="Estimated 1.5× rate"
          color={
            summary && summary.total_ot_cost_period > 0
              ? "text-amber-600 dark:text-amber-400"
              : "text-gray-400"
          }
          loading={loading}
        />
        <KpiCard
          label="Leave Approved"
          value={summary?.total_leave_approved_period ?? 0}
          sub={`Last ${months} months`}
          color="text-green-600 dark:text-green-400"
          loading={loading}
        />
        <KpiCard
          label="Open Disputes"
          value={summary?.open_disputes ?? 0}
          color={
            summary && summary.open_disputes > 0
              ? "text-red-600 dark:text-red-400"
              : "text-gray-400"
          }
          loading={loading}
        />
      </div>

      {/* Statutory remittance — what's due to the authority for the period */}
      <RemittanceSummary companyId={companyId} />

      {/* Phase 3 — country assignment history / reporting */}
      <CountryAssignmentsReport />

      {/* Charts — 2 columns on large screens */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {loading ? (
          <>
            <ChartSkeleton />
            <ChartSkeleton />
            <ChartSkeleton />
            <ChartSkeleton />
            <ChartSkeleton />
            <ChartSkeleton />
            <div className="lg:col-span-2">
              <ChartSkeleton />
            </div>
          </>
        ) : data ? (
          <>
            <HeadcountTrendChart data={data.headcount_trend} />
            <AttendanceRateChart data={data.attendance_by_month} />
            <OvertimeCostChart data={data.ot_cost_by_month} />
            <DisputeResolutionChart data={data.dispute_resolution} />
            <PayrollCostChart data={data.payroll_cost_by_month} />
            <TurnoverChart data={data.turnover_by_month} />
            <div className="lg:col-span-2">
              <LeaveUtilizationChart data={data.leave_utilization} />
            </div>
          </>
        ) : (
          <div className="lg:col-span-2 flex items-center justify-center h-64 text-gray-400 text-sm">
            No data available. Try refreshing.
          </div>
        )}
      </div>
    </div>
  );
}
