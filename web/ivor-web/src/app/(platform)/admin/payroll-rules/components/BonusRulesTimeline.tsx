"use client";

import { useCallback, useEffect, useState } from "react";
import {
  payrollRules,
  type CountryBonusRule,
  type CountryBonusRuleCreate,
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


const MONTHS = ["", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function bonusSummary(v: CountryBonusRule): string {
  const formula = String(v.formula).toLowerCase().replace(/_/g, " ");
  const amount = v.fixed_amount ? ` (${v.fixed_amount})` : "";
  const month = MONTHS[v.payable_month] ?? `month ${v.payable_month}`;
  const parts = [`Year-end bonus = ${formula}${amount}, paid in ${month}.`];
  if (v.eligibility_min_service_months) parts.push(`Eligible after ${v.eligibility_min_service_months} months of service.`);
  parts.push(v.prorate_on_partial_year ? "Prorated for partial years." : "Not prorated for partial years.");
  parts.push(v.taxable ? "Taxable." : "Tax-free.");
  return parts.join(" ");
}


function group(rows: CountryBonusRule[]): Map<string, CountryBonusRule[]> {
  const m = new Map<string, CountryBonusRule[]>();
  for (const r of rows) {
    if (!m.has(r.bonus_code)) m.set(r.bonus_code, []);
    m.get(r.bonus_code)!.push(r);
  }
  for (const arr of m.values()) arr.sort((a, b) => b.version - a.version);
  return m;
}


export default function BonusRulesTimeline({ countryCode }: { countryCode: string }) {
  const [rows, setRows] = useState<CountryBonusRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<string | null | "new">(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await payrollRules.listBonusRules(countryCode);
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
            {codes.length} bonus rule{codes.length !== 1 ? "s" : ""} configured.
            Update a rule when the formula changes — previous values stay on finalized runs.
          </p>
          <ExampleCallout caption={countryCode === "MU" ? "Mauritius end-of-year gratuity" : "Worked example (format only — not this country's real rule)"} className="mt-2">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
              <dt className="text-zinc-500 dark:text-zinc-400">Code</dt>
              <dd className="text-zinc-900 dark:text-zinc-100 font-mono">EOY_GRATUITY</dd>
              <dt className="text-zinc-500 dark:text-zinc-400">Formula</dt>
              <dd className="text-zinc-900 dark:text-zinc-100">1/12 of annual earnings</dd>
              <dt className="text-zinc-500 dark:text-zinc-400">Payable month</dt>
              <dd className="text-zinc-900 dark:text-zinc-100">December</dd>
              <dt className="text-zinc-500 dark:text-zinc-400">Min service</dt>
              <dd className="text-zinc-900 dark:text-zinc-100">12 months</dd>
              <dt className="text-zinc-500 dark:text-zinc-400">Prorate partial year</dt>
              <dd className="text-zinc-900 dark:text-zinc-100">Yes</dd>
              <dt className="text-zinc-500 dark:text-zinc-400">Taxable</dt>
              <dd className="text-zinc-900 dark:text-zinc-100">Yes</dd>
            </dl>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">
              Employees with &lt; 12 months service are excluded. Partial-year employees receive a pro-rated amount.
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
            Update bonus rule
          </button>
        </div>
      </div>

      {codes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-12 text-center">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No bonus rules seeded for {countryCode}.</p>
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
                  {versions.map((v) => (
                    <TimelineCard
                      key={v.id}
                      version={v.version}
                      effectiveFrom={v.effective_from}
                      effectiveTo={v.effective_to ?? null}
                      sourceReference={v.source_reference}
                      changeReason={v.change_reason}
                      status={deriveVersionStatus(v.effective_from, v.effective_to)}
                      headline={`${v.formula} · month ${v.payable_month}`}
                      body={
                        <div className="space-y-2">
                          <RuleSummary>{bonusSummary(v)}</RuleSummary>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                            <Field label="Formula" value={v.formula} />
                            <Field label="Payable month" value={v.payable_month} />
                            <Field label="Eligibility (mo)" value={v.eligibility_min_service_months} />
                            <Field label="Prorate partial year" value={v.prorate_on_partial_year ? "yes" : "no"} />
                            <Field label="Taxable" value={v.taxable ? "yes" : "no"} />
                            {v.fixed_amount && <Field label="Fixed amount" value={v.fixed_amount} />}
                          </div>
                        </div>
                      }
                    />
                  ))}
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


function AddDialog({
  open, countryCode, presetCode, presetLatestVersion, onClose, onSaved, onConflict,
}: {
  open: boolean; countryCode: string; presetCode: string | null;
  presetLatestVersion: number;
  onClose: () => void; onSaved: () => void; onConflict: () => void;
}) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [formula, setFormula] = useState<"twelfth_of_annual" | "fixed" | "percent_of_basic" | "custom">("twelfth_of_annual");
  const [eligibility, setEligibility] = useState("12");
  const [payableMonth, setPayableMonth] = useState("12");
  const [prorate, setProrate] = useState(true);
  const [taxable, setTaxable] = useState(true);
  const [fixedAmount, setFixedAmount] = useState("");
  const [rate, setRate] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [sourceRef, setSourceRef] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      setCode(presetCode ?? "");
      setLabel("");
      setFormula("twelfth_of_annual");
      setEligibility("12");
      setPayableMonth("12");
      setProrate(true);
      setTaxable(true);
      setFixedAmount("");
      setRate("");
      setEffectiveFrom(new Date().toISOString().slice(0, 10));
      setSourceRef("");
      setReason("");
    }
  }, [open, presetCode]);

  if (!open) return null;

  async function handleSubmit(token: string): Promise<{ ok: boolean; message?: string }> {
    if (!code.trim() || !label.trim() || !effectiveFrom) {
      return { ok: false, message: "Code, label, and effective_from are required" };
    }
    const payload: CountryBonusRuleCreate = {
      country_code: countryCode,
      bonus_code: code.trim().toUpperCase(),
      label: label.trim(),
      formula,
      eligibility_min_service_months: Number(eligibility) || 0,
      payable_month: Number(payableMonth),
      prorate_on_partial_year: prorate,
      taxable,
      fixed_amount: formula === "fixed" ? (fixedAmount.trim() || null) : null,
      rate: formula === "percent_of_basic" ? (rate.trim() || null) : null,
      effective_from: effectiveFrom,
      source_reference: sourceRef.trim() || null,
      change_reason: reason.trim() || null,
    };
    const result = await postSupersede({
      url: `/payroll-rules/${countryCode}/bonus-rules`,
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
            New bonus rule version{presetCode ? ` · ${presetCode}` : ""}
          </h2>
          <button onClick={onClose} className="text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:text-zinc-400">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FieldInput label="Bonus code" value={code} onChange={setCode} mono uppercase placeholder="EOY_GRATUITY" />
            <FieldInput label="Label" value={label} onChange={setLabel} placeholder="End of Year Gratuity" />
            <div>
              <label className="block text-xs uppercase font-semibold text-zinc-500 dark:text-zinc-400 mb-1 tracking-wide">Formula</label>
              <select value={formula} onChange={(e) => setFormula(e.target.value as typeof formula)}
                className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="twelfth_of_annual">twelfth_of_annual</option>
                <option value="percent_of_basic">percent_of_basic</option>
                <option value="fixed">fixed</option>
                <option value="custom">custom</option>
              </select>
            </div>
            <FieldInput label="Payable month (1–12)" value={payableMonth} onChange={setPayableMonth} type="number" />
            <FieldInput label="Eligibility (months)" value={eligibility} onChange={setEligibility} type="number" />
            {formula === "fixed" && (
              <FieldInput label="Fixed amount" value={fixedAmount} onChange={setFixedAmount} mono placeholder="e.g. 50000" />
            )}
            {formula === "percent_of_basic" && (
              <FieldInput label="Rate" value={rate} onChange={setRate} mono placeholder="0.10" />
            )}
            <FieldInput label="Effective from" type="date" value={effectiveFrom} onChange={setEffectiveFrom} />
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" checked={prorate} onChange={(e) => setProrate(e.target.checked)} />
              Prorate on partial year
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" checked={taxable} onChange={(e) => setTaxable(e.target.checked)} />
              Taxable
            </label>
          </div>
          <FieldInput label="Source reference" value={sourceRef} onChange={setSourceRef} placeholder="EOY Gratuity Act 2001 §X" />
          <FieldInput label="Change reason" value={reason} onChange={setReason} placeholder="Why this version" />
          <AddVersionStepUpFlow
            purpose="rule_supersede"
            description="Updating bonus rules requires a fresh OTP."
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
  label, value, onChange, type = "text", mono = false, uppercase = false, placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; mono?: boolean; uppercase?: boolean; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs uppercase font-semibold text-zinc-500 dark:text-zinc-400 mb-1 tracking-wide">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(uppercase ? e.target.value.toUpperCase() : e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${mono ? "font-mono" : ""}`}
      />
    </div>
  );
}
