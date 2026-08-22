// Shared TypeScript-friendly types used by both mobile and web services
export interface BreakLog {
  break_id: number;
  timelog_id: number;
  start_time: string;
  end_time?: string;
}

export interface TimeLog {
  timelog_id?: number;
  private_user_id?: number;
  job_id?: number;
  day_of_week?: string;
  start_time?: string;
  end_time?: string;
  location?: any;
  hours_worked?: number;
  breaks?: BreakLog[];
  is_overtime?: boolean;
  is_holiday?: boolean;
  is_weekend?: boolean;
  marked_as_overtime_at?: string;
  created_at?: string;
  updated_at?: string;
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
  regularHours?: number;
  overtimeHours?: number;
  holidayHours?: number;
  regularPay?: number;
  overtimePay?: number;
  holidayPay?: number;
  allowances?: number;
  breakTime?: number;
}

export interface Salary {
  salary_id?: number;
  job_id?: number;
  monthly_hours?: string | number;
  break_in_minutes_per_day?: number;
  days_of_work_per_month?: number;
  currency?: string;
  salary?: string | number;
  allowance?: string | number;
  revenue?: string | number;
}

export interface UserRightPayload {
  right_id?: number;
  private_user_id: number;
  title: string;
  category: string;
  issue_description: string;
  contact_method: string;
  previous_occurence?: boolean;
  date_of_occurrence?: string;
  time?: string;
  occurrence_description?: string;
  urgency_level: string;
  resolution_method: string;
  accept_terms_and_conditions: boolean;
  acknowledge_information: boolean;
  agreed_to_be_contacted: boolean;
  status: string;
  expected_outcome: string;
  created_at?: string;
  updated_at?: string;
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

export interface BreakLog {
  break_id: number;
  timelog_id: number;
  start_time: string;
  end_time?: string;
}

export interface Job {
  job_id?: number;
  private_user_id?: number;
  company_id?: number;
  job_title?: string;
  employer_name?: string;
  employer_brn?: string;
  employer_email?: string;
  employer_phone?: string;
  employer_address?: string;
  first_date_of_employment?: string;
  work_start_time?: string;
  work_end_time?: string;
  has_contract?: boolean;
  has_permission_to_work?: boolean;
  work_permit_type?: string;
  working_on_tourist_visa?: boolean;
  is_salary_deducted?: boolean;
  created_at?: string;
  updated_at?: string;
  hourly_rate?: number;
}

export interface User {
  user_id?: number;
  email?: string;
  user_name?: string;
  user_type?: string;
  onboard_complete?: boolean;
  private_user_id?: number;
  private_user?: any;
  company?: any;
  jobs?: any[];
  time_logs?: any[];
}

export interface Subscription {
  subscription_id: number;
  private_user_id: number;
  description: string;
  amount: number;
  currency: string;
  subscription_date?: string;
  created_at?: string;
  updated_at?: string;
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

export interface Repayment {
  repayment_id: number;
  loan_id: number;
  amount: number;
  payment_date: string;
  created_at?: string;
  updated_at?: string;
}

export interface Loan {
  loan_id: number;
  private_user_id: number;
  description: string;
  amount: number;
  currency: string;
  start_date?: string;
  due_date?: string;
  status?: string;
  repaid_amount?: number;
  is_recurrent?: boolean;
  duration_months?: number;
  payment_frequency?: string;
  interest_rate?: number;
  lender_name?: string;
  created_at?: string;
  updated_at?: string;
  repayments?: Repayment[];
}

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
  created_at?: string;
  updated_at?: string;
}

