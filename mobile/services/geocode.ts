/**
 * Display-time reverse geocoding.
 *
 * Offline punches store `Coordinates: <lat>, <lng>` as their address (the
 * network geocode step is skipped offline by design). When connectivity is
 * back, history screens resolve those strings into human-readable addresses
 * here — at RENDER time, never in the queued payload (rewriting payload bytes
 * breaks the idempotency hash; patching the server record post-sync risks
 * touching finalized payroll data for cosmetic gain).
 *
 * Results are cached in AsyncStorage keyed by rounded coordinates, so each
 * unique place resolves once and repeat renders stay offline-friendly.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { useEffect, useState } from "react";
import { api } from "./apiClient";
import { isOnlineNow } from "./offlinePolicy";

const CACHE_KEY = "geocodeCache";
const CACHE_CAP = 200;

let _cache: Record<string, string> | null = null;

async function loadCache(): Promise<Record<string, string>> {
  if (_cache) return _cache;
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    _cache = raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    _cache = {};
  }
  return _cache;
}

function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

/** Extract coordinates from an offline `Coordinates: <lat>, <lng>` string. */
export function parseCoordinates(text: string | null | undefined): {
  latitude: number;
  longitude: number;
} | null {
  if (!text) return null;
  const m = text.match(/coordinates:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function formatAddress(parts: Location.LocationGeocodedAddress): string | null {
  const s = `${parts.name || ""}, ${parts.city || ""}, ${parts.region || ""}, ${parts.country || ""}`
    .replace(/^, |, $|, , /g, ", ")
    .replace(/^, |, $/g, "");
  return s || null;
}

/**
 * Resolve display text: human addresses pass through untouched; offline
 * coordinate strings resolve via cache/network when possible, else display
 * as-is. Never throws.
 */
export async function resolveAddressText(text: string): Promise<string> {
  const coords = parseCoordinates(text);
  if (!coords) return text;
  const cache = await loadCache();
  const key = cacheKey(coords.latitude, coords.longitude);
  if (cache[key]) return cache[key];
  if (!(await isOnlineNow())) return text;
  // Primary: backend Google reverse-geocode — consistent addresses across
  // iOS/Android (device geocoders vary by region data) with quota control
  // server-side. Requires the endpoint + GOOGLE_MAPS_API_KEY deployed;
  // anything missing degrades to the on-device lookup below.
  try {
    const resp = await Promise.race([
      api.get("/geocode/reverse", {
        params: { lat: coords.latitude, lng: coords.longitude },
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    const name = (resp as { data?: { display_name?: string | null } } | null)?.data
      ?.display_name;
    if (name) {
      storeCached(key, name, cache);
      return name;
    }
  } catch {
    /* fall through to the device geocoder */
  }
  try {
    const result = await Promise.race([
      Location.reverseGeocodeAsync({
        latitude: coords.latitude,
        longitude: coords.longitude,
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    if (result && result.length > 0) {
      const formatted = formatAddress(result[0]);
      if (formatted) {
        storeCached(key, formatted, cache);
        return formatted;
      }
    }
  } catch {
    /* fall through to raw coordinates */
  }
  return text;
}

function storeCached(key: string, value: string, cache: Record<string, string>): void {
  cache[key] = value;
  const keys = Object.keys(cache);
  if (keys.length > CACHE_CAP) delete cache[keys[0]];
  _cache = cache;
  AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache)).catch(() => undefined);
}

/** Hook version: returns the fallback immediately, upgrades when resolved. */
export function useResolvedAddress(text: string | null | undefined): string {
  const [display, setDisplay] = useState(text ?? "");
  useEffect(() => {
    setDisplay(text ?? "");
    if (!text || !parseCoordinates(text)) return;
    let cancelled = false;
    resolveAddressText(text).then((resolved) => {
      if (!cancelled) setDisplay(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [text]);
  return display;
}
