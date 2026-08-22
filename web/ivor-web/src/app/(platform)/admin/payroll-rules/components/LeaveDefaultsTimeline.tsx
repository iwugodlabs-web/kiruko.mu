"use client";

import { useCallback, useEffect, useState } from "react";
import {
  payrollRules,
  type CountryLeaveDefault,
  type CountryLeaveDefaultCreate,
} from "@/services/payroll-api";
import { toast } from "sonner";
import { Plus, RefreshCcw, X } from "lucide-react";
import TimelineCard, { deriveVersionStatus } from "./TimelineCard";
import { postSupersede } from "./supersedeRequest";
import AddVersionStepUpFlow from "./AddVersionStepUpFlow";
import ExampleCallout from "@/components/ui/ExampleCallout";
import RuleSummary from "./RuleSummary";


function isError<T>(v: T | { error: string; status?: number }): v is { error: string; status?: number } {
  return typeof v === "object" && v !== null && "error" in v;
}


function leaveSummary(v: CountryLeaveDefault): string {
  const accrual = String(v.accrual_method).toLowerCase().replace(/_/g, " ");
  const parts = [`${v.label}: ${v.days_per_year} days per year, accrued ${accrual}.`];
  parts.push(v.carry_forward_max != null ? `Up to ${v.carry_forward_max} days carry over.` : "No carry-over.");
  parts.push(v.encashable ? "Unused days are encashable." : "Unused days are not encashable.");
  if (v.min_service_months) parts.push(`Available after ${v.min_service_months} months of service.`);
  return parts.join(" ");
}


function group(rows: CountryLeaveDefault[]): Map<string, CountryLeaveDefault[]> {
  const m = new Map<string, CountryLeaveDefault[]>();
  for (const r of rows) {
    if (!m.has(r.leave_type_code)) m.set(r.leave_type_code, []);
    m.get(r.leave_type_code)!.push(r);
  }
  for (const arr of m.values()) arr.sort((a, b) => b.version - a.version);
  return m;
}


export default function LeaveDefaultsTimeline({ countryCode }: { countryCode: string }) {
  const [rows, setRows] = useState<CountryLeaveDefault[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<string | null | "new">(null); // null=closed, "new"=fresh, code=preset

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await payrollRules.listLeaveDefaults(countryCode);
    if (isError(r)) { toast.error(r.error); setRows([]); } else setRows(r);
    setLoading(false);
  }, [countryCode]);

  useEffect(() => { refresh(); }, [refresh]);

  const grouped = group(rows);
  const codes = Array.from(grouped.keys()).sort();

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex-1">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {codes.length} leave type{codes.length !== 1 ? "s" : ""} configured (annual, sick, maternity, paternity, …).
            Update the entitlement when policy changes — old values stay on records that used them.
          </p>
          <ExampleCallout caption={countryCode === "MU" ? "Typical Mauritius leave defaults" : "Worked example (format only — not this country's real entitlements)"} className="mt-2">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-zinc-500 dark:text-zinc-400 uppercase">
                  <th className="text-left py-1 font-medium">Type</th>
                  <th className="text-right py-1 font-medium">Days/year</th>
                  <th className="text-left py-1 font-medium">Accrual</th>
                  <th className="text-right py-1 font-medium">Carry-forward</th>
                  <th className="text-left py-1 font-medium">Encashable</th>
                </tr>
              </thead>
              <tbody className="text-zinc-700 dark:text-zinc-300">
                <tr><td>Annual</td><td className="text-right">20</td><td>Monthly</td><td className="text-right">5</td><td>Yes</td></tr>
                <tr><td>Sick</td><td className="text-right">15</td><td>Annual</td><td className="text-right">—</td><td>No</td></tr>
                <tr><td>Maternity</td><td className="text-right">84</td><td>Annual</td><td className="text-right">—</td><td>No</td></tr>
                <tr><td>Paternity</td><td className="text-right">5</td><td>Annual</td><td className="text-right">—</td><td>No</td></tr>
              </tbody>
            </table>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">
              Min service months (e.g. 12) gates accrual eligibility. Encashable types pay out unused days at termination.
            </p>
          </ExampleCallout>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refresh} disabled={loading}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:bg-zinc-900/40 disabled:opacity-50">
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button onClick={() => setDialog("new")}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            <Plus className="h-4 w-4" />
            Update entitlement
          </button>
        </div>
      </div>

      {codes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-12 text-center">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No leave defaults seeded for {countryCode}.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {codes.map((code) => {
            const versions = grouped.get(code)!;
            return (
              <div key={code}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 font-mono">{code}</h3>
                  <button onClick={() => setDialog(code)} className="text-xs text-blue-600 hover:underline">
                    Add version for {code}
                  </button>
                </div>
                <div className="space-y-2">
                  {versions.map((v, i) => {
                    const prior = versions[i + 1];
                    return (
                      <TimelineCard
                        key={v.id}
                        version={v.version}
                        effectiveFrom={v.effective_from}
                        effectiveTo={v.effective_to ?? null}
                        sourceReference={v.source_reference}
                        changeReason={v.change_reason}
                        status={deriveVersionStatus(v.effective_from, v.effective_to)}
                        headline={`${v.days_per_year} days/yr · ${v.accrual_method}`}
                        body={
                          <div className="space-y-2">
                            <RuleSummary>{leaveSummary(v)}</RuleSummary>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                              <Field label="Days/year" value={v.days_per_year} />
                              <Field label="Accrual" value={v.accrual_method} />
                              <Field label="Carry fwd" value={v.carry_forward_max ?? "—"} />
                              <Field label="Encashable" value={v.encashable ? "yes" : "no"} />
                              <Field label="Min service (mo)" value={v.min_service_months} />
                              <Field label="Label" value={v.label} />
                            </div>
                          </div>
                        }
                        diff={prior ? <Diff prior={prior} current={v} /> : null}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AddDialog
        open={dialog !== null}
        countryCode={countryCode}
        presetCode={dialog === "new" ? null : dialog}
        presetLatestVersion={
          typeof dialog === "string" ? (grouped.get(dialog)?.[0]?.version ?? 0) : 0
        }
        onClose={() => setDialog(null)}
        onSaved={() => { setDialog(null); refresh(); }}
        onConflict={() => { setDialog(null); refresh(); }}
      />
    </div>
  );
}


function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded border border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 px-2 py-1.5">
      <div className="text-[10px] uppercase text-zinc-500 dark:text-zinc-400 tracking-wide">{label}</div>
      <div className="text-sm font-mono text-zinc-900 dark:text-zinc-100">{value}</div>
    </div>
  );
}


function Diff({ prior, current }: { prior: CountryLeaveDefault; current: CountryLeaveDefault }) {
  const fields = [
    { label: "days_per_year", old: String(prior.days_per_year), cur: String(current.days_per_year) },
    { label: "accrual_method", old: prior.accrual_method, cur: current.accrual_method },
    { label: "encashable", old: String(prior.encashable), cur: String(current.encashable) },
    { label: "min_service_months", old: String(prior.min_service_months), cur: String(current.min_service_months) },
  ];
  const changed = fields.filter((f) => f.old !== f.cur);
  if (changed.length === 0) return <p className="text-xs text-zinc-400 dark:text-zinc-500 italic">No value changes vs. v{prior.version}.</p>;
  return (
    <div className="text-xs">
      <div className="text-[10px] uppercase text-zinc-500 dark:text-zinc-400 mb-1">Changed vs. v{prior.version}</div>
      {changed.map((f) => (
        <div key={f.label} className="flex items-center gap-2 font-mono">
          <span className="text-zinc-500 dark:text-zinc-400">{f.label}:</span>
          <span className="text-red-600 line-through">{f.old}</span>
          <span className="text-zinc-400 dark:text-zinc-500">→</span>
          <span className="text-emerald-700">{f.cur}</span>
        </div>
      ))}
    </div>
  );
}


function AddDialog({
  open, countryCode, presetCode, presetLatestVersion, onClose, onSaved, onConflict,
}: {
  open: boolean; countryCode: string; presetCode: string | null;
  presetLatestVersion: number;
  onClose: () => void; onSaved: () => void; onConflict: () => void;
}) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [days, setDays] = useState("22");
  const [accrual, setAccrual] = useState<"monthly" | "annual" | "tenure_based">("annual");
  const [carryFwd, setCarryFwd] = useState("");
  const [encashable, setEncashable] = useState(false);
  const [minService, setMinService] = useState("0");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [sourceRef, setSourceRef] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      setCode(presetCode ?? "");
      setLabel("");
      setDays("22");
      setAccrual("annual");
      setCarryFwd("");
      setEncashable(false);
      setMinService("0");
      setEffectiveFrom(new Date().toISOString().slice(0, 10));
      setSourceRef("");
      setReason("");
    }
  }, [open, presetCode]);

  if (!open) return null;

  async function handleSubmit(token: string): Promise<{ ok: boolean; message?: string }> {
    if (!code.trim() || !label.trim() || !days.trim() || !effectiveFrom) {
      return { ok: false, message: "All marked fields are required" };
    }
    const payload: CountryLeaveDefaultCreate = {
      country_code: countryCode,
      leave_type_code: code.trim().toLowerCase(),
      label: label.trim(),
      days_per_year: Number(days),
      accrual_method: accrual,
      carry_forward_max: carryFwd ? Number(carryFwd) : null,
      encashable,
      min_service_months: Number(minService) || 0,
      effective_from: effectiveFrom,
      source_reference: sourceRef.trim() || null,
      change_reason: reason.trim() || null,
    };
    const result = await postSupersede({
      url: `/payroll-rules/${countryCode}/leave-defaults`,
      payload,
      stepUpToken: token,
      expectedLatestVersion: presetLatestVersion,
      onConflict,
    });
    if (result.ok) onSaved();
    return result;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 px-6 py-4">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            New leave default version{presetCode ? ` · ${presetCode}` : ""}
          </h2>
          <button onClick={onClose} className="text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:text-zinc-400">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FieldInput label="Leave type code" value={code} onChange={setCode} mono placeholder="annual, sick, maternity" />
            <FieldInput label="Label" value={label} onChange={setLabel} placeholder="e.g. Annual / local leave" />
            <FieldInput label="Days per year" value={days} onChange={setDays} type="number" />
            <div>
              <label className="block text-xs uppercase font-semibold text-zinc-500 dark:text-zinc-400 mb-1 tracking-wide">Accrual method</label>
              <select value={accrual} onChange={(e) => setAccrual(e.target.value as typeof accrual)}
                className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="annual">annual</option>
                <option value="monthly">monthly</option>
                <option value="tenure_based">tenure_based</option>
              </select>
            </div>
            <FieldInput label="Carry forward max" value={carryFwd} onChange={setCarryFwd} type="number" placeholder="(optional)" />
            <FieldInput label="Min service (months)" value={minService} onChange={setMinService} type="number" />
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 col-span-2 pt-1">
              <input type="checkbox" checked={encashable} onChange={(e) => setEncashable(e.target.checked)} />
              Encashable
            </label>
            <FieldInput label="Effective from" type="date" value={effectiveFrom} onChange={setEffectiveFrom} />
          </div>
          <FieldInput label="Source reference" value={sourceRef} onChange={setSourceRef}
            placeholder="e.g. Workers' Rights Act 2019 §X" />
          <FieldInput label="Change reason" value={reason} onChange={setReason} placeholder="Why this version" />
          <AddVersionStepUpFlow
            purpose="rule_supersede"
            description="Updating country leave rules requires a fresh OTP."
            onSubmit={handleSubmit}
          />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 dark:border-zinc-800 px-6 py-4">
          <button onClick={onClose} className="rounded-md border border-zinc-200 dark:border-zinc-800 px-4 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:bg-zinc-900/40">Cancel</button>
        </div>
      </div>
    </div>
  );
}


function FieldInput({
  label, value, onChange, type = "text", mono = false, placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; mono?: boolean; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs uppercase font-semibold text-zinc-500 dark:text-zinc-400 mb-1 tracking-wide">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${mono ? "font-mono" : ""}`}
      />
    </div>
  );
}
