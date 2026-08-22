"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/services/apiClient";
import { getDepartments, getVerifiedEmployees, type ShowDepartment, type VerifiedEmployee } from "@/services/api";
import { DashboardTimeLogs, DateRange, TimeLogRow } from "./types";
import AttendanceDateFilter from "./AttendanceDateFilter";
import AttendanceSummaryCards from "./AttendanceSummaryCards";
import LiveSessionsTable from "./LiveSessionsTable";
import TimeLogTable from "./TimeLogTable";
import TimeLogDetailDrawer from "./TimeLogDetailDrawer";
import AttendanceExportButton from "./AttendanceExportButton";
import { RefreshCw } from "lucide-react";
import DashboardHeader from "@/components/ui/DashboardHeader";
import FilterSelect from "@/components/ui/FilterSelect";

const LIMIT = 50;
// Backend caps a single page at 200 rows.
const FULL_PAGE = 200;
const LIVE_REFRESH_MS = 60_000;

function todayRange(): DateRange {
  const now = new Date();
  const day = now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - ((day + 6) % 7));
  const toISO = (d: Date) => d.toISOString().split("T")[0];
  return { start: toISO(mon), end: toISO(now) };
}

export default function AttendanceSection() {
  const { user, companyId } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const start = searchParams?.get('start');
    const end = searchParams?.get('end');
    if (start && end) return { start, end };
    return todayRange();
  });
  const [logs, setLogs] = useState<TimeLogRow[]>([]);
  // Full (unpaginated) set of logs for the selected range — drives the
  // range-based summary cards and the History tab counts.
  const [allLogs, setAllLogs] = useState<TimeLogRow[]>([]);
  // Currently-active sessions, fetched WITHOUT the date range so "Clocked In
  // Now" + Live Sessions reflect reality regardless of the history filter.
  const [activeLogs, setActiveLogs] = useState<TimeLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"live" | "history">(
    () => (searchParams?.get('tab') as "live" | "history") ?? "live"
  );

  // Extra filters (department / employee / source).
  const [deptId, setDeptId] = useState<string>("");
  const [employeeId, setEmployeeId] = useState<string>("");
  const [source, setSource] = useState<string>("");
  const [otFilter, setOtFilter] = useState<string>("");
  const [departments, setDepartments] = useState<ShowDepartment[]>([]);
  const [employees, setEmployees] = useState<VerifiedEmployee[]>([]);

  // Populate the department + employee dropdowns once.
  useEffect(() => {
    if (!companyId) return;
    (async () => {
      const d = await getDepartments(companyId);
      if (Array.isArray(d)) setDepartments(d);
      const brn = (user as { company?: { brn?: string } } | null)?.company?.brn;
      const e = await getVerifiedEmployees(brn);
      if (Array.isArray(e)) setEmployees(e);
    })();
  }, [companyId, user]);
  const [selectedLog, setSelectedLog] = useState<TimeLogRow | null>(null);
  const [spinning, setSpinning] = useState(false);

  // Mirror date range and active tab into the URL.
  useEffect(() => {
    const params = new URLSearchParams();
    params.set('start', dateRange.start);
    params.set('end', dateRange.end);
    if (activeTab !== 'live') params.set('tab', activeTab);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [dateRange.start, dateRange.end, activeTab, pathname, router]);

  const liveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = useCallback(
    async (off = 0, silent = false) => {
      if (!companyId) return;
      if (!silent) setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          start_date: dateRange.start,
          end_date: dateRange.end,
          limit: String(LIMIT),
          offset: String(off),
        });
        if (deptId) params.set('department_id', deptId);
        if (employeeId) params.set('private_user_id', employeeId);
        if (source) params.set('source', source);
        if (otFilter) params.set('overtime', otFilter);
        const res = await api.get<DashboardTimeLogs>(
          `/job/time-logs/company/${companyId}/dashboard?${params}`
        );
        setLogs(res.data.data);
        setTotal(res.data.total);
        setOffset(off);
      } catch (e: unknown) {
        setError("Failed to load attendance data. Please try again.");
        console.error(e);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [companyId, dateRange, deptId, employeeId, source, otFilter]
  );

  // Fetch every log in the range (paging through the capped endpoint) so the
  // summary cards and live sessions reflect the whole range, not just one page.
  const fetchAllLogs = useCallback(
    async (silent = false) => {
      if (!companyId) return;
      if (!silent) setSummaryLoading(true);
      try {
        const collected: TimeLogRow[] = [];
        let off = 0;
        for (;;) {
          const params = new URLSearchParams({
            start_date: dateRange.start,
            end_date: dateRange.end,
            limit: String(FULL_PAGE),
            offset: String(off),
          });
          if (deptId) params.set('department_id', deptId);
          if (employeeId) params.set('private_user_id', employeeId);
          if (source) params.set('source', source);
          const res = await api.get<DashboardTimeLogs>(
            `/job/time-logs/company/${companyId}/dashboard?${params}`
          );
          collected.push(...res.data.data);
          off += res.data.data.length;
          if (res.data.data.length < FULL_PAGE || off >= res.data.total) break;
        }
        setAllLogs(collected);
      } catch (e: unknown) {
        // Non-fatal for the page; the history table still loads via fetchLogs.
        console.error(e);
      } finally {
        if (!silent) setSummaryLoading(false);
      }
    },
    [companyId, dateRange, deptId, employeeId, source]
  );

  // Currently-active sessions — date-range-independent (active_only=true), so
  // it always reflects who is clocked in right now.
  const fetchActiveLogs = useCallback(
    async () => {
      if (!companyId) return;
      try {
        const params = new URLSearchParams({ active_only: "true", limit: "200", offset: "0" });
        const res = await api.get<DashboardTimeLogs>(
          `/job/time-logs/company/${companyId}/dashboard?${params}`
        );
        setActiveLogs(res.data.data);
      } catch (e: unknown) {
        console.error(e);
      }
    },
    [companyId]
  );

  // Initial fetch + refetch on filter change
  useEffect(() => {
    setOffset(0);
    fetchLogs(0);
    fetchAllLogs();
    fetchActiveLogs();
  }, [fetchLogs, fetchAllLogs, fetchActiveLogs]);

  // Auto-refresh every 60s for live sessions
  useEffect(() => {
    if (activeTab !== "live") return;
    liveTimerRef.current = setInterval(() => {
      fetchLogs(offset, true);
      fetchAllLogs(true);
      fetchActiveLogs();
    }, LIVE_REFRESH_MS);
    return () => {
      if (liveTimerRef.current) clearInterval(liveTimerRef.current);
    };
  }, [activeTab, fetchLogs, fetchAllLogs, fetchActiveLogs, offset]);

  async function handleManualRefresh() {
    setSpinning(true);
    await Promise.all([fetchLogs(offset, true), fetchAllLogs(true), fetchActiveLogs()]);
    setSpinning(false);
  }

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
        title="Attendance"
        subtitle="Monitor clock-ins, sessions, and overtime across your workforce."
        extra={
          <>
            <AttendanceExportButton companyId={companyId} dateRange={dateRange} />
            <button
              onClick={handleManualRefresh}
              disabled={spinning}
              title="Refresh"
              className="p-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <RefreshCw size={15} className={spinning ? "animate-spin" : ""} />
            </button>
          </>
        }
      />

      {/* Filters: date range + department / employee / source */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 px-4 py-3 flex flex-wrap items-center gap-3">
        <AttendanceDateFilter value={dateRange} onChange={setDateRange} />
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          {([
            { value: deptId, set: setDeptId, all: "All departments", opts: departments.map((d) => ({ v: String(d.department_id), l: d.name })) },
            { value: employeeId, set: setEmployeeId, all: "All employees", opts: employees.filter((e) => e.private_user_id).map((e) => ({ v: String(e.private_user_id), l: e.name })) },
            { value: source, set: setSource, all: "All sources", opts: [{ v: "kiosk", l: "Kiosk" }, { v: "mobile", l: "Mobile" }, { v: "web", l: "Web" }, { v: "admin", l: "Admin" }] },
            { value: otFilter, set: setOtFilter, all: "All entries", opts: [{ v: "any", l: "Overtime (any)" }, { v: "pending", l: "OT pending approval" }, { v: "approved", l: "OT approved" }, { v: "auto", l: "Auto-detected OT" }] },
          ]).map((f, i) => (
            <FilterSelect
              key={i}
              label=""
              value={f.value}
              onChange={(v) => { f.set(v); setOffset(0); }}
              options={[{ value: "", label: f.all }, ...f.opts.map((o) => ({ value: o.v, label: o.l }))]}
              selectClassName="max-w-[160px]"
            />
          ))}
          {(deptId || employeeId || source || otFilter) && (
            <button
              onClick={() => { setDeptId(""); setEmployeeId(""); setSource(""); setOtFilter(""); setOffset(0); }}
              className="text-xs font-medium text-gray-500 hover:text-gray-900 dark:hover:text-gray-200 px-2 py-1.5"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 text-sm text-red-700 dark:text-red-400 flex items-center justify-between gap-4">
          <span>{error}</span>
          <button
            onClick={() => {
              fetchLogs(offset);
              fetchAllLogs();
            }}
            className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Summary cards — range-based stats from allLogs, but "Clocked In Now"
          comes from the date-independent active fetch. */}
      <AttendanceSummaryCards logs={allLogs} activeCount={activeLogs.length} loading={summaryLoading} />

      {/* Tab switcher */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
        <div className="flex border-b border-gray-100 dark:border-gray-700 px-4">
          {(["live", "history"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-3 px-4 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab
                  ? "border-blue-600 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              }`}
            >
              {tab === "live" ? (
                <span className="flex items-center gap-2">
                  <span className="block h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                  Live Sessions
                </span>
              ) : (
                "Time Log History"
              )}
            </button>
          ))}
          <div className="ml-auto self-center">
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {total} record{total !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        <div className="p-4">
          {activeTab === "live" ? (
            <LiveSessionsTable
              logs={activeLogs}
              loading={summaryLoading}
              onRowClick={setSelectedLog}
            />
          ) : (
            <TimeLogTable
              logs={logs}
              total={total}
              limit={LIMIT}
              offset={offset}
              loading={loading}
              onPageChange={(off) => fetchLogs(off)}
              onRowClick={setSelectedLog}
            />
          )}
        </div>
      </div>

      {/* Detail drawer */}
      <TimeLogDetailDrawer log={selectedLog} onClose={() => setSelectedLog(null)} />
    </div>
  );
}
