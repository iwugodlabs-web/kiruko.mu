/**
 * Breadcrumb deportment: stationary drift is dropped, real movement is kept,
 * garbage coordinates never record (a bad fix in the trail is worse than none).
 */
const mockStore = new Map<string, string | null>();
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((k: string) => Promise.resolve(mockStore.get(k) ?? null)),
    setItem: jest.fn((k: string, v: string) => {
      mockStore.set(k, v);
      return Promise.resolve();
    }),
    removeItem: jest.fn((k: string) => {
      mockStore.delete(k);
      return Promise.resolve();
    }),
    multiGet: jest.fn((ks: string[]) =>
      Promise.resolve(ks.map((k) => [k, mockStore.get(k) ?? null])),
    ),
  },
}));
type Crumb = { latitude: number; longitude: number; recordedAt: number };
const mockRows: Crumb[] = [];
jest.mock("expo-sqlite", () => ({
  openDatabaseSync: jest.fn(() => ({
    execAsync: jest.fn(() => Promise.resolve()),
    getAllAsync: jest.fn((sql: string, params: any[] = []) => {
      if (/DESC/i.test(sql)) {
        const sorted = [...mockRows].sort((a, b) => b.recordedAt - a.recordedAt);
        return Promise.resolve(sorted.slice(0, 1));
      }
      const [since, limit] = params;
      return Promise.resolve(
        mockRows
          .filter((r) => r.recordedAt > since)
          .sort((a, b) => a.recordedAt - b.recordedAt)
          .slice(0, limit),
      );
    }),
    runAsync: jest.fn(() => Promise.resolve()),
  })),
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
import { api } from "../../apiClient";
import { shouldRecord, uploadPendingTrail } from "../breadcrumbs";

const mockPost = api.post as unknown as jest.Mock;

beforeEach(() => {
  mockStore.clear();
  mockRows.length = 0;
  mockPost.mockReset().mockResolvedValue({});
});

describe("uploadPendingTrail", () => {
  it("uploads everything pending and advances the cursor", async () => {
    mockStore.set("activeTimeLogId", "42");
    mockRows.push(
      { latitude: -20.1, longitude: 57.5, recordedAt: 1000 },
      { latitude: -20.2, longitude: 57.5, recordedAt: 2000 },
    );
    expect(await uploadPendingTrail()).toBe(2);
    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(mockPost).toHaveBeenNthCalledWith(
      1,
      "/job/time-log/42/breadcrumb",
      expect.objectContaining({ latitude: -20.1 }),
    );
    expect(mockStore.get("trailUploadedAt")).toBe("2000");
  });

  it("does nothing without an open session", async () => {
    mockRows.push({ latitude: -20.1, longitude: 57.5, recordedAt: 1000 });
    expect(await uploadPendingTrail()).toBe(0);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("resumes after a mid-batch failure without re-uploading", async () => {
    mockStore.set("activeTimeLogId", "42");
    mockRows.push(
      { latitude: -20.1, longitude: 57.5, recordedAt: 1000 },
      { latitude: -20.2, longitude: 57.5, recordedAt: 2000 },
      { latitude: -20.3, longitude: 57.5, recordedAt: 3000 },
    );
    mockPost
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("flaky"))
      .mockResolvedValue({});
    expect(await uploadPendingTrail()).toBe(1);
    expect(mockStore.get("trailUploadedAt")).toBe("1000");
    // Next run resumes after the cursor — the failed crumb retries, the
    // uploaded one does not.
    expect(await uploadPendingTrail()).toBe(2);
    expect(mockPost).toHaveBeenCalledTimes(4);
  });
});

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
