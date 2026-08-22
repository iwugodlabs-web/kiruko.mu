export interface MonthPoint {
  label: string;
}

export interface HeadcountPoint extends MonthPoint {
  total: number;
  new_hires: number;
}

export interface AttendancePoint extends MonthPoint {
  hours: number;
  sessions: number;
}

export interface LeaveRow {
  type: string;
  total: number;
  approved: number;
  pending: number;
  rejected: number;
}

export interface OtCostPoint extends MonthPoint {
  ot_hours: number;
  ot_cost: number;
}

export interface DisputePoint extends MonthPoint {
  opened: number;
  closed: number;
}

export interface PayrollCostPoint extends MonthPoint {
  gross: number;
}

export interface TurnoverPoint extends MonthPoint {
  terminations: number;
  rate: number;
}

export interface ReportsSummary {
  total_employees: number;
  total_hours_period: number;
  total_ot_cost_period: number;
  total_leave_approved_period: number;
  open_disputes: number;
  total_payroll_cost_period: number;
  terminations_period: number;
}

export interface ReportsData {
  labels: string[];
  months: number;
  headcount_trend: HeadcountPoint[];
  attendance_by_month: AttendancePoint[];
  leave_utilization: LeaveRow[];
  ot_cost_by_month: OtCostPoint[];
  dispute_resolution: DisputePoint[];
  payroll_cost_by_month: PayrollCostPoint[];
  turnover_by_month: TurnoverPoint[];
  summary: ReportsSummary;
}

export const LEAVE_TYPE_LABELS: Record<string, string> = {
  annual: "Annual",
  sick: "Sick",
  emergency: "Emergency",
  maternity: "Maternity",
  paternity: "Paternity",
  unpaid: "Unpaid",
  other: "Other",
};

export const LEAVE_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#3b82f6", "#8b5cf6", "#ec4899",
];
