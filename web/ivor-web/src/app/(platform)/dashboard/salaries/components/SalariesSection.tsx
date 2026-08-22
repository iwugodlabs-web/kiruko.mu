"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/services/apiClient";
import { CompanySalariesResponse, SalaryFormData, SalaryRow } from "./types";
import SalaryListTable from "./SalaryListTable";
import SalaryConfigModal from "./SalaryConfigModal";
import MissingSalaryBanner from "./MissingSalaryBanner";
import { DollarSign, Users, AlertTriangle, TrendingUp, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { fetchCompanyUsers } from "@/services/api";
import { formatMoney } from "@/utils/payrollFormat";
import DashboardHeader from "@/components/ui/DashboardHeader";
import ExampleCallout from "@/components/ui/ExampleCallout";
import SearchInput from "@/components/ui/SearchInput";
import useDebouncedValue from "@/hooks/useDebouncedValue";

const LIMIT = 100;

/**
 * Build placeholder salary rows from the company users list, so employees are
 * visible even before a salary record exists (or when the salary endpoint
 * fails). Shared by both fallback branches in fetchSalaries.
 */
function buildFallbackRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  usersRes: any[],
  companyId: number,
): SalaryRow[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return usersRes.map((u: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const job = u.private_user?.jobs?.find((j: any) => j.company_id === companyId) ?? u.private_user?.jobs?.[0];
    return {
      // 0 is a safe "missing" sentinel here (Postgres serial PKs never
      // start at 0) — falling back to u.user_id would silently target a
      // completely different, unrelated user's account whenever
      // private_user is unexpectedly null (same bug class as the
      // DepartmentsSection.tsx private_user_id/user_id mixup).
      job_id: job?.job_id ?? 0,
      private_user_id: u.private_user?.private_user_id ?? 0,
      user_id: u.user_id,
      salary_id: null,
      employee_name: `${u.private_user?.first_name ?? ""} ${u.private_user?.last_name ?? ""}`.trim() || u.email,
      employee_code: u.private_user?.employee_code ?? null,
      email: u.email ?? null,
      phone: u.private_user?.phone ?? null,
      gender: u.private_user?.gender ?? null,
      date_of_birth: u.private_user?.date_of_birth ?? null,
      passport_number: u.private_user?.pass_port_number ?? null,
      first_date_of_employment: job?.first_date_of_employment ?? null,
      employer_brn: job?.employer_brn ?? null,
      job_title: job?.job_title ?? null,
      department: u.private_user?.department?.name ?? u.private_user?.department?.department_name ?? null,
      department_id: u.private_user?.department_id ?? null,
      salary: null,
      allowance: null,
      revenue: null,
      currency: null,
      monthly_hours: null,
      days_of_work_per_month: null,
      break_in_minutes_per_day: null,
      hourly_rate: null,
      has_salary: false,
    };
  });
}

export default function SalariesSection() {
  const { user, companyId } = useAuth();

  const [data, setData] = useState<CompanySalariesResponse | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missingOnly, setMissingOnly] = useState(false);
  const [editRow, setEditRow] = useState<SalaryRow | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebouncedValue(searchQuery, 250);

  const fetchSalaries = useCallback(
    async (off = 0, missing = missingOnly, silent = false) => {
      if (!companyId) return;
      if (!silent) setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          limit: String(LIMIT),
          offset: String(off),
          ...(missing ? { missing_only: "true" } : {}),
        });
        const res = await api.get<CompanySalariesResponse>(
          `/job/salary/company/${companyId}?${params}`
        );
        const apiData: CompanySalariesResponse = res.data;

        // If the salary endpoint returns no rows, fall back to company users list
        // so employees are visible even before salary is configured
        if (!apiData.data || apiData.data.length === 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const usersRes = await fetchCompanyUsers(companyId) as any[];
          if (Array.isArray(usersRes) && usersRes.length > 0) {
            const fallbackRows = buildFallbackRows(usersRes, companyId);
            setData({ data: fallbackRows, total: fallbackRows.length, missing_count: fallbackRows.length, limit: LIMIT, offset: off });
            setOffset(off);
            return;
          }
        }

        setData(apiData);
        setOffset(off);
      } catch {
        // On any API failure, try the user list as a fallback
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const usersRes = await fetchCompanyUsers(companyId) as any[];
          if (Array.isArray(usersRes)) {
            const fallbackRows = buildFallbackRows(usersRes, companyId);
            setData({ data: fallbackRows, total: fallbackRows.length, missing_count: fallbackRows.length, limit: LIMIT, offset: off });
            setOffset(off);
          } else {
            setError("Failed to load salary data.");
          }
        } catch {
          setError("Failed to load salary data.");
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [companyId, missingOnly]
  );

  useEffect(() => {
    fetchSalaries(0, missingOnly);
  }, [fetchSalaries, missingOnly]);

  async function handleSave(jobId: number | null, salaryId: number | null, formData: SalaryFormData) {
    if (!jobId) {
      toast.error("Cannot configure salary: this employee has no job record linked to this company. Please complete their onboarding first.");
      return;
    }
    // `revenue` is derived server-side (revenue = salary + allowance) — the
    // backend ignores any client value, so we only send the authoritative
    // `salary` and `allowance`. (Previously this wrote revenue = allowance,
    // which corrupted the gross.)
    const payload = {
      job_id: jobId,
      salary: formData.salary,
      allowance: formData.allowance,
      currency: formData.currency,
      monthly_hours: formData.monthly_hours,
      days_of_work_per_month: formData.days_of_work_per_month,
      break_in_minutes_per_day: formData.break_in_minutes_per_day,
    };
    if (salaryId) {
      await api.put(`/job/salary/update/${salaryId}`, payload);
    } else {
      await api.post(`/job/salary`, payload);
    }
    toast.success("Salary saved successfully.");
    fetchSalaries(offset, missingOnly, true);
  }

  function handleShowMissing() {
    setMissingOnly(true);
  }

  const allRows = data?.data ?? [];
  const totalRows = data?.total ?? 0;
  const missingCount = data?.missing_count ?? 0;

  const rows = (() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter((r) =>
      (r.employee_name?.toLowerCase().includes(q))
      || (r.job_title?.toLowerCase().includes(q))
      || (r.department?.toLowerCase().includes(q))
      || (r.email?.toLowerCase().includes(q))
    );
  })();

  // Summary cards. Avg monthly pay = base + allowance (mobile-canonical
  // `allowance` column, with legacy `revenue` as fallback). Previously this
  // averaged the allowance alone, which understated the figure dramatically.
  const configured = rows.filter((r) => r.has_salary).length;
  const totalPay = (r: SalaryRow): number =>
    parseFloat(r.salary ?? "0") + parseFloat(r.allowance ?? r.revenue ?? "0");
  const configuredRows = rows.filter((r) => r.has_salary);
  // Averaging across currencies is meaningless — only compute an Avg Monthly
  // Pay figure when every configured row shares a single currency. If the rows
  // span multiple currencies (or none is set), surface "Mixed" instead of a
  // figure mislabeled with one row's currency.
  const payCurrencies = new Set(configuredRows.map((r) => r.currency ?? ""));
  const singleCurrency = payCurrencies.size === 1 ? [...payCurrencies][0] : null;
  const avgSalary = configuredRows.length > 0
    ? configuredRows.reduce((sum, r) => sum + totalPay(r), 0) / configuredRows.length
    : 0;

  const summaryCards = [
    {
      label: "Total Employees",
      value: totalRows,
      icon: <Users size={18} />,
      color: "text-blue-600 dark:text-blue-400",
    },
    {
      label: "Salary Configured",
      value: configured,
      icon: <DollarSign size={18} />,
      color: "text-green-600 dark:text-green-400",
    },
    {
      label: "Missing Salary",
      value: missingCount,
      icon: <AlertTriangle size={18} />,
      color: missingCount > 0 ? "text-red-600 dark:text-red-400" : "text-gray-400",
    },
    {
      label: "Avg Monthly Pay",
      value: configuredRows.length === 0
        ? "—"
        : singleCurrency
        ? formatMoney(Math.round(avgSalary), singleCurrency)
        : "Mixed",
      icon: <TrendingUp size={18} />,
      color: "text-blue-600 dark:text-blue-400",
    },
  ];

  if (!companyId) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 dark:text-gray-500">
        No company associated with your account.
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col gap-6 p-6">
      <DashboardHeader
        title="Salary Management"
        subtitle="Configure and manage salary packages for all employees."
        extra={
          <button
            onClick={() => fetchSalaries(offset, missingOnly)}
            disabled={loading}
            title="Refresh"
            className="p-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
        }
      />

      <ExampleCallout caption="A typical employee salary record">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-zinc-500">Employee</dt>
          <dd className="text-zinc-900">Sarah Smith · Sales</dd>
          <dt className="text-zinc-500">Currency</dt>
          <dd className="text-zinc-900">MUR</dd>
          <dt className="text-zinc-500">Base salary</dt>
          <dd className="text-zinc-900 tabular-nums">30,000.00 / month</dd>
          <dt className="text-zinc-500">Allowances</dt>
          <dd className="text-zinc-900 tabular-nums">5,000.00 / month <span className="text-zinc-500">(transport, meal, housing — anything fixed on top of base)</span></dd>
          <dt className="text-zinc-500">Total monthly pay</dt>
          <dd className="text-zinc-900 font-semibold tabular-nums">35,000.00 MUR</dd>
          <dt className="text-zinc-500">Monthly hours</dt>
          <dd className="text-zinc-900">173 <span className="text-zinc-500">(MU statutory: 40h × 52w ÷ 12)</span></dd>
          <dt className="text-zinc-500">Work days / month</dt>
          <dd className="text-zinc-900">22</dd>
          <dt className="text-zinc-500">Break / day</dt>
          <dd className="text-zinc-900">60 min</dd>
        </dl>
        <p className="text-xs text-zinc-500 mt-2">
          <strong>Base salary</strong> is the contracted figure. <strong>Allowances</strong> are fixed extras
          paid every month (transport, meal, housing). The two add up to <strong>Total monthly pay</strong>,
          which drives the hourly-rate calculation and is what the payroll engine uses as the gross before
          statutory deductions.
        </p>
      </ExampleCallout>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryCards.map((card) => (
          <div key={card.label} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4 flex items-center gap-4">
            <div className={card.color}>{card.icon}</div>
            <div className="min-w-0">
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{card.label}</p>
              {loading ? (
                <div className="h-6 w-12 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mt-1" />
              ) : (
                <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{card.value}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Missing salary banner */}
      {!loading && missingCount > 0 && !missingOnly && (
        <MissingSalaryBanner count={missingCount} onShowMissing={handleShowMissing} />
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Table card */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex-wrap">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {missingOnly ? "Missing Salary Configuration" : "All Employees"}
            </h2>
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {debouncedSearch
                ? // Client-side search only filters the rows already loaded for
                  // this page (the backend has no search param). Make the scope
                  // explicit so the count never implies it searched all employees.
                  `${rows.length} match${rows.length === 1 ? "" : "es"} on this page${
                    totalRows > allRows.length ? ` (of ${allRows.length} loaded · ${totalRows} total)` : ""
                  }`
                : `${totalRows} total`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search by name, role, or department…"
              className="w-72 max-w-full"
            />
            {missingOnly && (
              <button
                onClick={() => setMissingOnly(false)}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 underline underline-offset-2 transition-colors"
              >
                Show all
              </button>
            )}
          </div>
        </div>
        <div className="p-4">
          <SalaryListTable
            rows={rows}
            total={totalRows}
            limit={LIMIT}
            offset={offset}
            loading={loading}
            onEdit={setEditRow}
            onPageChange={(off) => fetchSalaries(off, missingOnly)}
          />
        </div>
      </div>

      {/* Config modal */}
      <SalaryConfigModal
        row={editRow}
        onClose={() => setEditRow(null)}
        onSave={handleSave}
      />
    </div>
  );
}
