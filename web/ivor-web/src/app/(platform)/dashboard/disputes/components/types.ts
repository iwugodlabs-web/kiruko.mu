// Concerns v2 status enum (mirrors backend `core.concern_states.ConcernStatus`).
// The legacy enum (`pending | under_review | awaiting_worker`) was replaced by
// Migration 1.C; the strings below are the only ones the backend accepts since
// the `ck_user_rights_status_v2` CHECK constraint was added.
export type DisputeStatus =
  | "received"
  | "triaged"
  | "investigating"
  | "action_taken"
  | "appealed"
  | "resolved"
  | "rejected"
  | "closed";
export type UrgencyLevel = "high" | "medium" | "low";

export interface InternalDispute {
  right_id: number;
  employee_name: string;
  private_user_id: number;
  title: string;
  category: string;
  urgency_level: UrgencyLevel | string;
  status: DisputeStatus | string;
  channel: "internal" | "external";
  issue_description: string;
  expected_outcome: string;
  occurrence_description: string | null;
  date_of_occurrence: string | null;
  attachment_url: string | null;
  assigned_to: number | null;
  internal_notes: string | null;
  resolution: string | null;
  closed_at: string | null;
  closed_by: number | null;
  days_open: number;
  created_at: string | null;
  updated_at: string | null;
  // Optional structural link to the payroll run/payslip this concern is about
  // (set when raised from a payslip via the mobile "Raise a query" flow).
  payroll_run_id: number | null;
  payslip_id: number | null;
}

export interface ExternalStats {
  total: number;
  by_category: Record<string, number>;
  by_month: Record<string, number>;
}

export interface DisputesResponse {
  internal: InternalDispute[];
  external_stats: ExternalStats;
  total: number;
}

// Kanban column definitions.
// Each column buckets one or more v2 statuses (`statuses[]`) for display.
// `dropTarget` is the status applied when a card is dragged into the column —
// it has to be ONE concrete status that the state machine accepts. The
// backend will still 409 illegal transitions (e.g. `closed → received`) so
// the UI doesn't need to gate transitions itself; the toast will surface
// the rejection.
export const KANBAN_COLUMNS: {
  id: string;
  label: string;
  color: string;
  statuses: DisputeStatus[];
  dropTarget: DisputeStatus;
}[] = [
  { id: "new",          label: "New",          color: "border-blue-400",
    statuses: ["received"], dropTarget: "received" },
  { id: "under-review", label: "Under Review", color: "border-amber-400",
    // dropTarget must be reachable from the card's prior column. The only
    // legal entry into the review phase is `received → triaged`; the finer
    // triaged→investigating→action_taken steps are driven from the modal.
    statuses: ["triaged", "investigating", "action_taken"], dropTarget: "triaged" },
  { id: "appealed",     label: "Appealed",     color: "border-purple-400",
    statuses: ["appealed"], dropTarget: "appealed" },
  { id: "resolved",     label: "Resolved",     color: "border-green-400",
    statuses: ["resolved", "closed"], dropTarget: "resolved" },
  { id: "rejected",     label: "Rejected",     color: "border-red-400",
    statuses: ["rejected"], dropTarget: "rejected" },
];

// Human labels per status.
export const STATUS_LABELS: Record<string, string> = {
  received: "Received",
  triaged: "Triaged",
  investigating: "Investigating",
  action_taken: "Action taken",
  appealed: "Appealed",
  resolved: "Resolved",
  rejected: "Rejected",
  closed: "Closed",
};

// Employer-drivable next states per current status — mirrors the backend
// state machine (core/concern_states.ALLOWED_TRANSITIONS). The reporter-only
// `appealed` transition is intentionally omitted. The status dropdown offers
// the current state plus these, so the UI can't request an illegal transition
// (which the backend would 409).
export const NEXT_STATUSES: Record<string, DisputeStatus[]> = {
  received: ["triaged", "rejected"],
  triaged: ["investigating", "rejected"],
  investigating: ["action_taken", "rejected"],
  action_taken: ["resolved"],
  resolved: ["closed"],
  rejected: ["closed"],
  appealed: ["investigating"],
  closed: [],
};

export const URGENCY_CONFIG: Record<string, { label: string; classes: string; border: string }> = {
  high:   { label: "High",   classes: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",     border: "border-l-red-400" },
  medium: { label: "Medium", classes: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400", border: "border-l-amber-400" },
  low:    { label: "Low",    classes: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400",    border: "border-l-gray-400" },
};
