export type OtStatus = "pending" | "approved" | "rejected";

export interface OvertimeRow {
  timelog_id: number;
  job_id: number;
  employee_name: string;
  employee_code?: string | null;
  job_title: string | null;
  department: string | null;
  date: string | null;           // YYYY-MM-DD
  start_time: string | null;     // ISO
  end_time: string | null;       // ISO
  hours_worked: number | null;
  hourly_rate: number | null;
  estimated_cost: number | null;
  currency: string | null;
  ot_status: OtStatus;
  is_overtime: boolean;
  overtime_confirmed_by_employer: boolean;
  overtime_rejected: boolean;
  marked_as_overtime_at: string | null;
  overtime_reason: string | null;
  location: Record<string, unknown> | null;
}

export interface OvertimeResponse {
  total: number;
  offset: number;
  limit: number;
  records: OvertimeRow[];
}
