export type PermitStatus = "valid" | "expiring_soon" | "expired" | "tourist_visa" | "no_data";

export interface ComplianceEmployee {
  job_id: number;
  private_user_id: number;
  employee_name: string;
  employee_code?: string | null;
  passport_number: string | null;
  job_title: string | null;
  department: string | null;
  department_id: number | null;
  permit_type: string | null;
  has_permission_to_work: boolean;
  working_on_tourist_visa: boolean;
  expiry_date: string | null;       // ISO date YYYY-MM-DD
  days_until_expiry: number | null;
  permit_status: PermitStatus;
  permit_doc_id: number | null;
  permit_doc_url: string | null;
  currency: string | null;
  total_monthly_pay: number | null;
  below_min_wage: boolean;
  compliance_score: number;         // 0-100
}

export interface StatusCounts {
  valid: number;
  expiring_soon: number;
  expired: number;
  tourist_visa: number;
  no_data: number;
}

export interface ComplianceResponse {
  overall_score: number;
  total_employees: number;
  status_counts: StatusCounts;
  below_min_wage_count: number;
  expiring_90_days: ComplianceEmployee[];
  employees: ComplianceEmployee[];
}

export const PERMIT_STATUS_CONFIG: Record<PermitStatus, { label: string; classes: string; dotColor: string }> = {
  valid:         { label: "Valid",          classes: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",   dotColor: "bg-green-500" },
  expiring_soon: { label: "Expiring Soon",  classes: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",   dotColor: "bg-amber-500" },
  expired:       { label: "Expired",        classes: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",           dotColor: "bg-red-500" },
  tourist_visa:  { label: "Tourist Visa",   classes: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",           dotColor: "bg-red-500" },
  no_data:       { label: "No Data",        classes: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400",          dotColor: "bg-gray-400" },
};
