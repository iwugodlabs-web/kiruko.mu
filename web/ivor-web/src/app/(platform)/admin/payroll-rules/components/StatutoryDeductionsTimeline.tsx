"use client";

import { useCallback, useEffect, useState } from "react";
import {
  payrollRules,
  type StatutoryDeduction,
  type StatutoryDeductionCreate,
} from "@/services/payroll-api";
import { toast } from "sonner";
import { Plus, RefreshCcw, X } from "lucide-react";
import TimelineCard, { deriveVersionStatus } from "./TimelineCard";
import AddVersionStepUpFlow from "./AddVersionStepUpFlow";
import { isError } from "@/utils/payrollFormat";
import { postSupersede } from "./supersedeRequest";
import ExampleCallout from "@/components/ui/ExampleCallout";
import RuleSummary from "./RuleSummary";


function statutorySummary(v: StatutoryDeduction): string {
  const side = v.employer_or_employee === "employer" ? "the employer" : "the employee";
  const base = v.taxable_base ? ` of ${String(v.taxable_base).toLowerCase().replace(/_/g, " ")}` : "";
  const cap = v.threshold_high ? `, on earnings up to ${v.threshold_high}` : "";
  return `${formatRate(v.rate)}${base}, paid by ${side}${cap}.`;
}


function groupByCode(rows: StatutoryDeduction[]): Map<string, StatutoryDeduction[]> {
  const map = new Map<string, StatutoryDeduction[]>();
  for (const r of rows) {
    if (!map.has(r.code)) map.set(r.code, []);
    map.get(r.code)!.push(r);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => b.version - a.version); // newest first
  }
  return map;
}


function formatRate(rate: string): string {
  const n = Number(rate);
  if (Number.isNaN(n)) return rate;
  return `${(n * 100).toFixed(3).replace(/\.?0+$/, "")}%`;
}


export default function StatutoryDeductionsTimeline({ countryCode }: { countryCode: string }) {
  const [rows, setRows] = useState<StatutoryDeduction[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [presetCode, setPresetCode] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await payrollRules.listStatutoryDeductions(countryCode);
    if (isError(r)) {
      toast.error(r.error);
      setRows([]);
    } else {
      setRows(r);
    }
    setLoading(false);
  }, [countryCode]);

  useEffect(() => { refresh(); }, [refresh]);

  const grouped = groupByCode(rows);
  const codes = Array.from(grouped.keys()).sort();

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex-1">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {codes.length} deduction code{codes.length !== 1 ? "s" : ""} active.
            Update a code when its rate or threshold changes — previous values stay on finalized runs.
          </p>
          <ExampleCallout caption={countryCode === "MU" ? "Typical Mauritius statutory deductions" : "Worked example (format only — not this country's real deductions)"} className="mt-2">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-zinc-500 dark:text-zinc-400 uppercase">
                  <th className="text-left py-1 font-medium">Code</th>
                  <th className="text-left py-1 font-medium">Who pays</th>
                  <th className="text-left py-1 font-medium">Applied to</th>
                  <th className="text-right py-1 font-medium">Rate</th>
                </tr>
              </thead>
              <tbody className="text-zinc-700 dark:text-zinc-300">
                <tr><td>NPF</td><td>Employee</td><td>Basic</td><td className="text-right">3.0%</td></tr>
                <tr><td>CSG_EE</td><td>Employee</td><td>Gross</td><td className="text-right">1.5%</td></tr>
                <tr><td>CSG_ER</td><td>Employer</td><td>Gross</td><td className="text-right">3.0%</td></tr>
                <tr><td>NSF_EE</td><td>Employee</td><td>Basic</td><td className="text-right">1.0%</td></tr>
                <tr><td>NSF_ER</td><td>Employer</td><td>Basic</td><td className="text-right">2.5%</td></tr>
              </tbody>
            </table>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">
              EE codes are deducted from worker pay; ER codes are paid by the employer on top.
            </p>
          </ExampleCallout>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refresh} disabled={loading}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:bg-zinc-900/40 disabled:opacity-50">
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button onClick={() => { setPresetCode(null); setDialogOpen(true); }}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            <Plus className="h-4 w-4" />
            Update rate
          </button>
        </div>
      </div>

      {codes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-12 text-center">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No statutory deductions seeded for {countryCode} yet.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {codes.map((code) => {
            const versions = grouped.get(code)!;
            return (
              <div key={code}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 font-mono">{code}</h3>
                  <button
                    onClick={() => { setPresetCode(code); setDialogOpen(true); }}
                    className="text-xs text-blue-600 hover:underline"
                  >
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
                        headline={`${formatRate(v.rate)} · ${v.employer_or_employee}`}
                        body={
                          <div className="space-y-2">
                            <RuleSummary>{statutorySummary(v)}</RuleSummary>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                              <Field label="Rate" value={formatRate(v.rate)} />
                              <Field label="Side" value={v.employer_or_employee} />
                              <Field label="Base" value={v.taxable_base} />
                              <Field label="Threshold" value={v.threshold_high ? `≤ ${v.threshold_high}` : "—"} />
                            </div>
                          </div>
                        }
                        diff={prior ? <DiffRow prior={prior} current={v} /> : null}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AddStatutoryDialog
        open={dialogOpen}
        countryCode={countryCode}
        presetCode={presetCode}
        presetLatestVersion={presetCode ? (grouped.get(presetCode)?.[0]?.version ?? 0) : 0}
        onClose={() => setDialogOpen(false)}
        onSaved={() => { setDialogOpen(false); refresh(); }}
        onConflict={() => { setDialogOpen(false); refresh(); }}
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


function DiffRow({ prior, current }: { prior: StatutoryDeduction; current: StatutoryDeduction }) {
  const fields: Array<{ label: string; old: string; cur: string }> = [
    { label: "rate", old: prior.rate, cur: current.rate },
    { label: "threshold_high", old: prior.threshold_high ?? "—", cur: current.threshold_high ?? "—" },
    { label: "taxable_base", old: prior.taxable_base, cur: current.taxable_base },
  ];
  const changed = fields.filter((f) => f.old !== f.cur);
  if (changed.length === 0) {
    return <p className="text-xs text-zinc-400 dark:text-zinc-500 italic">No value changes vs. v{prior.version}.</p>;
  }
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


// ---------------------------------------------------------------------------
// Add-version dialog
// ---------------------------------------------------------------------------


interface DialogProps {
  open: boolean;
  countryCode: string;
  presetCode: string | null;
  presetLatestVersion: number;
  onClose: () => void;
  onSaved: () => void;
  onConflict: () => void;
}


function AddStatutoryDialog({ open, countryCode, presetCode, presetLatestVersion, onClose, onSaved, onConflict }: DialogProps) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [rate, setRate] = useState("");
  const [thresholdHigh, setThresholdHigh] = useState("");
  const [taxableBase, setTaxableBase] = useState<"basic" | "gross" | "custom">("gross");
  const [side, setSide] = useState<"employer" | "employee">("employee");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [sourceReference, setSourceReference] = useState("");
  const [changeReason, setChangeReason] = useState("");

  // Reset form when opening with a different preset
  useEffect(() => {
    if (open) {
      setCode(presetCode ?? "");
      setLabel("");
      setRate("");
      setThresholdHigh("");
      setTaxableBase("gross");
      setSide("employee");
      setEffectiveFrom(new Date().toISOString().slice(0, 10));
      setSourceReference("");
      setChangeReason("");
    }
  }, [open, presetCode]);

  if (!open) return null;

  async function handleSubmit(stepUpToken: string): Promise<{ ok: boolean; message?: string }> {
    if (!code.trim() || !label.trim() || !rate.trim() || !effectiveFrom) {
      return { ok: false, message: "Code, label, rate, and effective_from are required" };
    }
    const payload: StatutoryDeductionCreate = {
      country_code: countryCode,
      code: code.trim().toUpperCase(),
      label: label.trim(),
      rate: rate.trim(),
      threshold_low: null,
      threshold_high: thresholdHigh.trim() || null,
      taxable_base: taxableBase,
      employer_or_employee: side,
      effective_from: effectiveFrom,
      source_reference: sourceReference.trim() || null,
      change_reason: changeReason.trim() || null,
    };
    const result = await postSupersede({
      url: `/payroll-rules/${countryCode}/statutory-deductions`,
      payload,
      stepUpToken,
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
            New statutory deduction version{presetCode ? ` · ${presetCode}` : ""}
          </h2>
          <button onClick={onClose} className="text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:text-zinc-400">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Code" value={code} onChange={setCode} mono uppercase placeholder="e.g. CSG_EE" />
            <Input label="Label" value={label} onChange={setLabel} placeholder="e.g. CSG — Employee" />
            <Input label="Rate" value={rate} onChange={setRate} mono placeholder="0.01500" />
            <Input label="Threshold (high)" value={thresholdHigh} onChange={setThresholdHigh} mono placeholder="50000 (optional)" />
            <div>
              <label className="block text-xs uppercase font-semibold text-zinc-500 dark:text-zinc-400 mb-1 tracking-wide">Side</label>
              <select value={side} onChange={(e) => setSide(e.target.value as typeof side)}
                className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="employee">employee</option>
                <option value="employer">employer</option>
              </select>
            </div>
            <div>
              <label className="block text-xs uppercase font-semibold text-zinc-500 dark:text-zinc-400 mb-1 tracking-wide">Taxable base (legacy)</label>
              <select value={taxableBase} onChange={(e) => setTaxableBase(e.target.value as typeof taxableBase)}
                className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="basic">basic</option>
                <option value="gross">gross</option>
                <option value="custom">custom</option>
              </select>
            </div>
            <Input label="Effective from" type="date" value={effectiveFrom} onChange={setEffectiveFrom} />
          </div>
          <Input label="Source reference" value={sourceReference} onChange={setSourceReference}
            placeholder="e.g. Finance Act 2027 §X / MRA Circular URL" />
          <Input label="Change reason" value={changeReason} onChange={setChangeReason}
            placeholder="One-line description of why this is changing" />
          <AddVersionStepUpFlow
            purpose="rule_supersede"
            description="Updating country rules requires a fresh OTP. Click below to send one to your email."
            onSubmit={handleSubmit}
          />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 dark:border-zinc-800 px-6 py-4">
          <button onClick={onClose} className="rounded-md border border-zinc-200 dark:border-zinc-800 px-4 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:bg-zinc-900/40">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}


function Input({
  label, value, onChange, type = "text", mono = false, uppercase = false, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  mono?: boolean;
  uppercase?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs uppercase font-semibold text-zinc-500 dark:text-zinc-400 mb-1 tracking-wide">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(uppercase ? e.target.value.toUpperCase() : e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          mono ? "font-mono" : ""
        }`}
      />
    </div>
  );
}
