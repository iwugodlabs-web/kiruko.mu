/**
 * Turn a time-log's raw GPS location into a human place name.
 *
 * Clock-in records carry location in one of a few shapes:
 *   - a friendly address string (mobile happy path, after on-device geocoding)
 *   - the literal fallback `"Coordinates: -20.1620, 57.5012"` (mobile geocode failed)
 *   - `{ latitude, longitude }` with no address (kiosk — wall-mounted, never geocodes)
 *   - `{ clock_in: { address | latitude, longitude }, clock_out: {...} }`
 *
 * The company time-logs viewer used to show "Unknown Location" or raw numbers
 * for the coordinate-only cases. This module reverse-geocodes those lazily
 * (deduped + cached by ~110 m bucket) so the viewer can show a place name, and
 * exposes the coordinates so the UI can offer a "View on map" fallback.
 */
import * as Location from 'expo-location';

export type Coords = { latitude: number; longitude: number };

// Module-level cache survives re-renders and re-fetches for the session.
const placeCache = new Map<string, string>();

const isCoordString = (s: string) => /^\s*coordinates:/i.test(s);

const pickCoords = (o: any): Coords | null => {
  if (!o || typeof o !== 'object') return null;
  const lat = o.latitude ?? o.lat;
  const lng = o.longitude ?? o.lng ?? o.lon;
  if (typeof lat === 'number' && typeof lng === 'number' && !(lat === 0 && lng === 0)) {
    return { latitude: lat, longitude: lng };
  }
  return null;
};

/** Best-effort extract `{latitude, longitude}` from any location shape. */
export function extractCoords(location: any): Coords | null {
  if (!location) return null;
  if (typeof location === 'string') {
    const m = location.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (m) return { latitude: parseFloat(m[1]), longitude: parseFloat(m[2]) };
    return null;
  }
  return pickCoords(location) || pickCoords(location.clock_in) || pickCoords(location.clock_out) || null;
}

/** A real, human address already on the record — or null if it's coords-only. */
export function realAddress(location: any): string | null {
  if (!location) return null;
  if (typeof location === 'string') return isCoordString(location) ? null : location;
  const a = location.address || location.clock_in?.address;
  if (typeof a === 'string' && a.trim() && !isCoordString(a)) return a;
  return null;
}

// ~110 m bucket so nearby clock-ins share one geocoder lookup.
const keyFor = (c: Coords) => `${c.latitude.toFixed(3)},${c.longitude.toFixed(3)}`;

/** Reverse-geocode a coordinate to a place name (cached). Null on failure. */
export async function resolvePlaceName(coords: Coords): Promise<string | null> {
  const key = keyFor(coords);
  if (placeCache.has(key)) return placeCache.get(key)!;
  try {
    const results = await Location.reverseGeocodeAsync(coords);
    if (results.length > 0) {
      const a = results[0];
      const label = [a.name, a.street, a.city, a.region, a.country]
        .filter((v): v is string => Boolean(v))
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .join(', ');
      if (label) {
        placeCache.set(key, label);
        return label;
      }
    }
  } catch {
    // OS geocoder unavailable/rate-limited — caller falls back to a map link.
  }
  return null;
}

/**
 * Enrich a list of logs: for any whose location is coordinate-only, resolve a
 * place name (deduped + cached) and stamp it on `log._place`. Returns a new
 * array; logs that already have an address — or that can't be resolved — pass
 * through unchanged. Resolution is sequential to respect OS geocoder limits;
 * the dedup keeps it to one lookup per ~110 m bucket per page.
 */
export async function enrichLogsWithPlaceNames(logs: any[]): Promise<any[]> {
  if (!Array.isArray(logs) || logs.length === 0) return logs;
  const unique = new Map<string, Coords>();
  for (const log of logs) {
    if (realAddress(log?.location)) continue;
    const c = extractCoords(log?.location);
    if (c) unique.set(keyFor(c), c);
  }
  if (unique.size === 0) return logs;
  for (const c of unique.values()) {
    await resolvePlaceName(c);
  }
  return logs.map((log) => {
    if (realAddress(log?.location)) return log;
    const c = extractCoords(log?.location);
    if (!c) return log;
    const place = placeCache.get(keyFor(c));
    return place ? { ...log, _place: place } : log;
  });
}

/** A maps deep-link for coordinates (Apple Maps on iOS, Google on others). */
export function mapsUrl(coords: Coords): string {
  const { latitude, longitude } = coords;
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}
