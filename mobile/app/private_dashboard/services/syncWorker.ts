/**
 * Employee offline clock-out sync worker (Feature 1).
 *
 * Drains the punch_queue oldest-first by re-POSTing through the authed
 * `postClockOut` client (services/api.tsx). The Idempotency-Key is preserved
 * per row, so the backend dedup cache returns the original response rather than
 * double-applying the clock-out.
 *
 * Triggers (registered once via `register()` in private_dashboard/_layout.tsx):
 *   * NetInfo online
 *   * AppState 'active'
 *   * Initial drain on registration
 *   * Manual `runOnce()` for a future "Retry now" UI button
 *
 * Network-class vs 4xx handling matches the kiosk worker:
 *   * status 0 / 5xx → "still down", don't burn attempts, stop the drain.
 *   * 4xx → real rejection, count toward MAX_SYNC_ATTEMPTS (dead-letter).
 */

import NetInfo from "@react-native-community/netinfo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, type AppStateStatus } from "react-native";
import { postClockIn, postClockOut } from "../../../services/api";
import { punchQueueStore, type QueuedPunch } from "./punchQueue";

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

function isApiError(r: unknown): r is { error: string; status?: number } {
  return typeof r === "object" && r !== null && "error" in (r as Record<string, unknown>);
}

async function _drainOnce(): Promise<SyncResult> {
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  // Re-fetch the oldest pending row each iteration: syncing a clock_in resolves
  // downstream clock_outs (dependsOnKey → real timelog_id), so they must be
  // re-read before draining.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const pending = await punchQueueStore.listPending();
    if (pending.length === 0) break;
    const row = pending[0];
    if (row.action === "clock_out" && row.timelogId == null) {
      // Still waiting on a pending (or dead-lettered) clock-in — leave it and
      // stop so we don't spin.
      break;
    }
    attempted += 1;
    const ok = await _syncRow(row);
    if (ok) succeeded += 1;
    else failed += 1;
  }
  const remaining = (await punchQueueStore.listPending()).length;
  return { attempted, succeeded, failed, remaining };
}

async function _syncRow(row: QueuedPunch): Promise<boolean> {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(row.payloadJson);
  } catch {
    /* fall through with empty payload */
  }

  const r =
    row.action === "clock_in"
      ? await postClockIn(payload, row.idempotencyKey)
      : await postClockOut(
          row.timelogId ?? 0,
          payload as { end_time: string; location?: any; geo_check?: any },
          row.idempotencyKey,
        );

  if (isApiError(r)) {
    const networkClass =
      r.status === undefined || r.status === 0 || (r.status >= 500 && r.status < 600);
    if (networkClass) {
      // Backend is the problem — bail out without burning attempts.
      throw new Error("network_still_down");
    }
    await punchQueueStore.recordFailure(row.id, `${r.status ?? 0}: ${r.error}`);
    return false;
  }
  // Success — including the idempotency replay path and "deferred" results
  // (the server accepted the correction and routed it to review).
  if (row.action === "clock_in") {
    // Resolve the client-generated temp id to the server's real timelog_id so
    // a later clock-out targets the right session.
    const realId = (r as { timelog_id?: number })?.timelog_id;
    if (realId) {
      try {
        await AsyncStorage.setItem("activeTimeLogId", String(realId));
        await AsyncStorage.removeItem("pendingClockInKey");
      } catch {
        /* best-effort */
      }
      // Relay the real id onto any clock-out queued against this pending clock-in.
      await punchQueueStore.resolveClockOuts(row.idempotencyKey, realId);
    }
  }
  await punchQueueStore.markSynced(row.id);
  return true;
}

export const punchSyncWorker = {
  runOnce: async (): Promise<SyncResult> => {
    if (_inFlight) return _inFlight;
    _inFlight = (async () => {
      try {
        const result = await _drainOnce();
        await _notify(result);
        return result;
      } catch {
        const remaining = (await punchQueueStore.listPending().catch(() => [])).length;
        const result: SyncResult = { attempted: 0, succeeded: 0, failed: 0, remaining };
        await _notify(result, "error");
        return result;
      } finally {
        _inFlight = null;
      }
    })();
    return _inFlight;
  },

  /** Idempotent — safe to call once per app launch. */
  register: (): void => {
    if (_registered) return;
    _registered = true;

    const trigger = () => {
      punchSyncWorker.runOnce().catch(() => undefined);
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

async function _notify(result: SyncResult, forceStatus?: "ok" | "partial" | "error"): Promise<void> {
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
