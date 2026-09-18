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
import { postClockIn, postClockOut } from "../api";
import { punchQueueStore, type QueuedAction, type QueuedPunch } from "./punchQueue";

export interface SyncResult {
  attempted: number;
  succeeded: number;
  failed: number;
  deadLettered: number;
  remaining: number;
}

/** A punch that exhausted its retry budget and was dropped. The UI reverts the
 * optimistic clock state and alerts the employee to redo it (guard #3). */
export interface DeadLetter {
  action: QueuedAction;
  timelogId: number | null;
}

type SyncListener = (status: {
  pending: number;
  lastResult: "ok" | "partial" | "error" | null;
  deadLetters: DeadLetter[];
}) => void;

type RowOutcome = "ok" | "retry" | "dead";

let _inFlight: Promise<SyncResult> | null = null;
let _registered = false;
const _listeners = new Set<SyncListener>();

function isApiError(r: unknown): r is { error: string; status?: number } {
  return typeof r === "object" && r !== null && "error" in (r as Record<string, unknown>);
}

async function _drainOnce(): Promise<{ result: SyncResult; deadLetters: DeadLetter[] }> {
  // Snapshot the queue ONCE (oldest-first) and attempt each row at most once per
  // drain. Re-reading the head every iteration (the old approach) meant a row
  // that failed a transient 4xx — e.g. a token that expired mid-drain — was
  // retried immediately, burning all MAX_SYNC_ATTEMPTS in one tight loop and
  // dead-lettering a legitimate punch. Spacing retries across triggers (network
  // flip, app foreground) is exactly what the attempt budget is for.
  const snapshot = await punchQueueStore.listPending();
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  const deadLetters: DeadLetter[] = [];

  for (const snap of snapshot) {
    let row = snap;
    if (row.action === "clock_out" && row.timelogId == null) {
      // A clock_in synced earlier in THIS drain may have resolved this
      // clock_out's timelog_id — re-read before deciding.
      const fresh = await punchQueueStore.getById(row.id);
      if (!fresh || fresh.deadLettered) continue; // synced/removed/dead meanwhile
      row = fresh;
      if (row.timelogId == null) continue; // clock_in still pending — next drain
    }
    attempted += 1;
    const outcome = await _syncRow(row);
    if (outcome === "ok") {
      succeeded += 1;
    } else {
      failed += 1;
      if (outcome === "dead") {
        deadLetters.push({ action: row.action, timelogId: row.timelogId });
        await _reconcileDeadLetter(row);
      }
    }
  }

  const remaining = (await punchQueueStore.listPending()).length;
  return {
    result: { attempted, succeeded, failed, deadLettered: deadLetters.length, remaining },
    deadLetters,
  };
}

async function _syncRow(row: QueuedPunch): Promise<RowOutcome> {
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
      // Backend is the problem — bail out of the whole drain without burning
      // this row's attempts. Resumes on the next trigger.
      throw new Error("network_still_down");
    }
    // 4xx — a real rejection. Record ONE failure; if that tips the row over the
    // attempt budget it's now dead-lettered and the caller reconciles state.
    const nowDead = await punchQueueStore.recordFailure(row.id, `${r.status ?? 0}: ${r.error}`);
    return nowDead ? "dead" : "retry";
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
  return "ok";
}

/**
 * Guard #3 — a queued punch was dropped after exhausting retries. The optimistic
 * UI told the employee it succeeded; it didn't, and the server never recorded
 * it. Revert local state so it matches the server, so the employee isn't left
 * believing they clocked out (with the session still open for the cron to
 * auto-close). The onChange dead-letter event drives the visible alert.
 */
async function _reconcileDeadLetter(row: QueuedPunch): Promise<void> {
  try {
    if (row.action === "clock_out") {
      // The server session is still OPEN — the employee is actually still
      // clocked in. Restore that so they can retry the clock-out.
      if (row.timelogId != null) {
        await AsyncStorage.setItem("activeTimeLogId", String(row.timelogId));
        await AsyncStorage.setItem("isClockedIn", "true");
      }
    } else {
      // A clock_in that never landed — the employee is NOT clocked in. Clear the
      // optimistic clocked-in state so the UI stops showing an active session.
      await AsyncStorage.removeItem("activeTimeLogId");
      await AsyncStorage.removeItem("pendingClockInKey");
      await AsyncStorage.removeItem("isClockedIn");
      await AsyncStorage.removeItem("currentClockInTime");
    }
  } catch {
    /* best-effort — the dead-letter alert still fires regardless */
  }
}

export const punchSyncWorker = {
  runOnce: async (): Promise<SyncResult> => {
    if (_inFlight) return _inFlight;
    _inFlight = (async () => {
      try {
        const { result, deadLetters } = await _drainOnce();
        await _notify(result, deadLetters);
        return result;
      } catch {
        const remaining = (await punchQueueStore.listPending().catch(() => [])).length;
        const result: SyncResult = {
          attempted: 0,
          succeeded: 0,
          failed: 0,
          deadLettered: 0,
          remaining,
        };
        await _notify(result, [], "error");
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

async function _notify(
  result: SyncResult,
  deadLetters: DeadLetter[],
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
      l({ pending, lastResult, deadLetters });
    } catch {
      /* don't crash siblings */
    }
  }
}
