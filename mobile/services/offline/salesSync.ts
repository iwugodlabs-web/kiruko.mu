/**
 * Field-sales offline sync worker.
 *
 * Drains `sales_queue` by POSTing the pinned `SaleSyncItem` bodies to
 * `/companies/{id}/sales/sync`. The backend is idempotent on `client_uuid`, so
 * a batch can be safely replayed. Rows delete on accept (created OR duplicate);
 * a per-item server rejection burns an attempt and dead-letters after
 * MAX_SYNC_ATTEMPTS.
 *
 * Triggers (registered from the field-sales screen):
 *   * NetInfo online
 *   * AppState 'active'
 *   * Initial drain on registration
 *   * Manual `runOnce()` for a "Retry now" button
 *
 * Network-class vs 4xx handling mirrors the punch worker:
 *   * status 0 / 5xx → "still down", don't burn attempts, stop the drain.
 *   * 4xx → real rejection, count toward MAX_SYNC_ATTEMPTS.
 */

import NetInfo from "@react-native-community/netinfo";
import { AppState, type AppStateStatus } from "react-native";
import { syncSales, isApiError, type SyncSaleItem } from "../../api/fieldSales";
import { salesQueueStore } from "./salesQueue";

export interface SalesSyncResult {
  attempted: number;
  succeeded: number;
  failed: number;
  deadLettered: number;
  remaining: number;
}

type SyncListener = (status: {
  pending: number;
  lastResult: "ok" | "partial" | "error" | null;
}) => void;

let _inFlight: Promise<SalesSyncResult> | null = null;
let _registered = false;
let _companyId: number | null = null;
const _listeners = new Set<SyncListener>();

export const salesSyncWorker = {
  /** Bind the company the queue belongs to (a rep has exactly one employer). */
  setCompanyId: (companyId: number | null): void => {
    _companyId = companyId;
  },

  runOnce: async (): Promise<SalesSyncResult> => {
    if (_inFlight) return _inFlight;
    _inFlight = (async () => {
      try {
        const result = await _drainOnce();
        await _notify(result);
        return result;
      } catch {
        const remaining = (await salesQueueStore.listPending().catch(() => [])).length;
        const result: SalesSyncResult = {
          attempted: 0,
          succeeded: 0,
          failed: 0,
          deadLettered: 0,
          remaining,
        };
        await _notify(result, "error");
        return result;
      } finally {
        _inFlight = null;
      }
    })();
    return _inFlight;
  },

  /** Idempotent — safe to call once per screen mount. */
  register: (companyId: number | null): void => {
    _companyId = companyId;
    if (_registered) return;
    _registered = true;

    const trigger = () => {
      salesSyncWorker.runOnce().catch(() => undefined);
    };

    NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) trigger();
    });

    AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") trigger();
    });

    trigger();
  },

  onChange: (listener: SyncListener): (() => void) => {
    _listeners.add(listener);
    return () => {
      _listeners.delete(listener);
    };
  },
};

async function _drainOnce(): Promise<SalesSyncResult> {
  const snapshot = await salesQueueStore.listPending();
  if (snapshot.length === 0 || _companyId == null) {
    return { attempted: 0, succeeded: 0, failed: 0, deadLettered: 0, remaining: snapshot.length };
  }

  const items: SyncSaleItem[] = [];
  for (const row of snapshot) {
    try {
      items.push(JSON.parse(row.payloadJson) as SyncSaleItem);
    } catch {
      // Corrupt row — drop it so it can't wedge the queue forever.
      await salesQueueStore.markSynced(row.id);
    }
  }
  if (items.length === 0) {
    return { attempted: 0, succeeded: 0, failed: 0, deadLettered: 0, remaining: 0 };
  }

  const res = await syncSales(_companyId, items);
  if (isApiError(res)) {
    const networkClass =
      res.status === undefined || res.status === 0 || (res.status >= 500 && res.status < 600);
    if (networkClass) {
      // Backend down — leave attempts untouched, resume on next trigger.
      throw new Error("network_still_down");
    }
    // Batch-level 4xx (e.g. auth): burn one attempt per row and stop.
    let deadLettered = 0;
    for (const row of snapshot) {
      const nowDead = await salesQueueStore.recordFailure(row.id, `${res.status ?? 0}: ${res.error}`);
      if (nowDead) deadLettered += 1;
    }
    return {
      attempted: snapshot.length,
      succeeded: 0,
      failed: snapshot.length,
      deadLettered,
      remaining: (await salesQueueStore.listPending()).length,
    };
  }

  let succeeded = 0;
  let failed = 0;
  let deadLettered = 0;
  const byUuid = new Map(res.results.map((r) => [r.client_uuid, r]));
  for (const row of snapshot) {
    const outcome = byUuid.get(row.clientUuid) ?? byUuid.get(row.id);
    if (outcome && (outcome.outcome === "created" || outcome.outcome === "duplicate")) {
      await salesQueueStore.markSynced(row.id);
      succeeded += 1;
    } else if (outcome) {
      const nowDead = await salesQueueStore.recordFailure(row.id, outcome.detail ?? "rejected");
      failed += 1;
      if (nowDead) deadLettered += 1;
    } else {
      // Server never acknowledged this uuid — leave it for the next drain.
      failed += 1;
    }
  }

  return {
    attempted: snapshot.length,
    succeeded,
    failed,
    deadLettered,
    remaining: (await salesQueueStore.listPending()).length,
  };
}

async function _notify(
  result: SalesSyncResult,
  forceStatus?: "ok" | "partial" | "error",
): Promise<void> {
  const pending = result.remaining;
  let lastResult: "ok" | "partial" | "error" | null;
  if (forceStatus) {
    lastResult = forceStatus;
  } else if (result.attempted === 0) {
    lastResult = null;
  } else if (result.failed === 0) {
    lastResult = "ok";
  } else if (result.succeeded > 0) {
    lastResult = "partial";
  } else {
    lastResult = "error";
  }
  for (const l of _listeners) {
    try {
      l({ pending, lastResult });
    } catch {
      /* don't crash siblings */
    }
  }
}
