"use client";

import { useCallback, useEffect, useState } from "react";
import {
  payrollRules,
  type TaxBracketSet,
  type TaxBracketSetCreate,
  type TaxBracketLine,
} from "@/services/payroll-api";
import { toast } from "sonner";
import { Plus, RefreshCcw, Trash2, X } from "lucide-react";
import TimelineCard, { deriveVersionStatus } from "./TimelineCard";
import AddVersionStepUpFlow from "./AddVersionStepUpFlow";
import { isError } from "@/utils/payrollFormat";
import { postSupersede } from "./supersedeRequest";
import ExampleCallout from "@/components/ui/ExampleCallout";


function summarizeBrackets(v: TaxBracketSet): string {
  const n = v.brackets.length;
  if (n === 0) return "no bands";
  const rates = v.brackets.map((b) => Number(b.rate)).filter((r) => !Number.isNaN(r));
  const max = rates.length > 0 ? Math.max(...rates) : 0;
  return `${n} band${n === 1 ? "" : "s"} · max ${(max * 100).toFixed(0)}%`;
}


function group(rows: TaxBracketSet[]): Map<number, TaxBracketSet[]> {
  const m = new Map<number, TaxBracketSet[]>();
  for (const r of rows) {
    if (!m.has(r.fiscal_year)) m.set(r.fiscal_year, []);
    m.get(r.fiscal_year)!.push(r);
  }
  for (const arr of m.values()) arr.sort((a, b) => b.version - a.version);
  return m;
}


function fmtPct(rate: string): string {
  const n = Number(rate);
  if (Number.isNaN(n)) return rate;
  return `${(n * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}


export default function TaxBracketsTimeline({ countryCode }: { countryCode: string }) {
  const [rows, setRows] = useState<TaxBracketSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<number | null | "new">(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await payrollRules.listTaxBracketSets(countryCode);
    if (isError(r)) { toast.error(r.error); setRows([]); } else setRows(r);
    setLoading(false);
  }, [countryCode]);

  useEffect(() => { refresh(); }, [refresh]);

  const grouped = group(rows);
  const years = Array.from(grouped.keys()).sort((a, b) => b - a);

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex-1">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Progressive PAYE bands, grouped by fiscal year. Add a new version when the bands change —
            previous versions stay attached to any payroll runs that already used them.
          </p>
          <ExampleCallout caption={countryCode === "MU" ? "Mauritius FY 2026 · v1" : "Worked example (format only — not this country's real rates)"} className="mt-2">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-zinc-500 dark:text-zinc-400 uppercase">
                  <th className="text-left py-1 font-medium">Band</th>
                  <th className="text-right py-1 font-medium">Lower</th>
                  <th className="text-right py-1 font-medium">Upper</th>
                  <th className="text-right py-1 font-medium">Rate</th>
                </tr>
              </thead>
              <tbody className="text-zinc-700 dark:text-zinc-300">
                <tr><td>1</td><td className="text-right tabular-nums">0</td><td className="text-right tabular-nums">390,000</td><td className="text-right">0%</td></tr>
                <tr><td>2</td><td className="text-right tabular-nums">390,000</td><td className="text-right tabular-nums">650,000</td><td className="text-right">10%</td></tr>
                <tr><td>3</td><td className="text-right tabular-nums">650,000</td><td className="text-right">∞</td><td className="text-right">15%</td></tr>
              </tbody>
            </table>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">
              Source: Finance Act 2026 §12. PAYE applies to annual taxable income; the engine pro-rates per pay period.
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
            Add fiscal year
          </button>
        </div>
      </div>

      {years.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-12 text-center">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No tax bracket sets seeded for {countryCode}.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {years.map((year) => {
            const versions = grouped.get(year)!;
            return (
              <div key={year}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Fiscal year {year}</h3>
                  <button onClick={() => setDialog(year)} className="text-xs text-blue-600 hover:underline">
                    Add version for {year}
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
                      headline={summarizeBrackets(v)}
                      body={
                        <div className="rounded border border-zinc-100 dark:border-zinc-800 overflow-hidden bg-white dark:bg-zinc-900">
                          <table className="min-w-full text-sm">
                            <thead className="bg-zinc-50 dark:bg-zinc-900/40">
                              <tr>
                                <th className="px-3 py-1.5 text-left text-[10px] uppercase text-zinc-500 dark:text-zinc-400">Band</th>
                                <th className="px-3 py-1.5 text-right text-[10px] uppercase text-zinc-500 dark:text-zinc-400">Lower</th>
                                <th className="px-3 py-1.5 text-right text-[10px] uppercase text-zinc-500 dark:text-zinc-400">Upper</th>
                                <th className="px-3 py-1.5 text-right text-[10px] uppercase text-zinc-500 dark:text-zinc-400">Rate</th>
                              </tr>
                            </thead>
                            <tbody>
                              {v.brackets.map((b) => (
                                <tr key={b.id} className="border-t border-zinc-100 dark:border-zinc-800">
                                  <td className="px-3 py-1.5 text-zinc-500 dark:text-zinc-400">{b.order_index}</td>
                                  <td className="px-3 py-1.5 tabular-nums text-right">{b.lower_bound}</td>
                                  <td className="px-3 py-1.5 tabular-nums text-right">{b.upper_bound ?? "∞"}</td>
                                  <td className="px-3 py-1.5 tabular-nums text-right font-medium text-zinc-900 dark:text-zinc-100">{fmtPct(b.rate)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
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
        presetYear={dialog === "new" ? null : dialog}
        presetLatestVersion={
          typeof dialog === "number"
            ? (grouped.get(dialog)?.[0]?.version ?? 0)
            : 0
        }
        onClose={() => setDialog(null)}
        onSaved={() => { setDialog(null); refresh(); }}
        onConflict={() => { setDialog(null); refresh(); }}
      />
    </div>
  );
}


type LineDraft = { lower: string; upper: string; rate: string };
function emptyLine(): LineDraft { return { lower: "", upper: "", rate: "" }; }


function AddDialog({
  open, countryCode, presetYear, presetLatestVersion, onClose, onSaved, onConflict,
}: {
  open: boolean; countryCode: string; presetYear: number | null;
  presetLatestVersion: number;
  onClose: () => void; onSaved: () => void; onConflict: () => void;
}) {
  const [year, setYear] = useState("");
  const [labelText, setLabelText] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [sourceRef, setSourceRef] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);

  useEffect(() => {
    if (open) {
      setYear(presetYear ? String(presetYear) : String(new Date().getFullYear()));
      setLabelText("");
      setEffectiveFrom(new Date().toISOString().slice(0, 10));
      setSourceRef("");
      setReason("");
      setLines([emptyLine()]);
    }
  }, [open, presetYear]);

  if (!open) return null;

  function addLine() { setLines([...lines, emptyLine()]); }
  function removeLine(idx: number) { setLines(lines.filter((_, i) => i !== idx)); }
  function updateLine(idx: number, patch: Partial<LineDraft>) {
    setLines(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  async function handleSubmit(token: string): Promise<{ ok: boolean; message?: string }> {
    if (!year || !effectiveFrom) {
      return { ok: false, message: "Fiscal year and effective_from are required" };
    }
    const cleanLines: TaxBracketLine[] = [];
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (!ln.lower || !ln.rate) {
        return { ok: false, message: `Band ${i + 1}: lower bound and rate are required` };
      }
      cleanLines.push({
        order_index: i + 1,
        lower_bound: ln.lower,
        upper_bound: ln.upper.trim() || null,
        rate: ln.rate,
      });
    }
    const payload: TaxBracketSetCreate = {
      country_code: countryCode,
      fiscal_year: Number(year),
      label: labelText.trim() || undefined,
      effective_from: effectiveFrom,
      source_reference: sourceRef.trim() || undefined,
      change_reason: reason.trim() || undefined,
      brackets: cleanLines,
    };
    const result = await postSupersede({
      url: `/payroll-rules/${countryCode}/tax-bracket-sets`,
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
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 px-6 py-4">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            New tax bracket set{presetYear ? ` · FY ${presetYear}` : ""}
          </h2>
          <button onClick={onClose} className="text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:text-zinc-400">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <FieldInput label="Fiscal year" value={year} onChange={setYear} type="number" />
            <FieldInput label="Label" value={labelText} onChange={setLabelText} placeholder="MU PAYE 2027" />
            <FieldInput label="Effective from" type="date" value={effectiveFrom} onChange={setEffectiveFrom} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">Bands</h3>
              <button type="button" onClick={addLine} className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1">
                <Plus className="h-3.5 w-3.5" /> Add band
              </button>
            </div>
            <div className="space-y-2">
              {lines.map((ln, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center rounded-md border border-zinc-200 dark:border-zinc-800 p-2">
                  <span className="col-span-1 text-xs text-zinc-500 dark:text-zinc-400 text-center">{idx + 1}</span>
                  <input
                    placeholder="Lower"
                    value={ln.lower}
                    onChange={(e) => updateLine(idx, { lower: e.target.value })}
                    className="col-span-3 rounded border border-zinc-200 dark:border-zinc-800 px-2 py-1.5 text-sm tabular-nums text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    placeholder="Upper (blank = ∞)"
                    value={ln.upper}
                    onChange={(e) => updateLine(idx, { upper: e.target.value })}
                    className="col-span-4 rounded border border-zinc-200 dark:border-zinc-800 px-2 py-1.5 text-sm tabular-nums text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    placeholder="Rate (0.10)"
                    value={ln.rate}
                    onChange={(e) => updateLine(idx, { rate: e.target.value })}
                    className="col-span-3 rounded border border-zinc-200 dark:border-zinc-800 px-2 py-1.5 text-sm tabular-nums text-right font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button onClick={() => removeLine(idx)} disabled={lines.length === 1}
                    className="col-span-1 text-zinc-400 dark:text-zinc-500 hover:text-red-600 disabled:opacity-30">
                    <Trash2 className="h-4 w-4 mx-auto" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <FieldInput label="Source reference" value={sourceRef} onChange={setSourceRef}
            placeholder="e.g. Finance Act 2027 §12 / MRA Circular URL" />
          <FieldInput label="Change reason" value={reason} onChange={setReason} placeholder="Why this version" />

          <AddVersionStepUpFlow
            purpose="rule_supersede"
            description="Updating tax bands requires a fresh OTP."
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
  label, value, onChange, type = "text", placeholder,
}: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs uppercase font-semibold text-zinc-500 dark:text-zinc-400 mb-1 tracking-wide">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}
