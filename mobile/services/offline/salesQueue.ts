/**
 * Field-sales offline queue.
 *
 * When a rep captures a sale offline, the full `SaleSyncItem` body is pinned
 * here and replayed by salesSync.ts once the network returns. Rows are deleted
 * on successful sync. Because the row id IS the `client_uuid`, and the backend's
 * `/sales/sync` is idempotent on that value, a resend after a dropped response
 * is reported as `duplicate` instead of creating a second sale.
 *
 * Backed by drizzle on expo-sqlite. Schema in `db/schema.ts::salesQueue`;
 * migration `drizzle/0003_sales_queue.sql`.
 */

import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/expo-sqlite";
import { openDatabaseSync } from "expo-sqlite";
import { salesQueue } from "../../db/schema";
import type { SyncSaleItem } from "../../api/fieldSales";

export const MAX_SYNC_ATTEMPTS = 3;

export interface QueuedSale {
  id: string;
  payloadJson: string;
  clientUuid: string;
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

function rowToEntry(row: typeof salesQueue.$inferSelect): QueuedSale {
  return {
    id: row.id,
    payloadJson: row.payloadJson,
    clientUuid: row.clientUuid,
    attempts: row.attempts,
    lastError: row.lastError,
    createdAt: row.createdAt,
    deadLettered: row.deadLettered === 1,
  };
}

/** RFC 4122 v4 — Hermes-safe (no crypto.randomUUID). */
export function newClientUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const salesQueueStore = {
  /** Pin an offline-captured sale. Idempotent on the item's client_uuid. */
  enqueue: async (item: SyncSaleItem): Promise<string | null> => {
    try {
      await db()
        .insert(salesQueue)
        .values({
          id: item.client_uuid,
          payloadJson: JSON.stringify(item),
          clientUuid: item.client_uuid,
          attempts: 0,
          lastError: null,
          createdAt: Date.now(),
          deadLettered: 0,
        });
      return item.client_uuid;
    } catch (e) {
      console.error("[salesQueue] enqueue failed", e);
      return null;
    }
  },

  getById: async (id: string): Promise<QueuedSale | null> => {
    try {
      const rows = await db().select().from(salesQueue).where(eq(salesQueue.id, id)).limit(1);
      return rows[0] ? rowToEntry(rows[0]) : null;
    } catch (e) {
      console.error("[salesQueue] getById failed", e);
      return null;
    }
  },

  /** Pending rows, oldest first, excluding dead-lettered. */
  listPending: async (): Promise<QueuedSale[]> => {
    try {
      const rows = await db()
        .select()
        .from(salesQueue)
        .where(eq(salesQueue.deadLettered, 0))
        .orderBy(asc(salesQueue.createdAt));
      return rows.map(rowToEntry);
    } catch (e) {
      console.error("[salesQueue] listPending failed", e);
      return [];
    }
  },

  count: async (): Promise<number> => {
    try {
      return (await salesQueueStore.listPending()).length;
    } catch {
      return 0;
    }
  },

  /** Mark synced = delete the row. */
  markSynced: async (id: string): Promise<void> => {
    try {
      await db().delete(salesQueue).where(eq(salesQueue.id, id));
    } catch (e) {
      console.error("[salesQueue] markSynced failed", e);
    }
  },

  /** Record a failed attempt; dead-letter once MAX_SYNC_ATTEMPTS is reached. */
  recordFailure: async (id: string, error: string): Promise<boolean> => {
    try {
      const rows = await db().select().from(salesQueue).where(eq(salesQueue.id, id)).limit(1);
      const existing = rows[0];
      if (!existing) return false;
      const nextAttempts = existing.attempts + 1;
      const deadLettered = nextAttempts >= MAX_SYNC_ATTEMPTS;
      await db()
        .update(salesQueue)
        .set({ attempts: nextAttempts, lastError: error, deadLettered: deadLettered ? 1 : 0 })
        .where(eq(salesQueue.id, id));
      return deadLettered;
    } catch (e) {
      console.error("[salesQueue] recordFailure failed", e);
      return false;
    }
  },

  clearAll: async (): Promise<void> => {
    try {
      await db().delete(salesQueue);
    } catch (e) {
      console.error("[salesQueue] clearAll failed", e);
    }
  },
};
