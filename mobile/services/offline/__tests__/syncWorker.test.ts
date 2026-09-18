/**
 * Employee offline punch sync worker — covers the two integrity fixes:
 *   Fix #1 (snapshot drain): each queued row is attempted AT MOST ONCE per
 *          drain, so a transient 4xx can't burn the whole retry budget in one
 *          tight loop.
 *   Fix #3 (dead-letter reconciliation): when a row is dropped after exhausting
 *          retries, the optimistic local clock state is reverted and a
 *          dead-letter event is emitted for the visible alert.
 *
 * The worker is tested in isolation: punchQueue (SQLite) and the API client are
 * mocked, so these assert the worker's control flow, not the DB.
 */

jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { addEventListener: jest.fn() },
}));
jest.mock("react-native", () => ({
  AppState: { addEventListener: jest.fn() },
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
    getItem: jest.fn(() => Promise.resolve(null)),
  },
}));
jest.mock("../../api", () => ({
  __esModule: true,
  postClockIn: jest.fn(),
  postClockOut: jest.fn(),
}));
jest.mock("../punchQueue", () => ({
  __esModule: true,
  punchQueueStore: {
    listPending: jest.fn(),
    getById: jest.fn(),
    recordFailure: jest.fn(),
    markSynced: jest.fn(),
    resolveClockOuts: jest.fn(),
  },
  MAX_SYNC_ATTEMPTS: 3,
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as api from "../../api";
import { punchQueueStore } from "../punchQueue";
import { punchSyncWorker, type DeadLetter } from "../syncWorker";

const mockAsyncStorage = AsyncStorage as unknown as {
  setItem: jest.Mock;
  removeItem: jest.Mock;
  getItem: jest.Mock;
};
const mockApi = api as unknown as { postClockIn: jest.Mock; postClockOut: jest.Mock };
const mockQueue = punchQueueStore as unknown as {
  listPending: jest.Mock;
  getById: jest.Mock;
  recordFailure: jest.Mock;
  markSynced: jest.Mock;
  resolveClockOuts: jest.Mock;
};

type Row = {
  id: string;
  action: "clock_in" | "clock_out";
  timelogId: number | null;
  dependsOnKey: string | null;
  payloadJson: string;
  idempotencyKey: string;
  attempts: number;
  lastError: string | null;
  createdAt: number;
  deadLettered: boolean;
};

function makeRow(over: Partial<Row>): Row {
  return {
    id: over.id ?? "row-1",
    action: over.action ?? "clock_out",
    timelogId: over.timelogId ?? null,
    dependsOnKey: over.dependsOnKey ?? null,
    payloadJson: over.payloadJson ?? JSON.stringify({ end_time: "2026-09-17T17:00:00Z" }),
    idempotencyKey: over.idempotencyKey ?? "key-1",
    attempts: over.attempts ?? 0,
    lastError: over.lastError ?? null,
    createdAt: over.createdAt ?? 1000,
    deadLettered: over.deadLettered ?? false,
  };
}

/** Subscribe, run a drain, return the last status the worker emitted. */
async function drainAndCapture() {
  const events: {
    pending: number;
    lastResult: string | null;
    deadLetters: DeadLetter[];
  }[] = [];
  const unsub = punchSyncWorker.onChange((s) => events.push(s));
  const result = await punchSyncWorker.runOnce();
  unsub();
  return { result, last: events[events.length - 1] };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQueue.recordFailure.mockResolvedValue(false);
  mockQueue.markSynced.mockResolvedValue(undefined);
  mockQueue.resolveClockOuts.mockResolvedValue(0);
  mockQueue.getById.mockResolvedValue(null);
});

describe("fix #1 — snapshot drain (one attempt per row)", () => {
  it("does NOT retry a 4xx-failing row within the same drain", async () => {
    const r1 = makeRow({ id: "a", timelogId: 11 });
    const r2 = makeRow({ id: "b", timelogId: 22 });
    // snapshot first, then the post-drain "remaining" count (r1 still there).
    mockQueue.listPending
      .mockResolvedValueOnce([r1, r2])
      .mockResolvedValueOnce([r1]);
    mockApi.postClockOut.mockImplementation((timelogId: number) =>
      timelogId === 11
        ? Promise.resolve({ error: "rejected", status: 400 })
        : Promise.resolve({ timelog_id: 22 }),
    );

    const { result } = await drainAndCapture();

    // The failing row is attempted exactly once — not MAX_SYNC_ATTEMPTS times.
    expect(mockApi.postClockOut).toHaveBeenCalledTimes(2);
    expect(mockQueue.recordFailure).toHaveBeenCalledTimes(1);
    expect(mockQueue.recordFailure).toHaveBeenCalledWith("a", expect.stringContaining("400"));
    expect(mockQueue.markSynced).toHaveBeenCalledWith("b");
    expect(result).toMatchObject({ attempted: 2, succeeded: 1, failed: 1 });
  });

  it("bails the whole drain on a network-class error without burning attempts", async () => {
    const r1 = makeRow({ id: "a", timelogId: 11 });
    const r2 = makeRow({ id: "b", timelogId: 22 });
    mockQueue.listPending.mockResolvedValue([r1, r2]);
    mockApi.postClockOut.mockResolvedValue({ error: "server down", status: 503 });

    const { last } = await drainAndCapture();

    // Stopped after the first row; nothing recorded against the retry budget.
    expect(mockApi.postClockOut).toHaveBeenCalledTimes(1);
    expect(mockQueue.recordFailure).not.toHaveBeenCalled();
    expect(last.lastResult).toBe("error");
  });
});

describe("fix #3 — dead-letter reconciliation", () => {
  it("clock_out dead-letter restores the still-open session locally + emits event", async () => {
    const r = makeRow({ id: "a", action: "clock_out", timelogId: 55 });
    mockQueue.listPending.mockResolvedValueOnce([r]).mockResolvedValueOnce([]);
    mockApi.postClockOut.mockResolvedValue({ error: "rejected", status: 400 });
    mockQueue.recordFailure.mockResolvedValue(true); // this attempt tips it dead

    const { result, last } = await drainAndCapture();

    // Server session is still open → employee is still clocked in.
    expect(mockAsyncStorage.setItem).toHaveBeenCalledWith("activeTimeLogId", "55");
    expect(mockAsyncStorage.setItem).toHaveBeenCalledWith("isClockedIn", "true");
    expect(result.deadLettered).toBe(1);
    expect(last.deadLetters).toEqual([{ action: "clock_out", timelogId: 55 }]);
  });

  it("clock_in dead-letter clears the optimistic clocked-in state + emits event", async () => {
    const r = makeRow({
      id: "a",
      action: "clock_in",
      payloadJson: JSON.stringify({ start_time: "2026-09-17T08:00:00Z" }),
    });
    mockQueue.listPending.mockResolvedValueOnce([r]).mockResolvedValueOnce([]);
    mockApi.postClockIn.mockResolvedValue({ error: "rejected", status: 403 });
    mockQueue.recordFailure.mockResolvedValue(true);

    const { last } = await drainAndCapture();

    expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith("activeTimeLogId");
    expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith("pendingClockInKey");
    expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith("isClockedIn");
    expect(last.deadLetters).toEqual([{ action: "clock_in", timelogId: null }]);
  });

  it("a retryable (not-yet-dead) 4xx does NOT reconcile or emit a dead-letter", async () => {
    const r = makeRow({ id: "a", action: "clock_out", timelogId: 55 });
    mockQueue.listPending.mockResolvedValueOnce([r]).mockResolvedValueOnce([r]);
    mockApi.postClockOut.mockResolvedValue({ error: "rejected", status: 400 });
    mockQueue.recordFailure.mockResolvedValue(false); // still has attempts left

    const { result, last } = await drainAndCapture();

    expect(mockAsyncStorage.setItem).not.toHaveBeenCalled();
    expect(result.deadLettered).toBe(0);
    expect(last.deadLetters).toEqual([]);
  });
});

describe("dependency chain — clock_in resolves a pending clock_out", () => {
  it("relays the server timelog_id and then drains the dependent clock_out", async () => {
    const clockIn = makeRow({ id: "ci", action: "clock_in", idempotencyKey: "K" });
    const clockOut = makeRow({
      id: "co",
      action: "clock_out",
      timelogId: null,
      dependsOnKey: "K",
    });
    mockQueue.listPending
      .mockResolvedValueOnce([clockIn, clockOut]) // snapshot
      .mockResolvedValueOnce([]); // remaining
    mockApi.postClockIn.mockResolvedValue({ timelog_id: 99 });
    mockApi.postClockOut.mockResolvedValue({ timelog_id: 99 });
    // After the clock_in syncs, re-reading the dependent row shows the real id.
    mockQueue.getById.mockResolvedValue({ ...clockOut, timelogId: 99 });

    const { result } = await drainAndCapture();

    expect(mockQueue.resolveClockOuts).toHaveBeenCalledWith("K", 99);
    expect(mockAsyncStorage.setItem).toHaveBeenCalledWith("activeTimeLogId", "99");
    expect(mockApi.postClockOut).toHaveBeenCalledWith(
      99,
      expect.anything(),
      expect.any(String),
    );
    expect(result).toMatchObject({ succeeded: 2, failed: 0 });
  });

  it("skips a clock_out whose clock_in is still pending", async () => {
    const clockOut = makeRow({
      id: "co",
      action: "clock_out",
      timelogId: null,
      dependsOnKey: "K",
    });
    mockQueue.listPending
      .mockResolvedValueOnce([clockOut])
      .mockResolvedValueOnce([clockOut]);
    mockQueue.getById.mockResolvedValue({ ...clockOut, timelogId: null });

    const { result } = await drainAndCapture();

    expect(mockApi.postClockOut).not.toHaveBeenCalled();
    expect(result.attempted).toBe(0);
  });
});
