// ==================== USER RIGHTS HISTORY SERVICES ====================
import { format } from 'date-fns';

import { calculatePayrollData, getAttendanceStats, formatCurrency, formatHours } from '../../shared/services/payroll';
import type {
    UserRightPayload,
    Subscription,
} from '../../shared/types/api';

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

// ── Concerns v2 (M3) — owner-gated thread for the in-app reporter view ────
// Anonymous reporters returning via the public /concerns/track web portal
// use the PIN-scoped endpoints in the web client; mobile uses these
// owner-gated ones because the user is already logged in.

export type ConcernMessage = {
    message_id: number;
    author_kind: 'reporter' | 'employer' | 'kontokaz' | 'system';
    body: string;
    attachment_url?: string | null;
    created_at: string | null;
};

export const getOwnerThread = async (
    rightId: number
): Promise<{ right_id: number; messages: ConcernMessage[] } | { error: string; status?: number }> => {
    try {
        const response = await api.get(`/user/user-right/${rightId}/messages`);
        return response.data;
    } catch (error: any) {
        console.error('Error fetching concern thread:', error.response?.data || error.message);
        return {
            error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch thread',
            status: error.response?.status || 500,
        };
    }
};

export const postOwnerMessage = async (
    rightId: number,
    body: string,
): Promise<{ ok: boolean; message_id: number; created_at: string } | { error: string; status?: number }> => {
    try {
        const response = await api.post(`/user/user-right/${rightId}/messages`, { body });
        return response.data;
    } catch (error: any) {
        console.error('Error posting concern message:', error.response?.data || error.message);
        return {
            error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to post message',
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
    allowance?: string;
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
        // Check if data is wrapped in standard API response structure
        if (response.data && response.data.data) {
            return response.data.data;
        }
        return response.data;
    } catch (error: any) {
        // If 404, it might mean no salary, return null-like object or handle gracefully
        if (error.response?.status === 404) {
            return { error: 'No salary found', status: 404 };
        }
        return {
            error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch salary',
            status: error.response?.status || 500
        };
    }
};

// Response shape matches company_dashboard/salaries.tsx's EmployeeFinancials
// exactly. Replaces the per-employee/per-job N+1 fetch pattern (salary
// structure preview + salary/time-log calls, ~60-90 requests for a
// 30-employee company) with one aggregate request computed server-side
// (GET /job/salary/company/{id}/earnings).
export interface CompanySalaryEarningsRow {
    id: number;
    jobId: number;
    name: string;
    department: string;
    position: string;
    totalIncome: number;
    estimatedEarnings: number;
    totalHoursWorked: number;
    hourlyRate: number;
    monthlyHours: number;
    regularPay: number;
    overtimePay: number;
    holidayPay: number;
    overtimeHours: number;
}

export const getCompanySalaryEarnings = async (companyId: number): Promise<CompanySalaryEarningsRow[] | { error: string; status: number }> => {
    try {
        const response = await api.get(`/job/salary/company/${companyId}/earnings`);
        return Array.isArray(response.data) ? response.data : [];
    } catch (error: any) {
        console.error('Error fetching company salary earnings:', error.response?.data || error.message);
        return {
            error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch salary earnings',
            status: error.response?.status || 500
        };
    }
};


// ==================== TYPE DEFINITIONS ====================

export interface SubscriptionPayload extends Omit<Subscription, 'subscription_id' | 'created_at' | 'updated_at'> {}

export interface ShowDepartment {
    department_id: number;
    company_id: number;
    name: string;
    created_at?: string;
}

export interface PayrollFormulaPayload {
    multiplier_overtime?: number;
    multiplier_sunday?: number;
    multiplier_public_holiday?: number;
    overtime_threshold_hours?: number;
}

export interface ScannedReceiptItem {
    name?: string | null;
    quantity?: number | null;
    unit_price?: number | null;
    amount?: number | null;
    /** Legacy stringified price kept for backward compatibility with the
     *  heuristic OCR path; new clients should prefer unit_price/amount. */
    price?: string;
    confidence?: number | null;
}

export interface ScannedReceipt {
    merchant?: string | null;
    date?: string | null;
    amount?: number | null;
    currency?: string | null;
    tax?: number | null;
    items?: ScannedReceiptItem[];
    extraction_method?: 'document_ai' | 'vision_heuristic' | 'easyocr_heuristic' | null;
    overall_confidence?: number | null;
    low_confidence_fields?: string[];
    /** URL of the saved receipt image. Thread into PurchasePayload so the
     *  saved purchase can render the original receipt later. */
    receipt_image_url?: string | null;
}

export const scanReceipt = async (imageUri: string): Promise<ScannedReceipt | ApiError> => {
    try {
        const formData = new FormData();
        const filename = imageUri.split('/').pop() || 'receipt.jpg';
        const match = /\.(\w+)$/.exec(filename);
        const type = match ? `image/${match[1]}` : `image`;

        formData.append('file', { uri: imageUri, name: filename, type } as any);

        const response = await api.post('/purchases/scan', formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });
        return response.data;
    } catch (error: any) {
        console.error('Error scanning receipt:', error);
        return { error: error.response?.data?.detail || 'Failed to scan receipt', status: error.response?.status || 500 };
    }
};

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

export interface TransferPayload extends Omit<Transfer, 'transfer_id' | 'created_at' | 'updated_at'> { }

export interface Repayment {
    repayment_id: number;
    loan_id: number;
    amount: number;
    payment_date: string; // YYYY-MM-DD
    created_at?: string;
    updated_at?: string;
}

export interface RepaymentPayload extends Omit<Repayment, 'repayment_id' | 'created_at' | 'updated_at'> { }

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
    is_recurrent?: boolean;
    duration_months?: number;
    payment_frequency?: string; // weekly, biweekly, monthly
    interest_rate?: number;
    lender_name?: string;
    created_at?: string;
    updated_at?: string;
    repayments?: Repayment[];
}

export interface LoanPayload extends Omit<Loan, 'loan_id' | 'created_at' | 'updated_at' | 'repayments'> { }

export interface Purchase {
    purchase_id: number;
    private_user_id: number;
    description: string;
    amount: number;
    currency: string;
    merchant?: string;
    category?: string;
    payment_method?: string;
    items?: { name: string; price: number; quantity?: number }[];
    /** URL of the originally-scanned receipt image (relative path like
     *  `/uploads/receipts/...` in dev, absolute https in prod). */
    receipt_image_url?: string | null;
    created_at?: string;
    updated_at?: string;
}

export interface PurchasePayload extends Omit<Purchase, 'purchase_id' | 'created_at' | 'updated_at'> { }

export interface AssignedEmployee {
    private_user_id: number;
    first_name: string;
    last_name: string;
}

export interface AssigneeStatus {
    schedule_id: number;
    private_user_id: number;
    /** Each employee's personal progress on this task */
    status: 'pending' | 'started' | 'completed';
    /** This employee's own message/note on the task */
    note?: string;
    /** Photo the employee attached as proof of completion */
    proof_image_url?: string;
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
    status: 'draft' | 'pending' | 'started' | 'completed';
    end_time: string; // ISO datetime string
    created_at?: string;
    updated_at?: string;
    assigned_employees: AssignedEmployee[];
    /** Per-employee completion statuses — use this to show co-assignee progress */
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
    geo_check?: any;
    hours_worked?: number;
    breaks?: BreakLog[];
    is_overtime?: boolean;
    is_holiday?: boolean;
    is_weekend?: boolean;
    marked_as_overtime_at?: string;
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
    auto_clockin_enabled?: boolean;
    department_id?: number;
    salaries?: Salary[];
}

export interface User {
    user_id: number;
    email: string;
    user_name?: string;
    user_type: string;
    // false for imported employees who haven't claimed their account yet.
    user_verified?: boolean;
    onboard_complete: boolean;
    private_user_id?: number;
    // Employer-side role data (CompanyUserRole) — present for role-holding
    // employees + company accounts; drives the profile-switch affordance.
    company_roles?: string[];
    is_company_admin?: boolean;
    company_permissions?: string[];
    company_rbac_enabled?: boolean;
    private_user?: {
        private_user_id: number;
        first_name: string;
        last_name: string;
        gender?: string;
        date_of_birth?: string;
        pass_port_number?: string;
        phone?: string;
        company_id?: number;
        department_id?: number;
        // Backend may return the department as a joined object (with name) or,
        // in some list shapes, a bare string — callers handle both.
        department?: { department_id?: number; name?: string } | string | null;
        // Self-reported country — independent (no company_id) users only.
        // A company employee's own value here is never consulted for
        // anything; only show/edit this in UI when company_id is unset.
        country_code?: string;
        // Computed: company's country for an employee, else country_code,
        // else phone-inferred, else 'MU' — "what's actually in effect".
        effective_country_code?: string;
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
        country_code?: string;
        currency?: string;
        created_at?: string;
        updated_at?: string;
    };
    company_onboarding_status?: string;
    verification_note?: string;
    jobs?: any[];
    time_logs?: any[];
}

export interface ApiResponse<T> {
    status: 'success' | 'error';
    message?: string;
    data?: T;
    error?: string;
}

export interface ApiError {
    error: string;
    status?: number;
}

export interface AuthResponse {
    access_token: string;
    refresh_token: string;
    data: User;
    status: string;
    message: string;
}

export interface PayrollData {
    totalHours: number;
    estimatedPay: number;
    completedDays: number;
    lateDays: number;
    absentDays: number;
    deductionForAbsences: number;
    deductionForLateIns: number;
    totalDeduction: number;
    filteredTimeLogs: TimeLog[];
    hourlyRate: number;
    totalDays: number;
    // Enhanced breakdown
    regularHours?: number;
    overtimeHours?: number;
    holidayHours?: number;
    regularPay?: number;
    overtimePay?: number;
    holidayPay?: number;
    allowances?: number;
    breakTime?: number;
}

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

export const checkEmailExists = async (email: string): Promise<boolean> => {
    try {
        await api.get(`/user/by-email/${encodeURIComponent(email)}`);
        return true; // 200 → email already registered
    } catch (error: any) {
        if (error.response?.status === 404) return false; // not found → available
        return false; // on network/other errors, don't block the user
    }
};

export const getCompanyByBrn = async (brn: string): Promise<ApiResponse<any> | { error: string; status?: number }> => {
    try {
        console.log('Fetching company by BRN:', brn);
        const response = await api.get(`/company/lookup/${brn}`);
        return response.data;
    } catch (error: any) {
        // Silence log for 404 as it is expected during typing in real-time lookup
        if (error.response?.status !== 404) {
            console.error('Error fetching company by BRN:', error.response?.data || error.message);
        } else {
            console.debug('Company not found for BRN:', brn);
        }
        return {
            error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch company',
            status: error.response?.status || 500,
        };
    }
};

export const updateCompanyProfile = async (
    companyId: number,
    payload: {
        company_name?: string;
        brn?: string;
        email?: string;
        phone?: string;
        address?: string;
        vat?: string;
        annual_leave_budget?: number;
    }
): Promise<{ company_id: number; company_name: string; [key: string]: any } | { error: string; status?: number }> => {
    try {
        const response = await api.put(`/company/${companyId}`, payload);
        return response.data;
    } catch (error: any) {
        console.error('Error updating company profile:', error.response?.data || error.message);
        return {
            error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to update company profile',
            status: error.response?.status || 500,
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
    // routing kicks in; legacy callers passing `email` still work.
    const payload: Record<string, unknown> = { password: data.password };
    if (data.identifier) payload.identifier = data.identifier;
    if (data.email) payload.email = data.email;
    console.log('Signing in user:', { identifier: data.identifier ?? data.email });
    try {
        const response = await api.post('/user/login', payload);
        console.log('User signin successful', { response });

        const { access_token } = response.data;
        if (access_token) {
            api.defaults.headers.Authorization = `Bearer ${access_token}`;
            console.log('Authorization header set');
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
// Phone OTP login (Phase 2). Mirrors the backend at api/v1/auth_otp.py.
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
        const { access_token } = r.data;
        if (access_token) {
            api.defaults.headers.Authorization = `Bearer ${access_token}`;
        }
        return r.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || error.message || 'Invalid code',
            status: error.response?.status || 500,
        };
    }
};

export const checkAuthToken = async (): Promise<{ valid: boolean; user?: User; error?: string; status?: number }> => {
    try {
        const response = await api.get('/user/me');
        return { valid: true, user: response.data };
    } catch (error: any) {
        console.error('Token validation failed:', error.response?.data || error.message);
        return {
            valid: false,
            error: error.response?.data?.detail || error.message || 'Token validation failed',
            status: error.response?.status
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

export const createMultipleJobs = async (jobsData: any[]): Promise<ApiResponse<any> | { error: string; status?: number }> => {
    console.log('Creating multiple jobs:', jobsData);

    try {
        // Create jobs sequentially to handle dependencies
        const results = [];
        let primaryJobCreated = false;

        for (const jobData of jobsData) {
            console.log('Creating job for employer:', jobData.employer);

            // Mark the first job as primary if none is marked
            if (!primaryJobCreated && jobData.isPrimary) {
                primaryJobCreated = true;
            }

            try {
                const response = await api.post('/user/onboard', jobData);
                results.push({
                    success: true,
                    employer: jobData.employer,
                    data: response.data
                });
                console.log(`Job created successfully for ${jobData.employer}`);
            } catch (error: any) {
                console.error(`Failed to create job for ${jobData.employer}:`, error.response?.data || error.message);
                results.push({
                    success: false,
                    employer: jobData.employer,
                    error: error.response?.data?.detail || error.message || 'Job creation failed'
                });
            }
        }

        // Check if at least one job was created successfully
        const successfulJobs = results.filter(r => r.success);
        if (successfulJobs.length === 0) {
            return {
                error: 'Failed to create any jobs. Please check your information and try again.',
                status: 400
            };
        }

        // Return summary
        return {
            status: 'success',
            message: `${successfulJobs.length} of ${jobsData.length} jobs created successfully`,
            data: {
                results: results,
                totalJobs: jobsData.length,
                successfulJobs: successfulJobs.length,
                failedJobs: results.length - successfulJobs.length
            }
        };

    } catch (error: any) {
        console.error('Multiple job creation error:', error);
        return {
            error: error.message || 'Multiple job creation failed',
            status: error.status || 500
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

        // Backend only registers PATCH /user/{user_id} (api/v1/user.py:996),
        // not PUT — this had no callers until now, so the mismatch never
        // surfaced as a 404/405 in practice.
        const response = await api.patch(`/user/${userId}`, userData);
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

export const getUsersByCompany = async (companyId: number): Promise<User[] | { error: string; status: number }> => {
    try {
        console.log('Fetching users for company:', companyId);
        const response = await api.get(`/user/users/company/${companyId}`);
        console.log('Company users fetched successfully:', response.data);
        return Array.isArray(response.data) ? response.data : [];
    } catch (error: any) {
        console.error('Error fetching company users:', error.response?.data || error.message);
        return {
            error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch company users',
            status: error.response?.status || 500
        };
    }
};

// The managers / HR / admins a worker can tag on a report: everyone assigned a role
// on the company's role-management page, plus the owner.
export const getCompanyManagers = async (companyId: number): Promise<User[] | { error: string; status: number }> => {
    try {
        const response = await api.get(`/user/users/company/${companyId}/role-holders`);
        return Array.isArray(response.data) ? response.data : [];
    } catch (error: any) {
        console.error('Error fetching company managers:', error.response?.data || error.message);
        return {
            error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch company managers',
            status: error.response?.status || 500
        };
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

export const getJobsByCompany = async (companyId: number): Promise<Job[] | { error: string; status: number }> => {
    try {
        console.log('Fetching jobs for company:', companyId);

        const response = await api.get(`/job/company/${companyId}`);
        console.log('Company jobs fetched successfully');
        return Array.isArray(response.data) ? response.data : [];
    } catch (error: any) {
        console.error('Error fetching company jobs:', error.response?.data || error.message);
        return {
            error: error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to fetch company jobs',
            status: error.response?.status || 500
        };
    }
};

export const getDashboardDataResilient = async (privateUserId: number) => {
    try {
        console.log('Fetching resilient dashboard data for private user ID:', privateUserId);

        const now = new Date();
        const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());

        // Use local date formatting instead of UTC to avoid "today" missing due to UTC lag
        const dateFrom = format(oneYearAgo, 'yyyy-MM-dd');
        const dateTo = format(now, 'yyyy-MM-dd');

        // Fetch user, job, time logs, and schedules in parallel
        const [authResult, jobResult, timeLogsResult, schedulesResult] = await Promise.allSettled([
            checkAuthToken(),
            getJobById(privateUserId),
            getUserTimeLogs(privateUserId, dateFrom, dateTo),
            getSchedulesForUser(privateUserId)
        ]);

        let userDetails = null;
        let userError = null;
        let jobData = null;
        let jobError = null;
        let timeLogs: TimeLog[] = [];
        let timeLogsError = null;
        let schedules: Schedule[] = [];
        let schedulesError = null;
        let salaryData: Salary | null = null;
        let salaryError = null;

        // Process Auth Result
        if (authResult.status === 'fulfilled') {
            const result = authResult.value;
            if (result.valid && result.user) {
                userDetails = result.user;
                console.log('✅ User details fetched via auth token');
            } else {
                userError = result.error || 'Failed to validate auth token';
                console.log('❌ Auth token validation failed:', userError);
            }
        } else {
            userError = 'Network error fetching user details';
            console.error('❌ Error fetching user via auth token:', authResult.reason);
        }

        // Process Job Result
        if (jobResult.status === 'fulfilled') {
            const result = jobResult.value;
            if ('error' in result) {
                jobError = result.error;
                console.log('⚠️ Job fetch error:', jobError);
            } else {
                jobData = result;
                console.log('✅ Job data fetched successfully');

                // If job fetched successfully, fetch salary data
                try {
                    console.log('💰 Fetching salary data for job ID:', jobData.job_id);
                    const salaryResult = await getSalaryByJobId(jobData.job_id);
                    if ('error' in salaryResult) {
                        salaryError = salaryResult.error;
                        console.log('⚠️ Salary fetch error:', salaryError);
                    } else {
                        salaryData = salaryResult as Salary;
                        console.log('✅ Salary data fetched successfully');
                    }
                } catch (error: any) {
                    salaryError = 'Network error fetching salary data';
                    console.error('❌ Error fetching salary data:', error);
                }
            }
        } else {
            jobError = 'Network error fetching job data';
            console.error('❌ Error fetching job data:', jobResult.reason);
        }

        // Process Time Logs Result
        if (timeLogsResult.status === 'fulfilled') {
            const result = timeLogsResult.value;
            if ('error' in result) {
                timeLogsError = result.error;
                console.log('⚠️ Time logs fetch error:', timeLogsError);
            } else {
                timeLogs = result;
                console.log('✅ Time logs fetched successfully:', timeLogs.length);
            }
        } else {
            timeLogsError = 'Network error fetching time logs';
            console.error('❌ Error fetching time logs:', timeLogsResult.reason);
        }

        // Process Schedules Result
        if (schedulesResult.status === 'fulfilled') {
            const result = schedulesResult.value;
            if ('error' in result) {
                schedulesError = result.error;
                console.log('⚠️ Schedules fetch error:', schedulesError);
            } else {
                schedules = result as Schedule[];
                console.log('✅ Schedules fetched successfully:', schedules.length);
            }
        } else {
            schedulesError = 'Network error fetching schedules';
            console.error('❌ Error fetching schedules:', schedulesResult.reason);
        }

        console.log('Resilient dashboard data fetch summary:', {
            userFetched: !!userDetails,
            jobFetched: !!jobData,
            timeLogsFetched: timeLogs.length,
            schedulesFetched: schedules.length,
            salaryFetched: !!salaryData,
            errors: { userError, jobError, timeLogsError, schedulesError, salaryError }
        });

        return {
            user: userDetails,
            job: jobData,
            timeLogs,
            schedules,
            salary: salaryData,
            errors: {
                user: userError,
                job: jobError,
                timeLogs: timeLogsError,
                schedules: schedulesError,
                salary: salaryError
            }
        };
    } catch (error: any) {
        console.error('Critical error in resilient dashboard fetch:', error);
        return {
            user: null,
            job: null,
            timeLogs: [],
            schedules: [],
            salary: null,
            errors: {
                user: 'Critical error: Failed to fetch user data',
                job: 'Critical error: Failed to fetch job data',
                timeLogs: 'Critical error: Failed to fetch time logs',
                schedules: 'Critical error: Failed to fetch schedules',
                salary: 'Critical error: Failed to fetch salary data'
            }
        };
    }
};

// ==================== SECTOR / CATEGORY SERVICES ====================

export interface SectorGrade {
    id: number;
    category_id: number;
    name: string;
}

export interface SectorCategorySalary {
    id: number;
    sector_category_id: number;
    sector_grade_id?: number | null;
    min_years_of_service: number | null;
    max_years_of_service: number | null;
    // ISO date string 'YYYY-MM-DD'. Null = always valid.
    // Calculator: prefer the row with the highest effective_from that is <= today.
    effective_from: string | null;
    basic_monthly_salary: number | null;
    basic_daily_salary: number | null;
    hourly_rate: number | null;
    productivity: number | null;
    unit: string | null;
    notes: string | null;
}

export interface SectorCategory {
    id: number;
    sector_id: number;
    name: string;
    currency: string;
    grades?: SectorGrade[];
    salary_ranges?: SectorCategorySalary[];
    // frontend-only helper
    years_array?: Array<number | string>;
}

const generateYearsArray = (salaryRanges?: SectorCategorySalary[]): Array<number | string> => {
    // Filter to live rows only (effective_from <= today or null).
    const today = new Date().toISOString().slice(0, 10);
    const liveSalaryRanges = salaryRanges?.filter(
        r => r.effective_from === null || r.effective_from <= today
    ) ?? [];
    // For the purpose of building picker labels, deduplicate by (min, max) so we don't
    // show duplicate year options. Prefer rows with a real monthly/daily/hourly value
    // so the maxYears calculation is driven by substantive salary rows, not productivity
    // rows that may have null max_years_of_service when substantive rows do have a max.
    const seenBands = new Set<string>();
    const dedupedRanges = [
        // First pass: prefer rows with real salary values
        ...liveSalaryRanges.filter(r =>
            (r.basic_monthly_salary != null && r.basic_monthly_salary > 0) ||
            (r.basic_daily_salary != null && r.basic_daily_salary > 0) ||
            (r.hourly_rate != null && r.hourly_rate > 0)
        ),
        // Second pass: fall back to productivity-only rows for any band not yet covered
        ...liveSalaryRanges.filter(r =>
            !(r.basic_monthly_salary != null && r.basic_monthly_salary > 0) &&
            !(r.basic_daily_salary != null && r.basic_daily_salary > 0) &&
            !(r.hourly_rate != null && r.hourly_rate > 0)
        ),
    ].filter(r => {
        const key = `${r.min_years_of_service}:${r.max_years_of_service}`;
        if (seenBands.has(key)) return false;
        seenBands.add(key);
        return true;
    });
    // Override parameter from here on with the deduped list
    salaryRanges = dedupedRanges;
    const out: Array<number | string> = [];
    if (!salaryRanges || salaryRanges.length === 0) {
        return out;
    }

    // Always start with '<1' as minimum
    const yearsSet = new Set<number | string>();
    yearsSet.add('<1');

    // Find the maximum years_of_service from all salary ranges
    let maxYears = 0;
    const nullRangeMins: number[] = [];

    for (const range of salaryRanges) {
        const max = range.max_years_of_service;
        if (max === null) {
            // For open-ended ranges, track the min_years_of_service
            const min = range.min_years_of_service || 0;
            nullRangeMins.push(min);
            // Still need to determine a reasonable maximum for the numeric range
            if (min + 10 > maxYears) {
                maxYears = Math.max(maxYears, min + 10); // Add 10 years beyond the minimum
            }
        } else if (max > maxYears) {
            maxYears = max;
        }
    }

    // Determine the open-ended value
    let openEndedValue: string | null = null;
    if (maxYears > 0) {
        // If we have any specific max values, use the highest max + "+"
        openEndedValue = `${maxYears}+`;
    } else if (nullRangeMins.length > 0) {
        // If we only have null ranges, use the highest min from null ranges + "+"
        const highestMin = Math.max(...nullRangeMins);
        openEndedValue = `${highestMin}+`;
    }

    // Add the open-ended value if we have one
    if (openEndedValue) {
        yearsSet.add(openEndedValue);
    }
    // Add all years from 1 to the maximum found
    for (let i = 1; i <= maxYears; i++) {
        yearsSet.add(i);
    }

    const result = Array.from(yearsSet).sort((a, b) => {
        if (a === '<1') return -1;
        if (b === '<1') return 1;
        // Handle "+X" format
        const aIsPlus = typeof a === 'string' && a.endsWith('+');
        const bIsPlus = typeof b === 'string' && b.endsWith('+');
        if (aIsPlus && bIsPlus) {
            const aNum = parseInt(a.slice(0, -1)) || 0;
            const bNum = parseInt(b.slice(0, -1)) || 0;
            return aNum - bNum;
        }
        if (aIsPlus) return 1;
        if (bIsPlus) return -1;
        return (a as number) - (b as number);
    });
    return result;
};

export const getCategoriesForSector = async (sectorId: number): Promise<SectorCategory[] | { error: string; status?: number }> => {
    try {
        const response = await api.get(`/sector/category/sector/${sectorId}`);
        const data = Array.isArray(response.data) ? response.data : response.data?.data || response.data;
        if (!Array.isArray(data)) return [];

        const mapped: SectorCategory[] = data.map((c: any) => {
            // Generate years_array from salary_ranges instead of individual min/max fields
            const years = generateYearsArray(c.salary_ranges);

            // Normalize grades shape: backend returns objects with `id`, `sector_id`, `sector_category_id`, `grade`
            const grades: SectorGrade[] | undefined = Array.isArray(c.grades)
                ? c.grades.map((g: any) => ({ id: g.id, category_id: g.sector_category_id ?? g.category_id ?? null, name: g.grade ?? g.name }))
                : undefined;

            return {
                ...c,
                years_array: years,
                grades,
            } as SectorCategory;
        });

        return mapped;
    } catch (error: any) {
        console.error('Error fetching categories for sector:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.message || 'Failed to fetch categories', status: error.response?.status || 500 };
    }
};

export const getAllSectors = async (countryCode?: string): Promise<{ id: number; name: string; country_code: string }[] | { error: string; status?: number }> => {
    try {
        const params = countryCode ? { country_code: countryCode } : {};
        const response = await api.get('/sector/all', { params });
        const data = Array.isArray(response.data) ? response.data : response.data?.data || response.data;
        if (!Array.isArray(data)) return [];
        // backend returns `activity` for the sector's display name
        return data.map((s: any) => ({ id: s.id, name: s.activity ?? s.name, country_code: s.country_code ?? 'MU' }));
    } catch (error: any) {
        console.error('Error fetching sectors:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.message || 'Failed to fetch sectors', status: error.response?.status || 500 };
    }
};

export interface Country {
    code: string;
    name: string;
    currency: string;
}

// Public, unauthenticated — safe to call before signup/login. Returns only
// countries flagged is_active on the backend, so an admin-only-visible
// country never appears here (backend/api/v1/sector.py:list_countries).
export const getCountries = async (): Promise<Country[] | { error: string; status?: number }> => {
    try {
        const response = await api.get('/sector/countries');
        const data = Array.isArray(response.data) ? response.data : response.data?.data || response.data;
        if (!Array.isArray(data)) return [];
        return data as Country[];
    } catch (error: any) {
        console.error('Error fetching countries:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || error.message || 'Failed to fetch countries', status: error.response?.status || 500 };
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

        if (response.data && Array.isArray(response.data.data)) {
            return response.data.data;
        }
        return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
        return { error: handleApiError(error, 'fetching job time logs'), status: (error as any).response?.status || 500 };
    }
};

// ==================== NOTIFICATION SERVICES ====================

export interface Notification {
    notification_id: number;
    user_id: number;
    title: string;
    message: string;
    type: string;
    notification_type: string;
    related_entity_id: number | null;
    is_read: boolean;
    meta: Record<string, any> | null;
    created_at: string;
}

export const getUserNotifications = async (): Promise<Notification[] | { error: string; status: number }> => {
    try {
        console.log('Fetching notifications for current user');
        const response = await api.get('/notification');
        return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
        return { error: handleApiError(error, 'fetching notifications'), status: (error as any).response?.status || 500 };
    }
};

/**
 * Re-issue a fresh 14-day account-claim link for an imported employee who
 * hasn't set up their account yet. Returns the link so the employer can hand it
 * out (it's also best-effort emailed by the backend).
 */
export const resendClaimLink = async (
    userId: number,
): Promise<{ status: string; email: string; name?: string; token: string; claim_link: string } | { error: string; status: number }> => {
    try {
        const response = await api.post('/account/claim/resend', { user_id: userId });
        return response.data;
    } catch (error) {
        return { error: handleApiError(error, 'resending the set-up link'), status: (error as any).response?.status || 500 };
    }
};

/**
 * Peek an account-claim token WITHOUT consuming it — drives the claim screen
 * header (whose account this is). Backend: POST /account/claim/validate.
 */
export const claimValidate = async (
    token: string,
): Promise<{ valid: boolean; email: string; first_name: string } | { error: string; status?: number }> => {
    try {
        const response = await api.post('/account/claim/validate', { token });
        return response.data;
    } catch (error) {
        return { error: handleApiError(error, 'checking your invitation'), status: (error as any).response?.status || 500 };
    }
};

/**
 * Set the password AND verify the account, consuming the claim token. Backend:
 * POST /account/claim/complete. `web_access` tells us where the user belongs
 * (true = web dashboard user, false = mobile employee).
 */
export const claimComplete = async (
    token: string,
    newPassword: string,
): Promise<{ status: string; email: string; web_access: boolean } | { error: string; status?: number }> => {
    try {
        const response = await api.post('/account/claim/complete', { token, new_password: newPassword });
        return response.data;
    } catch (error) {
        return { error: handleApiError(error, 'setting your password'), status: (error as any).response?.status || 500 };
    }
};

export const markNotificationAsRead = async (notificationId: number): Promise<any | { error: string; status: number }> => {
    try {
        console.log('Marking notification as read:', notificationId);
        const response = await api.put(`/notification/${notificationId}/read`);
        return response.data;
    } catch (error) {
        return { error: handleApiError(error, 'marking notification as read'), status: (error as any).response?.status || 500 };
    }
};

export const markAllNotificationsAsRead = async (): Promise<any | { error: string; status: number }> => {
    try {
        const response = await api.put('/notification/read-all');
        return response.data;
    } catch (error) {
        return { error: handleApiError(error, 'marking all notifications as read'), status: (error as any).response?.status || 500 };
    }
};

export const dismissNotification = async (notificationId: number): Promise<any | { error: string; status: number }> => {
    try {
        const response = await api.delete(`/notification/${notificationId}`);
        return response.data;
    } catch (error) {
        return { error: handleApiError(error, 'dismissing notification'), status: (error as any).response?.status || 500 };
    }
};

export const dismissAllNotifications = async (): Promise<any | { error: string; status: number }> => {
    try {
        const response = await api.delete('/notification');
        return response.data;
    } catch (error) {
        return { error: handleApiError(error, 'dismissing all notifications'), status: (error as any).response?.status || 500 };
    }
};

export const registerPushToken = async (token: string): Promise<any | { error: string; status: number }> => {
    try {
        console.log('Registering push token with backend:', token);
        const response = await api.post('/user/register-push-token', { token });
        return response.data;
    } catch (error) {
        return { error: handleApiError(error, 'registering push token'), status: (error as any).response?.status || 500 };
    }
};

export interface NotificationPreference {
    category: string;
    in_app: boolean;
    push: boolean;
}

export const getNotificationPreferences = async (): Promise<{ preferences: NotificationPreference[] } | { error: string; status: number }> => {
    try {
        const response = await api.get('/notification/preferences');
        return response.data;
    } catch (error) {
        return { error: handleApiError(error, 'fetching notification preferences'), status: (error as any).response?.status || 500 };
    }
};

export const updateNotificationPreferences = async (preferences: NotificationPreference[]): Promise<any | { error: string; status: number }> => {
    try {
        const response = await api.put('/notification/preferences', { preferences });
        return response.data;
    } catch (error) {
        return { error: handleApiError(error, 'updating notification preferences'), status: (error as any).response?.status || 500 };
    }
};

export const markTimeLogAsOvertime = async (
    timeLogId: number, 
    reason?: string
): Promise<any | { error: string; status: number }> => {
    try {
        console.log('Marking time log as overtime:', timeLogId);
        const response = await api.post(`/job/time-log/${timeLogId}/overtime`, {
            reason: reason || "Overtime shift completed"
        });
        return response.data;
    } catch (error) {
        return { error: handleApiError(error, 'marking overtime'), status: (error as any).response?.status || 500 };
    }
};

export const confirmOvertimeByEmployer = async (timeLogId: number): Promise<any | { error: string; status: number }> => {
    try {
        console.log('Confirming overtime by employer for time log:', timeLogId);
        const response = await api.put(`/job/time-log/${timeLogId}/overtime/confirm`);
        return response.data;
    } catch (error) {
        return { error: handleApiError(error, 'confirming overtime'), status: (error as any).response?.status || 500 };
    }
};

export const rejectOvertimeByEmployer = async (timeLogId: number): Promise<any | { error: string; status: number }> => {
    try {
        console.log('Rejecting overtime by employer for time log:', timeLogId);
        const response = await api.put(`/job/time-log/${timeLogId}/overtime/reject`);
        return response.data;
    } catch (error) {
        return { error: handleApiError(error, 'rejecting overtime'), status: (error as any).response?.status || 500 };
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

export const getTimeLogsByCompany = async (companyId: number): Promise<TimeLog[] | { error: string; status: number }> => {
    try {
        console.log('Fetching time logs for company:', companyId);

        const response = await api.get(`/job/time-logs/company/${companyId}`);
        console.log('Company time logs fetched successfully');
        return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
        return { error: handleApiError(error, 'fetching company time logs'), status: (error as any).response?.status || 500 };
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

export interface RentData {
    rent_id: number;
    private_user_id: number;
    description: string;
    amount: number;
    currency: string;
    landlord_name?: string;
    property_address?: string;
    due_day?: number;
    is_recurring?: boolean;
    status?: string;
    created_at?: string;
    updated_at?: string;
}

export interface RentPayload extends Omit<RentData, 'rent_id' | 'created_at' | 'updated_at'> { }

export interface LeaveQuota {
    quota_id: number;
    private_user_id: number;
    leave_type: string;
    total_days: number;
    used_days: number;
    year: number;
    created_at?: string;
    updated_at?: string;
}

export interface LeaveQuotaPayload extends Omit<LeaveQuota, 'quota_id' | 'created_at' | 'updated_at'> { }

export interface BudgetGoal {
    budget_id: number;
    private_user_id: number;
    category: string;
    monthly_limit: number;
    currency: string;
    created_at?: string;
    updated_at?: string;
}

export interface BudgetGoalPayload extends Omit<BudgetGoal, 'budget_id' | 'created_at' | 'updated_at'> { }

export interface PublicHoliday {
    holiday_id: number;
    country_code: string;
    name: string;
    date: string;
    year: number;
    is_recurring?: boolean;
    created_at?: string;
}

export interface FinancialsData {
    transfers: TransferData[];
    purchases: PurchaseData[];
    subscriptions: SubscriptionData[];
    loans: Loan[];
    rents: RentData[];
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

export interface DashboardData {
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
 * Fetch company dashboard stats for the currently authenticated company user on mobile.
 * Returns the API payload containing overview, leaveManagement and headCount.
 * This is a thin wrapper around GET /dashboard/stats and expects the request to be authenticated.
 */
export const getCompanyDashboardStats = async (): Promise<DashboardData | ApiError> => {
    try {
        const response = await api.get('/dashboard/stats');
        return response.data;
    } catch (error: any) {
        if (isPermissionDeniedError(error)) {
            console.log('🔒 company dashboard stats: permission denied (handled)');
        } else {
            console.error('Error fetching company dashboard stats:', error.response?.data || error.message);
        }
        return { error: error.response?.data?.detail || 'An unexpected error occurred.', status: error.response?.status || 500 };
    }
};

// Update a department name
export const updateDepartment = async (companyId: number, departmentId: number, name: string): Promise<ShowDepartment | ApiError> => {
    try {
        const resp = await api.put(`/company/${companyId}/departments/${departmentId}`, { name });
        return resp.data;
    } catch (error: any) {
        console.error('Error updating department:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || 'Failed to update department', status: error.response?.status || 500 };
    }
};

// Fetch all departments for a company
export const getDepartmentsByCompany = async (companyId: number): Promise<ShowDepartment[] | ApiError> => {
    try {
        const resp = await api.get(`/company/${companyId}/departments`);
        return resp.data;
    } catch (error: any) {
        console.error('Error fetching departments:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || 'Failed to fetch departments', status: error.response?.status || 500 };
    }
};

// Assign a department to an employee (company admin only)
export const patchUserDepartment = async (userId: number, departmentId: number | null): Promise<{ user_id: number; department_id: number | null } | ApiError> => {
    try {
        const resp = await api.patch(`/user/${userId}/department`, { department_id: departmentId });
        return resp.data;
    } catch (error: any) {
        console.error('Error patching user department:', error.response?.data || error.message);
        return { error: error.response?.data?.detail || 'Failed to update department', status: error.response?.status || 500 };
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

// Analytics & calculations are centralized in shared/services/payroll
// (calculatePayrollData, getAttendanceStats, formatCurrency, formatHours)

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
    // Backend may reject with a structured detail object (geofence blocks
    // carry { code, message, distance_m, fence, reason }) — prefer its
    // human-readable `message` over axios's generic "Request failed".
    const detail = error?.response?.data?.detail;
    if (typeof detail === 'string') {
        return detail;
    }
    if (detail && typeof detail === 'object' && typeof detail.message === 'string') {
        return detail.message;
    }
    if (error?.message) {
        return error.message;
    }
    return 'An unexpected error occurred';
};

/** True when an error is a backend authorization denial (HTTP 403). Every 403
 *  means "the server refused this action" — it's expected for delegated roles
 *  and always handled by callers (empty / no-access UI), never an unexpected
 *  crash, so it should log quietly rather than as a red error. Matches the
 *  web, which downgrades all 403s to warnings. Detecting by status (not by the
 *  exact wording of detail) avoids missing variants like "Not permitted to
 *  view this vault" that don't contain the word "permission".
 *  Accepts both raw axios errors and the { error, status } objects our wrappers
 *  return. */
export const isPermissionDeniedError = (error: any): boolean => {
    const status = error?.response?.status ?? error?.status;
    return status === 403;
};

export const handleApiError = (error: any, context: string = 'API call') => {
    const message = getErrorMessage(error);
    if (isPermissionDeniedError(error)) {
        // Expected when a role lacks a permission — the caller surfaces a
        // no-access / empty state. Log quietly instead of as a red error.
        console.log(`🔒 ${context}: permission denied (handled)`);
    } else {
        console.error(`${context} failed:`, message);
    }
    return message;
};

// ==================== EXPORTS ====================

export default {
    // Auth
    postSignUpUser,
    postSignUpCompany,
    postSignInUser,
    checkAuthToken,
    checkEmailExists,

    // Onboarding
    createOnboardJob,
    createMultipleJobs,

    // Users
    getUserDetail,
    updateUserProfile,
    getAllUsers,

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
    // Sectors
    getCategoriesForSector,
    getAllSectors,
    getCountries,

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

/**
 * Employee marks their own personal progress on an assigned task.
 * Does NOT overwrite other assignees' statuses.
 * When ALL assignees complete, the global task status auto-sets to 'completed'.
 * `note` is this employee's own message on the task (stored per-assignee).
 */
export const updateMyScheduleStatus = async (
    scheduleId: number,
    newStatus: 'pending' | 'started' | 'completed',
    note?: string
): Promise<Schedule | { error: string; status: number }> => {
    try {
        const response = await api.put(`/job/schedule/${scheduleId}/my-status`, { status: newStatus, note });
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to update your task status',
            status: error.response?.status || 500,
        };
    }
};

// #4 — upload a photo as proof of completion for the current user's assigned task.
export const uploadTaskProof = async (
    scheduleId: number,
    imageUri: string
): Promise<{ proof_image_url: string } | { error: string; status: number }> => {
    try {
        const formData = new FormData();
        const filename = imageUri.split('/').pop() || 'proof.jpg';
        const match = /\.(\w+)$/.exec(filename);
        const type = match ? `image/${match[1]}` : 'image/jpeg';
        formData.append('file', { uri: imageUri, name: filename, type } as any);
        const response = await api.post(`/job/schedule/${scheduleId}/proof`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || error.message || 'Failed to upload proof',
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

export const getLeaveRequestsByCompany = async (companyId: number): Promise<Leave[] | { error: string; status: number }> => {
    try {
        const response = await api.get(`/user/leaves/company/${companyId}`);
        if (response.data && response.data.status === 'success') {
            return response.data.data;
        }
        return response.data;
    } catch (error: any) {
        return {
            error: error.response?.data?.detail || 'Failed to fetch company leave requests',
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

export const approveLeaveRequest = async (
    leaveId: number,
    approvalData: {
        action: 'approve' | 'reject';
        rejection_reason?: string;
        approver_comments?: string;
    }
): Promise<ApiResponse<Leave> | { error: string; status?: number }> => {
    try {
        console.log('Approving/rejecting leave request:', { leaveId, approvalData });
        const response = await api.put(`/user/leave/${leaveId}/approve`, approvalData);
        return response.data;
    } catch (error: any) {
        if (isPermissionDeniedError(error)) {
            console.log('🔒 leave approval: permission denied (handled)');
        } else {
            console.error('Leave approval error:', error.response?.data || error.message);
        }
        return {
            error:
                error.response?.data?.detail ||
                error.response?.data?.message ||
                error.message ||
                'Failed to approve/reject leave request',
            status: error.response?.status || 500,
        };
    }
};

// ==================== RENT SERVICES ====================

export const createRent = async (
    payload: RentPayload
): Promise<ApiResponse<RentData> | { error: string; status?: number }> => {
    try {
        const response = await api.post('/user/rent', payload);
        return response.data;
    } catch (error: any) {
        return { error: error.response?.data?.detail || 'Failed to create rent', status: error.response?.status || 500 };
    }
};

export const getRentsByUser = async (
    privateUserId: number
): Promise<ApiResponse<RentData[]> | { error: string; status?: number }> => {
    try {
        const response = await api.get(`/user/rents/${privateUserId}`);
        return response.data;
    } catch (error: any) {
        return { error: error.response?.data?.detail || 'Failed to fetch rents', status: error.response?.status || 500 };
    }
};

export const updateRent = async (
    rentId: number,
    payload: Partial<RentPayload>
): Promise<ApiResponse<RentData> | { error: string; status?: number }> => {
    try {
        const response = await api.put(`/user/rent/${rentId}`, payload);
        return response.data;
    } catch (error: any) {
        return { error: error.response?.data?.detail || 'Failed to update rent', status: error.response?.status || 500 };
    }
};

export const deleteRent = async (
    rentId: number
): Promise<ApiResponse<any> | { error: string; status?: number }> => {
    try {
        const response = await api.delete(`/user/rent/${rentId}`);
        return response.data;
    } catch (error: any) {
        return { error: error.response?.data?.detail || 'Failed to delete rent', status: error.response?.status || 500 };
    }
};

// ==================== BUDGET GOAL SERVICES ====================

export const createBudgetGoal = async (
    payload: BudgetGoalPayload
): Promise<ApiResponse<BudgetGoal> | { error: string; status?: number }> => {
    try {
        const response = await api.post('/user/budget', payload);
        return response.data;
    } catch (error: any) {
        return { error: error.response?.data?.detail || 'Failed to create budget goal', status: error.response?.status || 500 };
    }
};

export const getBudgetGoalsByUser = async (
    privateUserId: number
): Promise<ApiResponse<BudgetGoal[]> | { error: string; status?: number }> => {
    try {
        const response = await api.get(`/user/budgets/${privateUserId}`);
        return response.data;
    } catch (error: any) {
        return { error: error.response?.data?.detail || 'Failed to fetch budget goals', status: error.response?.status || 500 };
    }
};

export const updateBudgetGoal = async (
    budgetId: number,
    payload: Partial<BudgetGoalPayload>
): Promise<ApiResponse<BudgetGoal> | { error: string; status?: number }> => {
    try {
        const response = await api.put(`/user/budget/${budgetId}`, payload);
        return response.data;
    } catch (error: any) {
        return { error: error.response?.data?.detail || 'Failed to update budget goal', status: error.response?.status || 500 };
    }
};

export const deleteBudgetGoal = async (
    budgetId: number
): Promise<ApiResponse<any> | { error: string; status?: number }> => {
    try {
        const response = await api.delete(`/user/budget/${budgetId}`);
        return response.data;
    } catch (error: any) {
        return { error: error.response?.data?.detail || 'Failed to delete budget goal', status: error.response?.status || 500 };
    }
};

// ==================== LEAVE QUOTA SERVICES ====================

export const getLeaveQuotas = async (
    privateUserId: number,
    year?: number
): Promise<ApiResponse<LeaveQuota[]> | { error: string; status?: number }> => {
    try {
        const params = year ? `?year=${year}` : '';
        const response = await api.get(`/user/leave-quotas/${privateUserId}${params}`);
        return response.data;
    } catch (error: any) {
        return { error: error.response?.data?.detail || 'Failed to fetch leave quotas', status: error.response?.status || 500 };
    }
};

export const createLeaveQuota = async (
    payload: LeaveQuotaPayload
): Promise<ApiResponse<LeaveQuota> | { error: string; status?: number }> => {
    try {
        const response = await api.post('/user/leave-quota', payload);
        return response.data;
    } catch (error: any) {
        return { error: error.response?.data?.detail || 'Failed to create leave quota', status: error.response?.status || 500 };
    }
};

// ==================== PUBLIC HOLIDAY SERVICES ====================

export const getPublicHolidays = async (
    countryCode: string,
    year?: number
): Promise<ApiResponse<PublicHoliday[]> | { error: string; status?: number }> => {
    try {
        const params = year ? `?year=${year}` : '';
        const response = await api.get(`/user/holidays/${countryCode}${params}`);
        return response.data;
    } catch (error: any) {
        return { error: error.response?.data?.detail || 'Failed to fetch public holidays', status: error.response?.status || 500 };
    }
};

// --- Document Vault ---
export const uploadVaultDocument = async (params: {
    private_user_id: number;
    doc_type: string;
    name: string;
    expiry_date?: string;
    notes?: string;
    visibility?: string;
    fileUri?: string;
    fileName?: string;
    fileMime?: string;
}) => {
    try {
        const formData = new FormData();
        formData.append('private_user_id', String(params.private_user_id));
        formData.append('doc_type', params.doc_type);
        formData.append('name', params.name);
        if (params.expiry_date) formData.append('expiry_date', params.expiry_date);
        if (params.notes) formData.append('notes', params.notes);
        if (params.visibility) formData.append('visibility', params.visibility);
        if (params.fileUri && params.fileName) {
            formData.append('file', {
                uri: params.fileUri,
                name: params.fileName,
                type: params.fileMime || 'application/octet-stream',
            } as any);
        }
        const response = await api.post('/user/vault/upload', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        return response.data;
    } catch (e: any) {
        return { error: e.response?.data?.detail || e.message || 'Upload failed' };
    }
};

/**
 * Resolve a stored file_url into an absolute, openable URL.
 * LocalStorage returns relative paths like "/uploads/vault/<id>/<file>"; prepend
 * the backend origin (apiClient baseURL minus its /api/v1 suffix) so the device
 * can reach it. Absolute URLs (S3/GCS) pass through unchanged.
 */
export const resolveFileUrl = (url?: string | null): string | null => {
    if (!url) return null;
    if (/^https?:\/\//i.test(url)) return url;
    const origin = (api.defaults.baseURL || "")
        .replace(/\/api\/v1\/?$/, "")
        .replace(/\/+$/, "");
    return `${origin}${url.startsWith("/") ? "" : "/"}${url}`;
};

/**
 * Wrap a PDF URL in the backend's pdf.js viewer page so it renders inside a
 * WebView on every platform (Android's system WebView can't show PDFs inline).
 * `fileUrl` must already be absolute (resolveFileUrl).
 */
export const pdfViewerUrl = (fileUrl: string): string => {
    const origin = (api.defaults.baseURL || "")
        .replace(/\/api\/v1\/?$/, "")
        .replace(/\/+$/, "");
    return `${origin}/pdf-view?file=${encodeURIComponent(fileUrl)}`;
};

export const getVaultDocuments = async (private_user_id: number) => {
    try {
        const response = await api.get(`/user/vault/${private_user_id}`);
        return response.data;
    } catch (e: any) {
        return { error: e.response?.data?.detail || e.message || 'Failed to fetch' };
    }
};

export const deleteVaultDocument = async (doc_id: number) => {
    try {
        const response = await api.delete(`/user/vault/doc/${doc_id}`);
        return response.data;
    } catch (e: any) {
        return { error: e.response?.data?.detail || e.message || 'Failed to delete' };
    }
};

// Self-service account deletion (App Store / Google Play requirement).
// Anonymizes + disables the authenticated user. Returns { error } on failure
// (e.g. a 409 when the caller owns a company with other members).
export const deleteAccount = async () => {
    try {
        const response = await api.delete('/user/me');
        return response.data;
    } catch (e: any) {
        return { error: e.response?.data?.detail || e.message || 'Failed to delete account' };
    }
};

// ==================== GEO FENCING (company sites / branches) ====================

export interface MobileGeofence {
    geofence_id: number;
    company_id: number;
    name: string;
    address: string | null;
    latitude: number;
    longitude: number;
    radius_meters: number;
    mode: 'block' | 'flag';
    active: boolean;
    employee_count?: number;
}

const geofenceError = (e: any, fallback: string) =>
    e?.response?.data?.detail || e?.message || fallback;

export const getCompanyGeofences = async (companyId: number): Promise<{
    geofences: MobileGeofence[];
    geofence_default_mode: string;
} | { error: string }> => {
    try {
        const response = await api.get(`/company/${companyId}/geofences`);
        return {
            geofences: response.data?.geofences ?? [],
            geofence_default_mode: response.data?.geofence_default_mode ?? 'off',
        };
    } catch (e: any) {
        return { error: geofenceError(e, 'Failed to load sites') };
    }
};

export const createCompanyGeofence = async (companyId: number, payload: {
    name: string;
    latitude: number;
    longitude: number;
    radius_meters?: number;
    mode?: 'block' | 'flag';
    active?: boolean;
    address?: string | null;
}): Promise<MobileGeofence | { error: string }> => {
    try {
        const response = await api.post(`/company/${companyId}/geofences`, payload);
        return response.data;
    } catch (e: any) {
        return { error: geofenceError(e, 'Failed to create site') };
    }
};

export const updateCompanyGeofence = async (companyId: number, geofenceId: number, payload: {
    name?: string;
    radius_meters?: number;
    mode?: 'block' | 'flag';
    active?: boolean;
    address?: string | null;
}): Promise<MobileGeofence | { error: string }> => {
    try {
        const response = await api.put(`/company/${companyId}/geofences/${geofenceId}`, payload);
        return response.data;
    } catch (e: any) {
        return { error: geofenceError(e, 'Failed to update site') };
    }
};

// Soft-deletes the site and moves its assigned employees to another site (or
// leaves them unassigned when toGeofenceId is null).
export const deleteCompanyGeofence = async (
    companyId: number,
    geofenceId: number,
    toGeofenceId: number | null = null,
): Promise<{ status: string; reassigned: number } | { error: string }> => {
    try {
        const response = await api.post(`/company/${companyId}/geofences/${geofenceId}/reassign`, {
            to_geofence_id: toGeofenceId,
        });
        return response.data;
    } catch (e: any) {
        return { error: geofenceError(e, 'Failed to delete site') };
    }
};

export const setCompanyGeofenceDefaultMode = async (companyId: number, mode: 'off' | 'block' | 'flag'): Promise<boolean | { error: string }> => {
    try {
        await api.put(`/company/${companyId}`, { geofence_default_mode: mode });
        return true;
    } catch (e: any) {
        return { error: geofenceError(e, 'Failed to update default mode') };
    }
};

export const searchPlace = async (q: string, country?: string): Promise<{
    latitude: number;
    longitude: number;
    display_name: string;
}[] | { error: string }> => {
    try {
        const response = await api.get('/geocode/search', {
            params: { q, country: country || undefined },
        });
        return response.data?.results ?? [];
    } catch (e: any) {
        return { error: geofenceError(e, 'Search is unavailable') };
    }
};

export const reverseGeocode = async (lat: number, lng: number): Promise<string | { error: string }> => {
    try {
        const response = await api.get('/geocode/reverse', { params: { lat, lng } });
        return response.data?.display_name ?? '';
    } catch (e: any) {
        return { error: geofenceError(e, 'Address lookup is unavailable') };
    }
};