"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type Site = {
  geofence_id: number;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  active: boolean;
};

export type DraftPin = {
  latitude: number;
  longitude: number;
  radius_meters: number;
} | null;

const PIN_SVG =
  '<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M13 1C6.4 1 1 6.4 1 13c0 8.2 12 20 12 20s12-11.8 12-20C25 6.4 19.6 1 13 1z" fill="#4f46e5" stroke="#fff" stroke-width="2"/>' +
  '<circle cx="13" cy="13" r="5" fill="#fff"/></svg>';

/** Interactive site map: shows every existing geofence as a radius circle and
 *  lets the admin click anywhere to drop the draft pin for a new site. */
export default function SiteMap({
  sites,
  draft,
  onPick,
}: {
  sites: Site[];
  draft: DraftPin;
  onPick: (latitude: number, longitude: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const sitesLayerRef = useRef<L.LayerGroup | null>(null);
  const draftLayerRef = useRef<L.LayerGroup | null>(null);
  // Keep the latest callback without re-creating the map on every render.
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, { zoomControl: true }).setView([-20.16, 57.5], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    map.on("click", (e: L.LeafletMouseEvent) => {
      onPickRef.current(e.latlng.lat, e.latlng.lng);
    });

    sitesLayerRef.current = L.layerGroup().addTo(map);
    draftLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      sitesLayerRef.current = null;
      draftLayerRef.current = null;
    };
  }, []);

  // Existing sites — one circle per geofence so overlapping areas are visible.
  useEffect(() => {
    const layer = sitesLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    sites.forEach((s) => {
      const color = s.active ? "#10b981" : "#9ca3af";
      L.circle([s.latitude, s.longitude], {
        radius: s.radius_meters,
        color,
        fillColor: color,
        fillOpacity: 0.12,
        weight: 1.5,
      })
        .bindPopup(`<b>${s.name}</b><br/>${s.radius_meters}m radius`)
        .addTo(layer);
    });
  }, [sites]);

  // Draft pin — draggable marker + radius halo for the new site.
  useEffect(() => {
    const layer = draftLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!draft) return;

    const icon = L.divIcon({
      html: PIN_SVG,
      className: "",
      iconSize: [26, 34],
      iconAnchor: [13, 34],
    });
    const marker = L.marker([draft.latitude, draft.longitude], {
      icon,
      draggable: true,
    });
    marker.on("dragend", (e) => {
      const ll = (e.target as L.Marker).getLatLng();
      onPickRef.current(ll.lat, ll.lng);
    });
    marker.addTo(layer);

    L.circle([draft.latitude, draft.longitude], {
      radius: draft.radius_meters,
      color: "#4f46e5",
      fillColor: "#4f46e5",
      fillOpacity: 0.08,
      weight: 1.5,
    }).addTo(layer);
  }, [draft]);

  return (
    <div className="relative isolate z-0 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
      <div ref={containerRef} className="w-full h-64" />
    </div>
  );
}