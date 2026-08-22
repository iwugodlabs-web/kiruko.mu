/**
 * #20 — Clock-in Review grouping + activity-type classification.
 *
 * The review list arrives as a flat array of sessions. A single employee can
 * have many sessions in one day (split shifts, re-clock-ins, an auto-closed
 * stub + a real session). This module turns that flat list into per-employee,
 * per-day blocks, and classifies each session into ONE activity type so the
 * reviewer sees the right action next to it:
 *
 *   normal       → within schedule, employee clocked out  → Approve
 *   overtime      → flagged overtime                       → Confirm overtime (a
 *                                                            separate money
 *                                                            decision) + Approve
 *   off_schedule  → clock-in outside the job's hours       → Verify, then Approve
 *   auto_closed   → system closed the session (no clock-out)→ Review hours first
 *
 * Pure functions only — no React, no network — so the classification is easy to
 * reason about and reuse. Precedence matters when a session trips more than one
 * flag (e.g. an auto-closed overtime session): we surface the MOST
 * action-blocking type first, because you can't trust the overtime premium until
 * the underlying hours are trustworthy.
 */
import type { TimeLogReviewItem } from "@/services/payroll-api";

export type ActivityType = "normal" | "overtime" | "off_schedule" | "auto_closed";

/** Display order within a day block: the bulk (normal) first, then the
 *  exceptions that each need their own scrutiny. */
export const ACTIVITY_ORDER: ActivityType[] = [
  "normal",
  "overtime",
  "off_schedule",
  "auto_closed",
];

export const ACTIVITY_META: Record<
  ActivityType,
  { label: string; hint: string }
> = {
  normal: {
    label: "Normal",
    hint: "Within schedule, clocked out normally. Approve to feed payroll.",
  },
  overtime: {
    label: "Overtime",
    hint:
      "Flagged as overtime. Confirming overtime is a separate decision from approving the clock-in — the premium only pays once you confirm it.",
  },
  off_schedule: {
    label: "Off-schedule",
    hint:
      "Clock-in fell outside this employee's configured work hours (with grace). Verify it was legitimate before approving.",
  },
  auto_closed: {
    label: "Auto-closed",
    hint:
      "The system closed this session — the employee never clocked out. The end time was capped at max-shift or the scheduled end. Review the hours before approving.",
  },
};

/**
 * Classify a session into exactly one activity type.
 *
 * Precedence (highest first): auto_closed → overtime → off_schedule → normal.
 * auto_closed wins over overtime on purpose: if the system guessed the end time,
 * the hours (and therefore any overtime within them) are not yet trustworthy.
 */
export function classifyActivity(l: TimeLogReviewItem): ActivityType {
  if (l.auto_closed) return "auto_closed";
  if (l.is_overtime) return "overtime";
  if (l.out_of_schedule) return "off_schedule";
  return "normal";
}

export type SessionStatus = "pending" | "approved" | "rejected" | "disputed";

export function sessionStatus(l: TimeLogReviewItem): SessionStatus {
  if (l.dispute_status === "pending") return "disputed";
  if (l.admin_approved) return "approved";
  if (l.admin_rejected) return "rejected";
  return "pending";
}

/** A session is selectable for bulk approve/reject only while still pending. */
export function isPending(l: TimeLogReviewItem): boolean {
  return sessionStatus(l) === "pending";
}

/** An overtime session whose premium hasn't been confirmed (or rejected) yet. */
export function needsOvertimeConfirmation(l: TimeLogReviewItem): boolean {
  return (
    l.is_overtime &&
    !l.overtime_confirmed_by_employer &&
    !l.admin_rejected
  );
}

export interface EmployeeDayGroup {
  key: string;
  privateUserId: number;
  employeeName: string;
  employeeCode: string | null;
  day: string | null;
  /** First available kiosk selfie in the day — used as the block avatar. */
  kioskPhotoPath: string | null;
  sessions: TimeLogReviewItem[];
  byType: Record<ActivityType, TimeLogReviewItem[]>;
  totalHours: number;
  pendingCount: number;
  needsOvertimeCount: number;
  disputedCount: number;
}

function emptyByType(): Record<ActivityType, TimeLogReviewItem[]> {
  return { normal: [], overtime: [], off_schedule: [], auto_closed: [] };
}

/**
 * Group a flat session list into per-employee, per-day blocks. Blocks are
 * sorted by day (most recent first) then employee name; sessions within a block
 * are ordered by start time.
 */
export function groupByEmployeeDay(
  items: TimeLogReviewItem[],
): EmployeeDayGroup[] {
  const groups = new Map<string, EmployeeDayGroup>();

  for (const l of items) {
    const key = `${l.private_user_id}|${l.day ?? "no-day"}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        privateUserId: l.private_user_id,
        employeeName: l.employee_name,
        employeeCode: l.employee_code ?? null,
        day: l.day,
        kioskPhotoPath: null,
        sessions: [],
        byType: emptyByType(),
        totalHours: 0,
        pendingCount: 0,
        needsOvertimeCount: 0,
        disputedCount: 0,
      };
      groups.set(key, g);
    }
    g.sessions.push(l);
    g.byType[classifyActivity(l)].push(l);
    g.totalHours += l.hours_worked ?? 0;
    if (isPending(l)) g.pendingCount += 1;
    if (needsOvertimeConfirmation(l)) g.needsOvertimeCount += 1;
    if (sessionStatus(l) === "disputed") g.disputedCount += 1;
    if (!g.kioskPhotoPath && l.kiosk_photo_path) g.kioskPhotoPath = l.kiosk_photo_path;
  }

  const out = Array.from(groups.values());
  for (const g of out) {
    g.sessions.sort(
      (a, b) =>
        new Date(a.start_time ?? 0).getTime() -
        new Date(b.start_time ?? 0).getTime(),
    );
  }
  out.sort((a, b) => {
    // Most recent day first; undated blocks sink to the bottom.
    const da = a.day ?? "";
    const db = b.day ?? "";
    if (da !== db) return da < db ? 1 : -1;
    return a.employeeName.localeCompare(b.employeeName);
  });
  return out;
}

/** Sum of hours for a set of sessions (used for per-type subtotals). */
export function sumHours(sessions: TimeLogReviewItem[]): number {
  return sessions.reduce((acc, s) => acc + (s.hours_worked ?? 0), 0);
}
