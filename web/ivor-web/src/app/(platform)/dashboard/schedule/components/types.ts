export interface ScheduleEmployee {
  private_user_id: number;
  first_name: string;
  last_name: string;
}

export type ShiftStatus = "pending" | "started" | "completed" | "cancelled";

export interface AssigneeStatus {
  schedule_id: number;
  private_user_id: number;
  status: ShiftStatus;
  proof_image_url?: string | null;   // #4 — photo proof of completion
  updated_at: string | null;
}

export interface Shift {
  schedule_id: number;
  title: string;
  company_id: number;
  location: string;
  hours: string | null;
  notes: string | null;
  start_time: string;   // ISO datetime
  end_time: string;     // ISO datetime
  status: ShiftStatus;
  assigned_employees: ScheduleEmployee[];
  assignee_statuses: AssigneeStatus[];
  created_at: string | null;
  updated_at: string | null;
}

export interface LeaveRecord {
  leave_id: number;
  private_user_id: number;
  leave_type: string;
  start_date: string;   // YYYY-MM-DD
  end_date: string;     // YYYY-MM-DD
  status: string;
  first_name?: string;
  last_name?: string;
}

export interface ShiftFormData {
  title: string;
  location: string;
  hours: string;
  notes: string;
  start_time: string;   // datetime-local value
  end_time: string;
  assigned_employee_ids: number[];
  status: ShiftStatus;
}

export const STATUS_CONFIG: Record<ShiftStatus, { label: string; cls: string }> = {
  pending:   { label: "Pending",     cls: "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400" },
  started:   { label: "In Progress", cls: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400" },
  completed: { label: "Completed",   cls: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  cancelled: { label: "Cancelled",   cls: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400" },
};

/** Returns Monday of the week containing `date` */
export function weekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // adjust for Sunday=0
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function toDateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function toLocalDatetimeStr(iso: string): string {
  // Convert ISO to datetime-local value (YYYY-MM-DDTHH:MM)
  return iso.slice(0, 16);
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

/** Checks if an employee on a shift has an approved leave overlapping that shift's date */
export function getLeaveConflicts(
  shift: Shift,
  leaves: LeaveRecord[]
): LeaveRecord[] {
  const shiftDate = shift.start_time.slice(0, 10);
  const assignedIds = new Set(shift.assigned_employees.map((e) => e.private_user_id));
  return leaves.filter(
    (l) =>
      l.status === "approved" &&
      assignedIds.has(l.private_user_id) &&
      shiftDate >= l.start_date &&
      shiftDate <= l.end_date
  );
}
