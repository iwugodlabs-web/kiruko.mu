"use client";

/**
 * Display-time reverse geocoding (web mirror of mobile SmartAddress).
 *
 * Offline mobile punches store `Coordinates: <lat>, <lng>` as their address.
 * This resolves those strings into human-readable addresses via the backend
 * Google endpoint (`GET /api/v1/geocode/reverse`, same-origin cookie auth),
 * cached per place for the session. Anything already human-readable renders
 * untouched; failures fall back to the raw text. Never throws.
 */

import { useEffect, useState } from "react";
import { api } from "@/services/apiClient";

const cache = new Map<string, string>();

function parseCoordinates(text: string | null | undefined): {
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

async function resolveAddressText(text: string): Promise<string> {
  const coords = parseCoordinates(text);
  if (!coords) return text;
  const key = `${coords.latitude.toFixed(4)},${coords.longitude.toFixed(4)}`;
  if (cache.has(key)) return cache.get(key)!;
  if (typeof navigator !== "undefined" && !navigator.onLine) return text;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const resp = await api.get("/geocode/reverse", {
      params: { lat: coords.latitude, lng: coords.longitude },
      signal: controller.signal as never,
    });
    clearTimeout(timer);
    const name = resp?.data?.display_name as string | null | undefined;
    if (name) {
      if (cache.size > 200) cache.delete(cache.keys().next().value!);
      cache.set(key, name);
      return name;
    }
  } catch {
    /* fall through to raw coordinates */
  }
  return text;
}

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

export default function SmartAddress({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const display = useResolvedAddress(text);
  return <span className={className}>{display}</span>;
}
