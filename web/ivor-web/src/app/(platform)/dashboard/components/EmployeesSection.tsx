"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
    Users,
    Plus,
    ArrowUpDown,
    AlertTriangle,
    X,
    UserX,
    CheckCircle,
    UserPlus,
    Clock,
    KeyRound,
    Upload,
} from "lucide-react";

import EmployeesDetails from "./EmployeesDetails";
import InviteWithRoleModal from "./InviteWithRoleModal";
import EmployeeImportModal from "./EmployeeImportModal";
import AccessHistoryDrawer from "./AccessHistoryDrawer";
import { fetchCompanyUsers, updateJobSimple, getCompanyGeofences, setUserHomeSite } from "../../../../services/api";
import EmptyState from "@/components/ui/EmptyState";
import useDebouncedValue from "@/hooks/useDebouncedValue";
import { api } from "../../../../services/apiClient";
import { useAuth } from "@/contexts/AuthContext";
import useDepartments from '@/hooks/useDepartments';
import { formatAccessRole } from '@/utils/roleFormat';
import DashboardHeader from "@/components/ui/DashboardHeader";
import SolarisBackground from "@/components/ui/SolarisBackground";
import SearchInput from "@/components/ui/SearchInput";
import FilterPillGroup from "@/components/ui/FilterPillGroup";
import { toast } from "sonner";

type Employee = {
    id: number;
    name: string;
    role: string | null;
    accessRole: string | null;      // company RBAC role (HR Manager, …) if assigned
    department: string | null;      // resolved display name
    department_id: number | null;   // raw id for late-resolution when map loads
    home_site_id?: number | null;
    home_site_name?: string | null;
    status: string;
    avatar: string;
    email: string;
    phone: string;
    joinDate: string;
    user_id: number;
    private_user_id: number;
    employee_code: string | null;
    job_details?: any;
    verified: boolean;
    passport_number?: string;
    date_of_birth?: string;
    gender?: string;
};

export default function EmployeesSection() {
    const router = useRouter();
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [sites, setSites] = useState<{ geofence_id: number; name: string }[]>([]);
    const [busySiteId, setBusySiteId] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const searchParams = useSearchParams();
    const [searchQuery, setSearchQuery] = useState(() => searchParams?.get('q') ?? '');
    const [showInviteModal, setShowInviteModal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [sortBy, setSortBy] = useState<'name' | 'role' | 'status'>('name');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

    // Confirmation state
    const [employeeToRemove, setEmployeeToRemove] = useState<Employee | null>(null);
    const [isRemoving, setIsRemoving] = useState(false);

    // Access drawer
    const [accessEmployee, setAccessEmployee] = useState<Employee | null>(null);

    // Pending onboarding-draft banner. Read on mount (in a useEffect, not
    // during render) so SSR/CSR markup matches — previously the banner
    // popped in abruptly after hydration. Stale drafts older than 14 days
    // are auto-cleared so abandoned drafts don't linger forever.
    const [draftBanner, setDraftBanner] = useState<{ name: string; stepLabel: string } | null>(null);
    useEffect(() => {
        try {
            const raw = localStorage.getItem("ivor_onboard_draft");
            if (!raw) return;
            const d = JSON.parse(raw);
            const savedAtMs = typeof d?.savedAt === "number" ? d.savedAt : null;
            const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
            if (savedAtMs && Date.now() - savedAtMs > STALE_AFTER_MS) {
                localStorage.removeItem("ivor_onboard_draft");
                return;
            }
            const name = [d?.first_name, d?.last_name].filter(Boolean).join(" ") || d?.email || "Unnamed";
            const stepLabel = ["Personal Info","Work Authorization","Job Details","Salary","Documents","Review"][d?.step ?? 0] ?? "Step 1";
            setDraftBanner({ name, stepLabel });
        } catch {
            // Corrupt JSON — best-effort clear so the banner doesn't keep firing.
            try { localStorage.removeItem("ivor_onboard_draft"); } catch {}
        }
    }, []);

    const dismissDraft = () => {
        try { localStorage.removeItem("ivor_onboard_draft"); } catch {}
        setDraftBanner(null);
    };

    // Get company info from context. companyId resolves for an owner AND a
    // delegated management employee (HR etc.) — see AuthContext.
    const { companyBrn, companyId, user } = useAuth();
    const { departments, departmentsMap } = useDepartments(companyId ?? undefined);
    const [deptFilter, setDeptFilter] = useState(() => searchParams?.get('dept') ?? '');

    // Mirror search + dept filter into the URL.
    useEffect(() => {
        const params = new URLSearchParams();
        if (searchQuery) params.set('q', searchQuery);
        if (deptFilter) params.set('dept', deptFilter);
        const qs = params.toString();
        router.replace(qs ? `/dashboard/employees?${qs}` : '/dashboard/employees', { scroll: false });
    }, [searchQuery, deptFilter, router]);

    const fetchEmployees = async () => {
        if (!companyId) return;
        setLoading(true);
        try {
            // Fetch ONLY approved employees
            const [response, sitesRes] = await Promise.all([
                fetchCompanyUsers(companyId, 'approved'),
                getCompanyGeofences(companyId),
            ]);

            if ('error' in response) {
                console.error("[Employees] Error fetching company users:", response.error);
                setError(response.error);
                setEmployees([]);
                return;
            }

            const siteMap: Record<number, string> = 'error' in sitesRes
                ? {}
                : Object.fromEntries(sitesRes.map((s: any) => [s.geofence_id, s.name]));
            if (!('error' in sitesRes)) {
                setSites(sitesRes.map((s: any) => ({ geofence_id: s.geofence_id, name: s.name })));
            }

            const users = response as any[]; // Type assertion for the array response

            if (Array.isArray(users)) {
                // Users returned are already approved.
                // We do NOT strictly filter by job anymore.

                // Map API users to Employee state
                const mappedEmployees: Employee[] = users.map((u: any) => {
                    // Resolve department — check job-level first, then user-level, then id lookup
                    const job = u.private_user?.jobs?.find((j: any) => j.company_id === companyId) || u.private_user?.jobs?.[0];
                    // Job title for the role column; the management/access role
                    // (PrivateUser.role slug) is surfaced separately as a badge.
                    const role = job?.job_title || 'Employee';
                    const accessRole = formatAccessRole(u.company_roles?.[0] || u.private_user?.role);
                    const rawDeptId: number | null =
                        job?.department_id
                        ?? u.private_user?.department?.department_id
                        ?? u.private_user?.department_id
                        ?? null;
                    const deptName: string | null =
                        job?.department?.department_name
                        || job?.department?.name
                        || u.private_user?.department?.department_name
                        || u.private_user?.department?.name
                        || (rawDeptId ? departmentsMap[rawDeptId] : null)
                        || null;

                    return {
                        id: u.user_id,
                        name: `${u.private_user?.first_name || ''} ${u.private_user?.last_name || ''}`.trim() || u.email,
                        role: role,
                        accessRole: accessRole,
                        department: deptName,
                        department_id: rawDeptId,
                        home_site_id: u.private_user?.home_geofence_id ?? null,
                        home_site_name: u.private_user?.home_geofence_id ? (siteMap[u.private_user.home_geofence_id] ?? null) : null,
                        status: u.user_enabled ? 'Active' : 'Inactive',
                        avatar: u.profile_image_url || `https://ui-avatars.com/api/?name=${u.private_user?.first_name || 'U'}+${u.private_user?.last_name || 'U'}&background=random`,
                        email: u.email,
                        phone: u.private_user?.phone || 'N/A',
                        joinDate: u.created_at || new Date().toISOString(),
                        user_id: u.user_id,
                        private_user_id: u.private_user?.private_user_id,
                        employee_code: u.private_user?.employee_code ?? null,
                        // Find the relevant job for this company if available
                        job_details: u.private_user?.jobs?.find((j: any) => j.company_id === companyId),
                        verified: u.user_verified,
                        passport_number: u.private_user?.pass_port_number,
                        date_of_birth: u.private_user?.date_of_birth,
                        gender: u.private_user?.gender
                    };
                });

                setEmployees(mappedEmployees);
            } else {
                setEmployees([]);
            }
        } catch (err) {
            console.error('Error fetching employees:', err);
            setError('Failed to load employees');
        } finally {
            setLoading(false);
        }
    };

    // Fetch employees on mount and when company changes
    useEffect(() => {
        fetchEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [companyBrn, companyId]);

    // Re-resolve department names once departmentsMap loads (fixes race condition)
    useEffect(() => {
        if (Object.keys(departmentsMap).length === 0) return;
        setEmployees(prev => prev.map(emp => {
            if (emp.department) return emp; // already resolved
            if (!emp.department_id) return emp;
            const resolved = departmentsMap[emp.department_id] ?? null;
            return resolved ? { ...emp, department: resolved } : emp;
        }));
    }, [departmentsMap]);

    // Assign the employee's home site/branch (shown on their payslips).
    const onChangeSite = async (emp: Employee, siteId: string) => {
        setBusySiteId(emp.user_id);
        const res = await setUserHomeSite(emp.user_id, siteId === "" ? null : Number(siteId));
        if ("error" in res) {
            toast.error(res.error);
        } else {
            setEmployees(prev => prev.map(e =>
                e.user_id === emp.user_id
                    ? { ...e, home_site_id: siteId === "" ? null : Number(siteId), home_site_name: siteId === "" ? null : (sites.find(s => s.geofence_id === Number(siteId))?.name ?? null) }
                    : e
            ));
        }
        setBusySiteId(null);
    };

    const handleRemoveEmployee = async () => {
        if (!employeeToRemove) return;

        setIsRemoving(true);
        try {
            // 1. Unset user_verified status AND company_onboarding_status
            await api.patch(`/user/${employeeToRemove.user_id}`, {
                company_onboarding_status: 'rejected'
            });
            await api.patch(`/user/${employeeToRemove.user_id}/verify`, { verified: false });

            // 2. Unlink the job from this company by nulling company_id
            if (employeeToRemove.job_details?.job_id) {
                await updateJobSimple(employeeToRemove.job_details.job_id, { company_id: null } as any);
            }

            // Note: If they are linked via PrivateUser.company_id, that might persist 
            // but setting status to 'rejected' should hide them from both lists.

            // Refresh list
            await fetchEmployees();
            setEmployeeToRemove(null);

        } catch (error) {
            console.error("Failed to remove employee:", error);
            toast.error("Failed to remove employee. Please try again.");
        } finally {
            setIsRemoving(false);
        }
    };

    const debouncedSearch = useDebouncedValue(searchQuery, 250);
    const filteredEmployees = employees
        .filter(emp => {
            const q = debouncedSearch.toLowerCase();
            if (!q) return true;
            return emp.name.toLowerCase().includes(q)
                || emp.email.toLowerCase().includes(q)
                || (emp.role?.toLowerCase().includes(q) ?? false)
                || (emp.accessRole?.toLowerCase().includes(q) ?? false);
        })
        .filter(emp => {
            if (deptFilter === '') return true;
            if (deptFilter === '__none__') return !emp.department;
            return emp.department?.toLowerCase() === deptFilter.toLowerCase();
        })
        .sort((a, b) => {
            const aValue = a[sortBy] || '';
            const bValue = b[sortBy] || '';
            return sortOrder === 'asc'
                ? aValue.toString().localeCompare(bValue.toString())
                : bValue.toString().localeCompare(aValue.toString());
        });

    const handleSort = (key: 'name' | 'role' | 'status') => {
        if (sortBy === key) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(key);
            setSortOrder('asc');
        }
    };

    return (
        <SolarisBackground>
            <div className="w-full max-w-7xl mx-auto py-8 px-6 space-y-6">
                <DashboardHeader
                    title="Employees"
                    subtitle={`Staff directory · ${user?.company?.company_name || 'Organization'}`}
                    extra={
                        <>
                            <SearchInput
                                value={searchQuery}
                                onChange={setSearchQuery}
                                placeholder="Search by name, role or email…"
                                className="w-64"
                            />
                            <Link
                                href="/dashboard/employees/onboard"
                                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
                            >
                                <UserPlus size={14} />
                                Onboard
                            </Link>
                            <button
                                onClick={() => setShowImportModal(true)}
                                className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-900 dark:text-white rounded-lg text-sm font-medium transition-colors"
                            >
                                <Upload size={14} />
                                Import
                            </button>
                            <button
                                onClick={() => setShowInviteModal(true)}
                                className="flex items-center gap-2 px-4 py-2 bg-gray-900 hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-100 text-white dark:text-gray-900 rounded-lg text-sm font-medium transition-colors"
                            >
                                <Plus size={14} />
                                Invite
                            </button>
                        </>
                    }
                />

                {/* Department filter pills */}
                {departments.length > 0 && (
                    <FilterPillGroup
                        value={deptFilter}
                        onChange={setDeptFilter}
                        options={[
                            { value: '', label: 'All', badge: employees.length, showZeroBadge: true, badgeVariant: 'neutral' },
                            ...departments.map(d => ({
                                value: d.name,
                                label: d.name,
                                badge: employees.filter(e => e.department === d.name).length,
                                showZeroBadge: true,
                                badgeVariant: 'neutral' as const,
                            })),
                            ...(employees.some(e => !e.department)
                                ? [{
                                    value: '__none__',
                                    label: 'No department',
                                    badge: employees.filter(e => !e.department).length,
                                    showZeroBadge: true,
                                    badgeVariant: 'neutral' as const,
                                }]
                                : []),
                        ]}
                    />
                )}

                {/* Pending onboarding draft banner — state-driven so it doesn't
                    flicker in after hydration. Auto-clears drafts > 14 days old. */}
                {draftBanner && (
                    <div className="flex items-center justify-between gap-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3">
                        <div className="flex items-center gap-3">
                            <Clock size={15} className="text-amber-500 shrink-0" />
                            <div>
                                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                                    Draft in progress — {draftBanner.name}
                                </p>
                                <p className="text-xs text-amber-600 dark:text-amber-400">
                                    Last saved at step: {draftBanner.stepLabel}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Link
                                href="/dashboard/employees/onboard"
                                className="px-3 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors"
                            >
                                Resume
                            </Link>
                            <button
                                onClick={dismissDraft}
                                aria-label="Dismiss draft"
                                title="Dismiss draft"
                                className="p-1.5 rounded-lg text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    </div>
                )}

                {/* Stats row */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                        { label: 'Active',    value: employees.filter(e => e.status === 'Active').length,  iconBg: 'bg-emerald-50', iconText: 'text-emerald-600', icon: Users },
                        { label: 'Verified',  value: employees.filter(e => e.verified).length,             iconBg: 'bg-blue-50',    iconText: 'text-blue-600',    icon: CheckCircle },
                        { label: 'Inactive',  value: employees.filter(e => e.status !== 'Active').length,  iconBg: 'bg-gray-100',   iconText: 'text-gray-500',    icon: UserX },
                        { label: 'Total',     value: employees.length,                                     iconBg: 'bg-violet-50',  iconText: 'text-violet-600',  icon: ArrowUpDown },
                    ].map((stat, i) => (
                        <div key={i} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
                            <div className="flex items-center gap-2.5 mb-3">
                                <div className={`w-7 h-7 ${stat.iconBg} rounded-lg flex items-center justify-center`}>
                                    <stat.icon size={13} className={stat.iconText} />
                                </div>
                                <span className="text-xs font-medium text-gray-500">{stat.label}</span>
                            </div>
                            <p className="text-xl font-bold text-gray-900 dark:text-white tabular-nums">{loading ? '—' : stat.value}</p>
                        </div>
                    ))}
                </div>

                {/* Table */}
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="border-b border-gray-100 dark:border-gray-800">
                                <th className="px-3 py-3.5 pl-5">
                                    <button onClick={() => handleSort('name')} className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 transition-colors">
                                        Name <ArrowUpDown size={11} />
                                    </button>
                                </th>
                                <th className="px-5 py-3.5">
                                    <button onClick={() => handleSort('role')} className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 transition-colors">
                                        Role / Dept <ArrowUpDown size={11} />
                                    </button>
                                </th>
                                <th className="px-5 py-3.5 hidden md:table-cell">
                                    <span className="text-xs font-medium text-gray-500">Contact</span>
                                </th>
                                <th className="px-5 py-3.5 hidden lg:table-cell">
                                    <span className="text-xs font-medium text-gray-500">Site / Branch</span>
                                </th>
                                <th className="px-5 py-3.5">
                                    <span className="text-xs font-medium text-gray-500">Status</span>
                                </th>
                                <th className="px-5 py-3.5 text-right">
                                    <span className="text-xs font-medium text-gray-500">Actions</span>
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                            {loading ? (
                                <tr>
                                    <td colSpan={6} className="py-20">
                                        <div className="flex flex-col items-center justify-center gap-3">
                                            <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-800 rounded-full animate-spin" />
                                            <span className="text-sm text-gray-400">Loading employees…</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : filteredEmployees.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="p-0">
                                        {employees.length === 0 ? (
                                            <EmptyState
                                                mode="no-data"
                                                icon={Users}
                                                title="No employees yet"
                                                description="Add your first team member to start tracking attendance, payroll, and compliance."
                                                actionLabel="Onboard an employee"
                                                onAction={() => router.push('/dashboard/employees/onboard')}
                                            />
                                        ) : (
                                            <EmptyState
                                                mode="no-results"
                                                icon={Users}
                                                title="No employees match your filters"
                                                description="Try clearing the search or department filter."
                                                actionLabel="Clear filters"
                                                onAction={() => { setSearchQuery(''); setDeptFilter(''); }}
                                            />
                                        )}
                                    </td>
                                </tr>
                            ) : (
                                filteredEmployees.map((employee) => (
                                    <tr
                                        key={employee.id}
                                        className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                                        onClick={() => router.push(`/dashboard/employees/${employee.id}`)}
                                    >
                                        <td className="px-3 py-4 pl-5">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center text-xs font-semibold text-gray-600 shrink-0 overflow-hidden">
                                                    {employee.avatar.includes('http') && !employee.avatar.includes('ui-avatars') ? (
                                                        <img src={employee.avatar} className="w-full h-full object-cover" alt="" />
                                                    ) : (
                                                        employee.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
                                                    )}
                                                </div>
                                                <div>
                                                    <p className="text-sm font-medium text-gray-900 dark:text-white">{employee.name}</p>
                                                    <p className="text-xs text-gray-400">
                                                        {employee.employee_code && (
                                                            <span className="font-mono text-gray-500 dark:text-gray-400">{employee.employee_code}</span>
                                                        )}
                                                        {employee.employee_code && ' · '}
                                                        Joined {new Date(employee.joinDate).toLocaleDateString([], { month: 'short', year: 'numeric' })}
                                                    </p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-5 py-4">
                                            <div className="flex items-center gap-2">
                                                <p className="text-sm font-medium text-gray-900 dark:text-white">{employee.role || 'Employee'}</p>
                                                {employee.accessRole && (
                                                    <span
                                                        title="Dashboard access role (company permissions)"
                                                        className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-500/20"
                                                    >
                                                        {employee.accessRole}
                                                    </span>
                                                )}
                                            </div>
                                            {employee.department
                                                ? <p className="text-xs text-gray-400">{employee.department}</p>
                                                : <p className="text-xs text-gray-300 dark:text-gray-600 italic">No department</p>
                                            }
                                        </td>
                                        <td className="px-5 py-4 hidden md:table-cell">
                                            <p className="text-sm text-gray-600">{employee.email}</p>
                                            <p className="text-xs text-gray-400">{employee.phone}</p>
                                        </td>
                                        <td className="px-5 py-4 hidden lg:table-cell">
                                            {sites.length > 0 ? (() => {
                                                const onDeletedSite = employee.home_site_id != null
                                                    && !sites.some(s => s.geofence_id === employee.home_site_id);
                                                return (
                                                    <select
                                                        value={employee.home_site_id ?? ""}
                                                        disabled={busySiteId === employee.user_id}
                                                        onChange={(e) => onChangeSite(employee, e.target.value)}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 dark:text-white text-xs"
                                                    >
                                                        <option value="">— None —</option>
                                                        {onDeletedSite && (
                                                            <option value={employee.home_site_id ?? undefined} disabled>
                                                                {employee.home_site_name ?? "Old branch"} (removed — reassign)
                                                            </option>
                                                        )}
                                                        {sites.map((s) => (
                                                            <option key={s.geofence_id} value={s.geofence_id}>{s.name}</option>
                                                        ))}
                                                    </select>
                                                );
                                            })() : employee.home_site_name ? (
                                                <p className="text-sm text-gray-600">{employee.home_site_name}</p>
                                            ) : (
                                                <p className="text-xs text-gray-300 dark:text-gray-600 italic">No site</p>
                                            )}
                                        </td>
                                        <td className="px-5 py-4">
                                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${
                                                employee.status === 'Active'
                                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                                                    : 'bg-gray-100 text-gray-600 border border-gray-200'
                                            }`}>
                                                <span className={`w-1.5 h-1.5 rounded-full ${employee.status === 'Active' ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                                                {employee.status}
                                            </span>
                                        </td>
                                        <td className="px-5 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                                            <div className="flex items-center justify-end gap-1">
                                                <button
                                                    onClick={() => setAccessEmployee(employee)}
                                                    className="w-8 h-8 inline-flex items-center justify-center text-gray-300 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors"
                                                    title="View access & permissions"
                                                >
                                                    <KeyRound size={13} />
                                                </button>
                                                <button
                                                    onClick={() => setEmployeeToRemove(employee)}
                                                    className="w-8 h-8 inline-flex items-center justify-center text-gray-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                    title="Remove employee"
                                                >
                                                    <UserX size={14} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {showInviteModal && companyId && (
                    <InviteWithRoleModal
                        companyId={companyId}
                        departments={departments}
                        onClose={() => setShowInviteModal(false)}
                        onInvited={fetchEmployees}
                    />
                )}

                {companyId && (
                    <EmployeeImportModal
                        companyId={companyId}
                        open={showImportModal}
                        onClose={() => setShowImportModal(false)}
                        onImported={fetchEmployees}
                    />
                )}

                {accessEmployee && companyId && (
                    <AccessHistoryDrawer
                        employee={accessEmployee}
                        companyId={companyId}
                        onClose={() => setAccessEmployee(null)}
                    />
                )}

                {/* Remove Confirmation Modal */}
                {employeeToRemove && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm">
                        <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
                            <div className="flex items-start gap-4 mb-5">
                                <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center shrink-0">
                                    <AlertTriangle size={18} className="text-red-600" />
                                </div>
                                <div>
                                    <h3 className="text-base font-semibold text-gray-900 dark:text-white">Remove employee</h3>
                                    <p className="text-sm text-gray-500 mt-0.5">This will revoke their company access.</p>
                                </div>
                            </div>

                            <p className="text-sm text-gray-600 mb-4">
                                Remove <span className="font-semibold text-gray-900 dark:text-white">{employeeToRemove.name}</span> from the active registry? Their historical data will be retained.
                            </p>

                            <div className="flex gap-3">
                                <button
                                    onClick={() => setEmployeeToRemove(null)}
                                    className="flex-1 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleRemoveEmployee}
                                    disabled={isRemoving}
                                    className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {isRemoving ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : 'Remove'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </SolarisBackground>
    );
}
