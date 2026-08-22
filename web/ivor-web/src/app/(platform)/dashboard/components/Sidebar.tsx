"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
    Home,
    Users,
    FileText,
    Settings,
    CircleHelp,
    LogOut,
    CheckCircle,
    UserCheck,
    Bell,
    User,
    Clock,
    DollarSign,
    Wallet,
    ShieldCheck,
    Scale,
    Zap,
    UserPlus,
    CalendarDays,
    FolderOpen,
    BarChart2,

    Settings2,
    Shield,
    Globe,
    Building2,
    UserCog,
    Sun,
    Moon,
    Target,
    Megaphone,
    BadgeDollarSign,
    Sparkles,
    Eye,
    Tablet,
    ClipboardCheck,
    ChevronRight,
} from "lucide-react";
import { getCompanyDashboardStats, getCurrentUser } from '@/services/apiClient';
import { api } from '@/services/apiClient';
import { useTheme } from 'next-themes';
import LocaleSwitcher from '@/components/LocaleSwitcher';

type TooltipState = { label: string; sub?: string; x: number; y: number } | null;

function TooltipPortal({ tip }: { tip: TooltipState }) {
    if (!tip) return null;
    return createPortal(
        <div
            style={{ position: 'fixed', top: tip.y, left: tip.x, transform: 'translateY(-50%)', zIndex: 9999, pointerEvents: 'none' }}
        >
            <div className="bg-gray-900 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-xl">
                {tip.label}
                {tip.sub && <p className="text-gray-400 text-[10px] mt-0.5">{tip.sub}</p>}
                <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-900" />
            </div>
        </div>,
        document.body
    );
}

type DropdownItem = { id: string; label: string; href: string; icon: React.ReactNode; badge?: number; requiredCompanyPermissions?: string[]; requiredPermissions?: string[]; requiredRoles?: string[] };
type DropdownState = { tabId: string; label: string; items: DropdownItem[]; x: number; y: number } | null;

function DropdownPortal({
    dropdown,
    isSubActive,
    onClose,
}: {
    dropdown: DropdownState;
    isSubActive: (href: string, siblings: DropdownItem[]) => boolean;
    onClose: () => void;
}) {
    if (!dropdown) return null;
    return createPortal(
        <>
            <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={onClose} />
            <div
                style={{ position: 'fixed', top: dropdown.y, left: dropdown.x, zIndex: 9999 }}
                className="bg-white border border-gray-100 rounded-xl shadow-xl overflow-hidden w-48"
            >
                <div className="px-3 py-2 border-b border-gray-50">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{dropdown.label}</p>
                </div>
                <div className="p-1.5 flex flex-col gap-0.5">
                    {dropdown.items.map(item => (
                        <Link
                            key={item.id}
                            href={item.href}
                            onClick={onClose}
                            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                                isSubActive(item.href, dropdown.items)
                                    ? 'bg-gray-900 text-white'
                                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                            }`}
                        >
                            <span className="shrink-0">{item.icon}</span>
                            <span className="font-medium">{item.label}</span>
                            {(item.badge || 0) > 0 && (
                                <span className="ml-auto text-[9px] font-bold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-md">
                                    {(item.badge || 0) > 99 ? '99+' : item.badge}
                                </span>
                            )}
                        </Link>
                    ))}
                </div>
                {/* left-pointing caret */}
                <div
                    style={{ position: 'absolute', right: '100%', top: 14, borderWidth: 6, borderStyle: 'solid', borderColor: 'transparent #f3f4f6 transparent transparent' }}
                />
                <div
                    style={{ position: 'absolute', right: 'calc(100% - 1px)', top: 15, borderWidth: 5, borderStyle: 'solid', borderColor: 'transparent white transparent transparent' }}
                />
            </div>
        </>,
        document.body
    );
}

export default function Sidebar() {
    const { user, loading, logout } = useAuth();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const currentTab = searchParams.get("tab");
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    const [companyId, setCompanyId] = useState<number | null>(null);

    // Expand/collapse the sidebar to show labels. Persisted so it sticks.
    const [expanded, setExpanded] = useState(false);
    // When expanded, grouped items (Teams/Payroll/Settings) accordion inline
    // instead of popping a flyout. Tracks which group is open.
    const [openGroup, setOpenGroup] = useState<string | null>(null);
    useEffect(() => {
        try { setExpanded(localStorage.getItem('kiruko_sidebar_expanded') === '1'); } catch { /* ignore */ }
    }, []);
    const toggleExpanded = () => setExpanded((v) => {
        const next = !v;
        try { localStorage.setItem('kiruko_sidebar_expanded', next ? '1' : '0'); } catch { /* ignore */ }
        return next;
    });

    const isPlatformAdmin = user?.isPlatformAdmin ?? false;
    const isCompanyAdmin = user?.isCompanyAdmin ?? false;

    const [tooltip, setTooltip] = useState<TooltipState>(null);
    const [dropdown, setDropdown] = useState<DropdownState>(null);

    const showTip = (e: React.MouseEvent, label: string, sub?: string) => {
        if (expanded) return; // labels are already visible when expanded
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setTooltip({ label, sub, x: rect.right + 10, y: rect.top + rect.height / 2 });
    };
    const hideTip = () => setTooltip(null);

    useEffect(() => {
        async function fetchCompanyId() {
            if (user && !isPlatformAdmin) {
                const currentUser = await getCurrentUser();
                if (currentUser && 'error' in currentUser) {
                    console.warn('Sidebar: /user/me returned an error', currentUser);
                } else if (currentUser && 'company' in currentUser && currentUser.company?.company_id) {
                    setCompanyId(currentUser.company.company_id);
                }
            }
        }
        fetchCompanyId();
    }, [user, isPlatformAdmin]);

    const [showUserMenu, setShowUserMenu] = useState(false);
    const [userMenuAnchor, setUserMenuAnchor] = useState<{ x: number; y: number } | null>(null);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setShowUserMenu(false);
                setUserMenuAnchor(null);
                setDropdown(null);
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    const [notifications, setNotifications] = useState({
        teams: 0,
        employees: 0,
        verification: 0,
        requests: 0,
        openTasks: 0,
        total: 0,
        unread: 0,
    });

    // Poll unread notification count every 2 minutes
    useEffect(() => {
        async function fetchUnread() {
            try {
                const res = await api.get('/notification');
                const data: Array<{ is_read: boolean }> = Array.isArray(res.data) ? res.data : [];
                const count = data.filter((n) => !n.is_read).length;
                setNotifications((prev) => ({ ...prev, unread: count }));
            } catch { /* non-critical */ }
        }
        fetchUnread();
        const id = setInterval(fetchUnread, 2 * 60 * 1000);
        return () => clearInterval(id);
    }, []);

    const fetchSidebarStats = useCallback(async () => {
        if (loading) return;
        if (!user?.isAuthenticated) return;
        const currentUserType = (user as { user_type?: string } | null)?.user_type;
        if (currentUserType !== 'company') return;

        let teams = 0;
        let employeesCount = 0;
        let verification = 0;
        let requests = 0;
        let openTasks = 0;

        const effectiveCompanyId = companyId || (user?.company?.company_id as number | undefined) || null;

        try {
            const resp = await getCompanyDashboardStats();
            if (!('error' in resp)) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const data: any = resp;
                teams = data.headCount?.departments?.length || 0;
                requests = data.overview?.pendingRequests || 0;
                employeesCount = data.headCount?.totalEmployees || 0;
                openTasks = data.overview?.assignedTasks || data.overview?.openPositions || 0;
            }
        } catch (err) {
            console.warn('Sidebar: failed to fetch dashboard stats', err);
        }

        try {
            if (effectiveCompanyId) {
                const companyStats = await api.get(`/company/${effectiveCompanyId}/stats`);
                verification = companyStats.data?.pending_verifications || 0;
                // openTasks is computed from /job/schedules below — the stats
                // endpoint has no open_jobs_count field (was dead code).
                try {
                    const schedulesResp = await api.get(`/job/schedules/company/${effectiveCompanyId}`);
                    if (Array.isArray(schedulesResp.data)) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const schedules: any[] = schedulesResp.data;
                        const unfinished = schedules.filter(s => {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const st = String((s as any).status ?? (s as any).state ?? 'pending');
                            return st !== 'completed' && st !== 'cancelled';
                        });
                        openTasks = unfinished.length;
                    }
                } catch { /* ignore */ }
                if (!teams && companyStats.data?.departments) teams = companyStats.data.departments.length || teams;
                if (!employeesCount) employeesCount = companyStats.data?.verified_headcount || 0;
            }
        } catch (err) {
            console.warn('Sidebar: failed to fetch company stats', err);
        }

        setNotifications((prev) => ({ ...prev, teams, employees: employeesCount, verification, requests, openTasks, total: verification + requests + openTasks }));
    }, [companyId, user, loading]);

    useEffect(() => {
        fetchSidebarStats();
        const handler = () => fetchSidebarStats();
        window.addEventListener('tasks:updated', handler);
        return () => window.removeEventListener('tasks:updated', handler);
    }, [fetchSidebarStats]);

    const tabs = [
        // ── 1. Overview ─ checked first thing each day ────────────────────
        { id: "home", label: "Dashboard", href: isPlatformAdmin ? "/admin" : "/dashboard", icon: <Home size={18} />, showFor: 'all' },
        { id: "notifications", label: "Notifications", href: "/dashboard/notifications", icon: <Bell size={18} />, showFor: 'company', badge: notifications.unread },

        { id: "sep_workforce", type: "separator", label: "Workforce" },

        // ── 2. Workforce ─ who works here & where they are ────────────────
        {
            id: "teams",
            label: "Teams",
            href: "/dashboard/employees",
            icon: <Users size={18} />,
            showFor: 'company',
            requiredCompanyPermissions: ['view_employee'],
            badge: notifications.teams,
            submenu: [
                { id: "employees", label: "Team Members", href: "/dashboard/employees", icon: <UserCheck size={15} />, badge: notifications.employees },
                { id: "verification", label: "Verify Employees", href: "/dashboard/verification", icon: <CheckCircle size={15} />, badge: notifications.verification },
                { id: "onboard", label: "Onboarding", href: "/dashboard/employees/onboard", icon: <UserPlus size={15} /> },
            ],
        },
        { id: "attendance", label: "Attendance", href: "/dashboard/attendance", icon: <Clock size={18} />, showFor: 'company', requiredCompanyPermissions: ['view_attendance'] },
        { id: "timelog_review", label: "Clock-in Review", sub: "Approve clock-ins · kiosk photos · auto-closed", href: "/dashboard/time-logs", icon: <ClipboardCheck size={18} />, showFor: 'company', requiredCompanyPermissions: ['edit_hours'] },
        { id: "schedule", label: "Schedule", sub: "Weekly shift roster", href: "/dashboard/schedule", icon: <CalendarDays size={18} />, showFor: 'company', requiredCompanyPermissions: ['view_schedule'] },
        { id: "compliance", label: "Compliance", href: "/dashboard/compliance", icon: <ShieldCheck size={18} />, showFor: 'company', requiredCompanyPermissions: ['view_compliance'] },

        { id: "sep_workflows", type: "separator", label: "Workflows" },

        // ── 3. Workflows ─ daily approvals & assignments ──────────────────
        { id: "tasks", label: "Tasks", sub: "Work items with a done state", href: "/dashboard/tasks", icon: <Target size={18} />, showFor: 'company', badge: notifications.openTasks },
        { id: "leave", label: "Leave", href: "/dashboard/leave", icon: <FileText size={18} />, showFor: 'company', badge: notifications.requests },
        { id: "overtime", label: "Overtime", href: "/dashboard/overtime", icon: <Zap size={18} />, showFor: 'company', requiredCompanyPermissions: ['view_overtime'] },
        { id: "disputes", label: "Disputes", href: "/dashboard/disputes", icon: <Scale size={18} />, showFor: 'company', requiredCompanyPermissions: ['view_disputes'] },

        { id: "sep_money", type: "separator", label: "Compensation" },

        // "My Payslips" is an employee self-service screen and lives in the
        // MOBILE app only — the web is the employer surface, where payslips are
        // viewed company-wide under Payroll → Runs. (A company owner has no
        // personal payslips, so it was always empty here.)

        // ── 4b. Compensation ─ monthly payroll cycle (employer/admin) ─────
        {
            id: "payroll",
            label: "Payroll",
            href: "/dashboard/payroll/runs",
            icon: <DollarSign size={18} />,
            showFor: 'company',
            requiredCompanyPermissions: ['view_salary', 'view_payslip', 'manage_payroll'],
            submenu: [
                { id: "payroll_runs", label: "Payroll Runs", sub: "Monthly draft → finalize cycle", href: "/dashboard/payroll/runs", icon: <FileText size={15} /> },
                { id: "salaries", label: "Salary Configuration", sub: "Per-employee base salary & allowance", href: "/dashboard/salaries", icon: <DollarSign size={15} /> },
                { id: "salary_structures", label: "Salary Structures", sub: "Reusable templates of components", href: "/dashboard/salary-structures", icon: <Settings size={15} /> },
            ],
        },

        { id: "sep_insights", type: "separator", label: "Insights" },

        // ── 5. Insights ─ analytics & archives ────────────────────────────
        { id: "reports", label: "Reports", href: "/dashboard/reports", icon: <BarChart2 size={18} />, showFor: 'company', requiredCompanyPermissions: ['view_reports'] },
        { id: "announcements", label: "Announcements", sub: "Sponsored cards on employee home", href: "/dashboard/announcements", icon: <Megaphone size={18} />, showFor: 'company', requiredCompanyPermissions: ['manage_announcements'] },
        { id: "documents", label: "Documents", href: "/dashboard/documents", icon: <FolderOpen size={18} />, showFor: 'company', requiredCompanyPermissions: ['view_documents'] },

        // ── Platform admin tools (shown only to platform admins) ──────────
        { id: "sep_admin", type: "separator", label: "Platform Admin" },
        { id: "employers", label: "Employers", href: "/admin/employers", icon: <Building2 size={18} />, showFor: 'admin' },
        { id: "platform_users", label: "Users", href: "/admin/users", icon: <UserCog size={18} />, showFor: 'admin', requiredRoles: ['platform_admin', 'support', 'admin'], requiredPermissions: ['view_platform_users', 'manage_platform_users'] },
        { id: "all_users", label: "All Users", sub: "Every onboarded user across the platform", href: "/admin/all-users", icon: <Users size={18} />, showFor: 'admin' },
        { id: "kiosks", label: "Kiosks", sub: "Tablet devices for entrance clock-in", href: "/admin/kiosks", icon: <Tablet size={18} />, showFor: 'admin', requiredRoles: ['platform_admin'] },
        { id: "payroll_rules", label: "Payroll Rules", href: "/admin/payroll-rules", icon: <FileText size={18} />, showFor: 'admin', requiredRoles: ['platform_admin'], requiredPermissions: ['view_payroll_rules', 'supersede_payroll_rules'] },
        { id: "sectors", label: "Sectors", sub: "Rate tables & versions", href: "/admin/sectors", icon: <Globe size={18} />, showFor: 'admin', requiredRoles: ['platform_admin'], requiredPermissions: ['view_sectors', 'manage_sectors'] },
        { id: "compliance_queue", label: "Compliance", sub: "External & aging Your Right reports", href: "/admin/compliance", icon: <Scale size={18} />, showFor: 'admin', requiredRoles: ['platform_admin', 'compliance_officer'], requiredPermissions: ['manage_compliance_cases'] },
        { id: "platform_settings", label: "Platform", href: "/admin/platform-settings", icon: <Globe size={18} />, showFor: 'admin', requiredRoles: ['platform_admin'], requiredPermissions: ['view_platform_settings', 'manage_platform_settings'] },
        { id: "roles", label: "Roles", href: "/admin/roles", icon: <Shield size={18} />, showFor: 'admin', requiredRoles: ['platform_admin'], requiredPermissions: ['view_roles', 'manage_roles'] },
        { id: "audit_logs", label: "Audit Logs", href: "/admin/logs", icon: <FileText size={18} />, showFor: 'admin', requiredRoles: ['platform_admin'], requiredPermissions: ['view_audit_log'] },
        { id: "ad_campaigns", label: "Ad Campaigns", sub: "Paid third-party ads (kind='ad')", href: "/admin/ads", icon: <BadgeDollarSign size={18} />, showFor: 'admin', requiredRoles: ['platform_admin'] },
        { id: "house_ads", label: "House Content", sub: "Kiruko-wide sponsored fill", href: "/admin/ads/house", icon: <Sparkles size={18} />, showFor: 'admin', requiredRoles: ['platform_admin'] },
        { id: "sponsored_moderation", label: "Sponsored Moderation", sub: "All kinds across companies", href: "/admin/sponsored", icon: <Eye size={18} />, showFor: 'admin', requiredRoles: ['platform_admin'] },

        { id: "sep_system", type: "separator", label: "System" },

        // ── 6. System ─ rare touches ──────────────────────────────────────
        {
            id: "settings",
            label: "Settings",
            href: "/dashboard/settings",
            icon: <Settings size={18} />,
            showFor: 'company',
            submenu: [
                { id: "settings_general", label: "General", href: "/dashboard/settings", icon: <Settings size={15} /> },
                { id: "settings_organization", label: "Organisation", href: "/dashboard/settings/organization", icon: <Building2 size={15} /> },
                { id: "settings_departments", label: "Departments", href: "/dashboard/settings/departments", icon: <Users size={15} /> },
                { id: "settings_permissions", label: "Permissions", href: "/dashboard/settings/permissions", icon: <Shield size={15} />, requiredRoles: ['company_admin'] },
                { id: "settings_payroll", label: "Payroll", href: "/dashboard/settings?tab=payroll", icon: <Wallet size={15} /> },
                { id: "settings_leave_types", label: "Leave Types", href: "/dashboard/settings/leave-types", icon: <CalendarDays size={15} /> },
                { id: "settings_holidays", label: "Holidays", href: "/dashboard/settings/holidays", icon: <CalendarDays size={15} /> },
            ],
        },
        { id: "documentation", label: "Help", href: "/dashboard/documentation", icon: <CircleHelp size={18} />, showFor: 'all' },
    ];

    // Whether `pathname` falls under `href`'s namespace: an exact match, or
    // nested past a "/" boundary. A bare `startsWith` (no boundary check)
    // would also match unrelated routes that merely share a string prefix.
    const underHref = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

    const isActive = (tab: typeof tabs[0]) => {
        // Exact match for root pages to avoid matching everything
        if (tab.id === 'home') return pathname === '/dashboard' || pathname === '/admin';
        if ('submenu' in tab && tab.submenu) {
            // Group buttons stay highlighted for their own href or any child's.
            if (tab.href && underHref(tab.href)) return true;
            return tab.submenu.some(sub => underHref(sub.href));
        }
        if (!tab.href || !underHref(tab.href)) return false;
        // Flat top-level items can have hrefs that nest inside one another
        // even though they're unrelated peer sections, not parent/child
        // (e.g. "Ad Campaigns" /admin/ads vs "House Content" /admin/ads/house).
        // Only the most specific (longest) matching sibling should light up.
        const moreSpecificSibling = tabs.some(t =>
            t.id !== tab.id && !('submenu' in t && t.submenu) && 'href' in t && t.href &&
            t.href.length > tab.href!.length && underHref(t.href)
        );
        return !moreSpecificSibling;
    };

    // `siblings` is the specific submenu group `href` belongs to — every
    // call site has that group in scope already (the array it's mapping
    // over to render the items). Scoping the collision check to it, rather
    // than every submenu item platform-wide, means an href in one group
    // (e.g. Payroll) can never suppress a highlight in an unrelated group
    // (e.g. Settings) just because the strings happen to nest.
    const isSubActive = (href: string, siblings: { href: string }[]) => {
        const [path, query] = href.split("?");
        const wantTab = query ? new URLSearchParams(query).get("tab") : null;
        // Tab deep-link (e.g. /dashboard/settings?tab=payroll): active only on
        // that exact tab. usePathname() drops the query, so compare it explicitly.
        if (wantTab) return pathname === path && currentTab === wantTab;
        if (!underHref(path)) return false;
        // A bare link shouldn't stay highlighted when a sibling tab is selected
        // on the same base path (e.g. "General" while ?tab=payroll is active).
        if (pathname === path && currentTab && currentTab !== "company") return false;
        // Same nesting problem as isActive, one level down: a submenu item's
        // href can be a URL-prefix of a sibling item's href in the same
        // group. Only the most specific (longest) matching sibling wins.
        const moreSpecificSibling = siblings.some(item => {
            const itemPath = item.href.split("?")[0];
            return itemPath !== path && itemPath.length > path.length && underHref(itemPath);
        });
        return !moreSpecificSibling;
    };

    const NavIcon = ({
        href,
        icon,
        label,
        sub,
        badge,
        active,
        small,
    }: {
        href: string;
        icon: React.ReactNode;
        label: string;
        sub?: string;
        badge?: number;
        active?: boolean;
        small?: boolean;
    }) => (
        <Link
            href={href}
            aria-label={label}
            onMouseEnter={(e) => showTip(e, label, sub)}
            onMouseLeave={hideTip}
            className={`relative flex items-center transition-all duration-150 ${
                expanded
                    ? 'w-full justify-start gap-3 px-3 py-2.5 rounded-xl'
                    : `justify-center ${small ? 'w-8 h-8 rounded-lg' : 'w-10 h-10 rounded-xl'}`
            } ${
                active
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900 shadow-sm'
                    : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
        >
            <span className="shrink-0 flex items-center justify-center">{icon}</span>
            {expanded && <span className="text-sm font-medium truncate">{label}</span>}
            {(badge || 0) > 0 && (
                <span className={expanded
                    ? 'ml-auto shrink-0 min-w-5 h-5 bg-gray-700 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1.5 leading-none'
                    : 'absolute -top-1 -right-1 min-w-4 h-4 bg-gray-700 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1 border-2 border-white dark:border-gray-900 leading-none'}>
                    {(badge || 0) > 99 ? '99+' : badge}
                </span>
            )}
        </Link>
    );

    return (
        <aside className={`${expanded ? 'w-60' : 'w-16'} h-full bg-white dark:bg-gray-900 flex flex-col ${expanded ? '' : 'items-center'} border-r border-gray-100 dark:border-gray-800 z-50 overflow-hidden transition-[width] duration-200 ease-out`}>
            {mounted && <TooltipPortal tip={tooltip} />}
            {mounted && <DropdownPortal dropdown={dropdown} isSubActive={isSubActive} onClose={() => setDropdown(null)} />}
            {mounted && showUserMenu && userMenuAnchor && createPortal(
                <>
                    <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={() => { setShowUserMenu(false); setUserMenuAnchor(null); }} />
                    <div style={{ position: 'fixed', left: userMenuAnchor.x, bottom: userMenuAnchor.y, zIndex: 9999 }}
                        className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-700 rounded-xl shadow-lg overflow-hidden w-52">
                        <div className="px-3 py-2.5 border-b border-gray-50 dark:border-gray-800">
                            <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                                {user?.user_name || user?.email?.split('@')[0] || 'User'}
                            </p>
                            <p className="text-[11px] text-gray-400 truncate mt-0.5">{user?.email}</p>
                            <span className="inline-block mt-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                                {isPlatformAdmin ? (user?.roles?.[0] || 'Platform Admin') : isCompanyAdmin ? 'Company Admin' : 'Member'}
                            </span>
                        </div>
                        <div className="py-1">
                            {isPlatformAdmin && (
                                <Link href="/admin"
                                    className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                    onClick={() => { setShowUserMenu(false); setUserMenuAnchor(null); }}>
                                    <Settings2 size={14} className="text-gray-400" />
                                    <span className="font-medium">Admin Panel</span>
                                </Link>
                            )}
                            <Link href="/dashboard/settings"
                                className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                onClick={() => { setShowUserMenu(false); setUserMenuAnchor(null); }}>
                                <Settings size={14} className="text-gray-400" />
                                <span className="font-medium">Settings</span>
                            </Link>
                        </div>
                        <LocaleSwitcher onClose={() => { setShowUserMenu(false); setUserMenuAnchor(null); }} />
                        <div className="border-t border-gray-50 dark:border-gray-800 py-1">
                            <button
                                onClick={() => { setShowUserMenu(false); setUserMenuAnchor(null); logout(); }}
                                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white transition-colors"
                            >
                                <LogOut size={14} />
                                <span className="font-medium">Sign Out</span>
                            </button>
                        </div>
                    </div>
                </>,
                document.body
            )}

            {/* Brand + collapse toggle */}
            <div className={`shrink-0 pt-3 pb-2.5 w-full flex ${expanded ? 'px-3 items-center justify-between' : 'flex-col items-center gap-1.5'}`}>
                <div className={`flex items-center min-w-0 ${expanded ? 'gap-2.5' : ''}`}>
                    <button
                        aria-label="Kiruko"
                        className="relative w-9 h-9 rounded-xl bg-gray-900 flex items-center justify-center text-white shadow-sm shrink-0"
                        onMouseEnter={(e) => showTip(e,
                            'Kiruko',
                            isPlatformAdmin ? (user?.roles?.[0] || 'Admin') : (user?.company ? 'Company Portal' : 'User Portal')
                        )}
                        onMouseLeave={hideTip}
                    >
                        <span className="text-sm font-bold tracking-tight">K</span>
                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-emerald-500 border-2 border-white dark:border-gray-900 rounded-full" />
                    </button>
                    {expanded && (
                        <span className="font-display font-semibold text-gray-900 dark:text-white text-base tracking-tight truncate">Kiruko</span>
                    )}
                </div>
                <button
                    onClick={toggleExpanded}
                    aria-label={expanded ? 'Collapse menu' : 'Expand menu'}
                    onMouseEnter={(e) => { if (!expanded) showTip(e, 'Expand menu'); }}
                    onMouseLeave={hideTip}
                    className="shrink-0 w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-all duration-150"
                >
                    <ChevronRight size={16} className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
                </button>
            </div>

            <div className={`${expanded ? 'w-[calc(100%-1.5rem)] mx-3' : 'w-5'} h-px bg-gray-100 dark:bg-gray-800 shrink-0`} />

            {/* Nav — overflow-y-auto is safe here since tooltips are portaled */}
            <nav className={`flex-1 min-h-0 flex flex-col ${expanded ? 'items-stretch' : 'items-center'} gap-1 overflow-y-auto w-full px-3 py-2 scrollbar-none`}>
                {loading && (
                    <>
                        {[...Array(4)].map((_, i) => (
                            <div key={i} className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
                        ))}
                    </>
                )}
                {!loading && (() => {
                    // Visibility predicate factored out so we can filter the
                    // tabs array BEFORE rendering. Without this pre-pass, two
                    // separators with `showFor: 'company'` items between them
                    // collapse to two adjacent thin lines on the platform-admin
                    // view — visible as a pair of "empty horizontal stripes"
                    // in the sidebar rail with no items between them.
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const isVisible = (t: any): boolean => {
                        if (t.type === 'separator') return true;
                        if (t.showFor === 'admin' && !isPlatformAdmin) return false;
                        if (t.showFor === 'company' && (isPlatformAdmin || !(user?.user_type === 'company' || isCompanyAdmin || (user?.company_permissions?.length ?? 0) > 0 || (user?.company_roles?.length ?? 0) > 0))) return false;
                        if (t.requiredRoles && Array.isArray(t.requiredRoles)) {
                            if (t.requiredRoles.includes('company_admin')) {
                                if (!isCompanyAdmin && !user?.is_superuser) return false;
                            } else {
                                const userRoles = user?.roles || [];
                                const hasRequiredRole = t.requiredRoles.some((role: string) => userRoles.includes(role));
                                if (!user?.is_superuser && !hasRequiredRole) return false;
                            }
                        }
                        // Phase 2 — platform permissions gating. Acts as an
                        // alternative to requiredRoles: an item is shown if
                        // either the role OR the permission check passes
                        // (or there are no constraints at all). Permission
                        // bypass mirrors backend: superuser + platform_admin
                        // role get everything.
                        if (t.requiredPermissions && Array.isArray(t.requiredPermissions)) {
                            const userPerms = user?.platform_permissions || [];
                            const userRoles = user?.roles || [];
                            const hasPerm = t.requiredPermissions.some((p: string) => userPerms.includes(p));
                            const bypass = user?.is_superuser || userRoles.includes('platform_admin');
                            if (!bypass && !hasPerm) return false;
                        }
                        // Company RBAC — gate company items on the user's resolved
                        // company permissions when declared. Owner/superuser bypass
                        // inside hasCompanyPermission; a management-role employee
                        // without the permission has the item hidden. (Cosmetic —
                        // the API is the real gate.)
                        if (t.requiredCompanyPermissions && Array.isArray(t.requiredCompanyPermissions)) {
                            if (!user?.hasCompanyPermission?.(t.requiredCompanyPermissions)) return false;
                        }
                        return true;
                    };

                    // Drop separators that don't have a visible item between
                    // them and the next separator (or the end of the list).
                    // Also drops a leading separator if there's nothing before
                    // it. This collapses the "empty stripe" runs.
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const visible = tabs.filter(isVisible) as any[];
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const filtered: any[] = [];
                    for (let i = 0; i < visible.length; i++) {
                        const t = visible[i];
                        if (t.type === 'separator') {
                            // Drop if there's no preceding non-separator item
                            // OR if the next item is also a separator / end.
                            const prev = filtered[filtered.length - 1];
                            if (!prev || prev.type === 'separator') continue;
                            const next = visible[i + 1];
                            if (!next || next.type === 'separator') continue;
                        }
                        filtered.push(t);
                    }

                    return filtered.map((tab) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const t = tab as any;

                    // Render section separators — labelled headers when expanded
                    // for clear hierarchy, a clean centred divider when collapsed.
                    if (t.type === 'separator') {
                        if (expanded && t.label) {
                            return (
                                <div key={tab.id} className="px-3 pt-4 pb-1 select-none">
                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{t.label}</span>
                                </div>
                            );
                        }
                        return <div key={tab.id} className={`${expanded ? 'w-full' : 'w-5'} h-px bg-gray-100 dark:bg-gray-800 shrink-0 my-1.5`} />;
                    }

                    if (t.showFor === 'admin' && !isPlatformAdmin) return null;
                    if (t.showFor === 'company' && (isPlatformAdmin || !(user?.user_type === 'company' || isCompanyAdmin || (user?.company_permissions?.length ?? 0) > 0 || (user?.company_roles?.length ?? 0) > 0))) return null;

                    if (t.requiredRoles && Array.isArray(t.requiredRoles)) {
                        if (t.requiredRoles.includes('company_admin')) {
                            if (!isCompanyAdmin && !user?.is_superuser) return null;
                        } else {
                            const userRoles = user?.roles || [];
                            const hasRequiredRole = t.requiredRoles.some((role: string) => userRoles.includes(role));
                            if (!user?.is_superuser && !hasRequiredRole) return null;
                        }
                    }
                    if (t.requiredPermissions && Array.isArray(t.requiredPermissions)) {
                        const userPerms = user?.platform_permissions || [];
                        const userRoles = user?.roles || [];
                        const hasPerm = t.requiredPermissions.some((p: string) => userPerms.includes(p));
                        const bypass = user?.is_superuser || userRoles.includes('platform_admin');
                        if (!bypass && !hasPerm) return null;
                    }

                    const active = isActive(tab);

                    if ('submenu' in tab && tab.submenu) {
                        const flyoutOpen = dropdown?.tabId === tab.id;
                        const inlineOpen = expanded && openGroup === tab.id;
                        return (
                            <div key={tab.id} className="w-full">
                                <button
                                    aria-label={tab.label}
                                    aria-expanded={expanded ? inlineOpen : undefined}
                                    onMouseEnter={(e) => { if (!flyoutOpen) showTip(e, tab.label); }}
                                    onMouseLeave={hideTip}
                                    onClick={(e) => {
                                        hideTip();
                                        if (expanded) {
                                            // Inline accordion when the sidebar is open.
                                            setOpenGroup(inlineOpen ? null : tab.id);
                                            return;
                                        }
                                        // Flyout popover when collapsed.
                                        if (flyoutOpen) { setDropdown(null); return; }
                                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                        setDropdown({
                                            tabId: tab.id,
                                            label: tab.label,
                                            items: (tab.submenu as DropdownItem[]).filter(isVisible),
                                            x: rect.right + 8,
                                            y: rect.top,
                                        });
                                    }}
                                    className={`relative flex items-center w-full transition-all duration-150 ${
                                        expanded ? 'justify-start gap-3 px-3 py-2.5 rounded-xl' : 'justify-center w-10 h-10 rounded-xl'
                                    } ${
                                        active || flyoutOpen
                                            ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900 shadow-sm'
                                            : inlineOpen
                                                ? 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200'
                                                : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-300'
                                    }`}
                                >
                                    <span className="shrink-0 flex items-center justify-center">{tab.icon}</span>
                                    {expanded && <span className="text-sm font-medium truncate">{tab.label}</span>}
                                    {(t.badge || 0) > 0 && (
                                        <span className={expanded
                                            ? 'ml-auto shrink-0 min-w-5 h-5 bg-gray-700 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1.5 leading-none'
                                            : 'absolute -top-1 -right-1 min-w-4 h-4 bg-gray-700 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1 border-2 border-white dark:border-gray-900 leading-none'}>
                                            {(t.badge || 0) > 99 ? '99+' : t.badge}
                                        </span>
                                    )}
                                    {expanded && (
                                        <ChevronRight size={14} className={`${(t.badge || 0) > 0 ? 'ml-1.5' : 'ml-auto'} shrink-0 opacity-50 transition-transform duration-200 ${inlineOpen ? 'rotate-90' : ''}`} />
                                    )}
                                </button>
                                {inlineOpen && (
                                    <div className="mt-1.5 mb-2.5 flex flex-col gap-1">
                                        {(() => { const groupItems = (tab.submenu as DropdownItem[]).filter(isVisible); return groupItems.map(item => {
                                            const subActive = isSubActive(item.href, groupItems);
                                            return (
                                                <Link
                                                    key={item.id}
                                                    href={item.href}
                                                    className={`group/sub flex items-center gap-2.5 rounded-lg py-2.5 pl-[34px] pr-3 text-[13px] transition-colors ${
                                                        subActive
                                                            ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white font-medium'
                                                            : 'text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/60 hover:text-gray-700 dark:hover:text-gray-200'
                                                    }`}
                                                >
                                                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 transition-colors ${
                                                        subActive
                                                            ? 'bg-gray-900 dark:bg-white'
                                                            : 'bg-gray-300 dark:bg-gray-600 group-hover/sub:bg-gray-400 dark:group-hover/sub:bg-gray-500'
                                                    }`} />
                                                    <span className="truncate">{item.label}</span>
                                                    {(item.badge || 0) > 0 && (
                                                        <span className="ml-auto text-[9px] font-bold bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded-md">
                                                            {(item.badge || 0) > 99 ? '99+' : item.badge}
                                                        </span>
                                                    )}
                                                </Link>
                                            );
                                        }); })()}
                                    </div>
                                )}
                            </div>
                        );
                    }

                    return (
                        <NavIcon
                            key={tab.id}
                            href={tab.href!}
                            icon={tab.icon}
                            label={tab.label!}
                            sub={t.sub}
                            badge={t.badge}
                            active={active}
                        />
                    );
                });
                })()}
            </nav>

            <div className={`${expanded ? 'w-[calc(100%-1.5rem)] mx-3' : 'w-5'} h-px bg-gray-100 dark:bg-gray-800 shrink-0`} />

            {/* User footer */}
            <div className={`shrink-0 flex flex-col ${expanded ? 'items-stretch' : 'items-center'} gap-1 py-3 px-3`}>

                {/* Avatar */}
                <div className="relative">
                    <button
                        aria-label="Account menu"
                        onClick={(e) => {
                            if (showUserMenu) {
                                setShowUserMenu(false);
                                setUserMenuAnchor(null);
                            } else {
                                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                setUserMenuAnchor({ x: rect.right + 8, y: window.innerHeight - rect.bottom });
                                setShowUserMenu(true);
                            }
                        }}
                        onMouseEnter={(e) => showTip(
                            e,
                            user?.user_name || user?.email?.split('@')[0] || 'User',
                            isPlatformAdmin ? (user?.roles?.[0] || 'Platform Admin') : (user?.company?.company_name || 'Account')
                        )}
                        onMouseLeave={hideTip}
                        className={`flex items-center transition-colors ${expanded ? 'w-full justify-start gap-3 px-3 py-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800' : ''}`}
                    >
                        <span className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center overflow-hidden shrink-0 hover:border-gray-300 dark:hover:border-gray-600">
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {(user as any)?.profile_image_url ? (
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any, @next/next/no-img-element
                                <img src={(user as any).profile_image_url} alt="Profile" className="w-full h-full object-cover" />
                            ) : (
                                <User size={16} className="text-gray-400 dark:text-gray-500" />
                            )}
                        </span>
                        {expanded && (
                            <span className="min-w-0 text-left">
                                <span className="block text-sm font-medium text-gray-900 dark:text-white truncate">{user?.user_name || user?.email?.split('@')[0] || 'User'}</span>
                                <span className="block text-[11px] text-gray-400 truncate">{isPlatformAdmin ? (user?.roles?.[0] || 'Admin') : (user?.company?.company_name || 'Account')}</span>
                            </span>
                        )}
                    </button>
                </div>

                {/* Theme toggle */}
                <button
                    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                    onMouseEnter={(e) => showTip(e, theme === 'dark' ? 'Light mode' : 'Dark mode')}
                    onMouseLeave={hideTip}
                    className={`flex items-center text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all duration-150 ${expanded ? 'w-full justify-start gap-3 px-3 py-2.5 rounded-xl' : 'w-10 h-10 justify-center rounded-xl'}`}
                    aria-label="Toggle theme"
                >
                    <span className="shrink-0 flex items-center justify-center">{mounted ? (theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />) : <Sun size={16} />}</span>
                    {expanded && <span className="text-sm font-medium">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>}
                </button>

                {/* Sign out */}
                <button
                    onClick={logout}
                    onMouseEnter={(e) => showTip(e, 'Sign Out')}
                    onMouseLeave={hideTip}
                    className={`flex items-center text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all duration-150 ${expanded ? 'w-full justify-start gap-3 px-3 py-2.5 rounded-xl' : 'w-10 h-10 justify-center rounded-xl'}`}
                    aria-label="Sign out"
                >
                    <LogOut size={16} className="shrink-0" />
                    {expanded && <span className="text-sm font-medium">Sign Out</span>}
                </button>
            </div>
        </aside>
    );
}
