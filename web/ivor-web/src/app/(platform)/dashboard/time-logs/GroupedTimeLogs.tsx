"use client";

/**
 * #20 — Grouped Clock-in Review.
 *
 * Renders the flat session list as per-employee/day blocks, each split into
 * activity-type sections (Normal / Overtime / Off-schedule / Auto-closed) with
 * the correct action surfaced per type. Selection + approve/reject reuse the
 * page's shared `selected` set and bulk-action bar; overtime confirmation is a
 * separate per-session action (a money decision distinct from approving the
 * clock-in).
 */
import { useState } from "react";
import type { TimeLogReviewItem } from "@/services/payroll-api";
import {
  ACTIVITY_META,
  ACTIVITY_ORDER,
  type ActivityType,
  type EmployeeDayGroup,
  needsOvertimeConfirmation,
  sessionStatus,
  sumHours,
} from "./grouping";
import { EditTimeLogButton } from "./EditTimeLogModal";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  ShieldAlert,
  Timer,
  XCircle,
  Zap,
} from "lucide-react";

const TYPE_ICON: Record<ActivityType, React.ReactNode> = {
  normal: <CheckCircle2 className="h-3.5 w-3.5" />,
  overtime: <Zap className="h-3.5 w-3.5" />,
  off_schedule: <ShieldAlert className="h-3.5 w-3.5" />,
  auto_closed: <Clock className="h-3.5 w-3.5" />,
};

const TYPE_ACCENT: Record<ActivityType, string> = {
  normal: "text-zinc-600 dark:text-gray-300",
  overtime: "text-violet-700 dark:text-violet-400",
  off_schedule: "text-yellow-700 dark:text-yellow-400",
  auto_closed: "text-orange-700 dark:text-orange-400",
};

function StatusBadge({ l }: { l: TimeLogReviewItem }) {
  const s = sessionStatus(l);
  if (s === "disputed")
    return (
      <span className="inline-flex items-center gap-1 rounded bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-400 px-2 py-0.5 text-xs">
        <AlertTriangle className="h-3 w-3" /> Disputed
      </span>
    );
  if (s === "approved")
    return (
      <span className="inline-flex items-center gap-1 rounded bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-400 px-2 py-0.5 text-xs">
        <CheckCircle2 className="h-3 w-3" /> Approved
      </span>
    );
  if (s === "rejected")
    return (
      <span className="inline-flex items-center gap-1 rounded bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400 px-2 py-0.5 text-xs">
        <XCircle className="h-3 w-3" /> Rejected
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded bg-zinc-100 dark:bg-gray-800 text-zinc-700 dark:text-gray-200 px-2 py-0.5 text-xs">
      Pending
    </span>
  );
}

function timeRange(l: TimeLogReviewItem): string {
  const s = l.start_time ? new Date(l.start_time).toLocaleTimeString() : "—";
  const e = l.end_time ? new Date(l.end_time).toLocaleTimeString() : "—";
  return `${s} → ${e}`;
}

function GroupBlock({
  group,
  selected,
  onToggleSelect,
  onSelectMany,
  onConfirmOvertime,
  onResolveDispute,
  onEdited,
  confirmingId,
}: {
  group: EmployeeDayGroup;
  selected: Set<number>;
  onToggleSelect: (id: number) => void;
  onSelectMany: (ids: number[], on: boolean) => void;
  onConfirmOvertime: (id: number) => void;
  onResolveDispute: (l: TimeLogReviewItem) => void;
  onEdited: () => void;
  confirmingId: number | null;
}) {
  const [open, setOpen] = useState(true);
  const pendingIds = group.sessions.filter((s) => sessionStatus(s) === "pending").map((s) => s.timelog_id);
  const allPendingSelected =
    pendingIds.length > 0 && pendingIds.every((id) => selected.has(id));

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
      {/* Block header — employee + day + roll-up */}
      <div className="flex items-center gap-3 px-4 py-3 bg-zinc-50 dark:bg-gray-800/50">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-zinc-400 hover:text-zinc-700 dark:hover:text-gray-200"
          aria-label={open ? "Collapse" : "Expand"}
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {group.kioskPhotoPath ? (
          <a href={`/uploads/${group.kioskPhotoPath}`} target="_blank" rel="noreferrer" title="Open full-size photo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/uploads/${group.kioskPhotoPath}`}
              alt=""
              className="w-9 h-9 rounded-full object-cover ring-1 ring-zinc-200 dark:ring-gray-700"
            />
          </a>
        ) : (
          <div className="w-9 h-9 rounded-full bg-zinc-200 dark:bg-gray-700 flex items-center justify-center text-xs font-medium text-zinc-600 dark:text-gray-300">
            {group.employeeName.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="font-medium text-zinc-900 dark:text-white truncate">
            {group.employeeName}
            {group.employeeCode && (
              <span className="ml-1.5 font-mono text-xs font-normal text-zinc-400 dark:text-gray-500">{group.employeeCode}</span>
            )}
          </p>
          <p className="text-xs text-zinc-500 dark:text-gray-400">{group.day ?? "—"}</p>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
          <span className="text-sm tabular-nums text-zinc-700 dark:text-gray-200">
            {group.totalHours.toFixed(2)}h total
          </span>
          {group.needsOvertimeCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-violet-100 dark:bg-violet-950/40 text-violet-800 dark:text-violet-400 px-2 py-0.5 text-xs">
              <Zap className="h-3 w-3" /> {group.needsOvertimeCount} OT to confirm
            </span>
          )}
          {group.disputedCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-400 px-2 py-0.5 text-xs">
              <AlertTriangle className="h-3 w-3" /> {group.disputedCount} disputed
            </span>
          )}
          {group.pendingCount > 0 ? (
            <label className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-gray-700 px-2 py-1 text-xs text-zinc-700 dark:text-gray-200 cursor-pointer hover:bg-zinc-100 dark:hover:bg-gray-800">
              <input
                type="checkbox"
                checked={allPendingSelected}
                onChange={(e) => onSelectMany(pendingIds, e.target.checked)}
              />
              Select {group.pendingCount} pending
            </label>
          ) : (
            <span className="inline-flex items-center gap-1 rounded bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-400 px-2 py-0.5 text-xs">
              <CheckCircle2 className="h-3 w-3" /> All reviewed
            </span>
          )}
        </div>
      </div>

      {/* Activity-type sections */}
      {open && (
        <div className="divide-y divide-zinc-100 dark:divide-gray-800">
          {ACTIVITY_ORDER.filter((t) => group.byType[t].length > 0).map((type) => {
            const rows = group.byType[type];
            const meta = ACTIVITY_META[type];
            return (
              <div key={type} className="px-4 py-2">
                <div className="flex items-center gap-2 mb-1.5" title={meta.hint}>
                  <span className={`inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide ${TYPE_ACCENT[type]}`}>
                    {TYPE_ICON[type]} {meta.label}
                  </span>
                  <span className="text-xs text-zinc-400 dark:text-gray-500">
                    {rows.length} · {sumHours(rows).toFixed(2)}h
                  </span>
                </div>
                <div className="space-y-1">
                  {rows.map((l) => {
                    const pending = sessionStatus(l) === "pending";
                    const disputed = sessionStatus(l) === "disputed";
                    return (
                      <div
                        key={l.timelog_id}
                        className="rounded-md px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-gray-800/40"
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            disabled={!pending}
                            checked={selected.has(l.timelog_id)}
                            onChange={() => onToggleSelect(l.timelog_id)}
                            className="disabled:opacity-30"
                          />
                          <span className="text-xs text-zinc-500 dark:text-gray-400 w-44 shrink-0">
                            {timeRange(l)}
                            {(l.scheduled_start && l.scheduled_end) && (type === "overtime" || type === "off_schedule") && (
                              <span className="block text-[10px] text-zinc-400 dark:text-gray-500">
                                scheduled {l.scheduled_start}–{l.scheduled_end}
                              </span>
                            )}
                          </span>
                          <span className="text-sm tabular-nums text-zinc-700 dark:text-gray-200 w-16 text-right">
                            {l.hours_worked?.toFixed(2) ?? "—"}h
                          </span>
                          <div className="ml-auto flex items-center gap-2">
                            {l.overtime_confirmed_by_employer && (
                              <span className="inline-flex items-center gap-1 rounded bg-violet-100 dark:bg-violet-950/40 text-violet-800 dark:text-violet-400 px-2 py-0.5 text-xs">
                                <Zap className="h-3 w-3" /> OT confirmed
                              </span>
                            )}
                            {l.is_late && (
                              <span className="inline-flex items-center gap-1 rounded bg-yellow-100 dark:bg-yellow-950/40 text-yellow-800 dark:text-yellow-400 px-2 py-0.5 text-xs">
                                <Timer className="h-3 w-3" /> Late
                              </span>
                            )}
                            <StatusBadge l={l} />
                            <EditTimeLogButton log={l} onSaved={onEdited} />
                            {needsOvertimeConfirmation(l) && (
                              <button
                                type="button"
                                onClick={() => onConfirmOvertime(l.timelog_id)}
                                disabled={confirmingId === l.timelog_id}
                                title="Confirm the overtime premium for this session. This is separate from approving the clock-in — you still approve it to feed payroll."
                                className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                              >
                                <Zap className="h-3 w-3" />
                                {confirmingId === l.timelog_id ? "Confirming…" : "Confirm OT"}
                              </button>
                            )}
                            {disputed && (
                              <button
                                type="button"
                                onClick={() => onResolveDispute(l)}
                                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                              >
                                Resolve
                              </button>
                            )}
                          </div>
                        </div>
                        {/* Employee's own explanation, collected via the mobile
                            late-start prompt — shown directly, not buried in a
                            hover tooltip, so HR doesn't miss it during review. */}
                        {l.is_late && (
                          <div className="mt-1.5 ml-7 rounded-md bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-900 px-2.5 py-1.5 text-xs text-yellow-800 dark:text-yellow-400">
                            <span className="font-semibold">Employee&apos;s reason:</span>{" "}
                            {l.late_reason || "No reason given"}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function GroupedTimeLogs({
  groups,
  selected,
  onToggleSelect,
  onSelectMany,
  onConfirmOvertime,
  onResolveDispute,
  onEdited,
  confirmingId,
}: {
  groups: EmployeeDayGroup[];
  selected: Set<number>;
  onToggleSelect: (id: number) => void;
  onSelectMany: (ids: number[], on: boolean) => void;
  onConfirmOvertime: (id: number) => void;
  onResolveDispute: (l: TimeLogReviewItem) => void;
  onEdited: () => void;
  confirmingId: number | null;
}) {
  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 dark:border-gray-800 bg-white dark:bg-gray-900 py-8 text-center text-zinc-400 dark:text-gray-500">
        No clock-ins for this filter.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <GroupBlock
          key={g.key}
          group={g}
          selected={selected}
          onToggleSelect={onToggleSelect}
          onSelectMany={onSelectMany}
          onConfirmOvertime={onConfirmOvertime}
          onResolveDispute={onResolveDispute}
          onEdited={onEdited}
          confirmingId={confirmingId}
        />
      ))}
    </div>
  );
}
