/**
 * Decides whether the "take a break" reminder banner should show.
 * Extracted as a pure function so this logic is unit-testable without
 * rendering the clock-in screen — see resolveShowBreakAlert.test.ts.
 *
 * hasCompletedBreakThisSession is the piece that was missing before: the
 * reminder used to only check "is a break active right now" (isBreaking),
 * with no memory of a break already having happened earlier in the same
 * clock-in session — so ending a break made it reappear a minute later.
 */
export function resolveShowBreakAlert(params: {
  isClockedIn: boolean;
  isBreaking: boolean;
  breakAlertDismissed: boolean;
  hasCompletedBreakThisSession: boolean;
  elapsedMinutesSinceClockIn: number;
  minBreakThresholdMinutes: number;
}): boolean {
  const {
    isClockedIn,
    isBreaking,
    breakAlertDismissed,
    hasCompletedBreakThisSession,
    elapsedMinutesSinceClockIn,
    minBreakThresholdMinutes,
  } = params;
  return (
    isClockedIn &&
    !isBreaking &&
    !breakAlertDismissed &&
    !hasCompletedBreakThisSession &&
    elapsedMinutesSinceClockIn >= minBreakThresholdMinutes
  );
}
