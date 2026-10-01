/**
 * Offline sync metadata (§10.2). Key/value store backed by the SQLite
 * `sync_state` table (durable across restarts, unlike AsyncStorage flags
 * that can be wiped by logout hygiene).
 *
 * Keys:
 *   * `last_synced:<domain>` — Date.now() of the last successful sync touching
 *     that domain (e.g. `punches`, `kiosk`). Drives "last synced Xm ago" UI.
 *   * `last_server_contact`  — Date.now() of the last authenticated round-trip.
 *     Enforces the max-offline-duration bound (matches REFRESH_TOKEN_EXPIRY).
 */

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/expo-sqlite";
import { openDatabaseSync } from "expo-sqlite";
import { syncState } from "../db/schema";

let _db: ReturnType<typeof drizzle> | null = null;
function db() {
  if (_db) return _db;
  const sqlite = openDatabaseSync("mywitnesstree.db");
  _db = drizzle(sqlite);
  return _db;
}

// Self-heal for devices whose migrator never applied 0003 (same class of
// journal/manifest skew as the 0002 incident). No-op when applied normally.
let _ensured = false;
async function ensureTable(): Promise<void> {
  if (_ensured) return;
  _ensured = true;
  try {
    const sqlite = openDatabaseSync("mywitnesstree.db");
    await sqlite.execAsync(
      "CREATE TABLE IF NOT EXISTS `sync_state` (" +
        "`key` text PRIMARY KEY NOT NULL, " +
        "`value` text NOT NULL, " +
        "`updated_at` integer NOT NULL);",
    );
  } catch {
    /* best-effort */
  }
}

export async function metaGet(key: string): Promise<string | null> {
  try {
    await ensureTable();
    const rows = await db().select().from(syncState).where(eq(syncState.key, key)).limit(1);
    return rows[0]?.value ?? null;
  } catch {
    return null;
  }
}

export async function metaSet(key: string, value: string): Promise<void> {
  try {
    await ensureTable();
    await db()
      .insert(syncState)
      .values({ key, value, updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: syncState.key,
        set: { value, updatedAt: Date.now() },
      });
  } catch {
    /* best-effort — metadata must never break a user flow */
  }
}

/** Stamp a successful sync for a domain (call from sync workers + fetch paths). */
export function stampSynced(domain: string): Promise<void> {
  return metaSet(`last_synced:${domain}`, String(Date.now()));
}

/** Millis timestamp of the last successful sync for a domain, or null. */
export async function lastSyncedAt(domain: string): Promise<number | null> {
  const raw = await metaGet(`last_synced:${domain}`);
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Stamp an authenticated server round-trip (call on checkAuth success). */
export function stampServerContact(): Promise<void> {
  return metaSet("last_server_contact", String(Date.now()));
}

/** Millis timestamp of the last authenticated contact, or null (never). */
export async function lastServerContactAt(): Promise<number | null> {
  const raw = await metaGet("last_server_contact");
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Short relative time ("just now", "12m ago", "3h ago", "5d ago").
 * English-only stopgap — route through i18n keys when translators pick it up.
 */
export function timeAgo(ts: number | null, now: number = Date.now()): string {
  if (ts == null) return "never";
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
