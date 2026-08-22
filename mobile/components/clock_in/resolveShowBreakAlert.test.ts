import { resolveShowBreakAlert } from "./resolveShowBreakAlert";

const BASE = {
  isClockedIn: true,
  isBreaking: false,
  breakAlertDismissed: false,
  hasCompletedBreakThisSession: false,
  elapsedMinutesSinceClockIn: 240,
  minBreakThresholdMinutes: 180,
};

describe("resolveShowBreakAlert", () => {
  it("shows the reminder once the threshold has passed and no break has happened yet", () => {
    expect(resolveShowBreakAlert(BASE)).toBe(true);
  });

  it("does NOT show while a break is currently active", () => {
    expect(resolveShowBreakAlert({ ...BASE, isBreaking: true })).toBe(false);
  });

  it("does NOT reappear after a break was already completed this session — the reported bug", () => {
    // Break started and finished earlier; elapsed time is still past the
    // threshold, but a break has already happened this session.
    expect(
      resolveShowBreakAlert({ ...BASE, isBreaking: false, hasCompletedBreakThisSession: true })
    ).toBe(false);
  });

  it("respects manual dismissal", () => {
    expect(resolveShowBreakAlert({ ...BASE, breakAlertDismissed: true })).toBe(false);
  });

  it("does not show before the threshold is reached", () => {
    expect(resolveShowBreakAlert({ ...BASE, elapsedMinutesSinceClockIn: 60 })).toBe(false);
  });

  it("does not show when not clocked in", () => {
    expect(resolveShowBreakAlert({ ...BASE, isClockedIn: false })).toBe(false);
  });
});
