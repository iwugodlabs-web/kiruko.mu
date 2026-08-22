export interface BreakEntry {
  break_id: number;
  start_time: string | null;
  end_time: string | null;
}

export type TimeLogStatus = "active" | "complete" | "incomplete" | "overtime";

export interface TimeLogRow {
  timelog_id: number;
  employee_name: string;
  employee_code?: string | null;
  private_user_id: number;
  job_id: number;
  job_title: string | null;
  department: string | null;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  hours_worked: number | null;
  break_minutes: number;
  is_overtime: boolean;
  overtime_confirmed_by_employer: boolean;
  // Engine-detected OT (worked hours beyond the daily statutory limit), even
  // when never manually flagged — mirrors what payroll pays.
  auto_overtime?: boolean;
  overtime_hours?: number | null;
  overtime_source?: "flagged" | "auto" | null;
  location: Record<string, unknown> | null;
  status: TimeLogStatus;
  breaks: BreakEntry[];
  // Provenance + kiosk selfie (M30 / v1.7). Optional — older payloads omit them.
  created_source?: string;
  kiosk_photo_path?: string | null;
  out_of_schedule?: boolean;
  // Schedule-aware clock-in: late start (after grace) + the employee's reason.
  is_late?: boolean;
  late_reason?: string | null;
}

export interface DashboardTimeLogs {
  total: number;
  limit: number;
  offset: number;
  data: TimeLogRow[];
}

export interface DateRange {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
}
