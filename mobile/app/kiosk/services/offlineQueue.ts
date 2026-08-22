/**
 * M31 — Kiosk offline queue (Expo port of web/ivor-web/src/app/kiosk/
 * services/offlineQueue.ts which uses IndexedDB).
 *
 * Backed by drizzle on expo-sqlite (same database the rest of the app
 * uses — `mywitnesstree.db` opened in `app/_layout.tsx`). Schema lives
 * in `db/schema.ts::kioskQueue`; migration is `drizzle/0001_kiosk_queue.sql`.
 *
 * Public surface mirrors the web version 1:1 so the sync worker code
 * paths are nearly identical. Rows are deleted on successful sync (the
 * server-side TimeLog is the persistent trail).
 */

import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/expo-sqlite";
import { openDatabaseSync } from "expo-sqlite";
import { kioskQueue } from "../../../db/schema";

export const MAX_SYNC_ATTEMPTS = 3;

export type QueuedAction = "clock_in" | "clock_out";

export interface QueuedClockEntry {
  id: string;
  action: QueuedAction;
  payload: {
    private_user_id: number;
    pin: string;
    location: { latitude: number; longitude: number };
    photo_b64?: string | null;
  };
  idempotencyKey: string;
  attempts: number;
  lastError: string | null;
  createdAt: number;
  deadLettered: boolean;
}

// Lazy singleton — the SQLiteProvider in app/_layout.tsx opens the same
// db with `openDatabaseSync('mywitnesstree.db')`; opening it again here
// returns a shared handle (expo-sqlite refcounts internally).
let _db: ReturnType<typeof drizzle> | null = null;
function db() {
  if (_db) return _db;
  const sqlite = openDatabaseSync("mywitnesstree.db");
  _db = drizzle(sqlite);
  return _db;
}

function rowToEntry(row: typeof kioskQueue.$inferSelect): QueuedClockEntry {
  return {
    id: row.id,
    action: row.action as QueuedAction,
    payload: {
      private_user_id: row.privateUserId,
      pin: row.pin,
      location: { latitude: row.latitude, longitude: row.longitude },
      photo_b64: row.photoB64 ?? null,
    },
    idempotencyKey: row.idempotencyKey,
    attempts: row.attempts,
    lastError: row.lastError,
    createdAt: row.createdAt,
    deadLettered: row.deadLettered === 1,
  };
}

export const offlineQueue = {
  /**
   * Enqueue a clock-in/out that couldn't reach the server. The given
   * idempotency_key is what the sync worker will reuse on retry so the
   * backend dedup cache returns the original TimeLog rather than
   * creating a duplicate. Returns the row id (== key) so the caller
   * can correlate later.
   */
  enqueue: async (
    action: QueuedAction,
    payload: QueuedClockEntry["payload"],
    idempotencyKey: string,
    id?: string,
  ): Promise<string> => {
    const rowId = id ?? idempotencyKey;
    await db()
      .insert(kioskQueue)
      .values({
        id: rowId,
        action,
        privateUserId: payload.private_user_id,
        pin: payload.pin,
        latitude: payload.location.latitude,
        longitude: payload.location.longitude,
        photoB64: payload.photo_b64 ?? null,
        idempotencyKey,
        attempts: 0,
        lastError: null,
        createdAt: Date.now(),
        deadLettered: 0,
      });
    return rowId;
  },

  /** Pending rows, oldest first, excluding dead-lettered ones. */
  listPending: async (): Promise<QueuedClockEntry[]> => {
    const rows = await db()
      .select()
      .from(kioskQueue)
      .where(eq(kioskQueue.deadLettered, 0))
      .orderBy(asc(kioskQueue.createdAt));
    return rows.map(rowToEntry);
  },

  /** UI banner count — excludes dead-lettered. */
  count: async (): Promise<number> => {
    try {
      const rows = await offlineQueue.listPending();
      return rows.length;
    } catch {
      return 0;
    }
  },

  /** Mark synced = delete the row. */
  markSynced: async (id: string): Promise<void> => {
    await db().delete(kioskQueue).where(eq(kioskQueue.id, id));
  },

  /**
   * Record a failed sync attempt. Increments attempts, stores the
   * error, dead-letters when MAX_SYNC_ATTEMPTS is reached.
   */
  recordFailure: async (id: string, error: string): Promise<void> => {
    const row = await db().select().from(kioskQueue).where(eq(kioskQueue.id, id)).limit(1);
    const existing = row[0];
    if (!existing) return;
    const nextAttempts = existing.attempts + 1;
    await db()
      .update(kioskQueue)
      .set({
        attempts: nextAttempts,
        lastError: error,
        deadLettered: nextAttempts >= MAX_SYNC_ATTEMPTS ? 1 : 0,
      })
      .where(eq(kioskQueue.id, id));
  },

  /** Operator escape hatch — wipe everything (incl. dead-lettered). */
  clearAll: async (): Promise<void> => {
    await db().delete(kioskQueue);
  },
};
