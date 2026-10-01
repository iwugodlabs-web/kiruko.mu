/**
 * Breadcrumb deportment: stationary drift is dropped, real movement is kept,
 * garbage coordinates never record (a bad fix in the trail is worse than none).
 */
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
    multiGet: jest.fn(() => Promise.resolve([])),
  },
}));
jest.mock("expo-task-manager", () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(() => Promise.resolve(false)),
}));
jest.mock("expo-location", () => ({
  Accuracy: { Low: 1, Balanced: 3, High: 4 },
  getForegroundPermissionsAsync: jest.fn(),
  getBackgroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
}));
jest.mock("../../apiClient", () => ({
  __esModule: true,
  api: { post: jest.fn() },
}));
import { shouldRecord } from "../breadcrumbs";

describe("shouldRecord", () => {
  it("records the first fix", () => {
    expect(shouldRecord(null, -20.16, 57.5, 1000)).toBe(true);
  });

  it("rejects non-finite and out-of-range coordinates", () => {
    expect(shouldRecord(null, NaN, 57.5, 1000)).toBe(false);
    expect(shouldRecord(null, -91, 57.5, 1000)).toBe(false);
    expect(shouldRecord(null, -20.16, 200, 1000)).toBe(false);
  });

  it("drops stationary drift within the time/distance window", () => {
    const last = { latitude: -20.16, longitude: 57.5, recordedAt: 1000 };
    // Same spot 30s later — too soon AND too close.
    expect(shouldRecord(last, -20.1601, 57.5001, 31_000)).toBe(false);
  });

  it("keeps real movement after the window", () => {
    const last = { latitude: -20.16, longitude: 57.5, recordedAt: 1000 };
    // ~1.5km away, 10 min later.
    expect(shouldRecord(last, -20.15, 57.51, 601_000)).toBe(true);
  });
});
