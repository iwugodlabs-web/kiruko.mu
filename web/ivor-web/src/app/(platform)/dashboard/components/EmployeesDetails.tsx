"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import {
    X,
    User,
    Mail,
    Phone,
    Calendar,
    Briefcase,
    MapPin,
    Clock,
    ChevronRight,
    Shield,
    CreditCard,
    FileText,
    AlertTriangle,
    UserX,
    CheckCircle,
    Building2,
    History,
    TrendingUp,
    DollarSign,
    Link2,
    Smartphone
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "../../../../services/apiClient";
import { deriveHourlyRateFromSalary, deriveAllowanceHourlyFromSalary } from "../../../../../../../shared/utils/payroll";
import KioskPinPanel from "./KioskPinPanel";
import MaxShiftPanel from "./MaxShiftPanel";
import ScheduleEditModal, { ScheduleValue } from "./ScheduleEditModal";
import {
    getUserTimeLogs,
    getAllUsers,
    getEmployeeBankDetails,
    updateEmployeeBankDetails,
    resendClaimLink,
    isApiError
} from "../../../../services/api";
import VerifyEmployeeModal from "./VerifyEmployeeModal";
import SalaryTab from "../employees/[id]/components/SalaryTab";
import ProfileLockButton from "../employees/[id]/components/ProfileLockButton";
import OneOffAllowancesPanel from "../employees/[id]/components/OneOffAllowancesPanel";
import RecurringAllowancesPanel from "../employees/[id]/components/RecurringAllowancesPanel";
import CountryLocationPanel from "../employees/[id]/components/CountryLocationPanel";
import Breadcrumbs from "@/components/ui/Breadcrumbs";

// Mirrors mobile's dedupeTimeLogs (mobile/app/private_dashboard/home.tsx) —
// the backend can produce repeated active/end TimeLog rows for the same
// real session, so a naive sum double-counts them. Web previously had no
// equivalent guard while mobile did, which was a source of the two
// platforms disagreeing on total hours for the same period. Same
// canonical-key strategy: exact (start, effective end) pairs collapse to
// one entry, keeping whichever duplicate has the longer duration (covers
// an "active" row later superseded by its own completed row).
function getTimeLogEffectiveEnd(log: any, now: Date): Date | null {
    const start = log.start_time ? new Date(log.start_time) : null;
    if (!start || Number.isNaN(start.getTime())) return null;
    if (log.end_time) {
        const end = new Date(log.end_time);
        return Number.isNaN(end.getTime()) ? now : end;
    }
    return now;
}
function getTimeLogCanonicalKey(log: any, now: Date): string | null {
    const start = log.start_time ? new Date(log.start_time) : null;
    if (!start || Number.isNaN(start.getTime())) return null;
    const end = getTimeLogEffectiveEnd(log, now);
    if (!end) return null;
    return `${start.toISOString()}|${end.toISOString()}`;
}
function dedupeTimeLogs(logs: any[], now: Date): any[] {
    const unique = new Map<string, { log: any; durationMs: number }>();
    for (const log of logs) {
        const key = getTimeLogCanonicalKey(log, now);
        if (!key) continue;
        const end = getTimeLogEffectiveEnd(log, now);
        if (!end) continue;
        const start = new Date(log.start_time);
        const durationMs = end.getTime() - start.getTime();
        const existing = unique.get(key);
        if (!existing || durationMs > existing.durationMs) {
            unique.set(key, { log, durationMs });
        }
    }
    return Array.from(unique.values()).map((entry) => entry.log);
}

// Hours for one clock-in — always recomputed live from raw start/end minus
// logged breaks, NEVER from the stored hours_worked column. An open (never
// explicitly ended) break is deducted through to the shift's own end_time,
// mirroring db_models/crud/job.py::update_time_log's fixed rule. Trusting
// hours_worked directly was the bug: that stored value is stale for any
// shift closed out before that rule existed, which is exactly why this
// table used to disagree with mobile's own always-live local calculation.
function computeLiveHoursForLog(log: any): number {
    const start = log.start_time ? new Date(log.start_time) : null;
    const end = log.end_time ? new Date(log.end_time) : null;
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        return 0;
    }
    const breaks: any[] = Array.isArray(log.breaks) ? log.breaks : [];
    let breakMs = 0;
    for (const b of breaks) {
        const bStart = b?.start_time ? new Date(b.start_time) : null;
        if (!bStart || Number.isNaN(bStart.getTime())) continue;
        const bEnd = b?.end_time ? new Date(b.end_time) : end; // open break -> shift end
        breakMs += Math.max(bEnd.getTime() - bStart.getTime(), 0);
    }
    return Math.max((end.getTime() - start.getTime() - breakMs) / 3600000, 0);
}

type Employee = {
    id: number;
    name: string;
    role: string | null;
    accessRole?: string | null;
    department: string | null;
    home_site_id?: number | null;
    home_site_name?: string | null;
    status: string;
    avatar: string;
    email: string;
    phone: string;
    joinDate: string;
    user_id: number;
    private_user_id: number;
    employee_code?: string | null;
    job_details?: any;
    verified: boolean;
    passport_number?: string;
    date_of_birth?: string;
    gender?: string;
};

type EmployeesDetailsProps = {
    employee: Employee;
    onBack: () => void;
};

export default function EmployeesDetails({ employee, onBack }: EmployeesDetailsProps) {
    const router = useRouter();
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [timeLogs, setTimeLogs] = useState<any[]>([]);
    const [jobHistory, setJobHistory] = useState<any[]>([]);
    const [bankDetails, setBankDetails] = useState<any>(null);
    const [bankFormData, setBankFormData] = useState<any>({});
    const [loadingBank, setLoadingBank] = useState(false);
    const { companyBrn, user, companyId } = useAuth();

    // Removal State
    const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
    const [isRemoving, setIsRemoving] = useState(false);
    // Backend current-month estimate — the CORRECT, mode-aware gross/net
    // (replaces the old client-side payroll guess). Null until loaded / on error.
    const [estimate, setEstimate] = useState<{
        gross: string; net: string; currency: string; pay_is_hours_driven: boolean;
        // 'no_pay_basis' | 'no_clockins' | null — why gross is 0, so the UI can
        // explain it instead of showing a bare Rs0.00.
        zero_reason: 'no_pay_basis' | 'no_clockins' | null;
        earnings?: { code: string; label: string; amount_str: string; multiplier_badge: string | null; hours_str: string | null }[];
        deductions?: { code: string; label: string; amount_str: string; is_statutory: boolean }[];
        period?: { label?: string };
        leave_summary?: { code: string; label: string; days: number; paid: boolean }[];
        // Day-count breakdown for salaried staff at a company requiring
        // clock-ins for payroll — null when not applicable.
        attendance?: { scheduled_days: number; present_days: number; absent_days: number } | null;
    } | null>(null);
    const [estimateLoading, setEstimateLoading] = useState(true);
    // Distinct from "estimate is null because it's still loading" — a real
    // fetch failure (403/network/etc) must not silently swap the headline
    // number to a different, unlabeled figure.
    const [estimateError, setEstimateError] = useState(false);

    // Account set-up link — for staff who haven't set a password yet (imported,
    // or admin-approved but still passwordless). Available for any employee.
    const [claimLinkInfo, setClaimLinkInfo] = useState<{ who: string; link: string } | null>(null);
    const [sendingLink, setSendingLink] = useState(false);
    const handleSendSetupLink = async () => {
        if (!employee?.user_id) return;
        setSendingLink(true);
        const res = await resendClaimLink(employee.user_id);
        setSendingLink(false);
        if ('error' in res) { toast.error(res.error || 'Failed to generate the set-up link'); return; }
        const who = (employee.name || 'this employee').split(' ')[0];
        try { await navigator.clipboard.writeText(res.claim_link); } catch { /* shown in modal */ }
        setClaimLinkInfo({ who, link: res.claim_link });
    };

    const [formData, setFormData] = useState({
        name: employee.name,
        role: employee.role,
        email: employee.email,
        phone: employee.phone,
        department: employee.department,
        employerName: employee.job_details?.employer_name || '',
        employerBrn: companyBrn || '',
    });

    // Re-sync read-only fields when the parent late-patches them (e.g. department
    // resolves after departmentsMap loads). Only fields the user can't edit here
    // — name/role/email/phone/department — get overwritten so we don't clobber
    // in-flight edits to the salary/hours inputs.
    useEffect(() => {
        setFormData(prev => ({
            ...prev,
            name: employee.name,
            role: employee.role,
            email: employee.email,
            phone: employee.phone,
            department: employee.department,
        }));
    }, [employee.name, employee.role, employee.email, employee.phone, employee.department]);

    const [modalOpen, setModalOpen] = useState(false);
    const [attendanceFilter, setAttendanceFilter] = useState<'all' | 'week' | 'last_week' | 'month' | 'last_month'>('month');
    const [attendancePage, setAttendancePage] = useState(1);
    const LOGS_PER_PAGE = 20;

    const filteredLogs = useMemo(() => {
        const now = new Date();
        const deduped = dedupeTimeLogs(timeLogs, now);
        const sorted = [...deduped].sort((a, b) =>
            new Date(b.start_time || b.created_at).getTime() - new Date(a.start_time || a.created_at).getTime()
        );
        if (attendanceFilter === 'all') return sorted;
        let from: Date, to: Date;
        if (attendanceFilter === 'week') {
            const d = now.getDay();
            from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (d === 0 ? 6 : d - 1));
            to = new Date(from.getTime() + 7 * 86400000);
        } else if (attendanceFilter === 'last_week') {
            const d = now.getDay();
            const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (d === 0 ? 6 : d - 1));
            from = new Date(mon.getTime() - 7 * 86400000);
            to = mon;
        } else if (attendanceFilter === 'month') {
            from = new Date(now.getFullYear(), now.getMonth(), 1);
            to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        } else {
            from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            to = new Date(now.getFullYear(), now.getMonth(), 1);
        }
        return sorted.filter(log => {
            const d = new Date(log.start_time || log.created_at);
            return d >= from && d < to;
        });
    }, [timeLogs, attendanceFilter]);

    const attendanceStats = useMemo(() => {
        const days = filteredLogs.length;
        const totalH = filteredLogs.reduce((s, l) => s + computeLiveHoursForLog(l), 0);

        // Show the CONTRACTUAL monthly structure — never recompute payroll here.
        // The old code hours-prorated the monthly salary (salary ÷ 195 × hours)
        // and faked net as ×0.9, which diverged from the real engine. Basic +
        // allowances come straight from the salary structure; real net
        // (CSG/NSF/PAYE) and any clock-in absence docking come from the backend
        // payslip/estimate, not the UI.
        const salaryData = employee.job_details?.salaries?.[0];
        const basicVal = parseFloat(salaryData?.salary || '0') || 0;
        const allowanceVal = (salaryData?.allowance != null && salaryData.allowance !== '')
            ? (parseFloat(salaryData.allowance) || 0)
            : Math.max(0, (parseFloat(salaryData?.revenue ?? '0') || 0) - basicVal);
        const grossVal = basicVal + allowanceVal;
        // Nominal hourly-equivalent rate — NOT how this employee is actually
        // paid if they're monthly (that's the fixed salary above). Used only
        // to show "value of hours logged so far" as a labeled reference stat.
        // Calls the SAME shared functions mobile's home.tsx uses to build its
        // local estimate (basic-rate + allowance-rate, summed) — importing
        // the real formula instead of hand-copying it, so the two can't
        // silently drift apart again the way they just did.
        const nominalHourlyRate = deriveHourlyRateFromSalary(salaryData) + deriveAllowanceHourlyFromSalary(salaryData);

        return {
            days,
            totalHours: totalH.toFixed(1),
            avgHours: days > 0 ? (totalH / days).toFixed(1) : '0.0',
            overtime: filteredLogs.filter(l => l.is_overtime).length,
            nominalHourlyRate,
            payroll: {
                grossPay: grossVal,
                regularPay: basicVal,
                allowance: allowanceVal,
                overtimePay: 0,
                holidayPay: 0,
            }
        };
    }, [filteredLogs, employee.job_details, attendanceFilter]);

    const totalAttendancePages = Math.ceil(filteredLogs.length / LOGS_PER_PAGE);
    const pagedLogs = filteredLogs.slice((attendancePage - 1) * LOGS_PER_PAGE, attendancePage * LOGS_PER_PAGE);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSave = async () => {
        setIsSaving(true);
        setSaveError(null);
        try {
            // Company-admin edits scope ONLY to the company segment (job title).
            // Salary/allowances/hours are edited in the Salary card below (single
            // source of truth — see SalaryTab), not here. Department assignment is
            // managed in Settings → Departments, and employee-owned fields (name,
            // phone, gender, DOB, passport) are the employee's to edit from their
            // own mobile profile.

            // Update job title via lightweight PATCH (no full schema validation required)
            if (employee.job_details?.job_id) {
                const jobTitle = (formData.role && formData.role.trim()) || employee.job_details?.job_title;
                if (jobTitle) {
                    await api.patch(`/job/${employee.job_details.job_id}/details`, { job_title: jobTitle });
                }
            }

            setIsEditing(false);
        } catch (err: any) {
            console.error('Save error:', err);
            setSaveError('Failed to save changes. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    useEffect(() => {
        const fetchData = async () => {
            try {
                // Fetch time logs
                const logs = await getUserTimeLogs(employee.private_user_id);
                if (Array.isArray(logs)) {
                    setTimeLogs(logs);
                }

                // Fetch full user data to get all jobs
                const users = await getAllUsers();
                if (Array.isArray(users)) {
                    const fullUser = users.find((u: any) => u.user_id === employee.user_id);
                    if ((fullUser?.private_user as any)?.jobs) {
                        // Sort jobs by date (most recent first)
                        const sortedJobs = [...(fullUser?.private_user as any).jobs].sort((a: any, b: any) => {
                            const dateA = a.first_date_of_employment ? new Date(a.first_date_of_employment).getTime() : 0;
                            const dateB = b.first_date_of_employment ? new Date(b.first_date_of_employment).getTime() : 0;
                            return dateB - dateA;
                        });
                        setJobHistory(sortedJobs);
                    }
                }
                // Fetch bank details
                setLoadingBank(true);
                const [bankRes] = await Promise.all([
                    getEmployeeBankDetails(employee.private_user_id)
                ]);

                if (!isApiError(bankRes)) {
                    setBankDetails(bankRes);
                    setBankFormData({
                        bank_name: bankRes.bank_name || '',
                        account_holder_name: bankRes.account_holder_name || '',
                        account_number: '',
                        swift_code: bankRes.swift_code || '',
                        bank_address: bankRes.bank_address || ''
                    });
                }
                setLoadingBank(false);
            } catch (error) {
                console.error("Error fetching data:", error);
            }
        };

        fetchData();
    }, [employee.private_user_id, employee.user_id]);

    // Pull the correct current-month estimate (gross/net) from the backend
    // instead of recomputing payroll in the browser. Falls back silently to
    // the contractual structure figures if it can't load.
    useEffect(() => {
        let cancelled = false;
        setEstimateLoading(true);
        setEstimateError(false);
        (async () => {
            try {
                const r = await api.get(`/private-users/${employee.private_user_id}/payslips/estimate`);
                if (!cancelled) { setEstimate(r.data); setEstimateError(false); }
            } catch {
                if (!cancelled) { setEstimate(null); setEstimateError(true); }
            } finally {
                if (!cancelled) setEstimateLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [employee.private_user_id]);

    const handleRemoveEmployee = async () => {
        if (!employee) return;

        setIsRemoving(true);
        try {
            // 1. Set status to rejected
            await api.patch(`/user/${employee.user_id}`, {
                company_onboarding_status: 'rejected'
            });
            // 2. Unverify
            await api.patch(`/user/${employee.user_id}/verify`, { verified: false });

            // 3. Unlink job if exists
            if (employee.job_details?.job_id) {
                await api.patch(`/job/${employee.job_details.job_id}/details`, { company_id: null });
            }

            setTimeout(() => {
                onBack();
            }, 500);
        } catch (error) {
            console.error("Error removing employee:", error);
            alert("Failed to remove employee. Please try again.");
            setIsRemoving(false);
        }
    };

    // Extract job details safely
    const job = employee.job_details;

    // Where "Edit salary" should take the admin. For MONTHLY staff the money
    // lives in the assigned salary STRUCTURE, not the legacy per-job salary row
    // (the Salary card / SalaryTab). Editing that flat figure changes nothing
    // the payroll engine reads — it resolves monthly pay from the structure.
    // So for monthly employees the button opens the structure-assignment flow;
    // only hourly/daily staff (whose pay really is rate × clock-ins, read from
    // the Salary card) keep scrolling to that card.
    // `pay_is_hours_driven` is the backend-authoritative signal; fall back to
    // the salary row's pay_basis when the estimate hasn't loaded.
    const salaryPayBasis = String(employee.job_details?.salaries?.[0]?.pay_basis || "").toLowerCase();
    const payIsHoursDriven =
        estimate?.pay_is_hours_driven === true ||
        salaryPayBasis === "hourly" ||
        salaryPayBasis === "daily";
    const handleEditSalary = () => {
        if (payIsHoursDriven) {
            // Hourly/daily: rate lives in the Salary card below — scroll to it.
            document.getElementById("salary-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
        } else {
            // Monthly: money lives in the salary structure — open the assignment flow.
            router.push(
                `/dashboard/salary-structures?tab=preview&employee=${employee.private_user_id}&assign=1`,
            );
        }
    };
    // Optimistic local override after a successful ScheduleEditModal save —
    // employee/job_details is a prop from the parent, which isn't refetched
    // here, so we mirror MaxShiftPanel's pattern of holding the just-saved
    // value locally instead of waiting on a parent refresh.
    const [scheduleOverride, setScheduleOverride] = useState<ScheduleValue | null>(null);
    const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
    const effectiveWorkStartTime = scheduleOverride ? scheduleOverride.work_start_time : job?.work_start_time;
    const effectiveWorkEndTime = scheduleOverride ? scheduleOverride.work_end_time : job?.work_end_time;
    const effectiveWorkDays = scheduleOverride ? scheduleOverride.work_days : job?.work_days;
    const workStartTime = effectiveWorkStartTime ? new Date(`1970-01-01T${effectiveWorkStartTime}`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A';
    const workEndTime = effectiveWorkEndTime ? new Date(`1970-01-01T${effectiveWorkEndTime}`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A';
    const workDays = effectiveWorkDays ? Object.entries(effectiveWorkDays)
        .filter(([_, active]) => active)
        .map(([day]) => day.charAt(0).toUpperCase() + day.slice(1))
        .join(', ') : 'N/A';

    return (
        <div className="h-full flex flex-col bg-gray-50/10 relative overflow-hidden">
            {/* Minimalist Profile Header */}
            <div className="bg-white dark:bg-gray-900 border-b border-gray-200/80 dark:border-gray-800 sticky top-0 z-30 shadow-sm">
                <div className="w-full px-6 py-5">
                    <div className="flex items-center justify-between gap-6 w-full">
                        <div className="flex items-center gap-6">
                            <button
                                onClick={onBack}
                                className="w-10 h-10 flex items-center justify-center rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-400 hover:text-red-600 hover:bg-white border border-transparent hover:border-red-100 transition-all group"
                                title="Back to Registry"
                            >
                                <ChevronRight className="w-5 h-5 rotate-180 group-hover:-translate-x-0.5 transition-transform" />
                            </button>

                            <div className="flex items-center gap-5">
                                <div className="relative">
                                    <div className="w-16 h-16 rounded-2xl bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-800 flex items-center justify-center text-gray-500 font-bold overflow-hidden shadow-sm">
                                        {employee.avatar.includes('http') && !employee.avatar.includes('ui-avatars') ? (
                                            <img src={employee.avatar} className="w-full h-full object-cover" alt="" />
                                        ) : (
                                            <span className="text-xl">{employee.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}</span>
                                        )}
                                    </div>
                                    <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-4 border-white dark:border-gray-900 ${employee.status === 'Active' ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                                </div>
                                <div className="space-y-1">
                                    <h1 className="text-xl font-bold text-gray-900 dark:text-white leading-none tracking-tight">
                                        {formData.name}
                                        {employee.employee_code && (
                                            <span className="ml-2 font-mono text-sm font-medium text-gray-400 dark:text-gray-500">{employee.employee_code}</span>
                                        )}
                                    </h1>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-medium text-gray-400">{formData.role || 'Employee'}</span>
                                        <span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
                                        <span className={`text-xs font-semibold ${employee.verified ? 'text-emerald-600' : 'text-amber-600'}`}>
                                            {employee.verified ? 'Verified' : 'Pending Verification'}
                                        </span>
                                        {employee.accessRole && (
                                            <>
                                                <span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
                                                <span
                                                    title="Dashboard access role (company permissions)"
                                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-500/20"
                                                >
                                                    <Shield size={11} className="text-indigo-500" />
                                                    {employee.accessRole}
                                                </span>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-8">
                            {/* Banking tab removed — there is no banking schema on the
                                backend yet, so the toggle was dead UI. Re-add when the
                                bank-details model + endpoints exist. */}

                            <div className="flex items-center gap-3">
                                <ProfileLockButton privateUserId={employee.private_user_id} />
                                <button
                                    onClick={() => setModalOpen(true)}
                                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all border border-gray-200 dark:border-gray-700 shadow-sm"
                                >
                                    <Shield size={16} className="text-emerald-500" />
                                    Review
                                </button>
                                {isEditing && (
                                    <button
                                        onClick={() => { setIsEditing(false); setSaveError(null); }}
                                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-all"
                                    >
                                        Cancel
                                    </button>
                                )}
                                {!isEditing && (
                                    <button
                                        onClick={handleSendSetupLink}
                                        disabled={sendingLink}
                                        title="Get the account set-up / password link to send to this employee"
                                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 hover:bg-amber-100 transition-all disabled:opacity-60"
                                    >
                                        <Link2 size={16} />
                                        {sendingLink ? 'Generating…' : 'Set-up link'}
                                    </button>
                                )}
                                <button
                                    onClick={isEditing ? handleSave : () => setIsEditing(true)}
                                    disabled={isSaving}
                                    className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-60 shadow-sm ${isEditing
                                        ? 'bg-emerald-600 text-white hover:bg-emerald-700 hover:shadow-emerald-100'
                                        : 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-white'
                                        }`}
                                >
                                    {isSaving ? (
                                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    ) : (
                                        <FileText size={16} />
                                    )}
                                    {isEditing ? (isSaving ? 'Saving…' : 'Save Changes') : 'Edit Profile'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                {saveError && (
                    <div className="sticky top-0 z-20 bg-red-50 dark:bg-red-900/30 border-b border-red-200 dark:border-red-800 px-6 py-2.5 flex items-center justify-between">
                        <p className="text-xs text-red-700 dark:text-red-400 font-medium">{saveError}</p>
                        <button onClick={() => setSaveError(null)} className="text-red-500 hover:text-red-700 ml-4"><X size={14} /></button>
                    </div>
                )}
                <div className="w-full max-w-7xl mx-auto p-8 lg:p-10 space-y-8 pb-32">
                    <Breadcrumbs
                        items={[
                            { label: "Employees", href: "/dashboard/employees" },
                            { label: employee.name },
                        ]}
                    />

                            {/* Personnel Insight Cards */}
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                                {/* Profile Meta */}
                                <div className="lg:col-span-2 space-y-8">
                                    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
                                        <div className="flex items-center px-5 py-4 border-b border-gray-100 dark:border-gray-800">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500">
                                                    <User size={15} />
                                                </div>
                                                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Personal Info</h3>
                                            </div>
                                        </div>
                                        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
                                            {/* Full Name — owned by employee, read-only to company */}
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                                                    <User size={12} />
                                                    Full Name
                                                </div>
                                                <div className="text-sm font-medium text-gray-900 dark:text-white">{formData.name}</div>
                                            </div>
                                            {/* Email (read-only) */}
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                                                    <Mail size={12} />
                                                    Email
                                                </div>
                                                <div className="text-sm font-medium text-gray-900 dark:text-white">{formData.email}</div>
                                            </div>
                                            {/* Phone — owned by employee, read-only to company */}
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                                                    <Phone size={12} />
                                                    Phone
                                                </div>
                                                <div className="text-sm font-medium text-gray-900 dark:text-white">{formData.phone}</div>
                                            </div>
                                            {/* Gender (read-only) */}
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                                                    <User size={12} />
                                                    Gender
                                                </div>
                                                <div className="text-sm font-medium text-gray-900 dark:text-white">{employee.gender || 'Not specified'}</div>
                                            </div>
                                            {/* Date of Birth (read-only) */}
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                                                    <Calendar size={12} />
                                                    Date of Birth
                                                </div>
                                                <div className="text-sm font-medium text-gray-900 dark:text-white">{employee.date_of_birth || 'Not specified'}</div>
                                            </div>
                                            {/* Passport (read-only) */}
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                                                    <Shield size={12} />
                                                    Passport / National ID
                                                </div>
                                                <div className="text-sm font-medium text-gray-900 dark:text-white font-mono">{employee.passport_number || 'Not specified'}</div>
                                            </div>
                                            {/* Join Date (read-only) */}
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                                                    <Clock size={12} />
                                                    Join Date
                                                </div>
                                                <div className="text-sm font-medium text-gray-900 dark:text-white">{new Date(employee.joinDate).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}</div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
                                        <div className="flex items-center px-5 py-4 border-b border-gray-100 dark:border-gray-800">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500">
                                                    <Briefcase size={15} />
                                                </div>
                                                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Employment</h3>
                                            </div>
                                        </div>
                                        <div className="p-5 space-y-6">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                                <div className="space-y-4">
                                                    {/* Job Title / Role */}
                                                    <div className="space-y-1">
                                                        <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Job Title</div>
                                                        {isEditing ? (
                                                            <input
                                                                name="role"
                                                                value={formData.role || ''}
                                                                onChange={handleChange}
                                                                placeholder="e.g. Software Engineer"
                                                                className="w-full text-sm font-medium text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-400"
                                                            />
                                                        ) : (
                                                            <div className="text-sm font-medium text-gray-900 dark:text-white">{formData.role || 'Not assigned'}</div>
                                                        )}
                                                    </div>
                                                    {/* Department — read-only; managed in Settings → Departments */}
                                                    <div className="space-y-1">
                                                        <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Department</div>
                                                        <div className="text-sm font-medium text-gray-900 dark:text-white">{formData.department || <span className="text-gray-400 italic">Unassigned</span>}</div>
                                                        {isEditing && (
                                                            <p className="text-[11px] text-gray-400 dark:text-gray-500">Manage in Settings → Departments</p>
                                                        )}
                                                    </div>
                                                    {/* Site / Branch — read-only; managed in Settings → Geofencing */}
                                                    <div className="space-y-1">
                                                        <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Site / Branch</div>
                                                        <div className="text-sm font-medium text-gray-900 dark:text-white">{employee.home_site_name || <span className="text-gray-400 italic">Unassigned</span>}</div>
                                                        {isEditing && (
                                                            <p className="text-[11px] text-gray-400 dark:text-gray-500">Manage in Settings → Geofencing</p>
                                                        )}
                                                    </div>
                                                    <div className="space-y-1">
                                                        <div className="flex items-center justify-between">
                                                            <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Schedule</div>
                                                            {job?.job_id && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setScheduleModalOpen(true)}
                                                                    className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                                                                >
                                                                    Edit
                                                                </button>
                                                            )}
                                                        </div>
                                                        <div className="flex flex-col gap-1.5 mt-1">
                                                            <div className="inline-flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 px-3 py-1.5 rounded-lg border border-gray-100 dark:border-gray-700">
                                                                <Clock size={12} className="text-gray-400" />
                                                                {workStartTime} — {workEndTime}
                                                            </div>
                                                            <div className="inline-flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 px-3 py-1.5 rounded-lg border border-gray-100 dark:border-gray-700">
                                                                <Calendar size={12} className="text-gray-400" />
                                                                {workDays}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="space-y-4">
                                                    <div className="space-y-1">
                                                        <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Documents</div>
                                                        <div className="flex flex-wrap gap-2 mt-1">
                                                            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium ${job?.has_contract ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400'
                                                                }`}>
                                                                <FileText size={11} />
                                                                {job?.has_contract ? 'Contract active' : 'No contract'}
                                                            </div>
                                                            {job?.has_permission_to_work && (
                                                                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-emerald-100 bg-emerald-50 text-emerald-700 text-xs font-medium">
                                                                    <CheckCircle size={11} />
                                                                    Work permit
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Side Panels */}
                                <div className="space-y-8">
                                    <div className="bg-gray-900 dark:bg-black rounded-2xl p-6 text-white shadow-xl relative overflow-hidden group">
                                        <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform">
                                            <TrendingUp size={80} />
                                        </div>
                                        <div className="relative z-10">
                                            <div className="flex items-center justify-between mb-6">
                                                <div className="text-xs font-bold text-gray-400 uppercase tracking-widest">Payroll Estimate</div>
                                                <button
                                                    onClick={handleEditSalary}
                                                    title={payIsHoursDriven ? "Edit the pay rate in the Salary card below" : "Edit this employee's salary structure"}
                                                    className="text-[10px] font-semibold text-gray-400 hover:text-white underline underline-offset-2"
                                                >
                                                    {payIsHoursDriven ? "Edit salary" : "Edit salary structure"}
                                                </button>
                                            </div>
                                            <div className="space-y-6">
                                                <div>
                                                    {estimateLoading ? (
                                                        <div className="text-sm text-gray-400">Loading payroll estimate…</div>
                                                    ) : estimateError ? (
                                                        // A fetch failure is NOT the same as a legitimate zero — say so
                                                        // explicitly instead of silently swapping in a different,
                                                        // unlabeled contractual figure under the same headline.
                                                        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5">
                                                            <p className="text-sm font-semibold text-red-300">Couldn&apos;t load payroll estimate</p>
                                                            <p className="text-[10px] text-red-400/80 mt-1">See the Salary card below for the configured base salary and allowances.</p>
                                                        </div>
                                                    ) : estimate?.zero_reason ? (
                                                        <div>
                                                            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2.5">
                                                                <p className="text-sm font-semibold text-amber-300">
                                                                    {estimate.zero_reason === "no_pay_basis" ? "No salary configured yet" : "No completed shifts this period yet"}
                                                                </p>
                                                                <p className="text-[10px] text-amber-400/70 mt-1">
                                                                    {estimate.zero_reason === "no_pay_basis"
                                                                        ? "This employee has clock-in hours this period, but no salary or hourly rate is set up — configure it in the Salary card below."
                                                                        : "This is an hourly-paid employee with no completed (clocked-out) shifts yet this period."}
                                                                </p>
                                                            </div>
                                                            <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mt-2">Payroll estimate (this period)</div>
                                                        </div>
                                                    ) : estimate ? (
                                                        <div className="flex items-end justify-between">
                                                            <div>
                                                                <div className="text-3xl font-bold tracking-tight">Rs{Number(estimate.gross).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                                                <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mt-1">Payroll estimate (this period)</div>
                                                            </div>
                                                            <div className="text-right">
                                                                <div className="text-sm font-semibold text-emerald-400">Rs{Number(estimate.net).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                                                <div className="text-[9px] text-gray-500 font-bold uppercase">Estimated Net</div>
                                                            </div>
                                                        </div>
                                                    ) : null}
                                                </div>

                                                {estimate?.leave_summary && estimate.leave_summary.length > 0 && (
                                                    <div className="mt-3 pt-3 border-t border-white/10">
                                                        <div className="text-[9px] text-gray-400 font-bold uppercase tracking-wider mb-1.5">
                                                            Leave taken{estimate.period?.label ? ` · ${estimate.period.label}` : ""}
                                                        </div>
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {estimate.leave_summary.map((lv) => (
                                                                <span
                                                                    key={lv.code}
                                                                    className={`text-[11px] font-medium px-2 py-0.5 rounded-md border ${lv.paid ? "border-emerald-500/30 text-emerald-300 bg-emerald-500/10" : "border-amber-500/30 text-amber-300 bg-amber-500/10"}`}
                                                                >
                                                                    {lv.label} · {lv.days}d · {lv.paid ? "paid" : "unpaid"}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Real per-component breakdown from the payroll engine (BASIC,
                                                    allowances, overtime buckets, etc.) — the configured base
                                                    salary / allowances themselves live in the Salary card below,
                                                    not duplicated here. */}
                                                {estimate && estimate.earnings && estimate.earnings.length > 0 && (
                                                    <div className="pt-1">
                                                        <div className="text-[9px] text-gray-400 font-bold uppercase tracking-wider mb-1.5">
                                                            Earnings
                                                        </div>
                                                        {estimate.earnings.map((e, i) => (
                                                            // Hourly staff can have several buckets sharing a code
                                                            // (REG + OT tiers from the overtime engine), so the code
                                                            // alone isn't unique — pair it with the index.
                                                            <div key={`${e.code}-${i}`} className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5 mb-2">
                                                                <div className="flex items-center gap-2.5">
                                                                    <DollarSign size={14} className="text-gray-400" />
                                                                    <span className="text-xs font-medium text-gray-300">
                                                                        {e.label}
                                                                        {e.multiplier_badge && <span className="text-gray-500"> ({e.multiplier_badge})</span>}
                                                                    </span>
                                                                </div>
                                                                <span className="text-xs font-bold text-white">
                                                                    Rs{e.amount_str}
                                                                    {e.hours_str && <span className="text-gray-500 font-normal"> · {e.hours_str}</span>}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Deductions — same components (statutory + absence/loan/unpaid-leave)
                                                    that already reduce gross to net above; previously computed but
                                                    never shown, so an absence deduction or loan repayment was
                                                    invisible even though it had already changed the net figure. */}
                                                {estimate && estimate.deductions && estimate.deductions.length > 0 && (
                                                    <div className="pt-1">
                                                        <div className="text-[9px] text-gray-400 font-bold uppercase tracking-wider mb-1.5">
                                                            Deductions
                                                        </div>
                                                        {estimate.deductions.map((d, i) => (
                                                            <div key={`${d.code}-${i}`} className="flex items-center justify-between p-3 rounded-xl bg-red-500/5 border border-red-500/10 mb-2">
                                                                <span className="text-xs font-medium text-gray-300">{d.label}</span>
                                                                <span className="text-xs font-bold text-red-300">−Rs{d.amount_str}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                <div className="h-px bg-gray-800" />

                                                {estimate?.attendance ? (
                                                    <div>
                                                        <div className="flex items-center gap-2 text-gray-500">
                                                            <Clock size={12} />
                                                            <span className="text-[10px] uppercase font-bold tracking-wider">Attendance this period</span>
                                                        </div>
                                                        <div className="text-lg font-bold mt-1">
                                                            {estimate.attendance.present_days}/{estimate.attendance.scheduled_days} days present
                                                        </div>
                                                        <p className="text-[10px] text-gray-400 mt-1">
                                                            {estimate.attendance.absent_days > 0
                                                                ? `${estimate.attendance.absent_days} day(s) with no clock-in and no approved leave — reflected in the Deductions line above.`
                                                                : "No unexplained absences this period — full contractual pay applies."}
                                                        </p>
                                                        <HoursReferenceRow
                                                            hours={attendanceStats.totalHours}
                                                            rate={attendanceStats.nominalHourlyRate}
                                                            firstName={employee.name.split(' ')[0]}
                                                        />
                                                    </div>
                                                ) : (
                                                    <div>
                                                        <div className="flex items-center gap-2 text-gray-500">
                                                            <Clock size={12} />
                                                            <span className="text-[10px] uppercase font-bold tracking-wider">Hours worked this period</span>
                                                        </div>
                                                        <div className="text-lg font-bold mt-1">{attendanceStats.totalHours}h</div>
                                                        <p className="text-[10px] text-gray-400 mt-1">
                                                            {estimate?.pay_is_hours_driven
                                                                ? "Directly drives the pay above (see hours next to each earning line)."
                                                                : "Attendance only — this employee's pay is a fixed salary and isn't affected by hours logged."}
                                                        </p>
                                                        {estimate?.pay_is_hours_driven === false && (
                                                            <HoursReferenceRow
                                                                hours={attendanceStats.totalHours}
                                                                rate={attendanceStats.nominalHourlyRate}
                                                                firstName={employee.name.split(' ')[0]}
                                                            />
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* v1.6 polish — pack the small admin-management panels
                                        into a 2-col grid (Verification + Kiosk PIN side-by-
                                        side) so they don't trap dead white space in a single
                                        narrow column. MaxShift was moved OUT to a full-width
                                        section below the grid (see right after this parent
                                        closes) because keeping it here made the right column
                                        taller than the left, leaving dead space below the
                                        employee-info card. */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500">
                                                    <Shield size={15} />
                                                </div>
                                                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Verification</h3>
                                            </div>
                                            <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700">
                                                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">Status: <span className={`font-medium ${employee.verified ? 'text-emerald-600' : 'text-amber-600'}`}>{employee.verified ? 'Verified' : 'Pending'}</span>. Regular audits are performed on all accounts.</p>
                                            </div>
                                            <button
                                                onClick={() => setModalOpen(true)}
                                                className="w-full py-2.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 transition-colors"
                                            >
                                                Start Review
                                            </button>
                                        </div>

                                        <KioskPinPanel privateUserId={employee.private_user_id} />
                                    </div>
                                </div>
                            </div>

                            {/* v1.6 polish — MaxShift in a full-width row outside
                                the 2/1-col parent grid so it doesn't make the
                                admin column run taller than the employee-info
                                column. The chain hint + two inputs fit naturally
                                across the full page width. */}
                            <MaxShiftPanel
                                userId={employee.user_id}
                                jobId={employee.job_details?.job_id ?? null}
                                initialEmployeeOverride={
                                    ((employee as unknown as { max_shift_hours?: number | null }).max_shift_hours) ?? null
                                }
                                initialJobOverride={employee.job_details?.max_shift_hours ?? null}
                                initialCompanyDefault={
                                    ((user?.company as unknown as { default_max_shift_hours?: number | null })?.default_max_shift_hours) ?? null
                                }
                            />



                    {/* Registry Sub-Sections */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden flex flex-col">
                            <div className="flex items-center px-5 py-4 border-b border-gray-100 dark:border-gray-800">
                                <div className="flex items-center gap-2">
                                    <History size={15} className="text-gray-400" />
                                    <span className="text-sm font-semibold text-gray-900 dark:text-white">Work History</span>
                                </div>
                            </div>
                            <div className="p-5 space-y-4 flex-1">
                                {jobHistory.length > 0 ? jobHistory.map((historyJob: any, index: number) => {
                                    const isCurrent = historyJob.job_id === employee.job_details?.job_id;
                                    return (
                                        <div key={index} className="flex gap-4 group">
                                            <div className="flex flex-col items-center">
                                                <div className={`w-2.5 h-2.5 rounded-full border-2 mt-1 ${isCurrent ? 'bg-gray-900 border-gray-300' : 'bg-gray-100 border-gray-300'}`} />
                                                {index < jobHistory.length - 1 && <div className="w-0.5 h-full bg-gray-100 my-1" />}
                                            </div>
                                            <div className="pb-4 space-y-0.5">
                                                <div className={`text-sm font-medium leading-none ${isCurrent ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'}`}>{historyJob.job_title || 'Position'}</div>
                                                <div className="text-xs text-gray-400">{historyJob.employer_name || historyJob.employer_brn}</div>
                                                <div className="text-xs text-gray-400">Since {new Date(historyJob.first_date_of_employment).toLocaleDateString([], { month: 'short', year: 'numeric' })}</div>
                                            </div>
                                        </div>
                                    );
                                }) : (
                                    <div className="flex items-center justify-center py-8 text-xs text-gray-400">No work history on record</div>
                                )}
                            </div>
                        </div>

                        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500">
                                    <Clock size={15} />
                                </div>
                                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Attendance at a Glance</h3>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                {[
                                    { label: 'Total Days', value: timeLogs.length },
                                    { label: 'Total Hours', value: timeLogs.reduce((s, l) => s + computeLiveHoursForLog(l), 0).toFixed(1) + 'h' },
                                    { label: 'Avg Per Day', value: timeLogs.length > 0 ? (timeLogs.reduce((s, l) => s + computeLiveHoursForLog(l), 0) / timeLogs.length).toFixed(1) + 'h' : '—' },
                                    { label: 'Overtime', value: timeLogs.filter(l => l.is_overtime).length + ' sessions' },
                                ].map(stat => (
                                    <div key={stat.label} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3.5 border border-gray-100 dark:border-gray-700">
                                        <div className="text-lg font-semibold text-gray-900 dark:text-white">{stat.value}</div>
                                        <div className="text-xs text-gray-400 mt-0.5">{stat.label}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Salary Card — single source of truth for editing base salary,
                        allowance, hours, work days and break time (the sidebar Payroll
                        Estimate card above is read-only and links here to edit). */}
                    <div id="salary-section" className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden scroll-mt-32">
                        <div className="flex items-center px-5 py-4 border-b border-gray-100 dark:border-gray-800">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500">
                                    <DollarSign size={15} />
                                </div>
                                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Salary</h3>
                            </div>
                        </div>
                        <div className="p-5">
                            <SalaryTab
                                jobId={employee.job_details?.job_id ?? null}
                                employeeName={employee.name}
                                privateUserId={employee.private_user_id}
                            />
                        </div>
                    </div>

                    {/* Recurring allowances & deductions */}
                    {companyId && (
                        <RecurringAllowancesPanel
                            privateUserId={employee.private_user_id}
                            companyId={companyId}
                        />
                    )}

                    {/* One-off allowances */}
                    {companyId && (
                        <OneOffAllowancesPanel
                            privateUserId={employee.private_user_id}
                            companyId={companyId}
                        />
                    )}

                    {/* Location / Country (missions & transfers) */}
                    {companyId && (
                        <CountryLocationPanel
                            privateUserId={employee.private_user_id}
                            companyId={companyId}
                        />
                    )}

                    {/* Full Attendance Logs */}
                    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
                        {/* Header + filter pills */}
                        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
                            <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500">
                                    <Clock size={15} />
                                </div>
                                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Attendance Logs</h3>
                                <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full font-medium">{filteredLogs.length} entries</span>
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                                {(['all', 'week', 'last_week', 'month', 'last_month'] as const).map(f => (
                                    <button
                                        key={f}
                                        onClick={() => { setAttendanceFilter(f); setAttendancePage(1); }}
                                        className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                                            attendanceFilter === f
                                                ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900'
                                                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                                        }`}
                                    >
                                        {f === 'all' ? 'All Time' : f === 'week' ? 'This Week' : f === 'last_week' ? 'Last Week' : f === 'month' ? 'This Month' : 'Last Month'}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Stats strip */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-gray-100 dark:divide-gray-800 border-b border-gray-100 dark:border-gray-800">
                            {[
                                { label: 'Days Present', value: attendanceStats.days },
                                { label: 'Total Hours', value: attendanceStats.totalHours + 'h' },
                                { label: 'Avg Per Day', value: attendanceStats.avgHours + 'h' },
                                { label: 'Overtime Sessions', value: attendanceStats.overtime },
                            ].map(stat => (
                                <div key={stat.label} className="px-5 py-4">
                                    <div className="text-xl font-semibold text-gray-900 dark:text-white">{stat.value}</div>
                                    <div className="text-xs text-gray-400 mt-0.5">{stat.label}</div>
                                </div>
                            ))}
                        </div>

                        {filteredLogs.length > 0 ? (
                            <>
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[640px]">
                                        <thead>
                                            <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/50">
                                                <th className="text-left text-xs font-semibold text-gray-400 dark:text-gray-500 px-5 py-3 uppercase tracking-wide">Date</th>
                                                <th className="text-left text-xs font-semibold text-gray-400 dark:text-gray-500 px-4 py-3 uppercase tracking-wide">Day</th>
                                                <th className="text-left text-xs font-semibold text-gray-400 dark:text-gray-500 px-4 py-3 uppercase tracking-wide">Clock In</th>
                                                <th className="text-left text-xs font-semibold text-gray-400 dark:text-gray-500 px-4 py-3 uppercase tracking-wide">Clock Out</th>
                                                <th className="text-right text-xs font-semibold text-gray-400 dark:text-gray-500 px-4 py-3 uppercase tracking-wide">Hours</th>
                                                <th className="text-right text-xs font-semibold text-gray-400 dark:text-gray-500 px-4 py-3 uppercase tracking-wide">Breaks</th>
                                                <th className="text-left text-xs font-semibold text-gray-400 dark:text-gray-500 px-5 py-3 uppercase tracking-wide">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50 dark:divide-gray-800/80">
                                            {pagedLogs.map((log: any) => {
                                                const clockIn = log.start_time ? new Date(log.start_time) : null;
                                                const clockOut = log.end_time ? new Date(log.end_time) : null;
                                                const hoursWorked = (clockIn && clockOut) ? computeLiveHoursForLog(log) : null;
                                                const breakCount = Array.isArray(log.breaks) ? log.breaks.length : 0;
                                                const isActive = !!clockIn && !clockOut;
                                                const isOvertime = !!log.is_overtime;
                                                return (
                                                    <tr key={log.timelog_id} className="hover:bg-gray-50/80 dark:hover:bg-gray-800/40 transition-colors">
                                                        <td className="px-5 py-3.5">
                                                            <span className="text-sm font-medium text-gray-900 dark:text-white">
                                                                {clockIn ? clockIn.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3.5">
                                                            <span className="text-sm text-gray-600 dark:text-gray-300">{log.day_of_week || '—'}</span>
                                                        </td>
                                                        <td className="px-4 py-3.5">
                                                            <span className="text-sm font-mono text-gray-700 dark:text-gray-300">
                                                                {clockIn ? clockIn.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3.5">
                                                            <span className={`text-sm font-mono ${clockOut ? 'text-gray-700 dark:text-gray-300' : 'text-emerald-500'}`}>
                                                                {clockOut ? clockOut.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : isActive ? 'Active' : '—'}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3.5 text-right">
                                                            <span className={`text-sm font-semibold tabular-nums ${
                                                                hoursWorked != null && hoursWorked > 8
                                                                    ? 'text-amber-600 dark:text-amber-400'
                                                                    : 'text-gray-900 dark:text-white'
                                                            }`}>
                                                                {hoursWorked != null ? hoursWorked.toFixed(1) + 'h' : '—'}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3.5 text-right">
                                                            <span className="text-sm text-gray-500 dark:text-gray-400">
                                                                {breakCount > 0 ? `${breakCount}×` : '—'}
                                                            </span>
                                                        </td>
                                                        <td className="px-5 py-3.5">
                                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border ${
                                                                isActive
                                                                    ? 'bg-emerald-50 border-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-800 dark:text-emerald-400'
                                                                    : isOvertime
                                                                    ? 'bg-amber-50 border-amber-100 text-amber-700 dark:bg-amber-900/30 dark:border-amber-800 dark:text-amber-400'
                                                                    : 'bg-gray-50 dark:bg-gray-800 border-gray-100 dark:border-gray-700 text-gray-500 dark:text-gray-400'
                                                            }`}>
                                                                {isActive ? '● Active' : isOvertime ? '▲ Overtime' : '✓ Done'}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                                {totalAttendancePages > 1 && (
                                    <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-gray-800">
                                        <span className="text-xs text-gray-400">
                                            Showing {(attendancePage - 1) * LOGS_PER_PAGE + 1}–{Math.min(attendancePage * LOGS_PER_PAGE, filteredLogs.length)} of {filteredLogs.length}
                                        </span>
                                        <div className="flex gap-1.5">
                                            <button
                                                onClick={() => setAttendancePage(p => Math.max(1, p - 1))}
                                                disabled={attendancePage === 1}
                                                className="px-3 py-1 text-xs rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                            >← Prev</button>
                                            <button
                                                onClick={() => setAttendancePage(p => Math.min(totalAttendancePages, p + 1))}
                                                disabled={attendancePage === totalAttendancePages}
                                                className="px-3 py-1 text-xs rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                            >Next →</button>
                                        </div>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="flex flex-col items-center justify-center py-16">
                                <Clock size={36} className="text-gray-200 dark:text-gray-700 mb-3" />
                                <p className="text-sm text-gray-400 dark:text-gray-500">No attendance records for this period</p>
                            </div>
                        )}
                    </div>

                    <div className="bg-red-50 rounded-xl border border-red-100 p-5">
                        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
                            <div className="space-y-1">
                                <div className="flex items-center gap-2 text-red-700">
                                    <AlertTriangle size={16} />
                                    <h3 className="text-sm font-semibold">Remove Employee</h3>
                                </div>
                                <p className="text-xs text-gray-500 leading-relaxed max-w-xl">
                                    This will unlink the employee from your organisation and set their status to inactive. Their profile data will be retained.
                                </p>
                            </div>
                            <button
                                onClick={() => setShowRemoveConfirm(true)}
                                className="px-4 py-2 bg-white border border-red-200 text-red-600 hover:bg-red-600 hover:text-white rounded-lg text-sm font-medium transition-colors shrink-0"
                            >
                                Remove
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Account set-up link — copy/send so the employee can set a password */}
            {claimLinkInfo && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm">
                    <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
                        <div className="flex items-start gap-4 mb-4">
                            <div className="w-10 h-10 bg-amber-50 dark:bg-amber-950/40 rounded-xl flex items-center justify-center shrink-0">
                                <Link2 size={18} className="text-amber-600 dark:text-amber-400" />
                            </div>
                            <div>
                                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Account set-up link</h3>
                                <p className="text-sm text-gray-500 mt-0.5">
                                    Send this to <span className="font-semibold text-gray-900 dark:text-white">{claimLinkInfo.who}</span> so they can set a password and log in. Expires in 14 days.
                                </p>
                            </div>
                        </div>
                        <input
                            readOnly
                            value={claimLinkInfo.link}
                            onFocus={(e) => e.currentTarget.select()}
                            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white mb-4 font-mono"
                        />
                        <div className="flex gap-3">
                            <button
                                onClick={() => { navigator.clipboard?.writeText(claimLinkInfo.link).catch(() => {}); toast.success('Link copied'); }}
                                className="flex-1 px-4 py-2.5 bg-gray-900 dark:bg-white hover:opacity-90 text-white dark:text-gray-900 rounded-lg text-sm font-medium transition-opacity"
                            >
                                Copy link
                            </button>
                            <a
                                href={`https://wa.me/?text=${encodeURIComponent('Set up your Kiruko account: ' + claimLinkInfo.link)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-1 px-4 py-2.5 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-400 rounded-lg text-sm font-medium transition-colors text-center"
                            >
                                Send on WhatsApp
                            </a>
                            <button
                                onClick={() => setClaimLinkInfo(null)}
                                className="px-4 py-2.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium transition-colors"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Verification Modal Mounting */}
            <VerifyEmployeeModal
                userId={employee.id}
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
                onResult={(res) => {
                    if (res.action === 'approved' || res.action === 'rejected') {
                        onBack();
                    }
                }}
            />

            {showRemoveConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm">
                    <div className="relative w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-xl overflow-hidden border border-gray-200 dark:border-gray-800">
                        <div className="p-6">
                            <div className="flex flex-col items-center text-center">
                                <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center text-red-600 mb-4 border border-red-100">
                                    <UserX size={22} />
                                </div>
                                <h3 className="text-base font-semibold text-gray-900 mb-1">Remove Employee?</h3>
                                <p className="text-xs text-gray-400 mb-5">Confirm account removal</p>

                                <p className="text-sm text-gray-500 leading-relaxed mb-6">
                                    This will remove <strong className="text-gray-900">{employee.name}</strong> from your organisation. Their profile will be set to inactive.
                                </p>

                                <div className="flex gap-3 w-full">
                                    <button
                                        onClick={() => setShowRemoveConfirm(false)}
                                        className="flex-1 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleRemoveEmployee}
                                        disabled={isRemoving}
                                        className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center"
                                    >
                                        {isRemoving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Remove'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {scheduleModalOpen && job?.job_id && (
                <ScheduleEditModal
                    jobId={job.job_id}
                    initial={{
                        work_start_time: effectiveWorkStartTime ?? null,
                        work_end_time: effectiveWorkEndTime ?? null,
                        work_days: effectiveWorkDays ?? null,
                    }}
                    onClose={() => setScheduleModalOpen(false)}
                    onSaved={(value) => setScheduleOverride(value)}
                />
            )}
            </div>
    );
}

// Hours logged x nominal hourly-equivalent rate (basic salary / contracted
// monthly hours) — a REFERENCE figure only, not this salaried employee's
// actual pay (the fixed amount on the Payroll Estimate above is). Styled as
// a distinct dashed-border row, visually separate from the solid-bordered
// earnings/deductions rows, so it never reads as another real pay line.
function HoursReferenceRow({ hours, rate, firstName }: { hours: string; rate: number; firstName: string }) {
    if (rate <= 0) return null;
    const value = parseFloat(hours) * rate;
    return (
        <div className="mt-3 flex items-center justify-between p-3 rounded-xl bg-white/5 border border-dashed border-white/15">
            <div className="flex items-center gap-2.5 min-w-0">
                <Smartphone size={14} className="text-gray-500 shrink-0" />
                <div className="min-w-0">
                    <div className="text-xs font-medium text-gray-300">Hours-based reference</div>
                    <div className="text-[10px] text-gray-500 truncate">Same figure {firstName} sees on mobile — not actual pay</div>
                </div>
            </div>
            <div className="text-right shrink-0 pl-3">
                <div className="text-xs font-bold text-gray-300">≈Rs{value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                <div className="text-[9px] text-gray-500">{hours}h × nominal rate</div>
            </div>
        </div>
    );
}
