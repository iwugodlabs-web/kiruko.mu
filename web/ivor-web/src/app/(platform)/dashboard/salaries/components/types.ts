export interface SalaryRow {
  job_id: number;
  private_user_id: number;
  user_id?: number | null;
  employee_name: string;
  employee_code?: string | null;
  // Extended employee profile fields
  email?: string | null;
  phone?: string | null;
  gender?: string | null;
  date_of_birth?: string | null;
  passport_number?: string | null;
  first_date_of_employment?: string | null;
  employer_brn?: string | null;
  // Job fields
  job_title: string | null;
  department: string | null;
  department_id: number | null;
  // Salary fields
  has_salary: boolean;
  salary_id: number | null;
  salary: string | null;       // base pay amount as string
  // The backend Salary table has both `allowance` and a legacy `revenue` column;
  // mobile writes to `allowance`, the web modal historically wrote to `revenue`.
  // Both fields are exposed so the UI can read whichever is set and write to
  // both, keeping the two clients in sync.
  allowance: string | null;
  revenue: string | null;
  currency: string | null;
  monthly_hours: string | null;
  days_of_work_per_month: number | null;
  break_in_minutes_per_day: number | null;
  hourly_rate: number | null;
}

export interface CompanySalariesResponse {
  total: number;
  limit: number;
  offset: number;
  missing_count: number;
  data: SalaryRow[];
}

export interface SalaryFormData {
  salary: string;
  /** Recurring monthly allowances. Persisted to both `salary.allowance`
   * (mobile-canonical) and `salary.revenue` (legacy) to keep clients in sync. */
  allowance: string;
  currency: string;
  monthly_hours: string;
  days_of_work_per_month: number;
  break_in_minutes_per_day: number;
}

// Minimum wage thresholds (monthly, in local currency)
export const MIN_WAGE: Record<string, { amount: number; label: string }> = {
  MUR: { amount: 11275, label: "MUR 11,275/mo (Mauritius)" },
  MGA: { amount: 258960, label: "MGA 258,960/mo (Madagascar)" },
};
