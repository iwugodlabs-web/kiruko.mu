import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const userProfiles = sqliteTable("user_profiles", {
  userAccountID: text().notNull(),
  authorUserAccountID: text().notNull(),
  firstName: text().notNull(),
  lastName: text().notNull(),
  s3URL: text(), // Optional field,
});

/**
 * M31 offline queue — kiosk clock-in/out requests that couldn't reach
 * the server. Drains via syncWorker on NetInfo `online` / AppState
 * `active` events. The idempotency_key is preserved across retries so
 * the backend's M26 dedup cache (kiosk_idempotency table) returns the
 * original TimeLog instead of creating duplicates.
 *
 * Mirrors web/ivor-web/src/app/kiosk/services/offlineQueue.ts (IndexedDB).
 */
export const kioskQueue = sqliteTable("kiosk_queue", {
  id: text("id").primaryKey(), // UUID — newIdempotencyKey() reused
  action: text("action").notNull(), // 'clock_in' | 'clock_out'
  privateUserId: integer("private_user_id").notNull(),
  pin: text("pin").notNull(), // cleared on sync via row deletion
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  // base64 JPEG, present only for clock_in. NULL on clock_out and when
  // camera capture failed. SQLite text columns are fine for ~500KB.
  photoB64: text("photo_b64"),
  idempotencyKey: text("idempotency_key").notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: integer("created_at").notNull(), // Date.now() — oldest-first drain
  // SQLite has no bool; 0/1 integer. Set when MAX_SYNC_ATTEMPTS reached;
  // listPending() filters these out so the worker stops retrying.
  deadLettered: integer("dead_lettered").notNull().default(0),
});

/**
 * Employee offline punch queue (Feature 1). When the authed employee's clock-in
 * or clock-out request fails on a network-class error, the full request body is
 * pinned here and replayed by services/syncWorker.ts once the network returns.
 *
 * Clock-in replays POST /job/create-time-log; clock-out replays
 * POST /job/time-log/{id}/clock-out. `payloadJson` holds the EXACT request body
 * so a retry replays the same bytes (the idempotency middleware 409s on a
 * reused key with a different body). `timelogId` is the clock-out target id
 * (NULL for clock-in).
 */
export const punchQueue = sqliteTable("punch_queue", {
  id: text("id").primaryKey(), // idempotency key (UUID) — also the row id
  action: text("action").notNull(), // 'clock_in' | 'clock_out'
  timelogId: integer("timelog_id"), // clock_out target; NULL for clock_in
  // For a clock_out queued while its clock_in is still pending offline: the
  // pending clock_in's idempotency key. The sync worker relays the server's
  // real timelog_id onto this row once that clock_in lands.
  dependsOnKey: text("depends_on_key"),
  payloadJson: text("payload_json").notNull(), // exact request body (JSON)
  idempotencyKey: text("idempotency_key").notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: integer("created_at").notNull(), // Date.now() — oldest-first drain
  deadLettered: integer("dead_lettered").notNull().default(0),
});
