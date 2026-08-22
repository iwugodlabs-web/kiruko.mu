"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/services/apiClient";
import { toast } from "sonner";
import {
  ComplianceResponse, ComplianceEmployee, PermitStatus, PERMIT_STATUS_CONFIG, StatusCounts,
} from "./types";
import ComplianceScoreCard from "./ComplianceScoreCard";
import ComplianceFlagBanner from "./ComplianceFlagBanner";
import ExpiryTimeline from "./ExpiryTimeline";
import PermitStatusTable from "./PermitStatusTable";
import PermitDetailDrawer from "./PermitDetailDrawer";
import ComplianceExportButton from "./ComplianceExportButton";
import { RefreshCw, Users, ShieldCheck, AlertTriangle, DollarSign } from "lucide-react";
import { fetchCompanyUsers } from "@/services/api";
import DashboardHeader from "@/components/ui/DashboardHeader";
import FilterPillGroup from "@/components/ui/FilterPillGroup";

type FilterStatus = PermitStatus | "all";

const FILTER_OPTIONS: { id: FilterStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "valid", label: "Valid" },
  { id: "expiring_soon", label: "Expiring Soon" },
  { id: "expired", label: "Expired" },
  { id: "tourist_visa", label: "Tourist Visa" },
  { id: "no_data", label: "No Data" },
];

const EMPTY_COUNTS: StatusCounts = { valid: 0, expiring_soon: 0, expired: 0, tourist_visa: 0, no_data: 0 };

// When the compliance endpoint returns nothing (empty or error), build a
// minimal "no_data" employee list from the company users so the table isn't
// blank. Used in both the empty-response path and the API-failure catch.
function mapUsersToFallbackEmployees(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  usersRes: any[]
): ComplianceEmployee[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return usersRes.map((u: any) => ({
    // 0 is a safe "missing" sentinel here (Postgres serial PKs never start
    // at 0) — falling back to u.user_id would silently target a completely
    // different, unrelated user's account whenever private_user is
    // unexpectedly null (same bug class as the DepartmentsSection.tsx
    // private_user_id/user_id mixup).
    job_id: u.private_user?.jobs?.[0]?.job_id ?? 0,
    private_user_id: u.private_user?.private_user_id ?? 0,
    employee_name: `${u.private_user?.first_name ?? ""} ${u.private_user?.last_name ?? ""}`.trim() || u.email,
    employee_code: u.private_user?.employee_code ?? null,
    passport_number: null,
    job_title: u.private_user?.jobs?.[0]?.job_title ?? null,
    department: null,
    department_id: null,
    permit_type: null,
    has_permission_to_work: false,
    working_on_tourist_visa: false,
    expiry_date: null,
    days_until_expiry: null,
    permit_status: "no_data" as PermitStatus,
    permit_doc_id: null,
    permit_doc_url: null,
    currency: null,
    total_monthly_pay: null,
    below_min_wage: false,
    compliance_score: 0,
  }));
}

export default function ComplianceSection() {
  const { user, companyId } = useAuth();

  const [data, setData] = useState<ComplianceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [selectedEmployee, setSelectedEmployee] = useState<ComplianceEmployee | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [activeTab, setActiveTab] = useState<"table" | "timeline">("table");

  const fetchCompliance = useCallback(async (silent = false) => {
    if (!companyId) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await api.get<ComplianceResponse>(`/job/compliance/company/${companyId}`);
      const apiData: ComplianceResponse = res.data;

      // If compliance endpoint returns no employees, fall back to company users
      if (!apiData.employees || apiData.employees.length === 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const usersRes = await fetchCompanyUsers(companyId) as any[];
        if (Array.isArray(usersRes) && usersRes.length > 0) {
          const fallbackEmployees = mapUsersToFallbackEmployees(usersRes);
          setData({
            ...apiData,
            employees: fallbackEmployees,
            expiring_90_days: [],
            total_employees: fallbackEmployees.length,
            status_counts: { valid: 0, expiring_soon: 0, expired: 0, tourist_visa: 0, no_data: fallbackEmployees.length },
            overall_score: 0,
            below_min_wage_count: 0,
          });
          return;
        }
      }
      setData(apiData);
    } catch {
      // On API failure, fall back to user list with no_data compliance status
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const usersRes = await fetchCompanyUsers(companyId) as any[];
        if (Array.isArray(usersRes)) {
          const fallbackEmployees = mapUsersToFallbackEmployees(usersRes);
          setData({
            employees: fallbackEmployees,
            expiring_90_days: [],
            total_employees: fallbackEmployees.length,
            status_counts: { valid: 0, expiring_soon: 0, expired: 0, tourist_visa: 0, no_data: fallbackEmployees.length },
            overall_score: 0,
            below_min_wage_count: 0,
          });
        } else {
          setError("Failed to load compliance data.");
        }
      } catch {
        setError("Failed to load compliance data.");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { fetchCompliance(); }, [fetchCompliance]);

  async function handleRefresh() {
    setSpinning(true);
    await fetchCompliance(true);
    setSpinning(false);
  }

  async function handleSendReminder(emp: ComplianceEmployee) {
    try {
      await api.post(`/user/notify/${emp.private_user_id}`, {
        title: "Permit Renewal Reminder",
        message: `Please upload your updated work permit to the Kiruko app. Your permit ${
          emp.expiry_date ? `expires on ${new Date(emp.expiry_date).toLocaleDateString()}` : "information is incomplete"
        }.`,
        type: "permit_reminder",
      });
      toast.success(`Reminder sent to ${emp.employee_name}`);
    } catch {
      toast.error("Could not send reminder. Please try again.");
    }
  }

  const employees = data?.employees ?? [];
  const statusCounts = data?.status_counts ?? EMPTY_COUNTS;
  const score = data?.overall_score ?? 100;

  const summaryCards = [
    { label: "Total Employees", value: data?.total_employees ?? 0, icon: <Users size={18} />, color: "text-blue-600 dark:text-blue-400" },
    { label: "Compliant", value: statusCounts.valid, icon: <ShieldCheck size={18} />, color: "text-green-600 dark:text-green-400" },
    { label: "Needs Action", value: statusCounts.expired + statusCounts.tourist_visa + statusCounts.expiring_soon, icon: <AlertTriangle size={18} />, color: "text-red-600 dark:text-red-400" },
    { label: "Below Min Wage", value: data?.below_min_wage_count ?? 0, icon: <DollarSign size={18} />, color: data?.below_min_wage_count ? "text-amber-600 dark:text-amber-400" : "text-gray-400" },
  ];

  if (!companyId) return (
    <div className="flex items-center justify-center h-64 text-gray-400 dark:text-gray-500">
      No company associated with your account.
    </div>
  );

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col gap-6 p-6">
      <DashboardHeader
        title="Compliance & Permits"
        subtitle="Work authorization status, permit expiry, and wage compliance across your workforce."
        extra={
          <>
            <ComplianceExportButton employees={employees} />
            <button
              onClick={handleRefresh}
              disabled={spinning}
              className="p-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <RefreshCw size={15} className={spinning ? "animate-spin" : ""} />
            </button>
          </>
        }
      />

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Flag banner */}
      {!loading && data && (
        <ComplianceFlagBanner statusCounts={statusCounts} belowMinWageCount={data.below_min_wage_count} />
      )}

      {/* Top row: score + summary cards */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Score */}
        <div className="lg:col-span-1">
          <ComplianceScoreCard score={score} loading={loading} />
        </div>

        {/* Summary cards */}
        <div className="lg:col-span-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
          {summaryCards.map((card) => (
            <div key={card.label} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4 flex items-center gap-3">
              <div className={card.color}>{card.icon}</div>
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
      </div>

      {/* Status filter pills */}
      <FilterPillGroup
        value={filterStatus}
        onChange={setFilterStatus}
        options={FILTER_OPTIONS.map((opt) => ({
          value: opt.id,
          label: opt.label,
          badge: opt.id === "all" ? employees.length : statusCounts[opt.id as PermitStatus] ?? 0,
          showZeroBadge: true,
          badgeVariant: "neutral",
          dotColor: opt.id !== "all" ? PERMIT_STATUS_CONFIG[opt.id as PermitStatus].dotColor : undefined,
        }))}
      />

      {/* Main content card — table + timeline tabs */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
        <div className="flex border-b border-gray-100 dark:border-gray-700 px-4">
          {(["table", "timeline"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-3 px-4 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab
                  ? "border-blue-500 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              }`}
            >
              {tab === "table" ? "Permit Status" : "90-Day Expiry Timeline"}
            </button>
          ))}
        </div>

        <div className="p-4">
          {activeTab === "table" ? (
            <PermitStatusTable
              employees={employees}
              loading={loading}
              filterStatus={filterStatus}
              onRowClick={setSelectedEmployee}
              onSendReminder={handleSendReminder}
            />
          ) : (
            <ExpiryTimeline employees={employees} />
          )}
        </div>
      </div>

      {/* Detail drawer */}
      <PermitDetailDrawer
        employee={selectedEmployee}
        onClose={() => setSelectedEmployee(null)}
        onSendReminder={handleSendReminder}
      />
    </div>
  );
}
