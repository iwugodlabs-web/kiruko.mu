"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "@/contexts/AuthContext";
import {
  MapPin, Plus, Save, Trash2, AlertCircle, CheckCircle, Loader2, Search, LocateFixed, ExternalLink, Users,
} from "lucide-react";
import { api } from "@/services/apiClient";
import { reassignAndDeleteGeofence } from "@/services/api";

// Leaflet touches `window`/`document`, so it must load client-only.
const SiteMap = dynamic(() => import("./SiteMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-64 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
  ),
});

type Geofence = {
  geofence_id: number;
  company_id: number;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  radius_meters: number;
  mode: "block" | "flag";
  active: boolean;
  ip_country_required: boolean;
  anchor_qr_token: string | null;
  anchor_wifi_bssids: string[] | null;
  employee_count?: number;
};

type GeofenceConfig = {
  geofence_default_mode: "off" | "block" | "flag";
  geofences: Geofence[];
};

type SearchResult = {
  lat: string;
  lon: string;
  display_name: string;
};

const inputCls =
  "w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm " +
  "text-gray-900 dark:text-white bg-white dark:bg-gray-800 " +
  "placeholder-gray-400 dark:placeholder-gray-500 " +
  "focus:outline-none focus:border-gray-400 dark:focus:border-gray-500 transition-colors";

const MODE_LABELS: Record<string, string> = {
  off: "Off — record location, never enforce",
  block: "Block — reject punches outside the fence",
  flag: "Flag — allow but mark punches for review",
};

// Google Maps search links work with zero API keys.
const mapsSearchUrl = (q: string) =>
  `https://www.google.com/maps/search/${encodeURIComponent(q)}`;

export default function GeofencingSettings() {
  const { user } = useAuth();
  const company = (user as any)?.company;
  const companyId = company?.company_id;

  const [config, setConfig] = useState<GeofenceConfig>({
    geofence_default_mode: "off",
    geofences: [],
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Geofence | null>(null);
  const [reassignTo, setReassignTo] = useState<string>("");

  // Draft form for a new fence.
  const [draft, setDraft] = useState({
    name: "",
    address: "",
    latitude: "",
    longitude: "",
    radius_meters: 200,
    mode: "block" as "block" | "flag",
    active: true,
    anchor_qr_token: "",
  });

  // Location lookup state.
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [searchedAddress, setSearchedAddress] = useState("");
  const [searchError, setSearchError] = useState("");

  const draftLat = parseFloat(draft.latitude);
  const draftLng = parseFloat(draft.longitude);
  const hasDraftCoords = !Number.isNaN(draftLat) && !Number.isNaN(draftLng);
  const radiusM = draft.radius_meters || 200;

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await api.get(`/company/${companyId}/geofences`);
      setConfig(res.data);
    } catch (err: any) {
      setMessage({ ok: false, text: err?.response?.data?.detail || "Failed to load geofencing settings" });
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  const saveDefaultMode = async (mode: "off" | "block" | "flag") => {
    if (!companyId) return;
    setSaving(true);
    setMessage(null);
    try {
      await api.put(`/company/${companyId}`, { geofence_default_mode: mode });
      setConfig((c) => ({ ...c, geofence_default_mode: mode }));
      setMessage({ ok: true, text: "Default geofence mode saved." });
    } catch (err: any) {
      setMessage({ ok: false, text: err?.response?.data?.detail || "Failed to save geofence mode" });
    } finally {
      setSaving(false);
    }
  };

  // "Use my current location" — the admin is usually standing at the site.
  const useMyLocation = () => {
    if (!("geolocation" in navigator)) {
      setMessage({ ok: false, text: "Your browser doesn't support geolocation. Search for the address instead." });
      return;
    }
    setLocating(true);
    setMessage(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDraft((d) => ({
          ...d,
          latitude: String(pos.coords.latitude),
          longitude: String(pos.coords.longitude),
        }));
        setSearchResults([]);
        setSearchQuery("");
        reverseGeocode(pos.coords.latitude, pos.coords.longitude)
          .then((addr) => {
            setDraft((d) => ({ ...d, address: addr }));
            setSearchedAddress(addr || "Using your current location");
          })
          .catch(() => setSearchedAddress("Using your current location"))
          .finally(() => setLocating(false));
      },
      (err) => {
        setLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          setMessage({ ok: false, text: "Location permission denied. Search for the address instead." });
        } else {
          setMessage({ ok: false, text: "Couldn't get your location. Search for the address instead." });
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  };

  // Best-effort reverse geocoding: turns a dropped/clicked pin into a readable
  // address for the branch list. Pure enhancement — never blocks the flow.
  // Proxied through the backend so the Google key never ships to the browser.
  const reverseGeocode = async (lat: number, lng: number) => {
    try {
      const res = await api.get("/geocode/reverse", { params: { lat, lng } });
      return typeof res?.data?.display_name === "string" ? res.data.display_name : "";
    } catch {
      // Best-effort only — never blocks pinning. Surface why the address stayed
      // empty via the same in-app notice the search box uses.
      setSearchError((prev) => prev || "Address lookup is unavailable — the pin location still works.");
      return "";
    }
  };

  // Address search via the backend Google Places proxy (key stays server-side;
  // Google covers MU/TZ business POIs like "Le Flamant" that OSM lacks).
  // Biased to the company's country so same-named places elsewhere don't
  // leak in — and the interactive map remains the click-to-pin fallback.
  const searchCountry = (company?.country_code || "").toUpperCase();
  // Race guard: only the latest request's response may update the dropdown.
  const searchSeqRef = useRef(0);
  // Scroll target for the "Add a site" header button (keeps the long form one
  // tap away from the list instead of buried at the bottom of the page).
  const addFormRef = useRef<HTMLDivElement | null>(null);
  const scrollToAddForm = () => addFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const runSearch = useCallback(async (q: string) => {
    const query = q.trim();
    if (!query) {
      setSearchResults([]);
      setSearching(false);
      setSearchError("");
      return;
    }
    const seq = ++searchSeqRef.current;
    setSearching(true);
    try {
      const res = await api.get("/geocode/search", {
        params: { q: query, country: searchCountry || undefined },
      });
      const data = res?.data?.results;
      if (seq !== searchSeqRef.current) return; // a newer keystroke superseded this
      setSearchError("");
      setSearchResults(
        (Array.isArray(data) ? data : []).map((r: any) => ({
          lat: String(r.latitude),
          lon: String(r.longitude),
          display_name: r.display_name,
        })),
      );
      setSearching(false);
    } catch (err) {
      if (seq !== searchSeqRef.current) return;
      console.warn("Geocode search failed:", err);
      setSearchResults([]);
      setSearchError("Search is unavailable — use the map or your current location instead.");
      setSearching(false);
    }
  }, [searchCountry]);

  // As-you-type suggestions: debounce ~450ms, minimum 3 characters to avoid
  // spamming the geocoder with half-typed addresses.
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 3) {
      searchSeqRef.current++;
      setSearchResults([]);
      setSearchError("");
      setSearching(false);
      return;
    }
    const timer = setTimeout(() => {
      runSearch(q);
    }, 450);
    return () => clearTimeout(timer);
  }, [searchQuery, runSearch]);

  const pickSearchResult = (r: SearchResult) => {
    setDraft((d) => ({
      ...d,
      latitude: r.lat,
      longitude: r.lon,
      name: d.name || r.display_name.split(",")[0],
      address: r.display_name,
    }));
    setSearchedAddress(r.display_name);
    setSearchResults([]);
    setSearchQuery("");
  };

  const addFence = async () => {
    if (!companyId) return;
    if (!draft.name.trim()) return setMessage({ ok: false, text: "Fence name is required" });
    if (!hasDraftCoords) return setMessage({ ok: false, text: "Choose a location — search for the address or use your current location." });
    setSaving(true);
    setMessage(null);
    try {
      await api.post(`/company/${companyId}/geofences`, {
        name: draft.name.trim(),
        address: draft.address.trim() || null,
        latitude: draftLat,
        longitude: draftLng,
        radius_meters: radiusM,
        mode: draft.mode,
        active: draft.active,
        anchor_qr_token: draft.anchor_qr_token.trim() || null,
      });
      setDraft({ name: "", address: "", latitude: "", longitude: "", radius_meters: 200, mode: "block", active: true, anchor_qr_token: "" });
      setSearchedAddress("");
      setMessage({ ok: true, text: "Geofence added." });
      await load();
    } catch (err: any) {
      setMessage({ ok: false, text: err?.response?.data?.detail || "Failed to add geofence" });
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (f: Geofence) => {
    if (!companyId) return;
    setMessage(null);
    try {
      await api.put(`/company/${companyId}/geofences/${f.geofence_id}`, { active: !f.active });
      await load();
    } catch (err: any) {
      setMessage({ ok: false, text: err?.response?.data?.detail || "Failed to update geofence" });
    }
  };

  const setFenceMode = async (f: Geofence, mode: "block" | "flag") => {
    if (!companyId) return;
    setMessage(null);
    try {
      await api.put(`/company/${companyId}/geofences/${f.geofence_id}`, { mode });
      await load();
    } catch (err: any) {
      setMessage({ ok: false, text: err?.response?.data?.detail || "Failed to update geofence" });
    }
  };

  const confirmDelete = async () => {
    if (!companyId || !deleteTarget) return;
    setSaving(true);
    try {
      const res = await reassignAndDeleteGeofence(
        companyId,
        deleteTarget.geofence_id,
        reassignTo ? Number(reassignTo) : null,
      );
      if ("error" in res) {
        setMessage({ ok: false, text: res.error });
      } else {
        const moved = res.reassigned > 0 ? ` ${res.reassigned} employee${res.reassigned === 1 ? "" : "s"} moved.` : "";
        setMessage({ ok: true, text: `"${deleteTarget.name}" deleted.${moved}` });
        setDeleteTarget(null);
        setReassignTo("");
        await load();
      }
    } catch (err: any) {
      setMessage({ ok: false, text: err?.response?.data?.detail || "Failed to delete site" });
    } finally {
      setSaving(false);
    }
  };

  if (loading && config.geofences.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-gray-500 dark:text-gray-400">
        <Loader2 size={16} className="animate-spin mr-2" /> Loading geofencing settings…
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 space-y-6">
      <div className="pb-4 border-b border-gray-100 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Geofencing</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Require employees to be within a virtual perimeter around your sites to clock in and out.
        </p>
      </div>

      {message && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-sm ${
          message.ok
            ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-100 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400"
            : "bg-red-50 dark:bg-red-950/40 border-red-100 dark:border-red-900 text-red-700 dark:text-red-400"
        }`}>
          {message.ok ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {message.text}
        </div>
      )}

      {/* Company default mode */}
      <div className="p-5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg flex items-center justify-center shrink-0">
            <MapPin className="text-gray-500 dark:text-gray-300" size={16} />
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-white">Company default</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              The master switch. Per-fence mode can override it for a specific site. When off, locations are recorded but never enforced.
            </p>
          </div>
        </div>
        <div className="grid gap-2">
          {(Object.keys(MODE_LABELS) as Array<"off" | "block" | "flag">).map((mode) => (
            <label key={mode} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer text-sm transition-colors ${
              config.geofence_default_mode === mode
                ? "border-gray-900 dark:border-white bg-white dark:bg-gray-900"
                : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
            }`}>
              <input
                type="radio"
                name="geofence_default_mode"
                checked={config.geofence_default_mode === mode}
                onChange={() => saveDefaultMode(mode)}
                disabled={saving}
                className="accent-gray-900 dark:accent-white"
              />
              <span className="text-gray-800 dark:text-gray-100">{MODE_LABELS[mode]}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Fence list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-gray-900 dark:text-white">Sites</h3>
          <button
            onClick={scrollToAddForm}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 dark:bg-white hover:bg-gray-800 dark:hover:bg-gray-100 text-white dark:text-gray-900 text-xs font-medium rounded-lg transition-colors"
          >
            <Plus size={14} /> Add a site
          </button>
        </div>
        {config.geofences.length === 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            No geofences yet. Add one per site (HQ, warehouse, branch…) below — no coordinates needed, just pick the location.
          </p>
        )}
        {config.geofences.map((f) => (
          <div key={f.geofence_id} className="p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-2 h-2 rounded-full shrink-0 ${f.active ? "bg-emerald-500" : "bg-gray-300 dark:bg-gray-600"}`} />
                <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">{f.name}</span>
                <span className="text-xs text-gray-400 dark:text-gray-500">({f.radius_meters}m)</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <select
                  value={f.mode}
                  onChange={(e) => setFenceMode(f, e.target.value as "block" | "flag")}
                  className={inputCls + " !w-auto !py-1.5"}
                  title="Per-site mode override"
                >
                  <option value="block">Block</option>
                  <option value="flag">Flag</option>
                </select>
                <button
                  onClick={() => toggleActive(f)}
                  title={f.active ? "Disable fence" : "Enable fence"}
                  className={`px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    f.active
                      ? "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      : "border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                  }`}
                >
                  {f.active ? "Pause" : "Enable"}
                </button>
                <button
                  onClick={() => { setMessage(null); setReassignTo(""); setDeleteTarget(f); }}
                  title="Delete site"
                  className="p-1.5 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
                <Users size={12} /> {(f.employee_count ?? 0)} employee{(f.employee_count ?? 0) === 1 ? "" : "s"}
              </span>
              <span className="sm:col-span-2 truncate"><span className="text-gray-400 dark:text-gray-500">Address:</span> {f.address || "—"}</span>
              <span><span className="text-gray-400 dark:text-gray-500">QR:</span> {f.anchor_qr_token ? "configured" : "—"}</span>
              <span><span className="text-gray-400 dark:text-gray-500">Lat:</span> {f.latitude.toFixed(5)}</span>
              <span><span className="text-gray-400 dark:text-gray-500">Lng:</span> {f.longitude.toFixed(5)}</span>
            </div>
            <a
              href={mapsSearchUrl(`${f.latitude},${f.longitude}`)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              <ExternalLink size={12} /> View on map
            </a>
          </div>
        ))}
      </div>

      {/* Add fence */}
      <div ref={addFormRef} className="p-5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg flex items-center justify-center shrink-0">
            <Plus className="text-gray-500 dark:text-gray-300" size={16} />
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-white">Add a site</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Pick the site on the map. You don&apos;t need to know coordinates — search the address or use your current location.
            </p>
          </div>
        </div>

        {/* 1. Choose the location */}
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">Find the site</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" size={14} />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(searchQuery); } }}
                  className={inputCls + " pl-9 pr-9"}
                  placeholder="Type an address, e.g. 21 Jump Street, Port Louis"
                  autoComplete="off"
                  spellCheck={false}
                />
                {searching && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 animate-spin" size={14} />
                )}
              </div>
              <button
                onClick={() => runSearch(searchQuery)}
                disabled={searching || !searchQuery.trim()}
                className="flex items-center gap-1.5 px-3 py-2 bg-gray-900 dark:bg-white hover:bg-gray-800 dark:hover:bg-gray-100 text-white dark:text-gray-900 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                <Search size={14} />
                Search
              </button>
            </div>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1.5">
              Start typing and suggestions appear automatically.
            </p>
            {searchError && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5">
                {searchError}
              </p>
            )}
            {searchResults.length > 0 && (
              <div className="mt-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 overflow-hidden">
                {searchResults.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => pickSearchResult(r)}
                    className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 border-b last:border-b-0 border-gray-100 dark:border-gray-800"
                  >
                    {r.display_name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">&nbsp;</label>
            <button
              onClick={useMyLocation}
              disabled={locating}
              className="flex items-center justify-center gap-2 w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              {locating ? <Loader2 size={14} className="animate-spin" /> : <LocateFixed size={14} />}
              {locating ? "Getting your location…" : "Use my current location"}
            </button>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1.5">
              Great when you&apos;re standing at the site. You can still adjust the pin below.
            </p>
          </div>
        </div>

        {/* Interactive map — every existing site + the draft pin for a new one.
            Click anywhere to drop/relocate the pin; drag it to fine-tune. */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
              All your sites <span className="font-normal text-gray-400 dark:text-gray-500">({config.geofences.length})</span>
            </label>
            {hasDraftCoords && (
              <a
                href={mapsSearchUrl(`${draftLat},${draftLng}`)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
              >
                <ExternalLink size={11} /> Open in Google Maps
              </a>
            )}
          </div>
          <SiteMap
            sites={config.geofences}
            draft={hasDraftCoords ? { latitude: draftLat, longitude: draftLng, radius_meters: radiusM } : null}
            onPick={(lat, lng) => {
              setDraft((d) => ({ ...d, latitude: String(lat), longitude: String(lng) }));
              setSearchedAddress("Pin set — looking up address…");
              reverseGeocode(lat, lng)
                .then((addr) => {
                  setDraft((d) => ({ ...d, address: addr }));
                  setSearchedAddress(addr || "");
                })
                .catch(() => setSearchedAddress(""));
            }}
          />
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
            <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-indigo-500" /> New site pin</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-emerald-500" /> Active site</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-gray-400" /> Paused site</span>
            <span className="text-gray-400 dark:text-gray-500">Click the map to set the pin, drag to fine-tune.</span>
          </p>
          {searchedAddress && (
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1 truncate">
              {searchedAddress}
            </p>
          )}
        </div>

        {/* 2. Details */}
        <div className="grid sm:grid-cols-2 gap-3">
          <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            className={inputCls} placeholder="Site name (e.g. HQ)" />
          <input type="number" min={10} max={5000} value={draft.radius_meters}
            onChange={(e) => setDraft((d) => ({ ...d, radius_meters: parseInt(e.target.value) || 200 }))}
            className={inputCls} placeholder="Fence radius (metres)" />
          <select value={draft.mode} onChange={(e) => setDraft((d) => ({ ...d, mode: e.target.value as "block" | "flag" }))}
            className={inputCls}>
            <option value="block">Block — reject punches outside</option>
            <option value="flag">Flag — allow + mark for review</option>
          </select>
          <input value={draft.anchor_qr_token} onChange={(e) => setDraft((d) => ({ ...d, anchor_qr_token: e.target.value }))}
            className={inputCls} placeholder="QR anchor token (optional)" />
        </div>

        {/* Advanced coordinates (auto-filled — rarely needs manual editing) */}
        <details className="group">
          <summary className="cursor-pointer text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            Advanced — exact coordinates
          </summary>
          <div className="grid sm:grid-cols-2 gap-3 mt-2">
            <input value={draft.latitude} onChange={(e) => setDraft((d) => ({ ...d, latitude: e.target.value }))}
              className={inputCls} placeholder="Latitude (e.g. -20.16)" inputMode="decimal" />
            <input value={draft.longitude} onChange={(e) => setDraft((d) => ({ ...d, longitude: e.target.value }))}
              className={inputCls} placeholder="Longitude (e.g. 57.50)" inputMode="decimal" />
          </div>
        </details>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
            <input type="checkbox" checked={draft.active} onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))}
              className="accent-gray-900 dark:accent-white" />
            Active immediately
          </label>
          <button onClick={addFence} disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 dark:bg-white hover:bg-gray-800 dark:hover:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ml-auto">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Add site
          </button>
        </div>
      </div>

      {/* Delete + reassign modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => !saving && setDeleteTarget(null)}>
          <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-xl p-6 shadow-xl border border-gray-200 dark:border-gray-800" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Delete “{deleteTarget.name}”?</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {deleteTarget.employee_count && deleteTarget.employee_count > 0
                ? <>
                    <span className="font-semibold text-amber-600 dark:text-amber-400">
                      {deleteTarget.employee_count} employee{deleteTarget.employee_count === 1 ? "" : "s"}
                    </span>{" "}
                    {deleteTarget.employee_count === 1 ? "is" : "are"} assigned to this site. Pick a site to move them to, or leave them unassigned. Historical payslips keep this site&apos;s name.
                  </>
                : "No employees are assigned to this site. Historical payslips keep this site's name."}
            </p>
            {deleteTarget.employee_count && deleteTarget.employee_count > 0 && (
              <div className="mt-3">
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                  Move assigned employees to
                </label>
                <select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)} className={inputCls}>
                  <option value="">— Leave unassigned —</option>
                  {config.geofences
                    .filter((g) => g.geofence_id !== deleteTarget.geofence_id)
                    .map((g) => <option key={g.geofence_id} value={g.geofence_id}>{g.name}</option>)}
                </select>
              </div>
            )}
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setDeleteTarget(null)} disabled={saving}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50">
                Cancel
              </button>
              <button onClick={confirmDelete} disabled={saving}
                className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                {saving ? "Deleting…" : "Delete site"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}