/**
 * Employee offline punch queue (Feature 1).
 *
 * When the authed employee's clock-in or clock-out fails on a network-class
 * error, the full request body is pinned here and replayed by syncWorker.ts
 * once the network returns. Rows are deleted on successful sync.
 *
 * Backed by drizzle on expo-sqlite. Schema in `db/schema.ts::punchQueue`;
 * migration `drizzle/0002_punch_queue.sql`.
 */

import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/expo-sqlite";
import { openDatabaseSync } from "expo-sqlite";
import { punchQueue } from "../../../db/schema";

export const MAX_SYNC_ATTEMPTS = 3;

export type QueuedAction = "clock_in" | "clock_out";

export interface QueuedPunch {
  id: string;
  action: QueuedAction;
  timelogId: number | null;
  dependsOnKey: string | null;
  payloadJson: string;
  idempotencyKey: string;
  attempts: number;
  lastError: string | null;
  createdAt: number;
  deadLettered: boolean;
}

let _db: ReturnType<typeof drizzle> | null = null;
function db() {
  if (_db) return _db;
  const sqlite = openDatabaseSync("mywitnesstree.db");
  _db = drizzle(sqlite);
  return _db;
}

function rowToEntry(row: typeof punchQueue.$inferSelect): QueuedPunch {
  return {
    id: row.id,
    action: row.action as QueuedAction,
    timelogId: row.timelogId,
    dependsOnKey: row.dependsOnKey,
    payloadJson: row.payloadJson,
    idempotencyKey: row.idempotencyKey,
    attempts: row.attempts,
    lastError: row.lastError,
    createdAt: row.createdAt,
    deadLettered: row.deadLettered === 1,
  };
}

/** RFC 4122 v4 — Hermes-safe (no crypto.randomUUID). */
export function newIdempotencyKey(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const punchQueueStore = {
  /**
   * Pin a punch that couldn't reach the server. The full body is stored as a
   * JSON string so a retry replays the EXACT bytes (the idempotency middleware
   * 409s on a reused key with a different body).
   */
  enqueue: async (args: {
    action: QueuedAction;
    payload: Record<string, unknown>;
    idempotencyKey: string;
    timelogId?: number | null;
    dependsOnKey?: string | null;
  }): Promise<string | null> => {
    const rowId = args.idempotencyKey;
    try {
      await db()
        .insert(punchQueue)
        .values({
          id: rowId,
          action: args.action,
          timelogId: args.timelogId ?? null,
          dependsOnKey: args.dependsOnKey ?? null,
          payloadJson: JSON.stringify(args.payload),
          idempotencyKey: args.idempotencyKey,
          attempts: 0,
          lastError: null,
          createdAt: Date.now(),
          deadLettered: 0,
        });
      return rowId;
    } catch (e) {
      // Never surface a SQLite error to the user — log it and let the caller
      // fall through to its optimistic path (the punch was still accepted).
      console.error("[punchQueue] enqueue failed", e);
      return null;
    }
  },

  /**
   * Once a queued clock-in lands with its server-assigned timelog_id, relay it
   * onto any clock-out rows that were queued against that pending clock-in, so
   * they target the real session. Returns the number of rows resolved.
   */
  resolveClockOuts: async (clockInKey: string, timelogId: number): Promise<number> => {
    try {
      const rows = await db()
        .select()
        .from(punchQueue)
        .where(eq(punchQueue.dependsOnKey, clockInKey));
      if (rows.length === 0) return 0;
      await db()
        .update(punchQueue)
        .set({ timelogId, dependsOnKey: null })
        .where(eq(punchQueue.dependsOnKey, clockInKey));
      return rows.length;
    } catch (e) {
      console.error("[punchQueue] resolveClockOuts failed", e);
      return 0;
    }
  },

  /** Fetch a single row by id regardless of dead-letter state, or null. Used by
   * the sync worker to re-read a row mid-drain (a clock-in may have resolved a
   * dependent clock-out's timelog_id) and to confirm a dead-letter transition. */
  getById: async (id: string): Promise<QueuedPunch | null> => {
    try {
      const rows = await db().select().from(punchQueue).where(eq(punchQueue.id, id)).limit(1);
      return rows[0] ? rowToEntry(rows[0]) : null;
    } catch (e) {
      console.error("[punchQueue] getById failed", e);
      return null;
    }
  },

  /** Pending rows, oldest first, excluding dead-lettered. */
  listPending: async (): Promise<QueuedPunch[]> => {
    try {
      const rows = await db()
        .select()
        .from(punchQueue)
        .where(eq(punchQueue.deadLettered, 0))
        .orderBy(asc(punchQueue.createdAt));
      return rows.map(rowToEntry);
    } catch (e) {
      console.error("[punchQueue] listPending failed", e);
      return [];
    }
  },

  /** UI banner count — excludes dead-lettered. */
  count: async (): Promise<number> => {
    try {
      return (await punchQueueStore.listPending()).length;
    } catch {
      return 0;
    }
  },

  /** Mark synced = delete the row. */
  markSynced: async (id: string): Promise<void> => {
    try {
      await db().delete(punchQueue).where(eq(punchQueue.id, id));
    } catch (e) {
      console.error("[punchQueue] markSynced failed", e);
    }
  },

  /** Record a failed attempt; dead-letter once MAX_SYNC_ATTEMPTS is reached.
   * Returns true iff this failure tipped the row into the dead-lettered state,
   * so the caller can reconcile the optimistic local clock state (guard #3). */
  recordFailure: async (id: string, error: string): Promise<boolean> => {
    try {
      const row = await db().select().from(punchQueue).where(eq(punchQueue.id, id)).limit(1);
      const existing = row[0];
      if (!existing) return false;
      const nextAttempts = existing.attempts + 1;
      const deadLettered = nextAttempts >= MAX_SYNC_ATTEMPTS;
      await db()
        .update(punchQueue)
        .set({
          attempts: nextAttempts,
          lastError: error,
          deadLettered: deadLettered ? 1 : 0,
        })
        .where(eq(punchQueue.id, id));
      return deadLettered;
    } catch (e) {
      console.error("[punchQueue] recordFailure failed", e);
      return false;
    }
  },

  clearAll: async (): Promise<void> => {
    try {
      await db().delete(punchQueue);
    } catch (e) {
      console.error("[punchQueue] clearAll failed", e);
    }
  },
};
