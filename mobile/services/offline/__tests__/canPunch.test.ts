import { canPunch } from "../canPunch";

const ok = {
  locationAuthorized: true,
  currentCoordinates: { latitude: -20.16, longitude: 57.5 },
  jobId: 42,
  isLoading: false,
};

describe("canPunch — offline gate contract", () => {
  it("enables when all prerequisites are met", () => {
    expect(canPunch(ok)).toBe(true);
  });

  it("stays enabled OFFLINE: jobId from cache + GPS coords is enough (no network input)", () => {
    // The regression this guards: jobId was server-only, so offline it was null
    // and both buttons were disabled — the offline queue could never run. With
    // jobId hydrated from the per-user cache, the gate opens with no network.
    expect(canPunch({ ...ok, jobId: 7 })).toBe(true);
  });

  it("disables when jobId is missing (nothing cached, offline first launch)", () => {
    expect(canPunch({ ...ok, jobId: null })).toBe(false);
  });

  it("disables without a location fix", () => {
    expect(canPunch({ ...ok, currentCoordinates: null })).toBe(false);
  });

  it("disables when location permission not granted", () => {
    expect(canPunch({ ...ok, locationAuthorized: false })).toBe(false);
    expect(canPunch({ ...ok, locationAuthorized: null })).toBe(false);
  });

  it("disables while a load is in flight", () => {
    expect(canPunch({ ...ok, isLoading: true })).toBe(false);
  });
});
