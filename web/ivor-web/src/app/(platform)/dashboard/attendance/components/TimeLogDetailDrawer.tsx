"use client";

import { useEffect, useRef, useState } from "react";
import { X, MapPin, Clock, Coffee, AlertTriangle, Timer, Tablet, Camera, ShieldAlert } from "lucide-react";
import { TimeLogRow } from "./types";
import StatusBadge from "./StatusBadge";
import { api } from "@/services/apiClient";

interface Props {
  log: TimeLogRow | null;
  onClose: () => void;
}

interface CostPreviewBucket { code: string; label: string; hours: string; multiplier: string; amount: string; }
interface CostPreview { currency: string; buckets: CostPreviewBucket[]; added_total: string; premium_above_base: string; }

function fmtCurrency(amount: string, currency: string): string {
  const n = Number(amount);
  if (Number.isNaN(n)) return `${currency} ${amount}`;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

function fmt(iso: string | null, type: "full" | "time" | "date" = "full"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (type === "time") return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (type === "date") return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-4 py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <span className="text-sm text-gray-500 dark:text-gray-400 shrink-0">{label}</span>
      <span className="text-sm text-gray-900 dark:text-gray-100 text-right">{value}</span>
    </div>
  );
}

export default function TimeLogDetailDrawer({ log, onClose }: Props) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<CostPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewUnavailable, setPreviewUnavailable] = useState(false);

  // Fetch the OT cost preview when an unconfirmed-OT log is opened, so the
  // approver sees what confirming will cost before they act.
  useEffect(() => {
    setPreview(null);
    setPreviewUnavailable(false);
    if (!log || !log.is_overtime || log.overtime_confirmed_by_employer) return;
    let cancelled = false;
    setPreviewLoading(true);
    api.get(`/payroll/timelogs/${log.timelog_id}/overtime-cost-preview`)
      .then((r) => { if (!cancelled) setPreview(r.data); })
      .catch(() => { if (!cancelled) setPreviewUnavailable(true); })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [log]);

  // Close on Escape key
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Lock body scroll while open
  useEffect(() => {
    if (log) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [log]);

  if (!log) return null;

  const locationLabel = log.location
    ? ((log.location as Record<string, unknown>).address as string) ??
      `${(log.location as Record<string, unknown>).latitude}, ${(log.location as Record<string, unknown>).longitude}`
    : null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className="fixed right-0 top-0 h-full w-full max-w-md bg-white dark:bg-gray-900 z-50 shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">
              {log.employee_name}
              {log.employee_code && <span className="ml-1.5 font-mono text-xs font-normal text-gray-400 dark:text-gray-500">{log.employee_code}</span>}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{fmt(log.start_time, "date")}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {/* Status */}
          <div className="flex items-center justify-between">
            <StatusBadge status={log.status} />
            {log.is_overtime && (
              <span className={`flex items-center gap-1 text-xs font-medium ${log.overtime_confirmed_by_employer ? "text-amber-600 dark:text-amber-400" : "text-amber-500 dark:text-amber-300"}`}>
                <AlertTriangle size={12} />
                {log.overtime_confirmed_by_employer ? "OT Approved" : "OT Pending Approval"}
              </span>
            )}
          </div>

          {/* OT cost preview — only for unconfirmed overtime */}
          {log.is_overtime && !log.overtime_confirmed_by_employer && (previewLoading || preview || previewUnavailable) && (
            <section className="rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-4 py-3">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-widest mb-2">
                <Timer size={13} /> Cost of confirming
              </h3>
              {previewLoading ? (
                <p className="text-sm text-amber-700 dark:text-amber-300">Calculating…</p>
              ) : previewUnavailable ? (
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  Preview unavailable (employee may not be hourly-paid, or no overtime rule is set for the country).
                </p>
              ) : preview ? (
                <div className="space-y-2">
                  <p className="text-sm text-amber-900 dark:text-amber-200">
                    Confirming adds <span className="font-semibold">{fmtCurrency(preview.added_total, preview.currency)}</span>
                    {Number(preview.premium_above_base) > 0 && (
                      <> — <span className="font-semibold">{fmtCurrency(preview.premium_above_base, preview.currency)}</span> above base rate</>
                    )}.
                  </p>
                  {preview.buckets.length > 0 && (
                    <div className="space-y-1">
                      {preview.buckets.map((b) => (
                        <div key={b.code} className="flex items-center justify-between text-xs text-amber-800 dark:text-amber-300">
                          <span>{b.label} · {Number(b.hours).toFixed(2)}h × {Number(b.multiplier).toFixed(2).replace(/\.?0+$/, "")}×</span>
                          <span className="font-mono">{fmtCurrency(b.amount, preview.currency)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </section>
          )}

          {/* Session details */}
          <section>
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3">
              Session Details
            </h3>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-2">
              <Row label="Job Title" value={log.job_title ?? "—"} />
              <Row label="Department" value={log.department ?? "—"} />
              <Row
                label="Clock In"
                value={
                  <span className="flex items-center gap-1 justify-end">
                    <Clock size={12} className="text-gray-400" />
                    {fmt(log.start_time)}
                  </span>
                }
              />
              <Row
                label="Clock Out"
                value={log.end_time ? fmt(log.end_time) : <span className="text-green-500 font-medium">Still active</span>}
              />
              <Row label="Total Hours" value={log.hours_worked != null ? `${log.hours_worked.toFixed(2)}h` : "—"} />
              <Row label="Break Time" value={log.break_minutes > 0 ? `${log.break_minutes} min` : "No breaks"} />
              <Row
                label="Source"
                value={
                  <span className="inline-flex items-center gap-1.5 justify-end">
                    {log.created_source === "kiosk" && <Tablet size={12} className="text-gray-400" />}
                    <span className="capitalize">{log.created_source ?? "mobile"}</span>
                    {log.out_of_schedule && (
                      <span
                        className="inline-flex items-center gap-1 rounded bg-yellow-100 dark:bg-yellow-950/40 text-yellow-800 dark:text-yellow-400 px-1.5 py-0.5 text-[11px]"
                        title="Clock-in fell outside this employee's configured work hours (with grace) — review against their schedule."
                      >
                        <ShieldAlert size={11} /> Off-schedule
                      </span>
                    )}
                  </span>
                }
              />
            </div>
          </section>

          {/* Kiosk selfie — captured at clock-in on kiosk devices (buddy-punch
              deterrent). Only present when a kiosk clock-in attached a photo. */}
          {log.kiosk_photo_path && (
            <section>
              <h3 className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3">
                <Camera size={13} /> Kiosk photo
              </h3>
              <a
                href={`/uploads/${log.kiosk_photo_path}`}
                target="_blank"
                rel="noreferrer"
                title="Open full-size — compare the face to the employee to catch buddy-punching"
                className="block w-fit"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/uploads/${log.kiosk_photo_path}`}
                  alt={`Clock-in selfie for ${log.employee_name}`}
                  className="w-32 h-32 rounded-xl object-cover ring-1 ring-gray-200 dark:ring-gray-700"
                />
              </a>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                Captured at clock-in. Compare with the employee to verify it&apos;s really them.
              </p>
            </section>
          )}

          {/* Location */}
          {locationLabel && (
            <section>
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3">
                Location
              </h3>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-3 flex items-start gap-3">
                <MapPin size={16} className="text-red-500 shrink-0 mt-0.5" />
                <span className="text-sm text-gray-700 dark:text-gray-300 break-words">{locationLabel}</span>
              </div>
            </section>
          )}

          {/* Break timeline */}
          {log.breaks.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3">
                Break Timeline
              </h3>
              <div className="space-y-2">
                {log.breaks.map((b, i) => (
                  <div key={b.break_id} className="flex items-center gap-3 bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-3">
                    <Coffee size={14} className="text-gray-400 shrink-0" />
                    <div className="text-sm">
                      <span className="text-gray-600 dark:text-gray-400">Break {i + 1}: </span>
                      <span className="text-gray-900 dark:text-gray-100 font-mono">{fmt(b.start_time, "time")}</span>
                      <span className="text-gray-400 mx-1">→</span>
                      <span className="text-gray-900 dark:text-gray-100 font-mono">
                        {b.end_time ? fmt(b.end_time, "time") : <span className="text-amber-500">Ongoing</span>}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
