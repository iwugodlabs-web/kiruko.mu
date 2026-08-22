"use client";

/**
 * Kiosk v1.6 — Per-employee + per-job max-shift-hours overrides UI.
 *
 * Rendered as a sibling to KioskPinPanel on the employee detail view.
 * Shows two number inputs (employee-level + job-level) plus an
 * always-visible "currently using Xh from <source>" hint so admins
 * can SEE which level of the resolution chain is winning before they
 * change anything. Matches the multi-level shift cap UX in Workday /
 * ADP / BambooHR — the lazy version (inputs without the chain hint)
 * is the standard bug-source: admin sets an employee override and
 * doesn't realize a job override is taking precedence.
 *
 * Chain (mirrors `backend/services/time_log_service.py::resolve_max_shift_hours`):
 *   Job.max_shift_hours → PrivateUser.max_shift_hours →
 *   Company.default_max_shift_hours → 12h system constant.
 *
 * Initial values are passed via props from the parent EmployeesDetails;
 * the panel does not refetch on mount. After a successful save we
 * update local state optimistically — admin sees the chain hint
 * change immediately.
 */

import { Clock, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { api } from "@/services/apiClient";


// 12h fallback mirrors `_SYSTEM_DEFAULT_MAX_SHIFT_HOURS` in
// backend/services/time_log_service.py. Keep these two in sync — if
// the server constant ever changes, this number should change too.
const SYSTEM_DEFAULT_HOURS = 12;


type ChainSource = "job" | "employee" | "company" | "system";


interface ResolvedChain {
  hours: number;
  source: ChainSource;
}


/**
 * Client-side mirror of the backend resolution chain. Pure function so
 * callers can compute the resolved value reactively as inputs change
 * without round-tripping the server. ~10 LoC. If the server logic
 * changes, this must change too.
 */
function resolveMaxShiftClient(args: {
  job: number | null;
  employee: number | null;
  company: number | null;
}): ResolvedChain {
  if (args.job != null) return { hours: args.job, source: "job" };
  if (args.employee != null) return { hours: args.employee, source: "employee" };
  if (args.company != null) return { hours: args.company, source: "company" };
  return { hours: SYSTEM_DEFAULT_HOURS, source: "system" };
}


interface MaxShiftPanelProps {
  /**
   * User ID (not PrivateUser ID) — the PATCH /user/{id} endpoint
   * takes the User row's PK, and the CRUD's update_user walks the
   * PrivateUser via PrivateUser.user_id internally.
   */
  userId: number;
  /** Pass undefined when the employee has no active job assignment. */
  jobId?: number | null;
  initialEmployeeOverride?: number | null;
  initialJobOverride?: number | null;
  /** Company-wide default; read from the v1.5 SettingsSection field. */
  initialCompanyDefault?: number | null;
}


export default function MaxShiftPanel({
  userId,
  jobId,
  initialEmployeeOverride = null,
  initialJobOverride = null,
  initialCompanyDefault = null,
}: MaxShiftPanelProps) {
  // Stored as strings so the input can be cleared without snapping
  // to 0. "" === null override; saving "" persists null.
  const [employeeOverride, setEmployeeOverride] = useState<string>(
    initialEmployeeOverride != null ? String(initialEmployeeOverride) : "",
  );
  const [jobOverride, setJobOverride] = useState<string>(
    initialJobOverride != null ? String(initialJobOverride) : "",
  );
  const [savingLevel, setSavingLevel] = useState<"employee" | "job" | null>(null);

  // The chain reads from the LATEST persisted values — not the in-flight
  // input strings. Re-derived whenever a save settles.
  const [persisted, setPersisted] = useState({
    employee: initialEmployeeOverride ?? null,
    job: initialJobOverride ?? null,
    company: initialCompanyDefault ?? null,
  });

  const resolved = useMemo(
    () => resolveMaxShiftClient({
      job: persisted.job,
      employee: persisted.employee,
      company: persisted.company,
    }),
    [persisted],
  );

  // ---------------------------------------------------------------
  // Parse helper: "" → null, "8" → 8, garbage → invalid sentinel.
  // ---------------------------------------------------------------

  const parseInput = (raw: string): { ok: true; value: number | null } | { ok: false } => {
    const trimmed = raw.trim();
    if (trimmed === "") return { ok: true, value: null };
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0 || n > 24) return { ok: false };
    return { ok: true, value: n };
  };

  // ---------------------------------------------------------------
  // Save handlers (per-input — admin doesn't have to set both)
  // ---------------------------------------------------------------

  const saveEmployee = async () => {
    const parsed = parseInput(employeeOverride);
    if (!parsed.ok) {
      toast.error("Max shift hours must be between 0 and 24");
      return;
    }
    setSavingLevel("employee");
    try {
      await api.patch(`/user/${userId}`, {
        max_shift_hours: parsed.value,
      });
      setPersisted((p) => ({ ...p, employee: parsed.value }));
      toast.success(parsed.value == null ? "Cleared employee override" : "Saved employee override");
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      toast.error(e.response?.data?.detail ?? "Failed to save");
    } finally {
      setSavingLevel(null);
    }
  };

  const saveJob = async () => {
    if (!jobId) {
      toast.error("No active job to attach this override to");
      return;
    }
    const parsed = parseInput(jobOverride);
    if (!parsed.ok) {
      toast.error("Max shift hours must be between 0 and 24");
      return;
    }
    setSavingLevel("job");
    try {
      await api.patch(`/job/${jobId}/details`, { max_shift_hours: parsed.value });
      setPersisted((p) => ({ ...p, job: parsed.value }));
      toast.success(parsed.value == null ? "Cleared job override" : "Saved job override");
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      toast.error(e.response?.data?.detail ?? "Failed to save");
    } finally {
      setSavingLevel(null);
    }
  };

  // ---------------------------------------------------------------
  // Chain-hint copy generator
  // ---------------------------------------------------------------

  const sourceCopy = (source: ChainSource): string => {
    switch (source) {
      case "job":      return "this job";
      case "employee": return "this employee";
      case "company":  return "company default";
      case "system":   return "system default (no overrides set)";
    }
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500">
          <Clock size={15} />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Max Shift Hours (Auto-Close Cap)</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
            How long a clock-in can run before the system closes it automatically.
          </p>
        </div>
      </div>

      {/* Live chain hint — the load-bearing piece. Shows which level is
          winning right now so admin doesn't set an override and wonder
          why nothing changed. */}
      <div className="p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900 rounded-lg">
        <p className="text-xs text-blue-800 dark:text-blue-300">
          <strong>Currently using: {resolved.hours}h</strong>{" "}
          ({sourceCopy(resolved.source)})
          {resolved.source === "company" && persisted.company == null && (
            <span className="text-blue-600 dark:text-blue-400"> — set in Company Settings → Leave</span>
          )}
        </p>
      </div>

      {/* Employee-level override */}
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
          Employee override
          {persisted.job != null && (
            <span className="ml-1 text-amber-600 dark:text-amber-400 font-normal">
              (job override above takes precedence while it's set)
            </span>
          )}
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number" min={1} max={24} step={0.5}
            value={employeeOverride}
            placeholder="—"
            onChange={(e) => setEmployeeOverride(e.target.value)}
            className="w-24 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-center tabular-nums bg-white dark:bg-gray-800 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500"
          />
          <span className="text-xs text-gray-500 dark:text-gray-400">hours</span>
          <button
            type="button"
            onClick={saveEmployee}
            disabled={savingLevel !== null}
            className="ml-auto px-3 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md text-xs font-medium border border-gray-200 dark:border-gray-700 disabled:opacity-50 inline-flex items-center gap-1"
          >
            {savingLevel === "employee" && <Loader2 className="h-3 w-3 animate-spin" />} Save
          </button>
        </div>
      </div>

      {/* Job-level override (only if there's an active job) */}
      {jobId ? (
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
            Job override
            <span className="ml-1 text-gray-500 dark:text-gray-400 font-normal">
              (highest precedence — overrides employee + company defaults)
            </span>
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number" min={1} max={24} step={0.5}
              value={jobOverride}
              placeholder="—"
              onChange={(e) => setJobOverride(e.target.value)}
              className="w-24 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-center tabular-nums bg-white dark:bg-gray-800 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500"
            />
            <span className="text-xs text-gray-500 dark:text-gray-400">hours</span>
            <button
              type="button"
              onClick={saveJob}
              disabled={savingLevel !== null}
              className="ml-auto px-3 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md text-xs font-medium border border-gray-200 dark:border-gray-700 disabled:opacity-50 inline-flex items-center gap-1"
            >
              {savingLevel === "job" && <Loader2 className="h-3 w-3 animate-spin" />} Save
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}


