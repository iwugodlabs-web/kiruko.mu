import { resolveLiveAmount, periodMatchesBackendPeriod } from "./resolveLiveAmount";

describe("resolveLiveAmount", () => {
  it("uses the local estimate whenever it's nonzero — even a fixed-salary employee on 'This Month', the reported disagreement", () => {
    // A monthly/fixed employee with a real, nonzero local (hours-derived)
    // estimate must see THAT number in Live mode, matching the same
    // period-scoped behavior hourly/daily/weekly employees already get —
    // not the backend's fixed full-period gross. That's what the separate
    // "Salary" tab is for. Preferring backendGross here made Live and
    // Salary show nearly the same fixed number for "This Month" only,
    // breaking the "Live always reacts to the filter" invariant that
    // holds for every other period and every other pay type.
    expect(
      resolveLiveAmount({
        backendGross: 41000,
        localEstimate: 10530,
        periodMatchesBackend: true,
      })
    ).toEqual({ amount: 10530, source: "local" });
  });

  it("uses the local estimate when it's nonzero regardless of period-match", () => {
    expect(
      resolveLiveAmount({
        backendGross: 0,
        localEstimate: 3026,
        periodMatchesBackend: false,
      })
    ).toEqual({ amount: 3026, source: "local" });
  });

  it("falls back to backendGross when local is a genuine 0 but backend has real data for the matching period — the original bug", () => {
    // No clock-in data has synced to this device, but the backend knows
    // real pay exists (kiosk/web clock-ins, or fixed salary with zero
    // local signal at all).
    expect(
      resolveLiveAmount({
        backendGross: 41000,
        localEstimate: 0,
        periodMatchesBackend: true,
      })
    ).toEqual({ amount: 41000, source: "backend" });
  });

  it("does NOT fall back to backendGross when the period doesn't match — nothing to fall back to for that window", () => {
    expect(
      resolveLiveAmount({
        backendGross: 41000,
        localEstimate: 0,
        periodMatchesBackend: false,
      })
    ).toEqual({ amount: 0, source: "local" });
  });

  it("falls back to local when backendGross is null (not yet loaded)", () => {
    expect(
      resolveLiveAmount({
        backendGross: null,
        localEstimate: 0,
        periodMatchesBackend: true,
      })
    ).toEqual({ amount: 0, source: "local" });
  });

  it("shows 0 when both backend and local genuinely agree on zero (0 is falsy, so this naturally reports source 'local' either way — see the doc comment on zero_reason)", () => {
    expect(
      resolveLiveAmount({
        backendGross: 0,
        localEstimate: 0,
        periodMatchesBackend: true,
      })
    ).toEqual({ amount: 0, source: "local" });
  });
});

describe("periodMatchesBackendPeriod", () => {
  it("matches when the local range and backend period are the same calendar dates", () => {
    expect(
      periodMatchesBackendPeriod({
        localStart: new Date(2026, 6, 1, 0, 0, 0, 0), // Jul 1 local midnight
        localEnd: new Date(2026, 6, 31, 23, 59, 59, 999), // Jul 31 local end-of-day
        backendPeriod: { start: "2026-07-01", end: "2026-07-31" },
      })
    ).toBe(true);
  });

  it("does NOT match when the company has an open run for a different month than 'This Month' locally resolves to", () => {
    // It's July locally, but the company still has June's payroll run open —
    // the backend estimate is for June, not July. The exact scenario this
    // function exists to catch.
    expect(
      periodMatchesBackendPeriod({
        localStart: new Date(2026, 6, 1, 0, 0, 0, 0),
        localEnd: new Date(2026, 6, 31, 23, 59, 59, 999),
        backendPeriod: { start: "2026-06-01", end: "2026-06-30" },
      })
    ).toBe(false);
  });

  it("is timezone/time-of-day safe — only calendar dates are compared, not timestamps", () => {
    expect(
      periodMatchesBackendPeriod({
        localStart: new Date(2026, 6, 1, 23, 59, 59, 999),
        localEnd: new Date(2026, 6, 31, 0, 0, 0, 0),
        backendPeriod: { start: "2026-07-01", end: "2026-07-31" },
      })
    ).toBe(true);
  });

  it("returns false when the backend hasn't returned a period yet (null/undefined)", () => {
    expect(
      periodMatchesBackendPeriod({
        localStart: new Date(2026, 6, 1),
        localEnd: new Date(2026, 6, 31),
        backendPeriod: null,
      })
    ).toBe(false);
    expect(
      periodMatchesBackendPeriod({
        localStart: new Date(2026, 6, 1),
        localEnd: new Date(2026, 6, 31),
        backendPeriod: undefined,
      })
    ).toBe(false);
  });
});
