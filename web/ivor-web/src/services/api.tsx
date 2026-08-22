// ==================== USER RIGHTS HISTORY SERVICES ====================
// NOTE: TimeLog, Subscription, SubscriptionPayload, Job, User, BreakLog and
// AuthResponse are declared LOCALLY below — importing them from shared/types/api
// created duplicate-declaration conflicts (and SubscriptionPayload/AuthResponse
// aren't even exported there). Only import the names that are uniquely shared.
import type {
  UserRightPayload,
  ApiResponse,
  ApiError,
  PayrollData,
} from '../../../../shared/types/api';

export const submitUserRightReport = async (
    payload: FormData
): Promise<ApiResponse<any> | { error: string; status?: number }> => {
    try {
        console.log('Submitting user rights report with FormData...');
        const response = await api.post('/user/user-right', payload, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });
        return response.data;
    } catch (error: any) {
        console.error('Rights report submission API error:', error.response?.data || error.message);
        return {
            error:
                error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to submit rights report',
            status: error.response?.status || 500,
        };
    }
};

export const getUserRightHistory = async (
    privateUserId: number
): Promise<UserRightPayload[] | { error: string; status?: number }> => {
    try {
        console.log('Fetching user rights history for private_user_id:', privateUserId);
        const response = await api.get(`/user/user-rights/user/${privateUserId}`);
        if (response.data?.status === 'success') {
            return response.data.data;
        }
        return response.data;
    } catch (error: any) {
        console.error('Error fetching user rights history:', error.response?.data || error.message);
        return {
            error:
                error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch rights history',
            status: error.response?.status || 500,
        };
    }
};

export const getAllRightHistory = async (): Promise<UserRightPayload[] | { error: string; status?: number }> => {
    try {
        console.log('Fetching all rights history');
        const response = await api.get('/user/user-rights');
        if (response.data?.status === 'success') {
            return response.data.data;
        }
        return response.data;
    } catch (error: any) {
        console.error('Error fetching all rights history:', error.response?.data || error.message);
        return {
            error:
                error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch all rights history',
            status: error.response?.status || 500,
        };
    }
};

export const getRightHistoryById = async (
    rightId: number
): Promise<UserRightPayload | { error: string; status?: number }> => {
    try {
        console.log('Fetching rights history by ID:', rightId);
        const response = await api.get(`/user/user-right/${rightId}`);
        if (response.data?.status === 'success') {
            return response.data.data;
        }
        return response.data;
    } catch (error: any) {
        console.error('Error fetching rights history by ID:', error.response?.data || error.message);
        return {
            error:
                error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch rights history',
            status: error.response?.status || 500,
        };
    }
};
// ==================== SALARY SERVICES ====================

export interface Salary {
    salary_id?: number;
    job_id: number;
    monthly_hours: string;
    break_in_minutes_per_day: number;
    days_of_work_per_month: number;
    currency?: string;
    salary: string;
    revenue: string;
    created_at?: string;
    updated_at?: string;
}

export const createSalary = async (data: Omit<Salary, 'salary_id'>): Promise<Salary | { error: string; status: number }> => {
    try {
        const response = await api.post('/job/salary', data);
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to create salary',
            status: error.response?.status || 500
        };
    }
};

export const getSalaryByJobId = async (jobId: number): Promise<Salary | { error: string; status: number }> => {
    try {
        const response = await api.get(`/job/salary/${jobId}`);
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch salary',
            status: error.response?.status || 500
        };
    }
};


// ==================== TYPE DEFINITIONS ====================

export interface Subscription {
    subscription_id: number;
    private_user_id: number;
    description: string;
    amount: number;
    currency: string;
    subscription_date?: string; // YYYY-MM-DD
    created_at?: string;
    updated_at?: string;
}

export type SubscriptionPayload = Omit<Subscription, 'subscription_id' | 'created_at' | 'updated_at'>;

export interface ShowDepartment {
    department_id: number;
    company_id: number;
    name: string;
    created_at?: string;
}

export interface Transfer {
    transfer_id: number;
    private_user_id: number;
    amount: number;
    currency: string;
    from_user: string;
    to_user: string;
    status: string;
    created_at?: string;
    updated_at?: string;
}

export type TransferPayload = Omit<Transfer, 'transfer_id' | 'created_at' | 'updated_at'>;

export interface Repayment {
    repayment_id: number;
    loan_id: number;
    amount: number;
    payment_date: string; // YYYY-MM-DD
    created_at?: string;
    updated_at?: string;
}

export type RepaymentPayload = Omit<Repayment, 'repayment_id' | 'created_at' | 'updated_at'>;

export interface Loan {
    loan_id: number;
    private_user_id: number;
    description: string;
    amount: number;
    currency: string;
    start_date?: string; // YYYY-MM-DD
    due_date?: string; // YYYY-MM-DD
    status?: string;
    repaid_amount?: number;
    created_at?: string;
    updated_at?: string;
    repayments?: Repayment[];
}

export type LoanPayload = Omit<Loan, 'loan_id' | 'created_at' | 'updated_at' | 'repayments'>;

export interface Purchase {
    purchase_id: number;
    private_user_id: number;
    description: string;
    amount: number;
    currency: string;
    created_at?: string;
    updated_at?: string;
}

export type PurchasePayload = Omit<Purchase, 'purchase_id' | 'created_at' | 'updated_at'>;

export interface AssignedEmployee {
    private_user_id: number;
    first_name: string;
    last_name: string;
}

export interface AssigneeStatus {
    schedule_id: number;
    private_user_id: number;
    status: 'pending' | 'started' | 'completed';
    proof_image_url?: string | null;
    // Non-null once the employer verified-and-paid this assignee's completion.
    remuneration_one_off_id?: number | null;
    updated_at?: string;
}

export interface Schedule {
    schedule_id: number;
    title: string;
    company_id: number;
    location: string;
    hours?: string;
    notes?: string;
    start_time: string; // ISO datetime string
    status: 'pending' | 'started' | 'completed';
    end_time: string; // ISO datetime string
    // Optional additional remuneration each assignee earns once the employer
    // verifies their completion (booked into that month's payroll).
    additional_remuneration_amount?: string | number | null;
    created_at?: string;
    updated_at?: string;
    assigned_employees: AssignedEmployee[];
    assignee_statuses?: AssigneeStatus[];
}

export interface CreateSchedulePayload
    extends Omit<Schedule, 'schedule_id' | 'created_at' | 'updated_at' | 'assigned_employees'> {
    assigned_employee_ids: number[];
}

export type UpdateSchedulePayload = Partial<CreateSchedulePayload>;


import { api } from "./apiClient";

export interface BreakLog {
    break_id: number;
    timelog_id: number;
    start_time: string;
    end_time?: string;
}

export interface TimeLog {
    timelog_id: number;
    private_user_id: number;
    job_id: number;
    day_of_week: string;
    start_time: string;
    end_time?: string;
    location: any;
    hours_worked?: number;
    breaks?: BreakLog[];
    created_at: string;
    updated_at?: string;
}

export interface Job {
    job_id: number;
    private_user_id: number;
    company_id?: number;
    job_title: string;
    employer_name: string;
    employer_brn: string;
    employer_email?: string;
    employer_phone?: string;
    employer_address?: string;
    first_date_of_employment: string;
    work_start_time: string;
    work_end_time: string;
    work_days?: Record<string, string>;
    has_contract: boolean;
    has_permission_to_work: boolean;
    work_permit_type: string;
    working_on_tourist_visa: boolean;
    is_salary_deducted: boolean;
    reason_for_deduction?: Record<string, boolean>;
    is_accommodation_covered_by_employer: boolean;
    is_accommodation_a_dormitory: boolean;
    is_accommodation_decent: boolean;
    is_passport_retained: boolean;
    is_job_execution_same_as_description: boolean;
    doubts_about_compensation?: boolean;
    created_at: string;
    updated_at?: string;
    hourly_rate?: number; // Add this for payroll calculations
}

export interface User {
    user_id: number;
    email: string;
    user_name?: string;
    user_type: string;
    onboard_complete: boolean;
    private_user_id?: number;
    private_user?: {
        private_user_id: number;
        first_name: string;
        last_name: string;
        gender?: string;
        date_of_birth?: string;
        pass_port_number?: string;
        phone?: string;
        company_id?: number;
        created_at?: string;
        updated_at?: string;
    };
    company?: {
        company_id: number;
        user_id: number;
        company_name: string;
        email: string;
        brn?: string;
        address?: string;
        phone: string;
        created_at?: string;
        updated_at?: string;
    };
    jobs?: any[];
    time_logs?: any[];
}

// ApiResponse<T> / ApiError / PayrollData are defined in shared/types/api and
// imported at the top of this file.

// AuthResponse — shape of the password-login and OTP-verify responses. Not in
// shared/types/api (the auth tokens are set HttpOnly by the backend); declared
// here because only this service consumes it.
export interface AuthResponse {
    status?: string;
    message?: string;
    access_token?: string;
    refresh_token?: string;
    data?: User;
}

// ==================== DASHBOARD ====================
export interface DashboardOverview {
    assignedTasks: number;
    scheduledEmployees: number;
    clockedInEmployees: number;
    pendingRequests: number;
    openPositions: number;
}

export interface DashboardData {
    overview: DashboardOverview;
    leaveManagement: Record<string, { total: number; pending: number; approved: number }>;
    headCount: { totalEmployees: number; departments: any[] };
}

export const getDashboardStats = async (): Promise<DashboardData | { error: string; status?: number }> => {
    try {
        const response = await api.get('/dashboard/stats');
        if (response.data?.status === 'success' || response.data) {
            // backend returns plain object in some routes, handle both shapes
            return response.data?.data ? response.data.data : response.data;
        }
        return response.data;
    } catch (error: any) {
        console.error('Failed to fetch dashboard stats:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch dashboard stats', status: error.response?.status || 500 };
    }
};

// ==================== COMPANY (Admin) SERVICES ====================
export interface CompanySummary {
    company_id: number;
    company_name: string;
    email?: string;
    brn: string;
    created_at?: string;
}

export interface Company extends CompanySummary {
    address?: string;
    phone?: string;
    annual_leave_budget?: number;
    status?: 'active' | 'disabled' | 'deleted';
    deleted_at?: string | null;
}

export interface CompanyPayload {
    company_name: string;
    brn: string;
    email?: string;
    address?: string;
    phone?: string;
    annual_leave_budget?: number;
    // Set once at creation, never editable after — see backend
    // company_crud.create_company(). Defaults to 'MU' server-side if omitted.
    country_code?: string;
}



// ==================== COMPANIES ====================

export const fetchCompanies = async (limit = 50, offset = 0): Promise<any[] | ApiError> => {
    try {
        const response = await api.get(`/company?limit=${limit}&offset=${offset}`);
        if (response.data?.status === 'success' || response.data) {
            return response.data?.data ? response.data.data : response.data;
        }
        return response.data;
    } catch (error: any) {
        console.error('Failed to fetch companies:', error.response?.data || error.message);
        return {
            error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch companies',
            status: error.response?.status || 500
        };
    }
};

export const fetchCompaniesAggregatedStats = async (): Promise<any | ApiError> => {
    try {
        const response = await api.get('/company/stats');
        if (response.data?.status === 'success' || response.data) {
            return response.data?.data ? response.data.data : response.data;
        }
        return response.data;
    } catch (error: any) {
        console.error('Failed to fetch companies aggregated stats:', error.response?.data || error.message);
        return {
            error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch aggregated company stats',
            status: error.response?.status || 500
        };
    }
};

export const fetchCompanyStats = async (companyId: number): Promise<any | ApiError> => {
    try {
        const response = await api.get(`/company/${companyId}/stats`);
        if (response.data?.status === 'success' || response.data) {
            return response.data?.data ? response.data.data : response.data;
        }
        return response.data;
    } catch (error: any) {
        console.error('Failed to fetch company stats:', error.response?.data || error.message);
        return {
            error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch company stats',
            status: error.response?.status || 500
        };
    }
};

export const createCompany = async (payload: CompanyPayload): Promise<CompanySummary | ApiError> => {
    try {
        const response = await api.post('/company', payload);
        if (response.data?.status === 'success' || response.data) {
            return response.data?.data ? response.data.data : response.data;
        }
        return response.data;
    } catch (error: any) {
        console.error('Failed to create company:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to create company', status: error.response?.status || 500 };
    }
};

export const updateCompany = async (companyId: number, payload: Partial<CompanyPayload>): Promise<CompanySummary | ApiError> => {
    try {
        const response = await api.put(`/company/${companyId}`, payload);
        if (response.data?.status === 'success' || response.data) {
            return response.data?.data ? response.data.data : response.data;
        }
        return response.data;
    } catch (error: any) {
        console.error('Failed to update company:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to update company', status: error.response?.status || 500 };
    }
};

export const deleteCompany = async (companyId: number): Promise<null | ApiError> => {
    try {
        await api.delete(`/company/${companyId}`);
        return null;
    } catch (error: any) {
        console.error('Failed to delete company:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to delete company', status: error.response?.status || 500 };
    }
};

// Self-service account deletion (GDPR + App Store / Google Play requirement).
// Backend: DELETE /user/me — anonymizes the caller, scrubs personal uploads, and
// disables login. Returns 409 when the caller still owns a company with other
// members (they must transfer ownership / offboard the team first).
export const deleteMyAccount = async (): Promise<{ message: string } | ApiError> => {
    try {
        const res = await api.delete('/user/me');
        return res.data as { message: string };
    } catch (error: any) {
        console.error('Failed to delete account:', error.response?.data || error.message);
        return {
            error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to delete your account',
            status: error.response?.status || 500,
        };
    }
};

// Leave-related helpers
export const fetchLeavesByCompany = async (companyId?: number): Promise<any[] | ApiError> => {
    try {
        if (!companyId) return await getAllLeaveRequests();
        const response = await api.get(`/user/leaves/company/${companyId}`);
        if (response.data?.status === 'success' || response.data) {
            return response.data?.data ? response.data.data : response.data;
        }
        return response.data;
    } catch (error: any) {
        console.error('Failed to fetch company leaves:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch company leaves', status: error.response?.status || 500 };
    }
};

export const approveOrRejectLeave = async (leaveId: number, action: 'approve' | 'reject', payload: any = {}): Promise<any | ApiError> => {
    try {
        const response = await api.put(`/user/leave/${leaveId}/approve`, { action, ...payload });
        return response.data;
    } catch (error: any) {
        console.error('Failed to approve/reject leave:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to update leave status', status: error.response?.status || 500 };
    }
};

// Complaints / rights
//
// @deprecated Use `fetchCompanyDisputes` instead. The legacy `/user/user-rights`
// endpoint returns unmasked rows regardless of `is_anonymous`, which can leak
// the identity of a reporter who explicitly filed anonymously. Kept here for
// backwards compatibility with any caller outside the Concerns view.
export const fetchComplaintsByCompany = async (companyId?: number): Promise<any[] | ApiError> => {
    try {
        const response = await api.get('/user/user-rights');
        const data = response.data?.data ? response.data.data : response.data;
        if (!companyId) return data;
        if (!Array.isArray(data)) return [];
        return data.filter((r: any) => (r?.company?.company_id ?? r?.company_id) === companyId);
    } catch (error: any) {
        console.error('Failed to fetch complaints:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch complaints', status: error.response?.status || 500 };
    }
};

// Concerns — masked, tenant-gated, rich payload.
// Backend returns { internal: Dispute[], external_stats: { total, by_category, by_month }, total }.
// On anonymous cases the server sets employee_name="Anonymous" and private_user_id=null.
export type ConcernDispute = {
    right_id: number;
    employee_name: string;
    private_user_id: number | null;
    is_anonymous: boolean;
    title: string;
    category: string;
    urgency_level: string;
    status: string;
    channel: string;
    issue_description?: string;
    expected_outcome?: string;
    occurrence_description?: string;
    date_of_occurrence?: string | null;
    attachment_url?: string | null;
    attachment_scan_result?: string | null;
    assigned_to?: number | null;
    internal_notes?: string | null;
    resolution?: string | null;
    closed_at?: string | null;
    closed_by?: number | null;
    days_open: number;
    created_at?: string | null;
    updated_at?: string | null;
    // M8 closeout — exposed by the backend so the UI can defensively
    // filter out any case where the calling admin appears in named_parties
    // (the backend already filters server-side; this is defence-in-depth).
    named_parties?: Array<{ user_id: number; label?: string }> | null;
};

export type CompanyDisputesResponse = {
    internal: ConcernDispute[];
    external_stats: { total: number; by_category: Record<string, number>; by_month?: Record<string, number> };
    total: number;
};

export const fetchCompanyDisputes = async (
    companyId: number,
    opts?: { channel?: 'internal' | 'external' | 'all'; status?: string; since?: string; until?: string },
): Promise<CompanyDisputesResponse | ApiError> => {
    try {
        const params: Record<string, string> = {};
        if (opts?.channel) params.channel = opts.channel;
        if (opts?.status) params.status = opts.status;
        if (opts?.since) params.since = opts.since;
        if (opts?.until) params.until = opts.until;
        const response = await api.get(`/user/disputes/company/${companyId}`, { params });
        return response.data;
    } catch (error: any) {
        console.error('Failed to fetch company disputes:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch company disputes', status: error.response?.status || 500 };
    }
};

// M4 — admin actions on a concern.
export type PatchDisputeBody = {
    status?: string;
    assigned_to?: number | null;
    internal_notes?: string;
    resolution?: string;
};

export const patchDispute = async (
    rightId: number,
    body: PatchDisputeBody,
): Promise<{ status: string; right_id: number; new_status: string } | ApiError> => {
    try {
        const response = await api.patch(`/user/disputes/${rightId}`, body);
        return response.data;
    } catch (error: any) {
        console.error('Failed to patch dispute:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to update concern', status: error.response?.status || 500 };
    }
};

// M4 — concern thread (handler-side; auth = company admin or compliance officer).
export type DisputeMessage = {
    message_id: number;
    author_kind: 'reporter' | 'employer' | 'kontokaz' | 'system';
    author_user_id?: number | null;
    body: string;
    attachment_url?: string | null;
    created_at: string | null;
};

export const fetchDisputeThread = async (
    rightId: number,
): Promise<{ right_id: number; messages: DisputeMessage[] } | ApiError> => {
    try {
        const response = await api.get(`/user/disputes/${rightId}/messages`);
        return response.data;
    } catch (error: any) {
        console.error('Failed to fetch dispute thread:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch thread', status: error.response?.status || 500 };
    }
};

export const postDisputeMessage = async (
    rightId: number,
    body: string,
): Promise<{ ok: boolean; message_id: number; created_at: string } | ApiError> => {
    try {
        const response = await api.post(`/user/disputes/${rightId}/messages`, { body });
        return response.data;
    } catch (error: any) {
        console.error('Failed to post dispute message:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to send message', status: error.response?.status || 500 };
    }
};

// M7 — Audit-log viewer for Kontokaz Compliance.
export type AuditLogRow = {
    audit_id: number;
    right_id: number;
    actor_user_id: number | null;
    actor_kind: 'reporter' | 'employer' | 'kontokaz' | 'system' | string;
    action: string;
    details: Record<string, unknown> | null;
    ip: string | null;
    created_at: string | null;
};

export type AuditLogQuery = {
    right_id?: number;
    action?: string;
    actor_kind?: string;
    since?: string;
    until?: string;
    limit?: number;
    offset?: number;
};

export const fetchConcernAuditLog = async (
    q: AuditLogQuery,
): Promise<{ total: number; limit: number; offset: number; rows: AuditLogRow[] } | ApiError> => {
    try {
        const params: Record<string, string | number> = {};
        if (q.right_id) params.right_id = q.right_id;
        if (q.action) params.action = q.action;
        if (q.actor_kind) params.actor_kind = q.actor_kind;
        if (q.since) params.since = q.since;
        if (q.until) params.until = q.until;
        if (q.limit) params.limit = q.limit;
        if (q.offset !== undefined) params.offset = q.offset;
        const response = await api.get('/user/concerns/audit-log', { params });
        return response.data;
    } catch (error: any) {
        console.error('Failed to fetch audit log:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch audit log', status: error.response?.status || 500 };
    }
};

// Returns the CSV download URL (with auth cookies, no separate fetch).
export const concernAuditLogCsvUrl = (q: AuditLogQuery): string => {
    const params = new URLSearchParams();
    params.set('output', 'csv');
    if (q.right_id) params.set('right_id', String(q.right_id));
    if (q.action) params.set('action', q.action);
    if (q.actor_kind) params.set('actor_kind', q.actor_kind);
    if (q.since) params.set('since', q.since);
    if (q.until) params.set('until', q.until);
    // CSV export is unbounded (intentionally — legal export). Backend caps at 1000;
    // for larger exports the caller would page.
    if (q.limit) params.set('limit', String(q.limit));
    return `/api/v1/user/concerns/audit-log?${params.toString()}`;
};

// M4 — Kontokaz triage dismiss / accept for auto-escalated cases.
export const patchTriageAction = async (
    rightId: number,
    action: 'dismiss' | 'accept',
    reason: string,
): Promise<{ ok: boolean; right_id: number; channel: string; action: string } | ApiError> => {
    try {
        const response = await api.patch(`/user/disputes/${rightId}/triage`, { action, reason });
        return response.data;
    } catch (error: any) {
        console.error('Failed to triage dispute:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to triage concern', status: error.response?.status || 500 };
    }
};

export const fetchCompanyUsers = async (companyId: number, status?: string): Promise<User[] | ApiError> => {
    try {
        const url = status ? `/user/users/company/${companyId}?status=${status}` : `/user/users/company/${companyId}`;
        const response = await api.get(url);
        if (response.data?.status === 'success' || response.data) {
            return response.data?.data ? response.data.data : response.data;
        }
        return response.data;
    } catch (error: any) {
        console.error('Failed to fetch company users:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch company users', status: error.response?.status || 500 };
    }
};

export const searchCompanyUsers = async (
    companyId: number,
    q: string,
    limit: number = 50,
    offset: number = 0
): Promise<User[] | ApiError> => {
    try {
        // Frontend callers should avoid calling with q.length < 2
        const response = await api.get(`/user/users/company/${companyId}/search`, {
            params: { q, limit, offset }
        });
        if (response.data?.status === 'success' || response.data) {
            return response.data?.data ? response.data.data : response.data;
        }
        return response.data;
    } catch (error: any) {
        console.error('Failed to search company users:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to search company users', status: error.response?.status || 500 };
    }
};

export const setCompanyUserRole = async (companyId: number, userId: number, payload: { role?: string; roles?: string[] }): Promise<any | ApiError> => {
    try {
        const response = await api.patch(`/company/${companyId}/users/${userId}/role`, payload);
        return response.data;
    } catch (error: any) {
        console.error('Failed to set company user role:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to set role', status: error.response?.status || 500 };
    }
};

// ==================== AUTH SERVICES ====================

export const postSignUpUser = async (data: any): Promise<ApiResponse<User> | { error: string; status?: number }> => {
    console.log('Signing up user:', { data });
    try {
        const response = await api.post('/user/sign-up', data);
        console.log('User signup successful:', response.data);
        return response.data;
    } catch (error: any) {
        console.error('User signup error:', error.response?.data || error.message);
        return {
            error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Signup failed',
            status: error.response?.status || 500
        };
    }
};

export const postSignUpCompany = async (data: any): Promise<ApiResponse<User> | { error: string; status?: number }> => {
    console.log('Signing up company:', { data });
    try {
        const response = await api.post('/user/company-sign-up', data);
        console.log('Company signup successful:', response.data);
        return response.data;
    } catch (error: any) {
        console.error('Company signup error:', error.response?.data || error.message);
        return {
            error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Company signup failed',
            status: error.response?.status || 500
        };
    }
};

export const postSignInUser = async (data: any): Promise<AuthResponse | { error: string; status?: number }> => {
    // Accept either `email` (legacy) or `identifier` (new — phone or email).
    // The wire payload sends `identifier` if present so the backend's new
    // phone-or-email router runs; legacy callers passing `email` still work.
    const payload: Record<string, unknown> = { password: data.password };
    if (data.identifier) payload.identifier = data.identifier;
    if (data.email) payload.email = data.email;
    console.log('Signing in user:', { identifier: data.identifier ?? data.email });
    try {
        const response = await api.post('/user/login', payload);
        console.log('User signin successful', { response });

        const { access_token } = response.data;
        if (access_token) {
            // Cookie is set automatically by the backend (HttpOnly)
            // No need to set localStorage or header manually
            console.log('Login successful, cookie should be set');
        }

        return response.data;
    } catch (error: any) {
        console.error('User signin error:', error.response?.data || error.message);
        return {
            error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Login failed',
            status: error.response?.status || 500
        };
    }
};

// ---------------------------------------------------------------------------
// Phone OTP login (Phase 2) — mirrors backend api/v1/auth_otp.py.
// HttpOnly cookies are set by the backend on verify; the frontend just needs
// to refresh user state via AuthContext after a successful verify.
// ---------------------------------------------------------------------------

export const requestLoginOtp = async (
    phone: string,
): Promise<{ status: string; expires_in_seconds: number; provider?: string } | { error: string; status?: number }> => {
    try {
        const r = await api.post('/auth/otp/request', { phone });
        return r.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || error.message || 'Could not request code',
            status: error.response?.status || 500,
        };
    }
};

export const verifyLoginOtp = async (
    phone: string,
    code: string,
): Promise<AuthResponse | { error: string; status?: number }> => {
    try {
        const r = await api.post('/auth/otp/verify', { phone, code });
        // Cookie set HttpOnly by backend — same path the password login uses.
        return r.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || error.message || 'Invalid code',
            status: error.response?.status || 500,
        };
    }
};

export const checkAuthToken = async (): Promise<{ valid: boolean; user?: User; error?: string }> => {
    try {
        const response = await api.get('/user/me');
        return { valid: true, user: response.data };
    } catch (error: any) {
        console.error('Token validation failed:', error.response?.data || error.message);
        return {
            valid: false,
            error: error.response?.data?.detail || 'Token validation failed'
        };
    }
};

export const postRequestPasswordReset = async (email: string): Promise<ApiResponse<any> | ApiError> => {
    try {
        const response = await api.post('/password/forgot-password', { email });
        return response.data;
    } catch (error: any) {
        return { error: error.response?.data?.detail || 'An unexpected error occurred.', status: error.response?.status };
    }
};

export const postVerifyPasswordResetOTP = async (email: string, otp: string): Promise<{ status: string; token: string } | ApiError> => {
    try {
        const response = await api.post('/password/verify-otp', { email, otp });
        return response.data;
    } catch (error: any) {
        return { error: error.response?.data?.detail || 'Invalid OTP.', status: error.response?.status };
    }
};

export const postResetPassword = async (token: string, new_password: string): Promise<ApiResponse<any> | ApiError> => {
    try {
        const response = await api.post('/password/reset-password', { token, new_password });
        return response.data;
    } catch (error: any) {
        return { error: error.response?.data?.detail || 'Failed to reset password.', status: error.response?.status };
    }
};

// ==================== ONBOARDING SERVICES ====================

export const createOnboardJob = async (data: any): Promise<ApiResponse<User> | { error: string; status?: number }> => {
    // Always send salary_data as provided; job_id will be injected by backend
    console.log('Creating onboard job:', data);
    try {
        const response = await api.post('/user/onboard', data);
        console.log('Onboard job created successfully:', response.data);
        return response.data;
    } catch (error: any) {
        console.error('Onboard job creation error:', error.response?.data || error.message);
        return {
            error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Onboarding failed',
            status: error.response?.status || 500
        };
    }
};

// ==================== USER SERVICES ====================

export const getUserDetail = async (userIdentifier: number | string): Promise<User | { error: string; status: number }> => {
    try {
        console.log('Fetching user details for identifier:', userIdentifier, typeof userIdentifier);

        let endpoint = '';

        // Determine if we're dealing with an ID (number) or email (string)
        if (typeof userIdentifier === 'number') {
            endpoint = `/user/by_user_id/${userIdentifier}`;
        } else if (typeof userIdentifier === 'string' && userIdentifier.includes('@')) {
            // It's an email, use a different endpoint or convert to ID
            endpoint = `/user/by-email/${encodeURIComponent(userIdentifier)}`;
        } else {
            // Try to parse as number
            const numId = parseInt(userIdentifier.toString(), 10);
            if (!isNaN(numId)) {
                endpoint = `/user/by_user_id/${numId}`;
            } else {
                return { error: 'Invalid user identifier', status: 400 };
            }
        }

        const response = await api.get(endpoint, {
            headers: {
                'Content-Type': 'application/json',
            },
        });

        console.log('User details fetched successfully');
        return response.data;
    } catch (error: any) {
        console.error('Error fetching user details:', error.response?.data || error.message);

        // Return structured error response
        if (error.response?.status === 404) {
            return { error: 'User not found', status: 404 };
        } else if (error.response?.status === 401) {
            return { error: 'Unauthorized - invalid token', status: 401 };
        } else {
            return {
                error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch user details',
                status: error.response?.status || 500
            };
        }
    }
};

export const updateUserProfile = async (
    userId: number,
    userData: Partial<User>
): Promise<User | { error: string; status: number }> => {
    try {
        console.log('Updating user profile for ID:', userId);

        const response = await api.put(`/user/${userId}`, userData);
        console.log('User profile updated successfully');
        return response.data;
    } catch (error: any) {
        console.error('Error updating user profile:', error.response?.data || error.message);
        return {
            error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to update profile',
            status: error.response?.status || 500
        };
    }
};

export const getAllUsers = async (): Promise<User[] | { error: string; status: number }> => {
    try {
        console.log('Fetching all users');
        const response = await api.get('/user/users');
        console.log('All users fetched successfully:', response.data);
        // The actual data is in response.data, which should be an array
        return Array.isArray(response.data) ? response.data : [];
    } catch (error: any) {
        console.error('Error fetching all users:', error.response?.data || error.message);
        return {
            error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch all users',
            status: error.response?.status || 500
        };
    }
};

// ==================== DEPARTMENT SERVICES ====================

export const getDepartments = async (companyId: number): Promise<ShowDepartment[] | { error: string; status?: number }> => {
    try {
        const response = await api.get(`/company/${companyId}/departments`);
        // Handle both plain-array responses and wrapped responses like { status, data }
        const payload = response.data?.data ?? response.data;
        return Array.isArray(payload) ? payload : [];
    } catch (error: any) {
        console.error('Error fetching departments:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch departments', status: error.response?.status || 500 };
    }
};

export const createDepartment = async (companyId: number, name: string): Promise<ShowDepartment | { error: string; status?: number }> => {
    try {
        const response = await api.post(`/company/${companyId}/departments`, { name });
        return response.data;
    } catch (error: any) {
        console.error('Error creating department:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to create department', status: error.response?.status || 500 };
    }
};

export const updateDepartment = async (companyId: number, departmentId: number, name: string): Promise<ShowDepartment | { error: string; status?: number }> => {
    try {
        const response = await api.put(`/company/${companyId}/departments/${departmentId}`, { name });
        return response.data;
    } catch (error: any) {
        console.error('Error updating department:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to update department', status: error.response?.status || 500 };
    }
};

export const deleteDepartment = async (companyId: number, departmentId: number): Promise<{ success: boolean } | { error: string; status?: number }> => {
    try {
        await api.delete(`/company/${companyId}/departments/${departmentId}`);
        return { success: true };
    } catch (error: any) {
        console.error('Error deleting department:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to delete department', status: error.response?.status || 500 };
    }
};

// ==================== USER FLAGS ====================

export const setUserEnabled = async (userId: number, enabled: boolean): Promise<{ user_id: number; user_enabled: boolean } | { error: string; status?: number }> => {
    try {
        const response = await api.patch(`/user/${userId}/enable`, { enabled });
        return response.data;
    } catch (error: any) {
        console.error('Error setting user enabled:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to set user enabled', status: error.response?.status || 500 };
    }
};

export const updateJobSimple = async (jobId: number, jobData: Partial<Job>): Promise<Job | { error: string; status?: number }> => {
    try {
        const response = await api.put(`/job/simple/${jobId}`, jobData);
        return response.data;
    } catch (error: any) {
        console.error('Error updating job:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to update job', status: error.response?.status || 500 };
    }
};

export const patchJobDepartment = async (jobId: number, departmentId: number | null): Promise<{ job_id: number; department_id: number | null } | { error: string; status?: number }> => {
    try {
        const response = await api.patch(`/job/${jobId}/department`, { department_id: departmentId });
        return response.data;
    } catch (error: any) {
        console.error('Error patching job department:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to patch job department', status: error.response?.status || 500 };
    }
};

export const setUserVerified = async (userId: number, verified: boolean): Promise<{ user_id: number; user_verified: boolean } | { error: string; status?: number }> => {
    try {
        const response = await api.patch(`/user/${userId}/verify`, { verified });
        return response.data;
    } catch (error: any) {
        console.error('Error setting user verified:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to set user verified', status: error.response?.status || 500 };
    }
};

/**
 * Re-issue a fresh 14-day account-claim link for an imported employee who hasn't
 * set up their account yet. Returns the link to hand out (also best-effort emailed).
 */
export const resendClaimLink = async (userId: number): Promise<{ status: string; email: string; name?: string; token: string; claim_link: string } | { error: string; status?: number }> => {
    try {
        const response = await api.post('/account/claim/resend', { user_id: userId });
        return response.data;
    } catch (error: any) {
        console.error('Error resending claim link:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to resend link', status: error.response?.status || 500 };
    }
};

// Allow current user to leave their company
export const leaveMyCompany = async (): Promise<{ success: boolean } | { error: string; status?: number }> => {
    try {
        const response = await api.post(`/user/me/leave`);
        return response.data;
    } catch (error: any) {
        console.error('Error leaving company:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to leave company', status: error.response?.status || 500 };
    }
};

export const setUserDepartment = async (userId: number, departmentId: number | null): Promise<{ user_id: number; department_id: number | null } | { error: string; status?: number }> => {
    try {
        const response = await api.patch(`/user/${userId}/department`, { department_id: departmentId });
        return response.data;
    } catch (error: any) {
        // Normalize response information for clearer logging and user feedback
        const respData = error?.response?.data;
        const status = error?.response?.status;
        let friendlyMessage = respData?.detail || respData?.message || null;

        // If response body is an empty object, stringify it so the log is informative
        if (!friendlyMessage) {
            if (typeof respData === 'string') {
                friendlyMessage = respData;
            } else if (respData && Object.keys(respData).length > 0) {
                try {
                    friendlyMessage = JSON.stringify(respData);
                } catch (e) {
                    friendlyMessage = 'Server returned an unexpected error payload';
                }
            }
        }

        const finalMessage = friendlyMessage || error?.message || 'Failed to set department';

        console.error('Error setting user department:', { status, data: respData, message: finalMessage, error });
        return { error: finalMessage, status: status || 500 };
    }
};

export const setUserHomeSite = async (userId: number, homeGeofenceId: number | null): Promise<{ user_id: number; home_geofence_id: number | null } | { error: string; status?: number }> => {
    try {
        const response = await api.patch(`/user/${userId}/home-site`, { home_geofence_id: homeGeofenceId });
        return response.data;
    } catch (error: any) {
        const respData = error?.response?.data;
        const status = error?.response?.status;
        const finalMessage = respData?.detail || respData?.message || error?.message || 'Failed to set home site';
        console.error('Error setting user home site:', { status, data: respData, message: finalMessage, error });
        return { error: finalMessage, status: status || 500 };
    }
};

export interface CompanyGeofence {
    geofence_id: number;
    company_id: number;
    name: string;
    address: string | null;
    latitude: number;
    longitude: number;
    radius_meters: number;
    mode: 'block' | 'flag';
    active: boolean;
    ip_country_required: boolean;
    anchor_qr_token: string | null;
    anchor_wifi_bssids: string[] | null;
    employee_count?: number;
}

export const getCompanyGeofences = async (companyId: number): Promise<CompanyGeofence[] | { error: string; status?: number }> => {
    try {
        const response = await api.get(`/company/${companyId}/geofences`);
        return (response.data?.geofences ?? []) as CompanyGeofence[];
    } catch (error: any) {
        const finalMessage = error?.response?.data?.detail || error?.message || 'Failed to load sites';
        console.error('Error loading sites:', { message: finalMessage, error });
        return { error: finalMessage, status: error?.response?.status || 500 };
    }
};

export const reassignAndDeleteGeofence = async (
    companyId: number,
    geofenceId: number,
    toGeofenceId: number | null,
): Promise<{ status: string; reassigned: number } | { error: string; status?: number }> => {
    try {
        const response = await api.post(`/company/${companyId}/geofences/${geofenceId}/reassign`, {
            to_geofence_id: toGeofenceId,
        });
        return response.data as { status: string; reassigned: number };
    } catch (error: any) {
        const finalMessage = error?.response?.data?.detail || error?.message || 'Failed to delete site';
        console.error('Error deleting site:', { message: finalMessage, error });
        return { error: finalMessage, status: error?.response?.status || 500 };
    }
};

// ==================== VERIFIED EMPLOYEES ====================

export interface VerifiedEmployee {
    id: number;
    private_user_id?: number;
    name: string;
    email: string;
    position: string;
    department: string;
    status: string;
    verification_date: string;
}

export const getVerifiedEmployees = async (brn?: string): Promise<VerifiedEmployee[] | { error: string; status?: number }> => {
    try {
        if (!brn) return [];
        const response = await api.get(`/job/verified/${encodeURIComponent(brn)}`);
        const data = Array.isArray(response.data) ? response.data : response.data?.data ?? [];
        // backend already returns verified employee objects; map to local VerifiedEmployee if needed
        const mapped = (data as any[]).map((p) => ({
            id: p.job_id || p.id,
            private_user_id: p.private_user_id,
            name: p.name || [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email,
            email: p.email || null,
            position: p.position || p.job_title || '',
            department: p.department || '',
            status: 'verified',
            verification_date: p.verification_date || p.verified_at || ''
        }));
        return mapped;
    } catch (error: any) {
        console.error('Error fetching verified employees:', error?.response?.data || error.message);
        return [];
    }
};

// ==================== JOB SERVICES ====================

export const getJobById = async (privateUserId: number): Promise<Job | { error: string; status: number }> => {
    try {
        console.log('Fetching job data for private user ID:', privateUserId);

        const response = await api.get(`/job/${privateUserId}`, {
            headers: {
                'Content-Type': 'application/json',
            },
        });

        console.log('Job data fetched successfully');
        return response.data;
    } catch (error: any) {
        console.error('Error fetching job data:', error.response?.data || error.message);

        // Special handling for job not found - this might be normal for new users
        if (error.response?.status === 404) {
            return { error: 'No job found for this user', status: 404 };
        } else if (error.response?.status === 401) {
            return { error: 'Unauthorized - invalid token', status: 401 };
        } else {
            return {
                error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch job data',
                status: error.response?.status || 500
            };
        }
    }
};

export const getAllJobs = async (): Promise<Job[] | { error: string; status: number }> => {
    try {
        console.log('Fetching all jobs');

        const response = await api.get('/job/all');
        console.log('All jobs fetched successfully');
        return Array.isArray(response.data) ? response.data : [];
    } catch (error: any) {
        console.error('Error fetching all jobs:', error.response?.data || error.message);
        return {
            error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch all jobs',
            status: error.response?.status || 500
        };
    }
};

export const getDashboardDataResilient = async (privateUserId: number) => {
    try {
        console.log('Fetching resilient dashboard data for private user ID:', privateUserId);

        // Start with getting current user via /user/me (most reliable)
        let userDetails = null;
        let userError = null;

        try {
            const authResult = await checkAuthToken();
            if (authResult.valid && authResult.user) {
                userDetails = authResult.user;
                console.log('✅ User details fetched via auth token');
            } else {
                userError = authResult.error || 'Failed to validate auth token';
                console.log('❌ Auth token validation failed:', userError);
            }
        } catch (error: any) {
            userError = 'Network error fetching user details';
            console.error('❌ Error fetching user via auth token:', error);
        }

        // Try to get job data
        let jobData = null;
        let jobError = null;

        try {
            const jobResult = await getJobById(privateUserId);
            if ('error' in jobResult) {
                jobError = jobResult.error;
                console.log('⚠️ Job fetch error:', jobError);
            } else {
                jobData = jobResult;
                console.log('✅ Job data fetched successfully');
            }
        } catch (error: any) {
            jobError = 'Network error fetching job data';
            console.error('❌ Error fetching job data:', error);
        }

        // Try to get time logs
        let timeLogs: TimeLog[] = [];
        let timeLogsError = null;

        try {
            const timeLogsResult = await getUserTimeLogs(privateUserId);
            if ('error' in timeLogsResult) {
                timeLogsError = timeLogsResult.error;
                console.log('⚠️ Time logs fetch error:', timeLogsError);
            } else {
                timeLogs = timeLogsResult;
                console.log('✅ Time logs fetched successfully:', timeLogs.length);
            }
        } catch (error: any) {
            timeLogsError = 'Network error fetching time logs';
            console.error('❌ Error fetching time logs:', error);
        }

        console.log('Resilient dashboard data fetch summary:', {
            userFetched: !!userDetails,
            jobFetched: !!jobData,
            timeLogsFetched: timeLogs.length,
            errors: { userError, jobError, timeLogsError }
        });

        return {
            user: userDetails,
            job: jobData,
            timeLogs,
            errors: {
                user: userError,
                job: jobError,
                timeLogs: timeLogsError,
            }
        };
    } catch (error: any) {
        console.error('Critical error in resilient dashboard fetch:', error);
        return {
            user: null,
            job: null,
            timeLogs: [],
            errors: {
                user: 'Critical error: Failed to fetch user data',
                job: 'Critical error: Failed to fetch job data',
                timeLogs: 'Critical error: Failed to fetch time logs',
            }
        };
    }
};

export const createJob = async (jobData: Partial<Job>): Promise<Job | { error: string; status: number }> => {
    try {
        console.log('Creating new job:', jobData);

        const response = await api.post('/job/create', jobData);
        console.log('Job created successfully');
        return response.data;
    } catch (error: any) {
        console.error('Error creating job:', error.response?.data || error.message);
        return {
            error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to create job',
            status: error.response?.status || 500
        };
    }
};

export const updateJob = async (
    jobId: number,
    jobData: Partial<Job>,
    changeReason?: string,
    changedBy?: string
): Promise<Job | { error: string; status: number }> => {
    try {
        console.log('Updating job ID:', jobId, { changeReason, changedBy });

        const params: any = {};
        if (changeReason) params.change_reason = changeReason;
        if (changedBy) params.changed_by = changedBy;

        const response = await api.put(`/job/${jobId}`, jobData, {
            params: Object.keys(params).length > 0 ? params : undefined,
        });

        console.log('Job updated successfully');
        return response.data;
    } catch (error: any) {
        console.error('Error updating job:', error.response?.data || error.message);
        return {
            error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to update job',
            status: error.response?.status || 500
        };
    }
};

export const deleteJob = async (jobId: number): Promise<{ success: boolean } | { error: string; status: number }> => {
    try {
        console.log('Deleting job ID:', jobId);

        const response = await api.delete(`/job/${jobId}`);
        console.log('Job deleted successfully');
        return { success: true };
    } catch (error: any) {
        console.error('Error deleting job:', error.response?.data || error.message);
        return {
            error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to delete job',
            status: error.response?.status || 500
        };
    }
};

export const getJobHistory = async (jobId: number): Promise<any[] | { error: string; status: number }> => {
    try {
        console.log('Fetching job history for job ID:', jobId);

        const response = await api.get(`/job/history/${jobId}`);
        console.log('Job history fetched successfully');
        return response.data;
    } catch (error: any) {
        console.error('Error fetching job history:', error.response?.data || error.message);
        return {
            error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch job history',
            status: error.response?.status || 500
        };
    }
};

// ==================== TIME LOG SERVICES ====================

export const postClockIn = async (data: any): Promise<TimeLog | { error: string; status: number }> => {
    try {
        console.log('Creating time log (clock in/out):', data);

        const response = await api.post('/job/create-time-log', data);
        console.log('Time log created successfully');
        return response.data;
    } catch (error) {
        return { error: handleApiError(error, 'creating time log'), status: (error as any).response?.status || 500 };
    }
};

export const getUserTimeLogs = async (
    privateUserId: number,
    dateFrom?: string,
    dateTo?: string
): Promise<TimeLog[] | { error: string; status: number }> => {
    try {
        console.log('Fetching time logs for user ID:', privateUserId, { dateFrom, dateTo });

        const params: any = {};
        if (dateFrom) params.date_from = dateFrom;
        if (dateTo) params.date_to = dateTo;

        const response = await api.get(`/job/time-logs/user/${privateUserId}`, {
            params: Object.keys(params).length > 0 ? params : undefined,
        });

        console.log('Time logs fetched successfully:', response.data?.length || 0, 'logs');
        return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
        return { error: handleApiError(error, 'fetching user time logs'), status: (error as any).response?.status || 500 };
    }
};

export const getTimeLogsByJob = async (jobId: number): Promise<TimeLog[] | { error: string; status: number }> => {
    try {
        console.log('Fetching time logs for job ID:', jobId);

        const response = await api.get(`/job/time-logs/job/${jobId}`);
        console.log('Job time logs fetched successfully');
        return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
        return { error: handleApiError(error, 'fetching job time logs'), status: (error as any).response?.status || 500 };
    }
};

export const getAllTimeLogs = async (): Promise<TimeLog[] | { error: string; status: number }> => {
    try {
        console.log('Fetching all time logs');

        const response = await api.get('/job/time-logs/all');
        console.log('All time logs fetched successfully');
        return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
        return { error: handleApiError(error, 'fetching all time logs'), status: (error as any).response?.status || 500 };
    }
};

export const updateTimeLog = async (
    timeLogId: number,
    timeLogData: Partial<TimeLog>
): Promise<TimeLog | { error: string; status: number }> => {
    try {
        console.log('Updating time log ID:', timeLogId);

        const response = await api.put(`/job/time-log/${timeLogId}`, timeLogData);
        console.log('Time log updated successfully');
        return response.data;
    } catch (error) {
        return { error: handleApiError(error, 'updating time log'), status: (error as any).response?.status || 500 };
    }
};

export const deleteTimeLog = async (timeLogId: number): Promise<{ success: boolean } | { error: string; status: number }> => {
    try {
        console.log('Deleting time log ID:', timeLogId);

        const response = await api.delete(`/job/time-log/${timeLogId}`);
        console.log('Time log deleted successfully');
        return { success: true };
    } catch (error) {
        return { error: handleApiError(error, 'deleting time log'), status: (error as any).response?.status || 500 };
    }
};

// ==================== BREAK LOG SERVICES ====================

export const startBreak = async (timelogId: number): Promise<any | { error: string; status?: number }> => {
    try {
        const response = await api.post(`/job/time-log/${timelogId}/start-break`);
        return response.data;
    } catch (error: any) {
        console.error('Error starting break:', error.response?.data || error.message);
        return {
            error: error.response?.data?.detail || 'Failed to start break',
            status: error.response?.status || 500,
        };
    }
};

export const endBreak = async (timelogId: number): Promise<any | { error: string; status?: number }> => {
    try {
        const response = await api.put(`/job/time-log/${timelogId}/end-break`);
        return response.data;
    } catch (error: any) {
        console.error('Error ending break:', error.response?.data || error.message);
        return {
            error: error.response?.data?.detail || 'Failed to end break',
            status: error.response?.status || 500,
        };
    }
};


// ==================== FINANCIALS & TRANSACTIONS (PRIVATE) ====================

export interface TransferData {
    transfer_id: number;
    private_user_id: number;
    amount: number;
    currency: string;
    from_user: string;
    to_user: string;
    status: string;
    created_at?: string;
}

export interface PurchaseData {
    purchase_id: number;
    private_user_id: number;
    description: string;
    amount: number;
    currency: string;
    created_at?: string;
}

export interface SubscriptionData {
    subscription_id: number;
    private_user_id: number;
    description: string;
    amount: number;
    currency: string;
    subscription_date?: string;
}

export interface FinancialsData {
    transfers: TransferData[];
    purchases: PurchaseData[];
    subscriptions: SubscriptionData[];
    loans: Loan[]; // Re-using existing Loan type
}

export const getFinancials = async (privateUserId: number): Promise<FinancialsData | ApiError> => {
    try {
        const response = await api.get(`/financials/user/${privateUserId}`);
        return response.data;
    } catch (error: any) {
        return { error: error.response?.data?.detail || 'An unexpected error occurred.', status: error.response?.status || 500 };
    }
};

// ==================== COMPANY DASHBOARD SERVICES ====================

export interface CompanyDashboardData {
    overview: {
        assignedTasks: number;
        scheduledEmployees: number;
        clockedInEmployees: number;
        pendingRequests: number;
        openPositions: number;
    };
    leaveManagement: {
        [key: string]: { // e.g., 'sick', 'holiday'
            total: number;
            pending: number;
            approved: number;
        }
    };
    headCount: {
        totalEmployees: number;
        departments: {
            name: string;
            count: number;
            roles: {
                title: string;
                count: number;
                tenure: string;
                description: string;
            }[];
        }[];
    };
}

/**
 * Fetch company dashboard stats for the currently authenticated company user.
 * Returns the API payload containing overview, leaveManagement and headCount.
 * Note: this endpoint requires an authenticated company user (GET /dashboard/stats).
 */
export const getCompanyDashboardStats = async (period?: string): Promise<CompanyDashboardData | ApiError> => {
    try {
        const response = await api.get('/dashboard/stats', { params: period ? { period } : {} });
        return response.data;
    } catch (error: any) {
        console.error('Error fetching company dashboard stats:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || 'An unexpected error occurred.', status: error.response?.status || 500 };
    }
};

// ==================== DASHBOARD DATA SERVICES ====================

export const getDashboardData = async (privateUserId: number) => {
    try {
        console.log('Fetching resilient dashboard data for private user ID:', privateUserId);

        // Start with getting current user via /user/me (most reliable)
        let userDetails = null;
        let userError = null;

        try {
            const authResult = await checkAuthToken();
            if (authResult.valid && authResult.user) {
                userDetails = authResult.user;
                console.log('✅ User details fetched via auth token');
            } else {
                userError = authResult.error || 'Failed to validate auth token';
                console.log('❌ Auth token validation failed:', userError);
            }
        } catch (error: any) {
            userError = 'Network error fetching user details';
            console.error('❌ Error fetching user via auth token:', error);
        }

        // Try to get job data
        let jobData = null;
        let jobError = null;

        try {
            const jobResult = await getJobById(privateUserId);
            if ('error' in jobResult) {
                jobError = jobResult.error;
                console.log('⚠️ Job fetch error:', jobError);
            } else {
                jobData = jobResult;
                console.log('✅ Job data fetched successfully');
            }
        } catch (error: any) {
            jobError = 'Network error fetching job data';
            console.error('❌ Error fetching job data:', error);
        }

        // Try to get time logs
        let timeLogs: TimeLog[] = [];
        let timeLogsError = null;

        try {
            const timeLogsResult = await getUserTimeLogs(privateUserId);
            if ('error' in timeLogsResult) {
                timeLogsError = timeLogsResult.error;
                console.log('⚠️ Time logs fetch error:', timeLogsError);
            } else {
                timeLogs = timeLogsResult;
                console.log('✅ Time logs fetched successfully:', timeLogs.length);
            }
        } catch (error: any) {
            timeLogsError = 'Network error fetching time logs';
            console.error('❌ Error fetching time logs:', error);
        }

        console.log('Resilient dashboard data fetch summary:', {
            userFetched: !!userDetails,
            jobFetched: !!jobData,
            timeLogsFetched: timeLogs.length,
            errors: { userError, jobError, timeLogsError }
        });

        return {
            user: userDetails,
            job: jobData,
            timeLogs,
            errors: {
                user: userError,
                job: jobError,
                timeLogs: timeLogsError,
            }
        };
    } catch (error: any) {
        console.error('Critical error in resilient dashboard fetch:', error);
        return {
            user: null,
            job: null,
            timeLogs: [],
            errors: {
                user: 'Critical error: Failed to fetch user data',
                job: 'Critical error: Failed to fetch job data',
                timeLogs: 'Critical error: Failed to fetch time logs',
            }
        };
    }
};

export const getCurrentUser = async (): Promise<User | { error: string; status: number }> => {
    try {
        console.log('Fetching current user data via /user/me');

        const response = await api.get('/user/me', {
            headers: {
                'Content-Type': 'application/json',
            },
        });

        console.log('Current user details fetched successfully:', response.data);
        return response.data;
    } catch (error: any) {
        console.error('Error fetching current user details:', error.response?.data || error.message);

        // Return structured error response
        if (error.response?.status === 404) {
            return { error: 'User not found', status: 404 };
        } else if (error.response?.status === 401) {
            return { error: 'Unauthorized - invalid token', status: 401 };
        } else {
            return {
                error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch current user details',
                status: error.response?.status || 500
            };
        }
    }
};

export const refreshDashboardData = async (privateUserId: number) => {
    console.log('Refreshing dashboard data...');
    return await getDashboardData(privateUserId);
};

// ==================== ANALYTICS & CALCULATIONS ====================
import { deriveHourlyRateFromSalary } from '../../../../shared/utils/payroll';
import { calculatePayrollData, getAttendanceStats, formatCurrency, formatHours } from '../../../../shared/services/payroll';

// Analytics & calculations are centralized in shared/services/payroll

// ==================== UTILITY FUNCTIONS ====================

export const isApiError = (response: any): response is { error: string; status: number } => {
    return response && typeof response === 'object' && 'error' in response;
};

export const getErrorMessage = (error: any): string => {
    if (isApiError(error)) {
        return error.error;
    }
    if (typeof error === 'string') {
        return error;
    }
    if (error?.message) {
        return error.message;
    }
    return 'An unexpected error occurred';
};

export const handleApiError = (error: any, context: string = 'API call') => {
    const message = getErrorMessage(error);
    console.error(`${context} failed:`, message);
    return message;
};

// ==================== EXPORTS ====================

export default {
    // Auth
    postSignUpUser,
    postSignUpCompany,
    postSignInUser,
    checkAuthToken,

    // Onboarding
    createOnboardJob,

    // Users
    getUserDetail,
    updateUserProfile,
    getAllUsers,
    // User Flags
    setUserEnabled,
    setUserVerified,

    // Departments
    getDepartments,
    createDepartment,
    updateDepartment,
    deleteDepartment,

    // Jobs
    getJobById,
    getAllJobs,
    createJob,

    updateJob,
    deleteJob,
    getJobHistory,

    // Time Logs
    postClockIn,
    getUserTimeLogs,
    getTimeLogsByJob,
    getAllTimeLogs,
    updateTimeLog,
    deleteTimeLog,

    // Break Logs
    startBreak,
    endBreak,

    // Dashboard
    getDashboardData,
    refreshDashboardData,

    // Analytics
    calculatePayrollData,
    getAttendanceStats,

    // Utilities
    formatCurrency,
    formatHours,
    isApiError,
    getErrorMessage,
    handleApiError,
};

// ==================== FINANCIALS & TRANSACTIONS ====================

// --- Subscription Services ---

export const createSubscription = async (
    payload: SubscriptionPayload
): Promise<ApiResponse<Subscription> | { error: string; status?: number }> => {
    try {
        const response = await api.post('/user/subscription', payload);
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to create subscription',
            status: error.response?.status || 500,
        };
    }
};

// ==================== SCHEDULE SERVICES ====================

export const createSchedule = async (
    payload: CreateSchedulePayload
): Promise<Schedule | { error: string; status: number }> => {
    try {
        const payloadWithStatus = {
            ...payload,
            status: payload.status || 'pending',
        };
        const response = await api.post('/job/schedule', payloadWithStatus);
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to create schedule',
            status: error.response?.status || 500,
        };
    }
};

export const updateSchedule = async (
    scheduleId: number,
    payload: UpdateSchedulePayload
): Promise<Schedule | { error: string; status: number }> => {
    try {
        console.log(`Updating schedule ${scheduleId} with payload:`, payload);
        const response = await api.put(`/job/schedule/${scheduleId}`, payload);
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to update schedule',
            status: error.response?.status || 500,
        };
    }
};

export interface VerifyCompletionResult {
    schedule_id: number;
    paid_count: number;
    skipped_count: number;
    amount_each?: string | number | null;
    total_booked: string | number;
}

// #22 — employer verifies a completed task and books its additional
// remuneration (one-off allowance) for each completed assignee. Idempotent.
export const verifyScheduleCompletion = async (
    scheduleId: number
): Promise<VerifyCompletionResult | { error: string; status: number }> => {
    try {
        const response = await api.post(`/job/schedule/${scheduleId}/verify-completion`);
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to verify task completion',
            status: error.response?.status || 500,
        };
    }
};

export const getScheduleById = async (
    scheduleId: number
): Promise<Schedule | { error: string; status: number }> => {
    try {
        const response = await api.get(`/job/schedule/${scheduleId}`);
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to fetch schedule',
            status: error.response?.status || 500,
        };
    }
};

export const deleteScheduleRequest = async (
    scheduleId: number
): Promise<{ success: boolean } | { error: string; status: number }> => {
    try {
        await api.delete(`/job/schedule/${scheduleId}`);
        return { success: true };
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to delete schedule',
            status: error.response?.status || 500,
        };
    }
};
export const getSchedulesByCompany = async (
    companyId: number
): Promise<Schedule[] | { error: string; status: number }> => {
    try {
        const response = await api.get(`/job/schedules/company/${companyId}`);
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to fetch schedules',
            status: error.response?.status || 500,
        };
    }
};

export const deleteSchedule = async (
    scheduleId: number
): Promise<{ success: boolean } | { error: string; status: number }> => {
    try {
        await api.delete(`/job/schedule/${scheduleId}`);
        return { success: true };
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to delete schedule',
            status: error.response?.status || 500,
        };
    }
};


export const getSubscription = async (
    subscriptionId: number
): Promise<ApiResponse<Subscription> | { error: string; status?: number }> => {
    try {
        const response = await api.get(`/user/subscription/${subscriptionId}`);
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to fetch subscription',
            status: error.response?.status || 500,
        };
    }
};

export const getAllSubscriptions = async (): Promise<ApiResponse<Subscription[]> | { error: string; status?: number }> => {
    try {
        const response = await api.get('/user/subscriptions');
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to fetch subscriptions',
            status: error.response?.status || 500,
        };
    }
};

export const updateSubscription = async (
    subscriptionId: number,
    payload: Partial<SubscriptionPayload>
): Promise<ApiResponse<Subscription> | { error: string; status?: number }> => {
    try {
        const response = await api.put(`/user/subscription/${subscriptionId}`, payload);
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to update subscription',
            status: error.response?.status || 500,
        };
    }
};

export const getSchedulesForUser = async (
    privateUserId: number
): Promise<Schedule[] | { error: string; status: number }> => {
    try {
        console.log(`[API] Fetching schedules for private_user_id: ${privateUserId}`);
        console.log(`[API] Using base URL: ${api.defaults.baseURL}`);
        console.log(`[API] Auth header present: ${!!api.defaults.headers.Authorization}`);

        const response = await api.get(`/user/${privateUserId}/schedules`);
        console.log(`[API] Schedules response status:`, response.status);
        console.log(`[API] Schedules response data:`, response.data);

        // Validate the response structure
        if (Array.isArray(response.data)) {
            console.log(`[API] ✅ Valid schedules array with ${response.data.length} items`);
            return response.data;
        } else {
            console.log(`[API] ❌ Unexpected response format:`, typeof response.data);
            return {
                error: 'Invalid response format from server',
                status: 200
            };
        }
    } catch (error: any) {
        console.error(`[API] ❌ Error fetching schedules for user ${privateUserId}:`, error);
        console.error(`[API] Error details:`, {
            message: error.message,
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data
        });

        return {
            error: error.response?.data?.detail || error.message || 'Failed to fetch schedules for user',
            status: error.response?.status || 500,
        };
    }
};


export const deleteSubscription = async (
    subscriptionId: number
): Promise<ApiResponse<any> | { error: string; status?: number }> => {
    try {
        const response = await api.delete(`/user/subscription/${subscriptionId}`);
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to delete subscription',
            status: error.response?.status || 500,
        };
    }
};

// --- Transfer Services ---

export const createTransfer = async (
    payload: TransferPayload
): Promise<ApiResponse<Transfer> | { error: string; status?: number }> => {
    try {
        const response = await api.post('/user/transfer', payload);
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to create transfer',
            status: error.response?.status || 500,
        };
    }
};

export const getTransfer = async (
    transferId: number
): Promise<ApiResponse<Transfer> | { error: string; status?: number }> => {
    try {
        const response = await api.get(`/user/transfer/${transferId}`);
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to fetch transfer',
            status: error.response?.status || 500,
        };
    }
};

export const getAllTransfers = async (): Promise<ApiResponse<Transfer[]> | { error: string; status?: number }> => {
    try {
        const response = await api.get('/user/transfers');
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to fetch transfers',
            status: error.response?.status || 500,
        };
    }
};

export const updateTransfer = async (
    transferId: number,
    payload: Partial<TransferPayload>
): Promise<ApiResponse<Transfer> | { error: string; status?: number }> => {
    try {
        const response = await api.put(`/user/transfer/${transferId}`, payload);
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to update transfer',
            status: error.response?.status || 500,
        };
    }
};

export const deleteTransfer = async (
    transferId: number
): Promise<ApiResponse<any> | { error: string; status?: number }> => {
    try {
        const response = await api.delete(`/user/transfer/${transferId}`);
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to delete transfer',
            status: error.response?.status || 500,
        };
    }
};

// --- Loan & Repayment Services ---

export const createLoan = async (
    payload: LoanPayload
): Promise<ApiResponse<Loan> | { error: string; status?: number }> => {
    try {
        const response = await api.post('/user/loan', payload);
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to create loan',
            status: error.response?.status || 500,
        };
    }
};

export const getLoan = async (
    loanId: number
): Promise<ApiResponse<Loan> | { error: string; status?: number }> => {
    try {
        const response = await api.get(`/user/loan/${loanId}`);
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to fetch loan',
            status: error.response?.status || 500,
        };
    }
};

export const getAllLoans = async (): Promise<ApiResponse<Loan[]> | { error: string; status?: number }> => {
    try {
        const response = await api.get('/user/loans');
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to fetch loans',
            status: error.response?.status || 500,
        };
    }
};

export const updateLoan = async (
    loanId: number,
    payload: Partial<LoanPayload>
): Promise<ApiResponse<Loan> | { error: string; status?: number }> => {
    try {
        const response = await api.put(`/user/loan/${loanId}`, payload);
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to update loan',
            status: error.response?.status || 500,
        };
    }
};

export const deleteLoan = async (
    loanId: number
): Promise<ApiResponse<any> | { error: string; status?: number }> => {
    try {
        const response = await api.delete(`/user/loan/${loanId}`);
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to delete loan',
            status: error.response?.status || 500,
        };
    }
};

export const createRepayment = async (
    payload: RepaymentPayload
): Promise<ApiResponse<Repayment> | { error: string; status?: number }> => {
    try {
        const response = await api.post('/user/repayment', payload);
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to create repayment',
            status: error.response?.status || 500,
        };
    }
};

export const getRepaymentsByLoan = async (
    loanId: number
): Promise<ApiResponse<Repayment[]> | { error: string; status?: number }> => {
    try {
        const response = await api.get(`/user/repayments/${loanId}`);
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to fetch repayments',
            status: error.response?.status || 500,
        };
    }
};

// --- Purchase Services ---

export const createPurchase = async (
    payload: PurchasePayload
): Promise<ApiResponse<Purchase> | { error: string; status?: number }> => {
    try {
        const response = await api.post('/user/purchase', payload);
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to create purchase',
            status: error.response?.status || 500,
        };
    }
};

export const getPurchase = async (
    purchaseId: number
): Promise<ApiResponse<Purchase> | { error: string; status?: number }> => {
    try {
        const response = await api.get(`/user/purchase/${purchaseId}`);
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to fetch purchase',
            status: error.response?.status || 500,
        };
    }
};

export const getAllPurchases = async (): Promise<ApiResponse<Purchase[]> | { error: string; status?: number }> => {
    try {
        const response = await api.get('/user/purchases');
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to fetch purchases',
            status: error.response?.status || 500,
        };
    }
};

export const updatePurchase = async (
    purchaseId: number,
    payload: Partial<PurchasePayload>
): Promise<ApiResponse<Purchase> | { error: string; status?: number }> => {
    try {
        const response = await api.put(`/user/purchase/${purchaseId}`, payload);
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to update purchase',
            status: error.response?.status || 500,
        };
    }
};

export const deletePurchase = async (
    purchaseId: number
): Promise<ApiResponse<any> | { error: string; status?: number }> => {
    try {
        const response = await api.delete(`/user/purchase/${purchaseId}`);
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to delete purchase',
            status: error.response?.status || 500,
        };
    }
};

// ==================== LEAVE SERVICES ====================

export interface LeavePayload {
    private_user_id: number;
    leave_type: string;
    start_date: string; // YYYY-MM-DD
    end_date: string;   // YYYY-MM-DD
    status: string;
    notes?: string;
}

export interface Leave extends LeavePayload {
    leave_id: number;
    created_at: string;
    updated_at: string;
}

export const createLeaveRequest = async (
    payload: LeavePayload
): Promise<ApiResponse<Leave> | { error: string; status?: number }> => {
    try {
        console.log('Submitting leave request:', { payload });
        const response = await api.post('/user/leave', payload);
        return response.data;
    } catch (error: any) {
        console.error('Leave request submission error:', error.response?.data || error.message);
        return {
            error:
                error.response?.data?.detail ||
                error.response?.data?.message ||
                error.message ||
                'Failed to submit leave request',
            status: error.response?.status || 500,
        };
    }
};

export const getLeaveRequestById = async (
    leaveId: number
): Promise<Leave | { error: string; status: number }> => {
    try {
        const response = await api.get(`/user/leave/${leaveId}`);
        if (response.data && response.data.status === 'success') {
            return response.data.data;
        }
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to fetch leave request',
            status: error.response?.status || 500,
        };
    }
};

export const getAllLeaveRequests = async (): Promise<Leave[] | { error: string; status: number }> => {
    try {
        const response = await api.get(`/user/leaves`);
        if (response.data && response.data.status === 'success') {
            return response.data.data;
        }
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to fetch all leave requests',
            status: error.response?.status || 500,
        };
    }
};

export const updateLeaveRequest = async (
    leaveId: number,
    payload: Partial<LeavePayload>
): Promise<ApiResponse<Leave> | { error: string; status?: number }> => {
    try {
        const response = await api.put(`/user/leave/${leaveId}`, payload);
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to update leave request',
            status: error.response?.status || 500,
        };
    }
};

export const deleteLeaveRequest = async (
    leaveId: number
): Promise<{ success: boolean } | { error: string; status: number }> => {
    try {
        await api.delete(`/user/leave/${leaveId}`);
        return { success: true };
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to delete leave request',
            status: error.response?.status || 500,
        };
    }
};

export const getUserLeaveRequests = async (
    privateUserId: number
): Promise<Leave[] | { error: string; status: number }> => {
    try {
        const response = await api.get(`/user/leaves/user/${privateUserId}`);
        if (response.data && response.data.status === 'success') {
            return response.data.data;
        }
        return response.data; // Should contain error info
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || error.message || 'Failed to fetch leave requests',
            status: error.response?.status || 500,
        };
    }
};

// ==================== COMPANY USER ROLE SERVICES ====================

export interface CompanyUser {
    user_id: number;
    email: string;
    user_type: string;
    user_name?: string;
    user_verified?: boolean;
    user_enabled?: boolean;
    company?: any;
    private_user?: {
        private_user_id: number;
        user_id: number;
        first_name: string;
        last_name: string;
        company_id?: number;
        department_id?: number | null;
        home_geofence_id?: number | null;
        role?: string;
        roles?: string[];
    };
}

export const getUsersByCompany = async (
    companyId: number
): Promise<CompanyUser[] | { error: string; status?: number }> => {
    try {
        const response = await api.get(`/user/users/company/${companyId}`);
        if (response.data && response.data.status === 'success') {
            return response.data.data;
        }
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch company users',
            status: error.response?.status || 500,
        };
    }
};

export const removeCompanyUser = async (
    companyId: number,
    userId: number
): Promise<{ success: boolean; user_id: number } | { error: string; status?: number }> => {
    try {
        const response = await api.delete(`/user/company/${companyId}/users/${userId}`);
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to remove employee',
            status: error.response?.status || 500,
        };
    }
};

export const setCompanyUserRoles = async (
    companyId: number,
    userId: number,
    roles: Array<'owner' | 'admin' | 'manager' | 'employee'>
): Promise<{ user_id: number; roles: string[] } | { error: string; status?: number }> => {
    try {
        const response = await api.patch(`/user/company/${companyId}/users/${userId}/role`, { roles });
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to set user roles',
            status: error.response?.status || 500,
        };
    }
};

export const getCompanyUserRoles = async (
    companyId: number,
    userId: number
): Promise<string[] | { error: string; status?: number }> => {
    try {
        const response = await api.get(`/user/company/${companyId}/users/${userId}/roles`);
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch user roles',
            status: error.response?.status || 500,
        };
    }
};

export interface InviteCompanyUserPayload { email: string; role?: string }
export interface TransferOwnershipPayload { new_owner_user_id: number }

export interface CreateEmployeePayload {
  first_name: string;
  last_name: string;
  email: string;
  job_title: string;
  start_date: string;         // YYYY-MM-DD
  base_salary: number;
  currency?: string;
  passport_number?: string | null;
  department?: string | null;
  work_days_per_week?: number | null;
  hours_per_month?: number | null;
  role?: string | null;
  pay_basis?: string | null;
  dob?: string | null;
  nationality?: string | null;
  permit_type?: string | null;
  permit_number?: string | null;
  permit_expiry?: string | null;
}

/**
 * Directly create ONE payroll-ready employee (name + job + salary), reusing the
 * bulk-import pipeline server-side. On success the employee is emailed the same
 * "Set my password" account-claim link as an imported employee — this is the
 * correct onboarding email, NOT the accept-only invite (which required the
 * person to already have an account and discarded every field but the email).
 */
export const createEmployee = async (
  companyId: number,
  payload: CreateEmployeePayload,
): Promise<any | { error: string; status?: number }> => {
  try {
    const resp = await api.post(`/companies/${companyId}/employees`, payload);
    return resp.data;
  } catch (error: any) {
    return { error: error.response?.data?.detail || error.message, status: error.response?.status };
  }
};

export const inviteCompanyUser = async (companyId: number, payload: InviteCompanyUserPayload): Promise<any | { error: string; status?: number }> => {
    try {
        const resp = await api.post(`/company/${companyId}/invite`, payload);
        return resp.data;
    } catch (error: any) {
        return { error: error.response?.data?.detail || error.message, status: error.response?.status };
    }
};

export const transferCompanyOwnership = async (companyId: number, payload: TransferOwnershipPayload): Promise<any | { error: string; status?: number }> => {
    try {
        const resp = await api.patch(`/company/${companyId}/transfer-ownership`, payload);
        return resp.data;
    } catch (error: any) {
        return { error: error.response?.data?.detail || error.message, status: error.response?.status };
    }
};

export const acceptInvite = async (token: string): Promise<any | { error: string; status?: number }> => {
    try {
        const resp = await api.post(`/company/invite/accept`, { token });
        return resp.data;
    } catch (error: any) {
        return { error: error.response?.data?.detail || error.message, status: error.response?.status };
    }
};

export const getInvitePreview = async (token: string): Promise<any | { error: string; status?: number }> => {
    try {
        const resp = await api.get(`/company/invite/preview/${encodeURIComponent(token)}`);
        return resp.data;
    } catch (error: any) {
        return { error: error.response?.data?.detail || error.message, status: error.response?.status };
    }
};
export const disableCompanyUser = async (userId: number, payload: { enabled: boolean }): Promise<any | { error: string; status?: number }> => {
    try {
        const resp = await api.patch(`/user/${userId}/enable`, payload);
        return resp.data;
    } catch (error: any) {
        return { error: error.response?.data?.detail || error.message, status: error.response?.status };
    }
};

// ==================== COMPANY LIST & STATS ====================

export interface CompanySummary {
    company_id: number;
    company_name: string;
    brn: string;
    email?: string;
    created_at?: string;
    status?: 'active' | 'disabled' | 'deleted';
    deleted_at?: string | null;
    ads_enabled?: boolean;
    country_code?: string;
}

export const getCompanies = async (limit = 50, offset = 0): Promise<CompanySummary[] | { error: string; status?: number }> => {
    try {
        const resp = await api.get(`/company?limit=${limit}&offset=${offset}`);
        // backend returns plain array; normalize
        const data = Array.isArray(resp.data) ? resp.data : (resp.data?.data ?? resp.data);
        return data as CompanySummary[];
    } catch (error: any) {
        console.error('Error fetching companies:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch companies', status: error.response?.status || 500 };
    }
};

export const getCompanyById = async (companyId: number): Promise<CompanySummary | { error: string; status?: number }> => {
    try {
        const resp = await api.get(`/company/${companyId}`);
        return resp.data as CompanySummary;
    } catch (error: any) {
        console.error('Error fetching company by id:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch company', status: error.response?.status || 500 };
    }
};

// Admin-specific company endpoints (uses platform role auth, not is_superuser)
// countryCode is optional and additive — existing callers that omit it see
// no change in behavior (unscoped, same as before).
export const getAdminCompanies = async (limit = 100, offset = 0, countryCode?: string): Promise<CompanySummary[] | { error: string; status?: number }> => {
    try {
        const params: Record<string, string | number> = { limit, offset };
        if (countryCode) params.country_code = countryCode;
        const resp = await api.get(`/admin/companies`, { params });
        const data = Array.isArray(resp.data) ? resp.data : (resp.data?.data ?? resp.data);
        return data as CompanySummary[];
    } catch (error: any) {
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch companies', status: error.response?.status || 500 };
    }
};

export interface AdminCompaniesStats {
    total_companies: number;
    total_verified_headcount: number;
    total_pending_verifications: number;
    total_open_jobs: number;
}

// Server-computed totals for the Employers page's stat cards — deliberately
// NOT derived from summing the (paginated, capped) company list on the
// frontend, so they stay correct past the page size and actually respect
// the Country Switcher.
export const getAdminCompaniesStats = async (countryCode?: string): Promise<AdminCompaniesStats | { error: string; status?: number }> => {
    try {
        const params: Record<string, string> = {};
        if (countryCode) params.country_code = countryCode;
        const resp = await api.get(`/admin/companies/stats`, { params });
        return resp.data as AdminCompaniesStats;
    } catch (error: any) {
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch company stats', status: error.response?.status || 500 };
    }
};

export const getAdminCompanyById = async (companyId: number): Promise<CompanySummary | { error: string; status?: number }> => {
    try {
        const resp = await api.get(`/admin/companies/${companyId}`);
        return resp.data as CompanySummary;
    } catch (error: any) {
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch company', status: error.response?.status || 500 };
    }
};

export const setCompanyStatus = async (
    companyId: number,
    status: 'active' | 'disabled'
): Promise<{ company_id: number; status: string } | { error: string; status?: number }> => {
    try {
        const resp = await api.post(`/admin/companies/${companyId}/status`, { status });
        return resp.data;
    } catch (error: any) {
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to update company status', status: error.response?.status || 500 };
    }
};

export const restoreCompany = async (
    companyId: number
): Promise<{ company_id: number; status: string } | { error: string; status?: number }> => {
    try {
        const resp = await api.post(`/admin/companies/${companyId}/restore`);
        return resp.data;
    } catch (error: any) {
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to restore company', status: error.response?.status || 500 };
    }
};

export interface CompanyStats {
    verified_headcount: number;
    pending_verifications: number;
    open_jobs_count: number;
    total_employees?: number;
    total_salary_per_month?: number;
    total_leaves_entitled?: number;
    employee_count?: number;  // role='employee'
    admin_count?: number;     // role in owner|admin|manager
}

export const getCompanyStats = async (companyId: number): Promise<CompanyStats | { error: string; status?: number }> => {
    try {
        const resp = await api.get(`/company/${companyId}/stats`);
        return resp.data as CompanyStats;
    } catch (error: any) {
        // Inline the diagnostics in the message string so the Next.js error
        // overlay shows them too — passing them as a second console.error
        // arg only surfaces in the browser DevTools console, which is easy
        // to miss in dev. Status + URL + detail in one line tells you
        // whether you're hitting a 401/403/404/500 or a CORS/network failure.
        const status = error.response?.status ?? 'no-response';
        const url = error.config?.url ?? '?';
        const detail = error.response?.data?.detail
            ?? error.response?.data?.message
            ?? (error.response ? JSON.stringify(error.response.data) : error.message);
        console.error(
            `Error fetching company stats for #${companyId} — status=${status} url=${url} detail=${detail}`,
        );
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch company stats', status: error.response?.status || 500 };
    }
};



export interface CompanyMonthlyPayroll {
    id: number;
    month: number;
    total_amount: number;
    currency: string;
}

export const getCompanyPayrolls = async (companyId: number, year: number): Promise<CompanyMonthlyPayroll[] | { error: string; status?: number }> => {
    try {
        const resp = await api.get(`/company/${companyId}/payroll?year=${year}`);
        return (Array.isArray(resp.data) ? resp.data : []) as CompanyMonthlyPayroll[];
    } catch (error: any) {
        console.error('Error fetching payrolls:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || 'Failed to fetch payrolls', status: error.response?.status || 500 };
    }
};

export const updateCompanyPayrolls = async (companyId: number, year: number, payrolls: { month: number; amount: number }[]): Promise<{ status: string } | { error: string }> => {
    try {
        const resp = await api.post(`/company/${companyId}/payroll`, { year, payrolls });
        return resp.data;
    } catch (error: any) {
        console.error('Error updating payrolls:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || 'Failed to update payrolls' };
    }
};

export interface CompaniesAggregatedStats {
    total_companies: number;
    total_verified_headcount: number;
    total_pending_verifications: number;
    total_open_jobs: number;
}

export const getCompaniesAggregatedStats = async (): Promise<CompaniesAggregatedStats | { error: string; status?: number }> => {
    try {
        const resp = await api.get(`/company/stats`);
        return resp.data as CompaniesAggregatedStats;
    } catch (error: any) {
        console.error('Error fetching aggregated company stats:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch aggregated stats', status: error.response?.status || 500 };
    }
};

// ==================== BANK DETAILS ====================

export const getEmployeeBankDetails = async (privateUserId: number): Promise<any | ApiError> => {
    try {
        const response = await api.get(`/user/bank-details/${privateUserId}`);
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || error.message || 'Failed to fetch bank details',
            status: error.response?.status || 500
        };
    }
};

export const updateEmployeeBankDetails = async (privateUserId: number, data: any): Promise<any | ApiError> => {
    try {
        const response = await api.put(`/user/bank-details/${privateUserId}`, data);
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || error.message || 'Failed to update bank details',
            status: error.response?.status || 500
        };
    }
};