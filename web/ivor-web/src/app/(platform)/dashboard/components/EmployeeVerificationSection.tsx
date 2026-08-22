"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useEffect } from "react";
import {
    UserCheck,
    CheckCircle,
    XCircle,
    Clock,
    User,
    MapPin,
    Mail,
    Calendar,
    Briefcase,
    AlertTriangle,
    Eye,
    Link2,
} from "lucide-react";
import { toast } from "sonner";

import { fetchCompanyUsers, resendClaimLink } from "../../../../services/api";
import { api } from "../../../../services/apiClient";
import { useAuth } from "@/contexts/AuthContext";
import VerifyEmployeeModal from "./VerifyEmployeeModal";
import DashboardHeader from "@/components/ui/DashboardHeader";
import SolarisBackground from "@/components/ui/SolarisBackground";
import SearchInput from "@/components/ui/SearchInput";

// Local fallback type for pending employees
type PendingEmployee = {
    id: number;
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    passport_number?: string;
    date_of_birth?: string;
    job_title?: string;
    employer_name?: string;
    employer_brn?: string;
    work_start_time?: string;
    work_end_time?: string;
    monthly_salary?: number;
    currency?: string;
    employer_email?: string;
    employer_phone?: string;
    employer_address?: string;
    last_clock_in_location?: string;
    last_clock_out_location?: string;
    total_work_locations?: number;
    verification_status?: 'pending' | 'approved' | 'rejected';
    first_date_of_employment?: string;
    user_verified?: boolean;
};

export default function EmployeeVerificationSection() {
    const [pendingEmployees, setPendingEmployees] = useState<PendingEmployee[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionError, setActionError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedEmployee, setSelectedEmployee] = useState<PendingEmployee | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [resendingId, setResendingId] = useState<number | null>(null);
    // The generated set-up link, shown in a modal so the employer can copy it
    // and send it (email delivery is best-effort and may be off in prod).
    const [claimLinkInfo, setClaimLinkInfo] = useState<{ who: string; link: string } | null>(null);

    // Re-issue the account set-up link for an imported employee who hasn't
    // claimed yet, then SHOW it so it can be copied/sent regardless of email.
    const handleResendClaim = async (employee: PendingEmployee) => {
        setResendingId(employee.id);
        const res = await resendClaimLink(employee.id);
        setResendingId(null);
        if ('error' in res) {
            toast.error(res.error || 'Failed to generate the set-up link');
            return;
        }
        const who = employee.first_name || 'the employee';
        try { await navigator.clipboard.writeText(res.claim_link); } catch { /* shown in modal anyway */ }
        setClaimLinkInfo({ who, link: res.claim_link });
    };
    // Confirmation for the quick-reject (X) button — destructive, so never fire
    // it on a single click. Captures an optional reason for the operator.
    const [employeeToReject, setEmployeeToReject] = useState<PendingEmployee | null>(null);
    const [rejectReason, setRejectReason] = useState('');

    const { companyId } = useAuth();

    // Fetch pending employees from API
    const fetchPendingEmployees = async () => {
        setLoading(true);
        try {
            if (companyId) {
                // Fetch all company users and locally include pending/rejected/unverified
                const response = await fetchCompanyUsers(companyId);

                if ('error' in response) {
                    console.error("Error fetching company users:", response);
                    setPendingEmployees([]);
                    return;
                }

                const users = response as any[];

                if (Array.isArray(users)) {
                    // Keep users that are not approved (pending/rejected) or explicitly unverified
                    const filtered = users.filter((u: any) => {
                        const onboarding = u.company_onboarding_status;
                        const verified = u.user_verified;
                        return onboarding !== 'approved' || verified === false;
                    });

                    const companyEmployees: PendingEmployee[] = filtered.map((u: any) => {
                        const job = u.private_user?.jobs?.find((j: any) => j.company_id === companyId);
                        const onboarding = u.company_onboarding_status as 'pending' | 'approved' | 'rejected' | undefined;
                        const verified = u.user_verified === true;
                        const verification_status = onboarding || (verified ? 'approved' : 'pending');

                        return {
                            id: u.user_id,
                            first_name: u.private_user?.first_name,
                            last_name: u.private_user?.last_name,
                            email: u.email,
                            job_title: job?.job_title,
                            verification_status: verification_status as any,
                            first_date_of_employment: job?.first_date_of_employment || undefined,
                            phone: u.private_user?.phone,
                            passport_number: u.private_user?.pass_port_number,
                            date_of_birth: u.private_user?.date_of_birth,
                            user_verified: verified,
                        };
                    });

                    setPendingEmployees(companyEmployees);
                } else {
                    setPendingEmployees([]);
                }
            } else {
                setPendingEmployees([]);
            }
        } catch (err) {
            console.error('Error fetching employees:', err);
            setPendingEmployees([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPendingEmployees();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [companyId]);

    const handleVerification = async (employee: PendingEmployee, action: 'approve' | 'reject', reason?: string) => {
        setIsProcessing(true);
        setActionError(null);

        try {
            if (action === 'approve') {
                // Single atomic endpoint — sets status, verified, links company in one transaction
                await api.post(`/user/${employee.id}/approve`, {});
            } else {
                // Reject is atomic on the backend: this single PATCH sets
                // rejected, clears verification, and detaches the company in one
                // transaction. No second /verify call (which used to 400 once
                // the company was detached, depending on call order).
                const trimmed = reason?.trim();
                await api.patch(`/user/${employee.id}`, {
                    company_onboarding_status: 'rejected',
                    ...(trimmed ? { rejection_reason: trimmed } : {}),
                });
            }

            // Re-fetch to reflect the actual server state
            await fetchPendingEmployees();

            setIsProcessing(false);
            setSelectedEmployee(null);
            setEmployeeToReject(null);
            setRejectReason('');
        } catch (err: any) {
            console.error('Error verifying employee:', err);
            setActionError(err?.response?.data?.detail || 'Failed to process verification. Please try again.');
            setIsProcessing(false);
        }
    };

    const filteredEmployees = pendingEmployees.filter(emp => {
        const matchesSearch =
            (emp.first_name?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false) ||
            (emp.last_name?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false) ||
            (emp.email?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);
        return matchesSearch;
    });

    return (
        <SolarisBackground>
            <div className="w-full max-w-7xl mx-auto py-8 px-6 space-y-6">
                <DashboardHeader
                    title="Verification"
                    subtitle="Review and verify newly registered employees before they gain full access."
                    icon={UserCheck}
                />

                {/* Action error banner */}
                {actionError && (
                    <div className="flex items-center justify-between gap-3 px-4 py-3 bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900 rounded-xl text-sm text-red-700 dark:text-red-400 animate-in slide-in-from-top-2 duration-300">
                        <span>{actionError}</span>
                        <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-600 transition-colors shrink-0">✕</button>
                    </div>
                )}

                {/* Search */}
                <SearchInput
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder="Search by name or email..."
                    className="w-full max-w-sm"
                />

                {/* List */}
                {loading ? (
                    <div className="flex items-center justify-center py-20 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
                        <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-800 rounded-full animate-spin" />
                    </div>
                ) : filteredEmployees.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl text-center">
                        <div className="w-12 h-12 bg-gray-50 rounded-lg flex items-center justify-center mb-4">
                            <UserCheck className="w-6 h-6 text-gray-300" />
                        </div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">All verified</p>
                        <p className="text-sm text-gray-500">All employees have been processed.</p>
                    </div>
                ) : (
                    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
                        <table className="w-full text-left">
                            <thead className="border-b border-gray-100 dark:border-gray-800">
                                <tr>
                                    <th className="px-5 py-3.5 text-xs font-medium text-gray-500">Employee</th>
                                    <th className="px-5 py-3.5 text-xs font-medium text-gray-500">Role</th>
                                    <th className="px-5 py-3.5 text-xs font-medium text-gray-500">Status</th>
                                    <th className="px-5 py-3.5 text-xs font-medium text-gray-500 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                                {filteredEmployees.map((employee) => (
                                    <tr key={employee.id} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                                        <td className="px-5 py-3.5">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-xs font-semibold text-gray-700 shrink-0">
                                                    {employee.first_name?.[0]}{employee.last_name?.[0]}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                                        {employee.first_name} {employee.last_name}
                                                    </p>
                                                    <p className="text-xs text-gray-400 truncate">{employee.email}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-5 py-3.5">
                                            <p className="text-sm font-medium text-gray-900 dark:text-white">{employee.job_title || <span className="text-gray-400 italic font-normal">No job title</span>}</p>
                                        </td>
                                        <td className="px-5 py-3.5">
                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-100 text-xs font-medium">
                                                <Clock size={11} />
                                                Pending
                                            </span>
                                        </td>
                                        <td className="px-5 py-3.5 text-right">
                                            <div className="flex items-center justify-end gap-1.5">
                                                {!employee.user_verified && (
                                                    <button
                                                        onClick={() => handleResendClaim(employee)}
                                                        disabled={resendingId === employee.id}
                                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 hover:bg-amber-200 dark:bg-amber-950/50 dark:hover:bg-amber-950/70 text-amber-800 dark:text-amber-300 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
                                                        title="Get the password set-up link to send to this employee"
                                                    >
                                                        <Link2 size={14} />
                                                        {resendingId === employee.id ? 'Generating…' : 'Set-up link'}
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => { setEmployeeToReject(employee); setRejectReason(''); }}
                                                    disabled={isProcessing}
                                                    className="p-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-md transition-colors disabled:opacity-50"
                                                    title="Reject"
                                                >
                                                    <XCircle size={16} />
                                                </button>
                                                <button
                                                    onClick={() => { setSelectedEmployee(employee); setModalOpen(true); }}
                                                    disabled={isProcessing}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 hover:bg-gray-800 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                                                >
                                                    <Eye size={14} />
                                                    Review
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Account set-up link — shown so it can be copied/sent even when email is off */}
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
                                        Send this to <span className="font-semibold text-gray-900 dark:text-white">{claimLinkInfo.who}</span> so they can set a password. Expires in 14 days.
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

                {/* Quick-reject confirmation — destructive, so confirm + capture reason first */}
                {employeeToReject && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm">
                        <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
                            <div className="flex items-start gap-4 mb-5">
                                <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center shrink-0">
                                    <AlertTriangle size={18} className="text-red-600" />
                                </div>
                                <div>
                                    <h3 className="text-base font-semibold text-gray-900 dark:text-white">Reject employee</h3>
                                    <p className="text-sm text-gray-500 mt-0.5">
                                        Reject <span className="font-semibold text-gray-900 dark:text-white">{employeeToReject.first_name} {employeeToReject.last_name}</span>? They will not gain company access.
                                    </p>
                                </div>
                            </div>

                            <label className="block text-xs font-medium text-gray-500 mb-1.5">Reason (optional)</label>
                            <textarea
                                value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)}
                                rows={3}
                                placeholder="Why is this application being rejected?"
                                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none mb-4"
                            />

                            <div className="flex gap-3">
                                <button
                                    onClick={() => { setEmployeeToReject(null); setRejectReason(''); }}
                                    disabled={isProcessing}
                                    className="flex-1 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => handleVerification(employeeToReject, 'reject', rejectReason)}
                                    disabled={isProcessing}
                                    className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {isProcessing ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : 'Reject'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Review modal */}
                {selectedEmployee && (
                    <VerifyEmployeeModal
                        userId={selectedEmployee.id}
                        isOpen={modalOpen}
                        onClose={() => { setModalOpen(false); setSelectedEmployee(null); }}
                        onResult={(res) => {
                            if (res.action === 'approved' || res.action === 'rejected') {
                                fetchPendingEmployees();
                            }
                            setModalOpen(false);
                            setSelectedEmployee(null);
                        }}
                    />
                )}
            </div>
        </SolarisBackground>
    );
}
