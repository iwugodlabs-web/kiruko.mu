/**
 * M31 — Kiosk offline-queue sync worker (Expo port).
 *
 * Drains `offlineQueue` rows oldest-first by re-POSTing through
 * `kioskApi.clockIn` / `kioskApi.clockOut`. Idempotency-Key is
 * preserved per row, so the backend dedup cache returns the original
 * TimeLog rather than creating a duplicate.
 *
 * Triggers (registered once, on `syncWorker.register()`):
 *   * NetInfo `connectionChange` → fires when network state flips
 *   * AppState 'active' → covers "tablet wakes from sleep"
 *   * Initial call on registration → drains anything left over
 *   * Manual `runOnce()` for a future "Retry now" UI button
 *
 * Concurrency: singleton with `_inFlight` coalescing — concurrent
 * triggers wait for the in-flight drain instead of launching parallel
 * POST loops.
 *
 * Network-class vs 4xx handling matches web exactly:
 *   * status 0 or 5xx → "still down" — DO NOT count against dead-letter
 *     budget, stop draining further rows (the backend is the bottleneck,
 *     not us). Resume on the next trigger.
 *   * 4xx → real rejection (revoked token, deleted employee, etc.) —
 *     count the attempt; row dead-letters after MAX_SYNC_ATTEMPTS.
 */

import NetInfo from "@react-native-community/netinfo";
import { AppState, type AppStateStatus } from "react-native";
import {
  isKioskApiError,
  kioskApi,
} from "./kioskApi";
import {
  offlineQueue,
  type QueuedClockEntry,
} from "./offlineQueue";

export interface SyncResult {
  attempted: number;
  succeeded: number;
  failed: number;
  remaining: number;
}

type SyncListener = (status: { pending: number; lastResult: "ok" | "partial" | "error" | null }) => void;

let _inFlight: Promise<SyncResult> | null = null;
let _registered = false;
const _listeners = new Set<SyncListener>();

async function _drainOnce(): Promise<SyncResult> {
  const pending = await offlineQueue.listPending();
  if (pending.length === 0) {
    return { attempted: 0, succeeded: 0, failed: 0, remaining: 0 };
  }
  let succeeded = 0;
  let failed = 0;
  for (const row of pending) {
    const ok = await _syncRow(row);
    if (ok) succeeded += 1;
    else failed += 1;
  }
  const remaining = (await offlineQueue.listPending()).length;
  return { attempted: pending.length, succeeded, failed, remaining };
}

async function _syncRow(row: QueuedClockEntry): Promise<boolean> {
  const r =
    row.action === "clock_out"
      ? await kioskApi.clockOut(
          {
            private_user_id: row.payload.private_user_id,
            pin: row.payload.pin,
            location: row.payload.location,
          },
          row.idempotencyKey,
        )
      : await kioskApi.clockIn(row.payload, row.idempotencyKey);

  if (isKioskApiError(r)) {
    const networkClass =
      r.status === undefined || r.status === 0 || (r.status >= 500 && r.status < 600);
    if (networkClass) {
      // Don't penalize the row — the backend is the problem. Bail out
      // of the drain entirely so we don't burn attempts.
      throw new Error("network_still_down");
    }
    await offlineQueue.recordFailure(row.id, `${r.status ?? 0}: ${r.error}`);
    return false;
  }
  // Success — including the idempotency replay path (backend returns
  // the original TimeLog).
  await offlineQueue.markSynced(row.id);
  return true;
}

export const syncWorker = {
  /**
   * Drain the queue now. Coalesces with in-flight drains so multiple
   * concurrent triggers don't launch parallel POST loops.
   */
  runOnce: async (): Promise<SyncResult> => {
    if (_inFlight) return _inFlight;
    _inFlight = (async () => {
      try {
        const result = await _drainOnce();
        await _notify(result);
        return result;
      } catch {
        // network_still_down thrown mid-drain — stop, report partial.
        const remaining = (await offlineQueue.listPending().catch(() => [])).length;
        const result: SyncResult = { attempted: 0, succeeded: 0, failed: 0, remaining };
        await _notify(result, "error");
        return result;
      } finally {
        _inFlight = null;
      }
    })();
    return _inFlight;
  },

  /**
   * Register the auto-drain triggers exactly once per app launch.
   * Idempotent — calling again is a no-op. Called from
   * `app/kiosk/_layout.tsx` so the worker is only live inside the
   * kiosk subtree, not in the regular user-auth app.
   */
  register: (): void => {
    if (_registered) return;
    _registered = true;

    const trigger = () => {
      // Fire-and-forget. UI subscribes via onChange for status updates.
      syncWorker.runOnce().catch(() => undefined);
    };

    NetInfo.addEventListener((state: { isConnected: boolean | null; isInternetReachable: boolean | null }) => {
      if (state.isConnected && state.isInternetReachable !== false) trigger();
    });

    AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") trigger();
    });

    // Drain anything left from a prior session immediately.
    trigger();
  },

  /**
   * Subscribe to drain events for UI (banner state). Returns
   * unsubscribe.
   */
  onChange: (listener: SyncListener): (() => void) => {
    _listeners.add(listener);
    return () => {
      _listeners.delete(listener);
    };
  },
};

async function _notify(
  result: SyncResult,
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
