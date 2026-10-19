/**
 * Field-sales offline sync worker — control-flow in isolation (the SQLite queue
 * and the API client are mocked). Covers the integrity guarantees that the
 * backend route smoke can't see from the client side:
 *   1. a successful batch marks every row synced and drains the queue
 *   2. backend-down (0 / 5xx) must NOT burn retry attempts — rows stay queued
 *   3. a per-item 4xx rejection burns one attempt and dead-letters on exhaustion
 */

jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { addEventListener: jest.fn() },
}));
jest.mock("react-native", () => ({
  AppState: { addEventListener: jest.fn() },
}));
jest.mock("../../../api/fieldSales", () => ({
  __esModule: true,
  syncSales: jest.fn(),
  // An API error is any result object carrying an `error` field.
  isApiError: (r: any) => !!r && typeof r === "object" && "error" in r,
}));
jest.mock("../salesQueue", () => ({
  __esModule: true,
  MAX_SYNC_ATTEMPTS: 3,
  salesQueueStore: {
    listPending: jest.fn(),
    markSynced: jest.fn(() => Promise.resolve()),
    recordFailure: jest.fn(() => Promise.resolve(false)),
  },
}));

import { syncSales } from "../../../api/fieldSales";
import { salesQueueStore } from "../salesQueue";
import { salesSyncWorker } from "../salesSync";

const mSync = syncSales as jest.Mock;
const mList = salesQueueStore.listPending as jest.Mock;
const mMarked = salesQueueStore.markSynced as jest.Mock;
const mFail = salesQueueStore.recordFailure as jest.Mock;

function qrow(uuid: string) {
  return {
    id: uuid,
    clientUuid: uuid,
    attempts: 0,
    payloadJson: JSON.stringify({
      client_uuid: uuid,
      rep_private_user_id: 1,
      sold_at: "2026-05-10T09:00:00Z",
      lines: [{ variant_id: 1, quantity: 1 }],
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mMarked.mockResolvedValue(undefined);
  mFail.mockResolvedValue(false);
  salesSyncWorker.setCompanyId(3);
});

test("successful batch marks every row synced and drains the queue", async () => {
  mList
    .mockResolvedValueOnce([qrow("uuid-aaaaaaa1"), qrow("uuid-bbbbbbb2")]) // snapshot
    .mockResolvedValue([]); // remaining after
  mSync.mockResolvedValue({
    accepted: 2,
    duplicates: 0,
    errors: 0,
    results: [
      { client_uuid: "uuid-aaaaaaa1", outcome: "created" },
      { client_uuid: "uuid-bbbbbbb2", outcome: "duplicate" },
    ],
  });

  const res = await salesSyncWorker.runOnce();

  expect(mSync).toHaveBeenCalledTimes(1);
  expect(mMarked).toHaveBeenCalledTimes(2);
  expect(mFail).not.toHaveBeenCalled();
  expect(res.succeeded).toBe(2);
  expect(res.remaining).toBe(0);
});

test("backend down (5xx) does not burn attempts; rows stay queued", async () => {
  mList.mockResolvedValue([qrow("uuid-ccccccc3")]);
  mSync.mockResolvedValue({ error: "upstream", status: 503 });

  const res = await salesSyncWorker.runOnce();

  expect(mFail).not.toHaveBeenCalled(); // attempts untouched
  expect(mMarked).not.toHaveBeenCalled();
  expect(res.remaining).toBe(1); // still pinned for the next trigger
});

test("per-item rejection burns an attempt and dead-letters when exhausted", async () => {
  mList
    .mockResolvedValueOnce([qrow("uuid-ddddddd4")])
    .mockResolvedValue([]);
  mSync.mockResolvedValue({
    accepted: 0,
    duplicates: 0,
    errors: 1,
    results: [{ client_uuid: "uuid-ddddddd4", outcome: "error", detail: "bad variant" }],
  });
  mFail.mockResolvedValue(true); // this failure exhausts the retry budget

  const res = await salesSyncWorker.runOnce();

  expect(mFail).toHaveBeenCalledTimes(1);
  expect(mMarked).not.toHaveBeenCalled();
  expect(res.failed).toBe(1);
  expect(res.deadLettered).toBe(1);
});
