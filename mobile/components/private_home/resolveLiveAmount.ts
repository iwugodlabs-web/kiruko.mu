/**
 * Resolves the PaySummary headline "live" earnings figure, plus which
 * source it came from (so callers — the Detailed Breakdown — can render
 * from the exact same source instead of separately re-deriving the same
 * decision, which is what let the two drift apart the first time). Pure
 * function so this logic is unit-testable without rendering the
 * component — see resolveLiveAmount.test.ts.
 *
 * "Live" mode means the same thing for every pay type: earned-so-far
 * within the SELECTED Time Period, reacting to every filter pill exactly
 * like it already does for hourly/daily/weekly staff. That's true for
 * monthly/fixed-salary employees too, even though real payroll doesn't
 * pay them incrementally — the local, hours-derived estimate is still the
 * right APPROXIMATION of "how much of this period's pay has accrued so
 * far," and it's what the Detailed Breakdown (Regular/Overtime/
 * Allowances) already sums to unconditionally. The separate "Salary" tab
 * exists specifically to show the fixed, period-independent contractual
 * reference figure — that's the right home for "the number payroll will
 * actually pay," not "Live" for one particular filter. Deferring to
 * backendGross whenever the selected period matched "This Month" made
 * Live and Salary show almost the same fixed number for that one filter,
 * which defeats the purpose of having two tabs at all, and broke the
 * "Live always reacts to the filter" invariant that holds for every other
 * pay type and every other period.
 *
 * The one case backendGross is still needed: the local estimate is a
 * genuine 0 (e.g. no clock-in data has synced to this device yet) but the
 * backend knows real pay exists for this exact period (kiosk/web
 * clock-ins, or a fixed salary with no local signal at all) — the
 * original bug this whole thing started from (commit afffb2e3). Without
 * that fallback the headline would show a bare, misleading "Rs0.00".
 *
 * No zero_reason handling here (unlike an earlier version of this
 * function): zero_reason is only ever set by the backend when gross is
 * itself 0, and a 0 backendGross is already falsy, so a
 * `backendGross && ...` check naturally skips it — there's no case where
 * showing "0 from the backend" vs "0 from local" would ever look
 * different to the user. PaySummary reads payslipEstimate.zero_reason
 * directly for the explanatory "why is this 0" text, independent of this
 * function's return value.
 */
export function resolveLiveAmount(params: {
  backendGross: number | null;
  localEstimate: number;
  periodMatchesBackend: boolean;
}): { amount: number; source: "local" | "backend" } {
  const { backendGross, localEstimate, periodMatchesBackend } = params;

  if (localEstimate > 0) {
    return { amount: localEstimate, source: "local" };
  }
  if (periodMatchesBackend && backendGross) {
    return { amount: backendGross, source: "backend" };
  }
  return { amount: localEstimate, source: "local" };
}

const toLocalDateStr = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/**
 * Whether the selected Time Period pill's date range is the SAME window
 * `payslipEstimate` was actually computed for. Deliberately compares the
 * backend's real returned `period.start`/`period.end` instead of assuming
 * "This Month" pill always equals the current calendar month — the backend
 * prefers an OPEN PAYROLL RUN's period over the calendar month when one
 * exists (see payslip_estimate.py::_target_window), and runs are commonly
 * open for real stretches around month-end/month-start. During that window,
 * a company mid-June-payroll while it's already July would have the
 * backend return June's gross; a naive `selectedFilter === "month"` check
 * would wrongly show that as if it were July's "This Month" figure.
 *
 * Compares calendar dates only (YYYY-MM-DD, local time) — backend period
 * dates are timezone-naive `date` values, not timestamps, so comparing raw
 * Date objects (with time-of-day) would risk a false negative near
 * midnight/timezone boundaries.
 */
export function periodMatchesBackendPeriod(params: {
  localStart: Date;
  localEnd: Date;
  backendPeriod: { start?: string; end?: string } | null | undefined;
}): boolean {
  const { localStart, localEnd, backendPeriod } = params;
  if (!backendPeriod?.start || !backendPeriod?.end) return false;
  return (
    toLocalDateStr(localStart) === backendPeriod.start &&
    toLocalDateStr(localEnd) === backendPeriod.end
  );
}
