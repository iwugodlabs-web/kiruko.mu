/**
 * Shift breadcrumb trail — the forgotten clock-out locator.
 *
 * While clocked in, the OS drops low-power location fixes (significant-change
 * grade, ~2 min cadence) into the local `breadcrumbs` table. Nothing leaves
 * the device except through the punch payload the user already consented to:
 * the worker uploads the latest breadcrumb against the open session, and the
 * server auto-close attaches the freshest one as an *estimated* clock-out
 * fix when the employee never clocks out. Tracking runs ONLY between
 * clock-in and clock-out — startTrail/stopTrail are called from the clock
 * screen for both online and queued (offline) punches.
 *
 * Battery/privacy posture (deliberate, App Review reads this file's config):
 *   * Balanced accuracy, 2-minute / 100 m cadence — cell-tower grade.
 *   * iOS blue-bar indicator on; Android sticky foreground-service notice.
 *   * Table capped (CAP_ROWS); rows cleared on clock-out.
 *   * In-app explainer precedes the OS background prompt, every clock-in
 *     until granted; a denial degrades to today's behavior, never an error.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { openDatabaseSync } from "expo-sqlite";
import { Alert } from "react-native";
import { api } from "../apiClient";

export const TRAIL_TASK = "kiruko-shift-trail";
const CAP_ROWS = 240;
const MIN_SEPARATION_M = 50;
const MIN_SEPARATION_MS = 60_000;

export interface Breadcrumb {
  id: number;
  latitude: number;
  longitude: number;
  recordedAt: number;
}

function sqlite() {
  return openDatabaseSync("mywitnesstree.db");
}

/** Best-effort table creation (same self-heal rationale as the queues). */
let _ensured = false;
async function ensureTable(): Promise<void> {
  if (_ensured) return;
  _ensured = true;
  try {
    await sqlite().execAsync(
      "CREATE TABLE IF NOT EXISTS `breadcrumbs` (" +
        "`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, " +
        "`latitude` real NOT NULL, " +
        "`longitude` real NOT NULL, " +
        "`recorded_at` integer NOT NULL);",
    );
    await sqlite()
      .execAsync(
        "CREATE INDEX IF NOT EXISTS `breadcrumbs_recorded_at_idx` ON `breadcrumbs` (`recorded_at`);",
      )
      .catch(() => undefined);
  } catch {
    /* best-effort */
  }
}

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(s));
}

/** Decide whether a fix is worth storing (dedups stationary drift). Pure. */
export function shouldRecord(
  last: Pick<Breadcrumb, "latitude" | "longitude" | "recordedAt"> | null,
  lat: number,
  lng: number,
  now: number,
): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  if (!last) return true;
  if (now - last.recordedAt < MIN_SEPARATION_MS) return false;
  return haversineM(last.latitude, last.longitude, lat, lng) >= MIN_SEPARATION_M;
}

export async function latestBreadcrumb(): Promise<Breadcrumb | null> {
  try {
    await ensureTable();
    const rows = (await sqlite().getAllAsync(
      "SELECT id, latitude, longitude, recorded_at AS recordedAt FROM breadcrumbs ORDER BY recorded_at DESC LIMIT 1;",
    )) as Breadcrumb[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function recordBreadcrumb(lat: number, lng: number, at?: number): Promise<void> {
  try {
    const now = at ?? Date.now();
    const last = await latestBreadcrumb();
    if (!shouldRecord(last, lat, lng, now)) return;
    await ensureTable();
    await sqlite().runAsync(
      "INSERT INTO breadcrumbs (latitude, longitude, recorded_at) VALUES (?, ?, ?);",
      [lat, lng, now],
    );
    await sqlite().runAsync(
      "DELETE FROM breadcrumbs WHERE id NOT IN (SELECT id FROM breadcrumbs ORDER BY recorded_at DESC LIMIT ?);",
      [CAP_ROWS],
    );
  } catch {
    /* best-effort — trail must never break a punch */
  }
}

export async function clearTrail(): Promise<void> {
  try {
    await ensureTable();
    await sqlite().runAsync("DELETE FROM breadcrumbs;");
  } catch {
    /* best-effort */
  }
}

// The OS delivers fixes here even with the app backgrounded or suspended.
TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(
  TRAIL_TASK,
  async ({ data, error }) => {
    if (error) return;
    const locations = data?.locations ?? [];
    for (const loc of locations) {
      if (!loc?.coords) continue;
      await recordBreadcrumb(
        loc.coords.latitude,
        loc.coords.longitude,
        loc.timestamp ?? Date.now(),
      );
    }
  },
);

/** In-app explainer shown before the OS background-location prompt. */
function explainTrail(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      "Stay protected if you forget to clock out",
      "Kiruko can keep a low-power trail of your location ONLY while you are clocked in. If you forget to clock out, your shift closes with your departure area instead of nothing. Tracking stops the moment you clock out, and nothing is recorded off-shift.",
      [
        { text: "Not now", style: "cancel", onPress: () => resolve(false) },
        { text: "Continue", onPress: () => resolve(true) },
      ],
    );
  });
}

/**
 * Begin trail recording for a shift. Returns true when live. False (denied,
 * unavailable) is NOT an error — punches and queueing proceed unchanged.
 */
export async function startTrail(seed?: { latitude: number; longitude: number }): Promise<boolean> {
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (fg.status !== "granted") return false;
    let bg = await Location.getBackgroundPermissionsAsync();
    if (bg.status !== "granted") {
      if (!(await explainTrail())) return false;
      bg = await Location.requestBackgroundPermissionsAsync();
      if (bg.status !== "granted") return false;
    }
    if (seed) {
      await recordBreadcrumb(seed.latitude, seed.longitude);
    }
    const active = await TaskManager.isTaskRegisteredAsync(TRAIL_TASK).catch(() => false);
    if (!active) {
      await Location.startLocationUpdatesAsync(TRAIL_TASK, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 120_000,
        distanceInterval: 100,
        deferredUpdatesInterval: 120_000,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: "Shift tracking on",
          notificationBody: "Recording your shift trail until you clock out.",
        },
      });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Upload the latest crumb against the open server session, if it is newer
 * than the last upload. No idempotency key by design — the server dedups
 * appends by recorded_at. Returns true when a crumb was uploaded.
 */
export async function uploadLatestBreadcrumb(): Promise<boolean> {
  return (await uploadPendingTrail(1)) > 0;
}

/**
 * Full-trail replay for dead-zone shifts: upload every crumb newer than the
 * last upload cursor (oldest first), capped per call so a multi-hour offline
 * stretch doesn't stall the drain. The cursor advances only past successful
 * POSTs, so a mid-batch failure resumes — never restarts — next time.
 * Returns the number of crumbs uploaded.
 */
export async function uploadPendingTrail(maxBatch = 100): Promise<number> {
  let uploaded = 0;
  try {
    const [[, timelogId], [, uploadedAt]] = await AsyncStorage.multiGet([
      "activeTimeLogId",
      "trailUploadedAt",
    ]);
    if (!timelogId) return 0;
    await ensureTable();
    const since = uploadedAt ? Number(uploadedAt) : 0;
    const rows = (await sqlite().getAllAsync(
      "SELECT latitude, longitude, recorded_at AS recordedAt FROM breadcrumbs WHERE recorded_at > ? ORDER BY recorded_at ASC LIMIT ?;",
      [since, maxBatch],
    )) as Pick<Breadcrumb, "latitude" | "longitude" | "recordedAt">[];
    for (const crumb of rows) {
      await api.post(`/job/time-log/${timelogId}/breadcrumb`, {
        latitude: crumb.latitude,
        longitude: crumb.longitude,
        recorded_at: new Date(crumb.recordedAt).toISOString(),
      });
      uploaded += 1;
      // Advance the cursor per crumb (not just at the end): a mid-batch
      // failure keeps partial progress, and the next run resumes after the
      // last acknowledged crumb instead of restarting the batch.
      await AsyncStorage.setItem("trailUploadedAt", String(crumb.recordedAt)).catch(
        () => undefined,
      );
    }
    return uploaded;
  } catch {
    return uploaded;
  }
}

/** End trail recording. Best-effort final upload first so the freshest fix
 * reaches the server even when clock-out itself was queued offline. */
export async function stopTrail(upload?: () => Promise<unknown>): Promise<void> {
  try {
    if (upload) await upload().catch(() => undefined);
  } finally {
    try {
      const active = await TaskManager.isTaskRegisteredAsync(TRAIL_TASK).catch(() => false);
      if (active) await Location.stopLocationUpdatesAsync(TRAIL_TASK).catch(() => undefined);
    } finally {
      await clearTrail();
    }
  }
}
