"use client";

/**
 * M28 — Admin kiosk device management.
 *
 * Single-page UI for platform admins (RoleGuard default-denies non-platform).
 * Workflow:
 *   1. Pick a company from the dropdown (fetched via getAdminCompanies).
 *   2. See its registered kiosk devices in a table — name, location, status,
 *      last_seen_at, token expiry.
 *   3. Per-row actions: rotate token (opens a one-time-display modal),
 *      deactivate (ConfirmModal).
 *   4. CTA at the top: link to /admin/kiosks/register for new devices.
 *
 * The "register a new device" flow lives at /admin/kiosks/register so the
 * one-time token display can occupy a full screen (more legible than a
 * modal for a 50-character secret).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  KeyRound,
  Plus,
  RotateCw,
  ShieldOff,
  Tablet,
  Wifi,
} from "lucide-react";
import { toast } from "sonner";

import RoleGuard from "../../components/RoleGuard";
import Modal, { ConfirmModal } from "@/components/Modal";
import FilterSelect from "@/components/ui/FilterSelect";
import { getAdminCompanies, type CompanySummary } from "@/services/api";
import {
  isKioskError,
  kioskAdmin,
  type KioskFleetItem,
} from "@/services/kioskAdminApi";
import type {
  KioskListItem,
  KioskRotateResponse,
} from "../../../../../../../shared/types/payroll";


// Health thresholds, kept here so the fleet overview and the per-row badges
// agree on what "offline" / "expiring" mean.
const STALE_MS = 24 * 3600 * 1000;        // no heartbeat in 24h → likely offline
const EXPIRING_MS = 7 * 24 * 3600 * 1000; // token expires within 7 days

function isStale(iso: string | null): boolean {
  if (!iso) return true;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return true;
  return Date.now() - d.getTime() > STALE_MS;
}

function isExpiringSoon(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  const ms = d.getTime() - Date.now();
  return ms > 0 && ms < EXPIRING_MS;
}


function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}


function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}


/**
 * Inline one-time-token display. Identical visual to the post-registration
 * panel so admins recognize "this is the only time you see this." Auto-
 * focuses the copy button to encourage immediate action.
 */
function OneTimeTokenModal({
  open,
  token,
  expiresAt,
  onClose,
}: {
  open: boolean;
  token: string | null;
  expiresAt: string | null;
  onClose: () => void;
}) {
  if (!open || !token) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      toast.success("Token copied to clipboard");
    } catch {
      toast.error("Couldn't copy — select the text manually");
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title="New kiosk token" size="lg">
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 p-3 text-amber-900 dark:text-amber-400">
          <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <strong>This is the only time this token will be shown.</strong>{" "}
            Copy it now and paste it into the kiosk tablet. After closing this
            dialog there is no way to retrieve it.
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">API token</div>
          <div className="flex gap-2">
            <textarea
              readOnly
              value={token}
              rows={3}
              onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              className="flex-1 font-mono text-xs bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 dark:text-white rounded-lg px-3 py-2 select-all"
            />
            <button
              type="button"
              onClick={copy}
              autoFocus
              className="px-4 py-2 bg-gray-900 hover:bg-black text-white rounded-lg flex items-center gap-1.5"
            >
              <Copy className="h-4 w-4" /> Copy
            </button>
          </div>
        </div>

        {expiresAt && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Expires {formatDate(expiresAt)}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg"
          >
            I&apos;ve copied it
          </button>
        </div>
      </div>
    </Modal>
  );
}


/**
 * Fleet-health overview across ALL companies. Sits above the per-company
 * management table and answers "is anything wrong across the whole fleet?":
 * how many tablets are online, how many have gone quiet, and which tokens are
 * about to expire. Clicking a flagged device jumps the table to its company.
 */
function FleetHealth({ onJumpToCompany }: { onJumpToCompany: (companyId: number) => void }) {
  const [fleet, setFleet] = useState<KioskFleetItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await kioskAdmin.fleet();
      if (cancelled) return;
      if (isKioskError(r)) {
        toast.error(r.error);
        setFleet([]);
      } else {
        setFleet(r.data);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const stats = useMemo(() => {
    let online = 0, offline = 0, expiring = 0;
    for (const d of fleet) {
      if (isStale(d.last_seen_at)) offline += 1; else online += 1;
      if (isExpiringSoon(d.token_expires_at)) expiring += 1;
    }
    return { total: fleet.length, online, offline, expiring };
  }, [fleet]);

  // Devices that need an admin's attention: offline or token expiring soon.
  const needsAttention = useMemo(
    () => fleet.filter((d) => isStale(d.last_seen_at) || isExpiringSoon(d.token_expires_at)),
    [fleet],
  );

  if (loading) {
    return <div className="mb-6 p-4 text-sm text-gray-500 dark:text-gray-400">Loading fleet health…</div>;
  }
  if (fleet.length === 0) {
    return (
      <div className="mb-6 p-4 rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-800 text-sm text-gray-500 dark:text-gray-400">
        No active kiosk devices across any company yet.
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-lg border border-gray-200 dark:border-gray-800 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Wifi className="h-4 w-4 text-gray-500 dark:text-gray-400" />
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Fleet health</h2>
        <span className="text-xs text-gray-400 dark:text-gray-500">across all companies</span>
      </div>
      <div className="flex flex-wrap gap-2 text-xs mb-1">
        <span className="inline-flex items-center gap-1 rounded bg-green-100 dark:bg-green-950/40 text-green-800 dark:text-green-400 px-2 py-1">
          <CheckCircle2 className="h-3 w-3" /> {stats.online} online
        </span>
        <span className="inline-flex items-center gap-1 rounded bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400 px-2 py-1">
          <AlertTriangle className="h-3 w-3" /> {stats.offline} offline (24h+)
        </span>
        <span className="inline-flex items-center gap-1 rounded bg-orange-100 dark:bg-orange-950/40 text-orange-800 dark:text-orange-400 px-2 py-1">
          <Clock className="h-3 w-3" /> {stats.expiring} token{stats.expiring === 1 ? "" : "s"} expiring &lt;7d
        </span>
        <span className="text-gray-400 dark:text-gray-500 self-center">·</span>
        <span className="text-gray-500 dark:text-gray-400 self-center">{stats.total} active devices</span>
      </div>

      {needsAttention.length > 0 && (
        <div className="mt-3 border-t border-gray-100 dark:border-gray-800 pt-3">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Needs attention</div>
          <div className="space-y-1">
            {needsAttention.map((d) => {
              const offline = isStale(d.last_seen_at);
              const expiring = isExpiringSoon(d.token_expires_at);
              return (
                <button
                  key={d.device_id}
                  type="button"
                  onClick={() => onJumpToCompany(d.company_id)}
                  className="w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
                  title="Jump to this company's devices below"
                >
                  <Tablet className="h-3 w-3 text-gray-400 dark:text-gray-500 shrink-0" />
                  <span className="font-medium">{d.device_name}</span>
                  <span className="text-gray-400 dark:text-gray-500">·</span>
                  <span className="text-gray-500 dark:text-gray-400">{d.company_name}</span>
                  <span className="ml-auto flex items-center gap-1">
                    {offline && (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400 px-1.5 py-0.5">
                        <AlertTriangle className="h-3 w-3" /> {d.last_seen_at ? relativeTime(d.last_seen_at) : "never seen"}
                      </span>
                    )}
                    {expiring && (
                      <span className="inline-flex items-center gap-1 rounded bg-orange-100 dark:bg-orange-950/40 text-orange-800 dark:text-orange-400 px-1.5 py-0.5">
                        <Clock className="h-3 w-3" /> expires {formatDate(d.token_expires_at)}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}


function KiosksAdminSection() {
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);
  const [devices, setDevices] = useState<KioskListItem[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(false);

  // Action state
  const [rotatedToken, setRotatedToken] = useState<KioskRotateResponse | null>(null);
  const [rotatedPin, setRotatedPin] = useState<{ device_name: string; admin_pin: string } | null>(null);
  const [deactivating, setDeactivating] = useState<KioskListItem | null>(null);
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);

  // -------------------------------------------------------------------
  // Companies bootstrap. Only fires once — companies don't churn here.
  // -------------------------------------------------------------------

  // v1.6 polish — accept `?company_id=` so the employer-detail page's
  // "Kiosk Devices" link lands here pre-filtered to that company. Falls
  // through to the first active company if the param is missing.
  const params = useSearchParams();
  const initialCompanyId = useMemo(() => {
    const raw = params.get("company_id");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  }, [params]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await getAdminCompanies(200);
      if (cancelled) return;
      if (Array.isArray(r)) {
        const active = r.filter((c) => c.status !== "deleted");
        setCompanies(active);
        if (selectedCompanyId === null) {
          const preselect = initialCompanyId != null && active.some((c) => c.company_id === initialCompanyId)
            ? initialCompanyId
            : (active[0]?.company_id ?? null);
          if (preselect !== null) setSelectedCompanyId(preselect);
        }
      } else {
        toast.error(r.error ?? "Failed to load companies");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCompanyId]);

  // -------------------------------------------------------------------
  // Devices list. Refetches on company change OR includeInactive toggle.
  // -------------------------------------------------------------------

  const loadDevices = useCallback(async () => {
    if (selectedCompanyId === null) return;
    setLoadingDevices(true);
    const r = await kioskAdmin.list(selectedCompanyId, { includeInactive });
    if (isKioskError(r)) {
      toast.error(r.error);
      setDevices([]);
    } else {
      setDevices(r);
    }
    setLoadingDevices(false);
  }, [selectedCompanyId, includeInactive]);

  useEffect(() => { loadDevices(); }, [loadDevices]);

  // -------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------

  const handleRotate = async (device: KioskListItem) => {
    setActionInFlight(device.device_id);
    const r = await kioskAdmin.rotateToken(device.device_id);
    setActionInFlight(null);
    if (isKioskError(r)) {
      toast.error(r.error);
      return;
    }
    setRotatedToken(r);
    loadDevices();
  };

  const handleRotatePin = async (device: KioskListItem) => {
    setActionInFlight(device.device_id);
    const r = await kioskAdmin.rotateAdminPin(device.device_id);
    setActionInFlight(null);
    if (isKioskError(r)) {
      toast.error(r.error);
      return;
    }
    setRotatedPin({ device_name: device.device_name, admin_pin: r.admin_pin });
  };

  const handleDeactivate = async () => {
    if (!deactivating) return;
    setActionInFlight(deactivating.device_id);
    const r = await kioskAdmin.deactivate(deactivating.device_id);
    setActionInFlight(null);
    if (typeof r === "object" && r !== null && "error" in (r as object)) {
      toast.error((r as { error: string }).error);
      return;
    }
    toast.success(`Deactivated "${deactivating.device_name}"`);
    setDeactivating(null);
    loadDevices();
  };

  const selectedCompany = useMemo(
    () => companies.find((c) => c.company_id === selectedCompanyId) ?? null,
    [companies, selectedCompanyId],
  );

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-6 pb-5 border-b border-gray-200 dark:border-gray-800">
        <div>
          <h1 className="flex items-center gap-2 text-[2rem] font-display font-semibold text-gray-900 dark:text-white leading-tight tracking-tight">
            <Tablet className="h-6 w-6" /> Kiosk Devices
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Registered tablets that let employees clock in at the entrance.
          </p>
        </div>
        <Link
          href={
            selectedCompanyId !== null
              ? `/admin/kiosks/register?company_id=${selectedCompanyId}`
              : "/admin/kiosks/register"
          }
          className="px-4 py-2 bg-gray-900 hover:bg-black text-white rounded-lg flex items-center gap-1.5"
        >
          <Plus className="h-4 w-4" /> Register device
        </Link>
      </div>

      {/* Fleet-wide health across all companies */}
      <FleetHealth onJumpToCompany={setSelectedCompanyId} />

      {/* Company picker + filter */}
      <div className="flex items-center gap-4 mb-4">
        <FilterSelect
          label="Company"
          value={String(selectedCompanyId ?? "")}
          onChange={(v) => setSelectedCompanyId(v ? Number(v) : null)}
          selectClassName="min-w-[240px]"
          options={
            companies.length === 0
              ? [{ value: "", label: "No companies" }]
              : companies.map((c) => ({
                  value: String(c.company_id),
                  label: `${c.country_code ? `[${c.country_code}] ` : ""}${c.company_name}${c.status && c.status !== "active" ? ` (${c.status})` : ""}`,
                }))
          }
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          Include deactivated
        </label>
      </div>

      {/* Devices table */}
      {loadingDevices ? (
        <div className="p-12 text-center text-gray-500 dark:text-gray-400">Loading devices…</div>
      ) : devices.length === 0 ? (
        <div className="p-12 text-center bg-gray-50 dark:bg-gray-800/60 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg">
          <Tablet className="h-10 w-10 mx-auto text-gray-400 dark:text-gray-500 mb-3" />
          <div className="text-gray-600 dark:text-gray-400 mb-3">
            No kiosk devices registered for {selectedCompany?.company_name ?? "this company"} yet.
          </div>
          {selectedCompanyId !== null && (
            <Link
              href={`/admin/kiosks/register?company_id=${selectedCompanyId}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-sm rounded-lg"
            >
              <Plus className="h-3 w-3" /> Register the first one
            </Link>
          )}
        </div>
      ) : (
        <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-800">
              <tr className="text-left">
                <th className="px-4 py-2 font-medium">Device</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Last seen</th>
                <th className="px-4 py-2 font-medium">Token expires</th>
                <th className="px-4 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.device_id} className="border-b border-gray-100 dark:border-gray-800 last:border-b-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{d.device_name}</div>
                    {d.location && (d.location.latitude || d.location.address) && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {d.location.address ?? `${d.location.latitude}, ${d.location.longitude}`}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {d.is_active ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-green-100 dark:bg-green-950/40 text-green-800 dark:text-green-400 text-xs">
                        <CheckCircle2 className="h-3 w-3" /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs">
                        <ShieldOff className="h-3 w-3" /> Deactivated
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400" title={d.last_seen_at ?? "Never"}>
                    {relativeTime(d.last_seen_at)}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                    {formatDate(d.token_expires_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <button
                        type="button"
                        disabled={!d.is_active || actionInFlight === d.device_id}
                        onClick={() => handleRotate(d)}
                        className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-1 disabled:opacity-50"
                      >
                        <RotateCw className="h-3 w-3" /> Rotate
                      </button>
                      <button
                        type="button"
                        disabled={!d.is_active || actionInFlight === d.device_id}
                        onClick={() => handleRotatePin(d)}
                        title="Regenerate the admin PIN entered on the tablet to manage the kiosk"
                        className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-1 disabled:opacity-50"
                      >
                        <KeyRound className="h-3 w-3" /> PIN
                      </button>
                      <button
                        type="button"
                        disabled={!d.is_active || actionInFlight === d.device_id}
                        onClick={() => setDeactivating(d)}
                        className="px-2 py-1 text-xs border border-red-300 dark:border-red-900 text-red-700 dark:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center gap-1 disabled:opacity-50"
                      >
                        <ShieldOff className="h-3 w-3" /> Deactivate
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rotatedPin && (
        <Modal isOpen onClose={() => setRotatedPin(null)} title="New admin PIN" size="md">
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 p-3 text-amber-900 dark:text-amber-400 text-sm">
              <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
              <span>
                Shown once. The old PIN for “{rotatedPin.device_name}” stops working
                now — enter this new one on the tablet (gear → admin PIN, or at setup).
              </span>
            </div>
            <div className="flex items-center justify-center py-2">
              <span className="font-mono text-4xl font-bold tracking-[0.4em] text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl px-6 py-3">
                {rotatedPin.admin_pin}
              </span>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={async () => { try { await navigator.clipboard.writeText(rotatedPin.admin_pin); toast.success("Admin PIN copied"); } catch { toast.error("Couldn't copy"); } }}
                className="px-4 py-2 bg-gray-900 hover:bg-black text-white rounded-lg flex items-center gap-1.5"
              >
                <Copy className="h-4 w-4" /> Copy
              </button>
              <button
                type="button"
                onClick={() => setRotatedPin(null)}
                className="px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg"
              >
                Done
              </button>
            </div>
          </div>
        </Modal>
      )}

      <OneTimeTokenModal
        open={rotatedToken !== null}
        token={rotatedToken?.api_token ?? null}
        expiresAt={rotatedToken?.token_expires_at ?? null}
        onClose={() => setRotatedToken(null)}
      />

      <ConfirmModal
        isOpen={deactivating !== null}
        onClose={() => setDeactivating(null)}
        onConfirm={handleDeactivate}
        title="Deactivate kiosk device?"
        message={
          deactivating
            ? `The token on "${deactivating.device_name}" will stop validating immediately. The tablet will be unable to clock anyone in until you register a new device or re-activate this one (not yet supported — it's a permanent disable).`
            : ""
        }
        confirmText="Deactivate"
        type="danger"
      />
    </div>
  );
}


export default function KiosksAdminPage() {
  return (
    <RoleGuard>
      <KiosksAdminSection />
    </RoleGuard>
  );
}
