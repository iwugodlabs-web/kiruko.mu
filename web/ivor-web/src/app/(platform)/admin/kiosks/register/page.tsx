"use client";

/**
 * M28 — Kiosk device registration.
 *
 * Full-page form (not a modal) because the response carries a one-time
 * 50-character token that admins must copy verbatim — better legibility
 * outside a popup. After successful registration the form is replaced
 * by a token-display panel with a copy-to-clipboard control.
 *
 * Pre-fills the company picker from a `?company_id=` query param so the
 * list page's "Register the first one" CTA jumps straight into context.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Loader2,
  Plus,
  Tablet,
} from "lucide-react";
import { toast } from "sonner";

import RoleGuard from "../../../components/RoleGuard";
import { getAdminCompanies, type CompanySummary } from "@/services/api";
import {
  isKioskError,
  kioskAdmin,
} from "@/services/kioskAdminApi";
import type {
  KioskRegisterResponse,
} from "../../../../../../../../shared/types/payroll";


function RegisterKioskSection() {
  const router = useRouter();
  const params = useSearchParams();
  const initialCompanyId = useMemo(() => {
    const raw = params.get("company_id");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  }, [params]);

  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [companyId, setCompanyId] = useState<number | null>(initialCompanyId);
  const [deviceName, setDeviceName] = useState("");
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<KioskRegisterResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await getAdminCompanies(200);
      if (cancelled) return;
      if (Array.isArray(r)) {
        const active = r.filter((c) => c.status !== "deleted");
        setCompanies(active);
        // If no preselected company, default to the first one for convenience.
        if (companyId === null && active.length > 0) {
          setCompanyId(active[0].company_id);
        }
      } else {
        toast.error(r.error ?? "Failed to load companies");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (companyId === null) {
      toast.error("Pick a company first");
      return;
    }
    if (!deviceName.trim()) {
      toast.error("Device name is required");
      return;
    }

    // Build the optional location payload — only include the keys the
    // admin actually filled in, so the JSONB column doesn't store empty
    // strings as "0" coords.
    const location: { latitude?: number; longitude?: number; address?: string } = {};
    if (address.trim()) location.address = address.trim();
    const lat = latitude.trim() === "" ? NaN : Number(latitude);
    const lng = longitude.trim() === "" ? NaN : Number(longitude);
    if (Number.isFinite(lat)) location.latitude = lat;
    if (Number.isFinite(lng)) location.longitude = lng;

    setSubmitting(true);
    const r = await kioskAdmin.register(companyId, {
      device_name: deviceName.trim(),
      location: Object.keys(location).length > 0 ? location : null,
    });
    setSubmitting(false);

    if (isKioskError(r)) {
      toast.error(r.error);
      return;
    }
    setResult(r);
    toast.success(`Registered "${r.device_name}"`);
  }, [companyId, deviceName, address, latitude, longitude]);

  const copyToken = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.api_token);
      toast.success("Token copied to clipboard");
    } catch {
      toast.error("Couldn't copy — select the text manually");
    }
  };

  // -----------------------------------------------------------------
  // Render — token-display state or form state.
  // -----------------------------------------------------------------

  if (result) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-6">
          <Link
            href="/admin/kiosks"
            className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white inline-flex items-center gap-1"
          >
            <ArrowLeft className="h-4 w-4" /> Back to devices
          </Link>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-green-200 dark:border-green-900 shadow-sm overflow-hidden">
          <div className="bg-green-50 dark:bg-green-950/40 border-b border-green-200 dark:border-green-900 px-6 py-4 flex items-center gap-2 text-green-900 dark:text-green-400">
            <CheckCircle2 className="h-5 w-5" />
            <h1 className="text-lg font-semibold">
              Device &quot;{result.device_name}&quot; registered
            </h1>
          </div>

          <div className="p-6 space-y-5">
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 p-3 text-amber-900 dark:text-amber-400">
              <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <strong>This is the only time this token will be shown.</strong>{" "}
                Copy it now and paste it into the kiosk tablet. After leaving
                this page there is no way to retrieve it — only rotation can
                issue a new one.
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">API token</div>
              <div className="flex gap-2">
                <textarea
                  readOnly
                  value={result.api_token}
                  rows={3}
                  onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                  className="flex-1 font-mono text-xs bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 dark:text-white rounded-lg px-3 py-2 select-all"
                />
                <button
                  type="button"
                  onClick={copyToken}
                  autoFocus
                  className="px-4 py-2 bg-gray-900 hover:bg-black text-white rounded-lg flex items-center gap-1.5"
                >
                  <Copy className="h-4 w-4" /> Copy
                </button>
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Admin PIN</div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-2xl font-bold tracking-[0.3em] text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-2">
                  {result.admin_pin}
                </span>
                <button
                  type="button"
                  onClick={async () => { try { await navigator.clipboard.writeText(result.admin_pin); toast.success("Admin PIN copied"); } catch { toast.error("Couldn't copy"); } }}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-1.5"
                >
                  <Copy className="h-4 w-4" /> Copy
                </button>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                Enter this on the tablet at setup. It&apos;s required to exit kiosk mode or re-enter the token later — no uninstall needed.
              </p>
            </div>

            <div className="text-xs text-gray-500 dark:text-gray-400">
              Token expires {new Date(result.token_expires_at).toLocaleString()}.
              You can rotate it at any time from the device list.
            </div>

            <div className="flex gap-2 pt-4 border-t border-gray-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => {
                  setResult(null);
                  setDeviceName("");
                  setAddress("");
                  setLatitude("");
                  setLongitude("");
                }}
                className="px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg flex items-center gap-1.5"
              >
                <Plus className="h-4 w-4" /> Register another
              </button>
              <button
                type="button"
                onClick={() => router.push("/admin/kiosks")}
                className="px-4 py-2 bg-gray-900 hover:bg-black text-white rounded-lg"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <Link
          href="/admin/kiosks"
          className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-4 w-4" /> Back to devices
        </Link>
      </div>

      <h1 className="flex items-center gap-2 mb-2 text-[2rem] font-display font-semibold text-gray-900 dark:text-white leading-tight tracking-tight">
        <Tablet className="h-6 w-6" /> Register kiosk device
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Create the credentials for a new tablet. You&apos;ll receive a one-time
        token to paste into the kiosk client.
      </p>

      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Company <span className="text-red-500">*</span>
          </label>
          <select
            value={companyId ?? ""}
            onChange={(e) => setCompanyId(Number(e.target.value))}
            required
            className="w-full border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900"
          >
            {companies.length === 0 && <option value="">Loading companies…</option>}
            {companies.map((c) => (
              <option key={c.company_id} value={c.company_id}>
                {c.country_code ? `[${c.country_code}] ` : ""}{c.company_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Device name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            placeholder='e.g. "Main Entrance — Reception"'
            maxLength={120}
            required
            className="w-full border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900"
          />
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Used to identify the device in admin lists + audit logs.
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Location <span className="text-gray-400 dark:text-gray-500 font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Street address or short description"
            className="w-full border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900"
          />
          <div className="grid grid-cols-2 gap-2 mt-2">
            <input
              type="text"
              inputMode="decimal"
              value={latitude}
              onChange={(e) => setLatitude(e.target.value)}
              placeholder="Latitude (e.g. -20.16)"
              className="border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900"
            />
            <input
              type="text"
              inputMode="decimal"
              value={longitude}
              onChange={(e) => setLongitude(e.target.value)}
              placeholder="Longitude (e.g. 57.50)"
              className="border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900"
            />
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Stored as JSONB; used by the admin device list for context.
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-gray-100 dark:border-gray-800">
          <Link
            href="/admin/kiosks"
            className="px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting || companyId === null || !deviceName.trim()}
            className="px-4 py-2 bg-gray-900 hover:bg-black text-white rounded-lg flex items-center gap-1.5 disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Registering…
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" /> Register device
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}


export default function RegisterKioskPage() {
  return (
    <RoleGuard>
      <RegisterKioskSection />
    </RoleGuard>
  );
}
