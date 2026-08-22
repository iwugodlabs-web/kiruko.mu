"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from 'next/navigation';
import { CheckCircle, Users, Clock, FileText, BarChart2, AlertTriangle, ArrowRight, Bell, ShieldCheck, Scale, CalendarDays, DollarSign, RefreshCw } from "lucide-react";
import AlertDetailsModal, { AlertItem } from '@/components/ui/AlertDetailsModal';
import { useAuth } from "@/contexts/AuthContext";
import { useCompanyCurrency } from "@/hooks/useCompanyCurrency";
import { api, getCompanyDashboardStats } from "@/services/apiClient";
import { getDepartments, type ShowDepartment } from "@/services/api";
import SolarisBackground from "@/components/ui/SolarisBackground";
import FilterSelect from "@/components/ui/FilterSelect";
import GettingStartedPanel from "./GettingStartedPanel";
import TrendsWidget, { DashboardTrends } from "./TrendsWidget";

interface CompanyMetrics {
  total_companies?: number;
  total_verified_headcount?: number;
  total_pending_verifications?: number;
  verified_headcount?: number;
  total_employees?: number;
  pending_verifications?: number;
  open_jobs_count?: number;
}

interface LeaveStats {
  [leaveType: string]: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
  };
}

interface DepartmentData {
  name: string;
  count: number;
  roles: Array<{
    title: string;
    count: number;
    tenure: string;
    description: string;
  }>;
}

interface HeadCountData {
  totalEmployees: number;
  departments: DepartmentData[];
}

export interface ActiveSession {
  user_id: number;
  name: string;
  job_title: string;
  start_time: string;
  duration_hours: number;
}

interface DashboardData {
  overview: {
    assignedTasks: number;
    scheduledEmployees: number;
    clockedInEmployees: number;
    pendingRequests: number;
    openPositions: number;
    overdueTasks?: number;
    activeOvertime?: number;
    expiringDocuments?: number;
    clockInAnomalies?: number;
    totalGrossPayroll?: number;
    totalWorkHours?: number;
  };
  alertDetails?: {
    overtime?: AlertItem[];
    overdueTasks?: AlertItem[];
    docs?: AlertItem[];
    attendance?: AlertItem[];
  };
  leaveManagement: LeaveStats;
  headCount: HeadCountData;
  activeSessions?: ActiveSession[];
  trends?: DashboardTrends | null;
  recentActivity?: Array<{
    type: string;
    title: string;
    description: string;
    timestamp: string;
    icon: string;
  }>;
}

interface ExtendedUser {
  user_id: number;
  email: string;
  user_type: 'company' | 'private';
  user_name?: string;
  company?: {
    company_id: number;
    company_name: string;
    brn?: string;
    email?: string;
    phone?: string;
    address?: string;
  };
  isAuthenticated: boolean;
  is_superuser?: boolean;
  roles?: string[];
}

export default function HomeSection() {
  const router = useRouter();
  const { user } = useAuth();
  const companyCcy = useCompanyCurrency();
  // Modal State
  const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
  const [activeAlertType, setActiveAlertType] = useState<'overtime' | 'overdueTasks' | 'docs' | 'attendance'>('overtime');
  const [activeAlertItems, setActiveAlertItems] = useState<AlertItem[]>([]);

  // Metrics state — derive isSuper directly from user to avoid flash
  const extendedUserBase = user as ExtendedUser;
  const [isSuper, setIsSuper] = useState(() => {
    return !!(extendedUserBase?.is_superuser || (extendedUserBase?.roles || []).includes('platform_admin'));
  });
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [metrics, setMetrics] = useState<CompanyMetrics | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState('Monthly');
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [departments, setDepartments] = useState<ShowDepartment[]>([]);

  // Dashboard data state
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Helper to open modal
  const openAlertModal = (type: 'overtime' | 'overdueTasks' | 'docs' | 'attendance', items: AlertItem[] = []) => {
    setActiveAlertType(type);
    setActiveAlertItems(items);
    setIsAlertModalOpen(true);
  };

  useEffect(() => {
    let mounted = true;
    const loadMetrics = async () => {
      if (!user) return;
      setLoadingMetrics(true);
      try {
        const extendedUser = user as ExtendedUser;
        const isPlatformAdmin = !!(extendedUser?.is_superuser || (extendedUser?.roles || []).includes('platform_admin'));
        if (isPlatformAdmin) {
          const resp = await api.get('/company/stats');
          if (!mounted) return;
          setIsSuper(true);
          setMetrics(resp.data || {});
        } else if (extendedUser?.company?.company_id) {
          const cid = extendedUser.company.company_id;
          const resp = await api.get(`/company/${cid}/stats`);
          if (!mounted) return;
          setIsSuper(false);
          setMetrics(resp.data || {});
        }
      } catch (e) {
        console.error('Failed to load metrics', e);
      } finally {
        if (mounted) setLoadingMetrics(false);
      }
    };
    loadMetrics();
    return () => { mounted = false };
  }, [user]);

  const loadDashboardData = useCallback(async (isBackground = false) => {
    if (!user) return;
    const extendedUser = user as ExtendedUser;
    const isPlatformAdmin = !!(extendedUser?.is_superuser || (extendedUser?.roles || []).includes('platform_admin'));
    // Company-side = owner OR a delegated management-role employee (a private
    // user carrying a company role / company_permissions). The backend resolves
    // the company from the employee's private_user and gates on view_attendance.
    const u = user as { private_user?: { company_id?: number }; company_roles?: string[]; company_permissions?: string[] };
    const isCompanySide = extendedUser.user_type === 'company'
      || !!u?.private_user?.company_id
      || (u?.company_roles?.length ?? 0) > 0
      || (u?.company_permissions?.length ?? 0) > 0;
    if (isPlatformAdmin || !isCompanySide) return;

    if (isBackground) setIsRefreshing(true);
    else setLoadingDashboard(true);

    try {
      const resp = await getCompanyDashboardStats(selectedPeriod?.toLowerCase(), selectedDeptId ? Number(selectedDeptId) : undefined);
      if (resp && 'error' in resp) {
        if (!isBackground) {
          if (resp.status === 403) {
            setDashboardError('Company dashboard is not available for this account.');
            return;
          }
          setDashboardError(typeof resp.error === 'string' ? resp.error : 'Failed to load dashboard data');
        }
        return;
      }
      setDashboardData(resp as DashboardData);
      setLastUpdated(new Date());
    } catch (e) {
      if (!isBackground) {
        console.error('Failed to load dashboard data', e);
        setDashboardError('Failed to load dashboard data');
      }
    } finally {
      if (isBackground) setIsRefreshing(false);
      else setLoadingDashboard(false);
    }
  }, [user, selectedPeriod, selectedDeptId]);

  useEffect(() => {
    loadDashboardData(false);
  }, [loadDashboardData]);

  // Department list for the overview filter dropdown.
  useEffect(() => {
    const cid = (user as ExtendedUser)?.company?.company_id
      ?? (user as { private_user?: { company_id?: number } })?.private_user?.company_id;
    if (!cid) return;
    getDepartments(cid).then((d) => { if (Array.isArray(d)) setDepartments(d); });
  }, [user]);

  // Auto-refresh every 60 seconds (background, no spinner)
  useEffect(() => {
    if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    autoRefreshRef.current = setInterval(() => {
      loadDashboardData(true);
    }, 60_000);
    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    };
  }, [loadDashboardData]);

  // Period date-range label shown under the toggle
  const getPeriodRange = () => {
    const now = new Date();
    const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    if (selectedPeriod === 'Daily') return now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    if (selectedPeriod === 'Weekly') {
      const from = new Date(now); from.setDate(from.getDate() - 7);
      return `${fmt(from)} – ${fmt(now)}`;
    }
    if (selectedPeriod === 'Monthly') {
      const from = new Date(now); from.setDate(from.getDate() - 30);
      return `${fmt(from)} – ${fmt(now)}`;
    }
    return '';
  };

  const getUpdatedAgo = () => {
    if (!lastUpdated) return null;
    const secs = Math.floor((Date.now() - lastUpdated.getTime()) / 1000);
    if (secs < 30) return 'Just now';
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    return `${mins}m ago`;
  };

  // Only use headCount from the dashboard API — don't fall back to metrics (different meaning/scope)
  const totalEmployees = dashboardData?.headCount?.totalEmployees ?? 0;
  // Derive clockedIn from the actual session list (most accurate) then fall back to API count
  const clockedIn = dashboardData?.activeSessions != null
    ? dashboardData.activeSessions.length
    : (dashboardData?.overview?.clockedInEmployees ?? 0);
  const utilization = totalEmployees > 0 ? Math.round((clockedIn / totalEmployees) * 100) : 0;
  const scheduledToday = dashboardData?.overview?.scheduledEmployees || 0;
  const pendingLeaves = dashboardData?.overview?.pendingRequests || 0;
  const overdueAlerts = (dashboardData?.overview?.overdueTasks || 0) + (dashboardData?.overview?.expiringDocuments || 0) + (dashboardData?.overview?.clockInAnomalies || 0);

  // Leave totals
  const leaveTotals = dashboardData?.leaveManagement
    ? Object.values(dashboardData.leaveManagement).reduce(
        (acc, v) => ({ pending: acc.pending + v.pending, approved: acc.approved + v.approved, rejected: acc.rejected + v.rejected, total: acc.total + v.total }),
        { pending: 0, approved: 0, rejected: 0, total: 0 }
      )
    : null;

  return (
    <SolarisBackground>
      <div className="w-full max-w-7xl mx-auto py-8 px-6 space-y-6">

        {/* ── Page Header ─────────────────────────────────────────────── */}
        <div className="flex items-start justify-between border-b border-gray-200 dark:border-gray-800 pb-4">
          <div>
            {(() => {
              const extUser = user as ExtendedUser;
              const rawName = extUser?.user_name ?? '';
              const isEmail = rawName.includes('@');
              // Greet by the person's actual name first — this covers delegated
              // role-holders (HR Manager etc.) whose user_name is an email and who
              // have no company object. Fall back to a non-email user_name, then
              // the company name.
              const firstName = (extUser as any)?.private_user?.first_name as string | undefined;
              // Greet by the person's own first name. An owner has no personal
              // name here, so the company name (below) carries their identity
              // instead of repeating it in the greeting.
              const displayName = firstName?.trim()
                ? firstName.trim().split(' ')[0]
                : !isEmail && rawName
                  ? rawName.split(' ')[0]
                  : '';
              const tod = new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening';
              // An owner carries the company on `company`; a delegated role-holder
              // (HR etc.) carries it on private_user.company. Resolve both so a
              // representative sees the company they're acting for.
              const company = extUser?.company ?? (extUser as any)?.private_user?.company;
              // The capacity the user is acting in — Owner, or their assigned
              // company role (e.g. "HR Manager"). Surfaces that a delegate like Ben
              // is acting AS an admin role, not as the owner.
              const prettyRole = (s?: string) =>
                (s ?? '').split(/[_\s]+/).filter(Boolean)
                  .map(w => (w.toLowerCase() === 'hr' ? 'HR' : w.charAt(0).toUpperCase() + w.slice(1)))
                  .join(' ');
              const companyRoles = (extUser as any)?.company_roles as string[] | undefined;
              const roleLabel = isSuper ? ''
                : extUser?.user_type === 'company' ? 'Owner'
                : companyRoles && companyRoles.length ? prettyRole(companyRoles[0])
                : (extUser as any)?.is_company_admin ? 'Admin'
                : '';
              return (
                <>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h1 className="font-display font-semibold text-gray-900 dark:text-white text-[2rem] leading-tight tracking-tight">
                      {isSuper ? 'Platform Overview' : (
                        <>
                          Good {tod}
                          {displayName && (
                            <>
                              ,{' '}
                              <span className="bg-gradient-to-r from-amber-500 to-yellow-400 dark:from-amber-400 dark:to-yellow-300 bg-clip-text text-transparent">
                                {displayName}
                              </span>
                            </>
                          )}
                        </>
                      )}
                    </h1>
                    {roleLabel && (
                      <span className="inline-flex items-center rounded-full border border-primary-200 dark:border-primary-900/60 bg-primary-50 dark:bg-primary-900/20 px-2.5 py-0.5 text-xs font-semibold text-primary-700 dark:text-primary-300">
                        {roleLabel}
                      </span>
                    )}
                  </div>
                  {company?.company_name && (
                    <p className="mt-1.5 flex items-center gap-1.5 text-lg sm:text-xl font-display font-semibold leading-tight text-accent-600 dark:text-accent-400">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 shrink-0 opacity-90" aria-hidden="true">
                        <path fillRule="evenodd" d="M4 3a1 1 0 0 0-1 1v12H2a1 1 0 1 0 0 2h16a1 1 0 1 0 0-2h-1V4a1 1 0 0 0-1-1H4Zm3 3a1 1 0 0 0 0 2h1a1 1 0 1 0 0-2H7Zm5 0a1 1 0 1 0 0 2h1a1 1 0 1 0 0-2h-1ZM7 9a1 1 0 0 0 0 2h1a1 1 0 1 0 0-2H7Zm5 0a1 1 0 1 0 0 2h1a1 1 0 1 0 0-2h-1Zm-3 4a1 1 0 0 0-1 1v2h4v-2a1 1 0 0 0-1-1H9Z" clipRule="evenodd" />
                      </svg>
                      {company.company_name}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    <span className="text-sm text-gray-500">
                      {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    </span>
                    {company?.brn && (
                      <>
                        <span className="text-gray-300 dark:text-gray-700">·</span>
                        <span className="text-xs text-gray-400">BRN {company.brn}</span>
                      </>
                    )}
                    {company?.address && (
                      <>
                        <span className="text-gray-300 dark:text-gray-700">·</span>
                        <span className="text-xs text-gray-400 truncate max-w-[200px]">{company.address}</span>
                      </>
                    )}
                  </div>
                </>
              );
            })()}
          </div>

          {/* Period toggle + metadata */}
          <div className="flex flex-col items-end gap-1.5 mt-1">
            <div className="flex items-center gap-2">
              {/* Updated-ago + manual refresh */}
              {lastUpdated && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-gray-400">{getUpdatedAgo()}</span>
                  <button
                    onClick={() => loadDashboardData(false)}
                    disabled={isRefreshing || loadingDashboard}
                    className="w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-40"
                    title="Refresh now"
                  >
                    <RefreshCw size={11} className={isRefreshing ? 'animate-spin' : ''} />
                  </button>
                </div>
              )}
              {/* Department filter */}
              {departments.length > 0 && (
                <FilterSelect
                  label=""
                  value={selectedDeptId}
                  onChange={setSelectedDeptId}
                  options={[
                    { value: "", label: "All departments" },
                    ...departments.map((d) => ({ value: String(d.department_id), label: d.name })),
                  ]}
                  selectClassName="max-w-[150px]"
                />
              )}
              {/* Segment control */}
              <div className="flex items-center bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-0.5">
                {['Daily', 'Weekly', 'Monthly'].map((p) => (
                  <button
                    key={p}
                    onClick={() => setSelectedPeriod(p)}
                    className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                      selectedPeriod === p
                        ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
                        : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            {/* Date range label */}
            <span className="text-[11px] text-gray-400 tabular-nums">{getPeriodRange()}</span>
          </div>
        </div>

        {/* ── Error Banner ─────────────────────────────────────────────── */}
        {dashboardError && (
          <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl">
            <AlertTriangle size={15} className="shrink-0" />
            <p className="text-sm font-medium">{dashboardError}</p>
          </div>
        )}

        {/* ── Platform Admin Cards ─────────────────────────────────────── */}
        {isSuper && (
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Total Companies', value: metrics?.total_companies ?? '—', iconText: 'text-red-600 dark:text-red-400', iconBg: 'bg-red-50 dark:bg-red-500/10', icon: Users, action: () => router.push('/dashboard/employees') },
              { label: 'Verified Headcount', value: metrics?.total_verified_headcount ?? '—', iconText: 'text-emerald-600 dark:text-emerald-400', iconBg: 'bg-emerald-50 dark:bg-emerald-500/10', icon: CheckCircle, action: () => router.push('/dashboard/verification') },
              { label: 'Pending Verifications', value: metrics?.total_pending_verifications ?? '—', iconText: 'text-amber-600 dark:text-amber-400', iconBg: 'bg-amber-50 dark:bg-amber-500/10', icon: AlertTriangle, action: () => router.push('/dashboard/verification') },
            ].map((card) => (
              <button
                key={card.label}
                onClick={card.action}
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm p-5 text-left hover:border-gray-300 dark:hover:border-gray-700 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 group"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className={`w-9 h-9 ${card.iconBg} rounded-lg flex items-center justify-center`}>
                    <card.icon size={16} className={card.iconText} />
                  </div>
                  <ArrowRight size={14} className="text-gray-300 group-hover:text-gray-600 transition-colors" />
                </div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{loadingMetrics ? '—' : card.value}</p>
                <p className="text-sm text-gray-500 mt-1">{card.label}</p>
              </button>
            ))}
          </div>
        )}

        {/* ── Loading (initial only) ────────────────────────────────────── */}
        {(loadingDashboard || loadingMetrics) ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-800 rounded-full animate-spin" />
          </div>
        ) : (
          <div className={`space-y-6 transition-opacity duration-300 ${isRefreshing ? 'opacity-60 pointer-events-none' : 'opacity-100'}`}>

            {/* ── KPI Row ─────────────────────────────────────────────── */}
            {!isSuper && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">

                {/* Clocked In — links to Attendance */}
                <button
                  onClick={() => router.push('/dashboard/attendance')}
                  className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm p-5 text-left hover:border-emerald-300 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 group"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-9 h-9 bg-emerald-50 dark:bg-emerald-500/10 rounded-lg flex items-center justify-center">
                      <Users size={16} className="text-emerald-600" />
                    </div>
                    <span className="flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-md">
                      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                      Live
                    </span>
                  </div>
                  {!dashboardData ? (
                    <>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">
                        —
                        {totalEmployees > 0 && <span className="text-sm font-normal text-gray-400 ml-1">/ {totalEmployees}</span>}
                      </p>
                      <p className="text-sm text-gray-500 mt-1">Clocked In</p>
                      <p className="text-xs text-gray-400 mt-3">Live data from attendance →</p>
                    </>
                  ) : (
                    <>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">
                        {clockedIn}
                        <span className="text-sm font-normal text-gray-400 ml-1">/ {totalEmployees}</span>
                      </p>
                      <p className="text-sm text-gray-500 mt-1">Clocked In</p>
                      <div className="mt-3 w-full h-1 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full transition-all duration-700" style={{ width: `${utilization}%` }} />
                      </div>
                      <p className="text-xs text-emerald-600 mt-1.5 group-hover:underline">{utilization}% utilization →</p>
                    </>
                  )}
                </button>

                {/* Shifts Today — links to Schedule */}
                <button
                  onClick={() => router.push('/dashboard/schedule')}
                  className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm p-5 text-left hover:border-blue-300 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 group"
                >
                  <div className="mb-4">
                    <div className="w-9 h-9 bg-blue-50 dark:bg-blue-500/10 rounded-lg flex items-center justify-center">
                      <CalendarDays size={16} className="text-blue-600" />
                    </div>
                  </div>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">
                    {dashboardData ? scheduledToday : '—'}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">Shifts Today</p>
                  <p className="text-xs text-blue-600 mt-3 font-medium group-hover:underline">View schedule →</p>
                </button>

                {/* Pending Leaves */}
                <button
                  onClick={() => router.push('/dashboard/leave')}
                  className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm p-5 text-left hover:border-amber-300 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 group"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-9 h-9 bg-amber-50 dark:bg-amber-500/10 rounded-lg flex items-center justify-center">
                      <FileText size={16} className="text-amber-600" />
                    </div>
                    {pendingLeaves > 0 && (
                      <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-md">{pendingLeaves} pending</span>
                    )}
                  </div>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">
                    {dashboardData ? pendingLeaves : '—'}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">Leave Requests</p>
                  <p className="text-xs text-amber-600 mt-3 font-medium group-hover:underline">Review requests →</p>
                </button>

                {/* Action Required */}
                <button
                  onClick={() => {
                    if (overdueAlerts > 0) {
                      openAlertModal('overdueTasks', dashboardData?.alertDetails?.overdueTasks);
                    }
                  }}
                  disabled={overdueAlerts === 0}
                  className={`bg-white dark:bg-gray-900 border rounded-2xl shadow-sm p-5 text-left transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 group ${
                    overdueAlerts > 0
                      ? 'border-red-200 dark:border-red-900 hover:border-red-300 cursor-pointer'
                      : 'border-gray-200 dark:border-gray-800 cursor-default'
                  }`}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${overdueAlerts > 0 ? 'bg-red-50 dark:bg-red-500/10' : 'bg-emerald-50 dark:bg-emerald-500/10'}`}>
                      {overdueAlerts > 0
                        ? <AlertTriangle size={16} className="text-red-600" />
                        : <CheckCircle size={16} className="text-emerald-600" />}
                    </div>
                    {overdueAlerts > 0 && (
                      <span className="text-xs font-medium text-red-700 bg-red-50 border border-red-100 px-2 py-0.5 rounded-md">{overdueAlerts} items</span>
                    )}
                  </div>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{overdueAlerts}</p>
                  <p className="text-sm text-gray-500 mt-1">Action Required</p>
                  <p className={`text-xs mt-3 font-medium ${overdueAlerts > 0 ? 'text-red-600 group-hover:underline' : 'text-emerald-600'}`}>
                    {overdueAlerts > 0 ? 'Review alerts →' : 'All clear'}
                  </p>
                </button>
              </div>
            )}

            {/* Getting started — the OWNER's first-run setup wizard ("set up your
                company / payroll structure"). Only shown to the company owner with
                a brand-new company (0 employees); a delegated role-holder (HR etc.)
                is acting inside an already-set-up company, not creating one, so it
                never shows for them. Auto-disappears once the first employee joins. */}
            {totalEmployees === 0 && extendedUserBase?.user_type === 'company' && (
              <GettingStartedPanel companyName={extendedUserBase?.company?.company_name || 'your company'} />
            )}

            {/* ── Main Content ─────────────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">

              {/* Department Table — 2 cols */}
              <div className="lg:col-span-2 self-start bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center">
                      <BarChart2 size={14} className="text-gray-600 dark:text-gray-400" />
                    </div>
                    <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Department Breakdown</h2>
                  </div>
                  {dashboardData?.headCount?.departments && (
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2.5 py-1 rounded-md">
                      {dashboardData.headCount.departments.length} depts
                    </span>
                  )}
                </div>

                {dashboardData?.headCount?.departments && dashboardData.headCount.departments.length > 0 ? (
                  <div className="p-5 space-y-4">
                    {dashboardData.headCount.departments
                      .filter((dept) => {
                        if (!dept.name) return false;
                        const n = dept.name.trim().toLowerCase();
                        return n !== 'null' && n !== 'undefined' && n !== 'unassigned' && n !== 'none' && n !== 'n/a' && n !== '';
                      })
                      .sort((a, b) => b.count - a.count)
                      .slice(0, 8)
                      .map((dept, i) => {
                        const pct = totalEmployees > 0 ? Math.round((dept.count / totalEmployees) * 100) : 0;
                        const colors = ['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#DC2626', '#06B6D4', '#EC4899', '#6366F1'];
                        const color = colors[i % colors.length];
                        const isEmpty = dept.count === 0;
                        return (
                          <div
                            key={dept.name}
                            onClick={() => router.push(`/dashboard/employees?dept=${encodeURIComponent(dept.name)}`)}
                            className="group cursor-pointer"
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="relative flex items-center gap-2 min-w-0">
                                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${isEmpty ? 'opacity-40' : ''}`} style={{ background: color }} />
                                <span className={`text-sm font-medium truncate transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400 ${isEmpty ? 'text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-white'}`}>{dept.name}</span>
                                {/* Role tooltip */}
                                {dept.roles && dept.roles.length > 0 && (
                                  <div className="absolute left-0 top-full mt-1.5 z-20 hidden group-hover:block min-w-[180px] bg-gray-900 dark:bg-gray-800 rounded-lg shadow-xl p-2.5 pointer-events-none">
                                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Roles</p>
                                    {dept.roles.slice(0, 5).map((r, ri) => (
                                      <div key={ri} className="flex items-center justify-between gap-3 py-0.5">
                                        <span className="text-xs text-gray-200 truncate max-w-[120px]">{r.title}</span>
                                        <span className="text-[10px] font-semibold text-gray-400 tabular-nums">{r.count}</span>
                                      </div>
                                    ))}
                                    {dept.roles.length > 5 && (
                                      <p className="text-[10px] text-gray-500 mt-1">+{dept.roles.length - 5} more roles</p>
                                    )}
                                  </div>
                                )}
                              </div>
                              {isEmpty ? (
                                <button
                                  onClick={(e) => { e.stopPropagation(); router.push('/dashboard/employees'); }}
                                  className="text-xs font-medium text-blue-600 hover:underline flex items-center gap-1 shrink-0"
                                >
                                  Invite <ArrowRight size={10} />
                                </button>
                              ) : (
                                <div className="flex items-center gap-2 shrink-0 tabular-nums">
                                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{dept.count}</span>
                                  <span className="text-xs font-semibold" style={{ color }}>{pct}%</span>
                                </div>
                              )}
                            </div>
                            {/* Horizontal bar */}
                            <div className="h-2 w-full bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-700 group-hover:opacity-90"
                                style={{ width: `${isEmpty ? 3 : Math.max(pct, 4)}%`, background: color, opacity: isEmpty ? 0.3 : 1 }}
                              />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-10 text-gray-300">
                    <Users size={24} className="mb-2" />
                    <p className="text-sm font-medium text-gray-400 mb-3">No departments yet</p>
                    <button
                      onClick={() => router.push('/dashboard/employees/onboard')}
                      className="text-xs font-medium text-blue-600 hover:underline flex items-center gap-1"
                    >
                      Onboard your first employee <ArrowRight size={10} />
                    </button>
                  </div>
                )}
              </div>

              {/* Right rail — Live Attendance + Trends, stacked */}
              <div className="space-y-6">
                <div className="self-start bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 bg-emerald-50 dark:bg-emerald-500/10 rounded-lg flex items-center justify-center">
                        <Users size={14} className="text-emerald-600" />
                      </div>
                      <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Live Attendance</h2>
                    </div>
                    <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                      <div className="w-1 h-1 bg-emerald-500 rounded-full animate-pulse" />
                      {clockedIn} Active
                    </span>
                  </div>

                  <div className="divide-y divide-gray-50 dark:divide-gray-800 max-h-[320px] overflow-y-auto">
                    {dashboardData?.activeSessions && dashboardData.activeSessions.length > 0 ? (
                      dashboardData.activeSessions.map((session, idx) => (
                        <div key={idx} className="px-5 py-3 hover:bg-gray-50/50 transition-colors">
                          <div className="flex items-center justify-between mb-0.5">
                            <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{session.name}</p>
                            <span className="text-[10px] font-medium text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">
                              {session.duration_hours}h
                            </span>
                          </div>
                          <p className="text-xs text-gray-500">{session.job_title}</p>
                        </div>
                      ))
                    ) : (
                      <div className="py-8 flex flex-col items-center justify-center text-gray-300">
                        <Clock size={20} className="mb-2 opacity-30" />
                        <p className="text-xs font-medium">No active sessions</p>
                      </div>
                    )}
                  </div>
                  <div className="px-5 py-2.5 bg-gray-50/50 dark:bg-gray-800/40 border-t border-gray-100 dark:border-gray-800">
                    <button
                      onClick={() => router.push('/dashboard/attendance')}
                      className="text-[11px] font-medium text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition-colors flex items-center gap-1"
                    >
                      View attendance logs <ArrowRight size={10} />
                    </button>
                  </div>
                </div>

                <TrendsWidget
                  companyId={(extendedUserBase?.company?.company_id) ?? (extendedUserBase as any)?.private_user?.company_id}
                  trends={dashboardData?.trends}
                />
              </div>
            </div>

            {/* ── Module Summary Row — uniform tiles ──────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-fr">

              {/* Leave Summary (compact) */}
              {leaveTotals && (
                <button
                  onClick={() => router.push('/dashboard/leave')}
                  className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm p-4 text-left hover:border-amber-300 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 group flex flex-col"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-8 h-8 bg-amber-50 dark:bg-amber-500/10 rounded-lg flex items-center justify-center">
                      <FileText size={15} className="text-amber-600" />
                    </div>
                    {leaveTotals.pending > 0 && (
                      <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded-md">{leaveTotals.pending} pending</span>
                    )}
                  </div>
                  <p className="text-xs font-semibold text-gray-900 dark:text-white">Leave</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{leaveTotals.approved} approved · {leaveTotals.total} total</p>
                  <p className="text-[10px] text-amber-600 mt-auto pt-2 group-hover:underline flex items-center gap-0.5">View <ArrowRight size={9} /></p>
                </button>
              )}

              {/* Payroll Snapshot (compact) — always shown for a company so the
                  payroll dimension is never invisible (it was hidden at Rs 0,
                  which made the dashboard look payroll-less while setting up). */}
              {dashboardData?.overview?.totalGrossPayroll !== undefined && (
                <button
                  onClick={() => router.push('/dashboard/payroll/runs')}
                  className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm p-4 text-left hover:border-teal-300 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 group flex flex-col"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-8 h-8 bg-teal-50 dark:bg-teal-500/10 rounded-lg flex items-center justify-center">
                      <DollarSign size={15} className="text-teal-600" />
                    </div>
                    <span className="text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-md">{selectedPeriod}</span>
                  </div>
                  <p className="text-xs font-semibold text-gray-900 dark:text-white">Payroll</p>
                  <p className="text-sm font-bold text-gray-900 dark:text-white tabular-nums mt-0.5">
                    {companyCcy.format(dashboardData.overview.totalGrossPayroll, { maximumFractionDigits: 0 })}
                    <span className="text-[10px] text-gray-400 font-normal ml-1">gross</span>
                  </p>
                  {dashboardData.overview.totalWorkHours !== undefined && (
                    <p className="text-[10px] text-gray-400 mt-0.5 tabular-nums">
                      {dashboardData.overview.totalWorkHours.toLocaleString('en-US', { maximumFractionDigits: 1 })} hrs worked
                    </p>
                  )}
                  <p className="text-[10px] text-teal-600 mt-auto pt-2 group-hover:underline flex items-center gap-0.5">View payroll <ArrowRight size={9} /></p>
                </button>
              )}

              {/* Compliance */}
              <button
                onClick={() => router.push('/dashboard/compliance')}
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm p-4 text-left hover:border-indigo-300 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 group flex flex-col"
              >
                <div className="w-8 h-8 bg-indigo-50 dark:bg-indigo-500/10 rounded-lg flex items-center justify-center mb-3">
                  <ShieldCheck size={15} className="text-indigo-600" />
                </div>
                <p className="text-xs font-semibold text-gray-900 dark:text-white">Compliance</p>
                <p className="text-[11px] text-gray-400 mt-0.5">Permits & visas</p>
                <p className="text-[10px] text-indigo-600 mt-auto pt-2 group-hover:underline flex items-center gap-0.5">View <ArrowRight size={9} /></p>
              </button>

              {/* Disputes */}
              <button
                onClick={() => router.push('/dashboard/disputes')}
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm p-4 text-left hover:border-violet-300 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 group flex flex-col"
              >
                <div className="w-8 h-8 bg-violet-50 dark:bg-violet-500/10 rounded-lg flex items-center justify-center mb-3">
                  <Scale size={15} className="text-violet-600" />
                </div>
                <p className="text-xs font-semibold text-gray-900 dark:text-white">Disputes</p>
                <p className="text-[11px] text-gray-400 mt-0.5">HR case management</p>
                <p className="text-[10px] text-violet-600 mt-auto pt-2 group-hover:underline flex items-center gap-0.5">View <ArrowRight size={9} /></p>
              </button>
            </div>

            {/* ── Bottom Row ── Activity + Alerts (only when data exists) ── */}
            {(() => {
              const hasActivity = dashboardData?.recentActivity && dashboardData.recentActivity.length > 0;
              const alertItems = [
                !!(dashboardData?.overview?.expiringDocuments) && {
                  dot: 'bg-red-400', label: 'Expiring Documents',
                  sub: `${dashboardData?.overview?.expiringDocuments} items`,
                  action: () => openAlertModal('docs', dashboardData?.alertDetails?.docs),
                  cta: 'Review', ctaColor: 'text-red-600',
                },
                !!(dashboardData?.overview?.clockInAnomalies) && {
                  dot: 'bg-amber-400', label: 'Attendance Gaps',
                  sub: `${dashboardData?.overview?.clockInAnomalies} anomalies`,
                  action: () => openAlertModal('attendance', dashboardData?.alertDetails?.attendance),
                  cta: 'Review', ctaColor: 'text-amber-600',
                },
                (dashboardData?.overview?.activeOvertime ?? 0) > 0 && {
                  dot: 'bg-amber-400', label: 'Overtime Pending',
                  sub: `${dashboardData?.overview?.activeOvertime} awaiting approval`,
                  action: () => router.push('/dashboard/overtime'),
                  cta: 'Approve', ctaColor: 'text-amber-600',
                },
                pendingLeaves > 0 && {
                  dot: 'bg-violet-400', label: 'Leave Requests',
                  sub: `${pendingLeaves} awaiting review`,
                  action: () => router.push('/dashboard/leave'),
                  cta: 'Review', ctaColor: 'text-violet-600',
                },
              ].filter(Boolean) as Array<{ dot: string; label: string; sub: string; action: () => void; cta: string; ctaColor: string }>;

              if (!hasActivity && alertItems.length === 0) return null;

              return (
                <div className={`grid grid-cols-1 gap-6 ${hasActivity && alertItems.length > 0 ? 'lg:grid-cols-3' : ''}`}>
                  {/* Recent Activity */}
                  {hasActivity && (
                    <div className={`${alertItems.length > 0 ? 'lg:col-span-2' : ''} bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden`}>
                      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
                        <div className="w-7 h-7 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center">
                          <Bell size={14} className="text-gray-600 dark:text-gray-400" />
                        </div>
                        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Recent Activity</h2>
                      </div>
                      <div className="px-5 py-5">
                        <div className="relative">
                          {/* Timeline rail */}
                          <div className="absolute left-[11px] top-3 bottom-3 w-px bg-gray-200 dark:bg-gray-700" />
                          <div className="space-y-5">
                            {dashboardData!.recentActivity!.slice(0, 5).map((activity, idx) => {
                              const tone = activity.icon === 'Users'
                                ? 'bg-blue-500'
                                : activity.icon === 'FileText'
                                  ? 'bg-violet-500'
                                  : 'bg-emerald-500';
                              return (
                                <div key={idx} className="relative flex items-start gap-3">
                                  {/* Dot on the rail (ring matches the card bg to punch through the line) */}
                                  <div className="relative z-10 w-6 h-6 rounded-full bg-white dark:bg-gray-900 ring-4 ring-white dark:ring-gray-900 flex items-center justify-center shrink-0">
                                    <span className={`w-2.5 h-2.5 rounded-full ${tone}`} />
                                  </div>
                                  <div className="flex-1 min-w-0 pt-0.5">
                                    <div className="flex items-start justify-between gap-2">
                                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate leading-tight">{activity.title}</p>
                                      <p className="text-[11px] text-gray-400 shrink-0 whitespace-nowrap">
                                        {activity.timestamp ? new Date(activity.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'Recent'}
                                      </p>
                                    </div>
                                    <p className="text-xs text-gray-400 truncate mt-0.5">{activity.description}</p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Alerts — only rendered when there are real items */}
                  {alertItems.length > 0 && (
                    <div className="bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-900/40 rounded-xl overflow-hidden">
                      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-amber-100 dark:border-amber-900/30 bg-amber-50/50 dark:bg-amber-900/10">
                        <div className="w-7 h-7 bg-amber-100 dark:bg-amber-900/30 rounded-lg flex items-center justify-center">
                          <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400" />
                        </div>
                        <div>
                          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Needs Attention</h2>
                          <p className="text-[10px] text-amber-600 dark:text-amber-400">{alertItems.length} item{alertItems.length !== 1 ? 's' : ''} require action</p>
                        </div>
                      </div>
                      <div className="divide-y divide-gray-50 dark:divide-gray-800">
                        {alertItems.map((alert) => (
                          <div key={alert.label} className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                            <div className={`w-1.5 h-1.5 rounded-full ${alert.dot} shrink-0`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 dark:text-white">{alert.label}</p>
                              <p className="text-xs text-gray-500">{alert.sub}</p>
                            </div>
                            <button onClick={alert.action} className={`text-xs font-semibold ${alert.ctaColor} hover:underline shrink-0`}>{alert.cta}</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

          </div>
        )}

        <AlertDetailsModal
          isOpen={isAlertModalOpen}
          onClose={() => setIsAlertModalOpen(false)}
          type={activeAlertType}
          items={activeAlertItems}
        />
      </div>
    </SolarisBackground>
  );
}

