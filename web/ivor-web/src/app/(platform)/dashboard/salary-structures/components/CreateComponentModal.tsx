"use client";

import { useState } from "react";
import { salaryStructures, type SalaryComponent, type SalaryComponentCreate } from "@/services/payroll-api";
import { toast } from "sonner";
import { Loader2, X } from "lucide-react";


function isError<T>(v: T | { error: string; status?: number }): v is { error: string; status?: number } {
  return typeof v === "object" && v !== null && "error" in v;
}


// Common preset categories with sensible defaults. The form is also free-text.
const CATEGORY_PRESETS = [
  { value: "earning.basic", label: "Earning · Basic salary", kind: "earning" as const, isBasic: true,
    bases: ["PAYE", "CSG_EE", "CSG_ER", "NSF_EE", "NSF_ER"] },
  { value: "allowance.transport", label: "Allowance · Transport", kind: "earning" as const, isBasic: false,
    bases: ["PAYE", "CSG_EE", "CSG_ER"] },
  { value: "allowance.housing", label: "Allowance · Housing", kind: "earning" as const, isBasic: false,
    bases: ["PAYE", "CSG_EE", "CSG_ER"] },
  { value: "allowance.meal", label: "Allowance · Meal", kind: "earning" as const, isBasic: false,
    bases: ["PAYE", "CSG_EE", "CSG_ER"] },
  { value: "allowance.general", label: "Allowance · Other", kind: "earning" as const, isBasic: false,
    bases: ["PAYE", "CSG_EE", "CSG_ER"] },
  { value: "earning.bonus", label: "Earning · Bonus (PAYE-only)", kind: "earning" as const, isBasic: false,
    bases: ["PAYE"] },
  { value: "deduction.loan", label: "Deduction · Loan repayment", kind: "deduction" as const, isBasic: false,
    bases: [] },
  { value: "deduction.other", label: "Deduction · Other", kind: "deduction" as const, isBasic: false,
    bases: [] },
];


const ALL_BASES = ["PAYE", "CSG_EE", "CSG_ER", "NSF_EE", "NSF_ER"];


interface Props {
  open: boolean;
  companyId: number;
  existingCodes: Set<string>;
  hasBasic: boolean;
  onClose: () => void;
  onCreated: (created: SalaryComponent) => void;
}


/**
 * Live-sanitize a component code so the user can't enter something the
 * backend will reject. Codes are identifiers used in structure formulas
 * (e.g. `BASIC * 0.10`), so: uppercase; spaces and any dash (hyphen, en/em
 * dash) → underscore; drop every other non [A-Z0-9_] char; a leading
 * digit/underscore is stripped so it always starts with a letter; cap 40.
 */
function sanitizeCode(raw: string): string {
  let s = raw
    .toUpperCase()
    .replace(/[\s\-‐-―]+/g, "_")  // spaces + hyphen/en/em dashes → _
    .replace(/[^A-Z0-9_]/g, "");            // strip anything else
  s = s.replace(/^[^A-Z]+/, "");            // must start with a letter
  return s.slice(0, 40);
}


export default function CreateComponentModal({ open, companyId, existingCodes, hasBasic, onClose, onCreated }: Props) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [presetIdx, setPresetIdx] = useState(0);
  const [isTaxable, setIsTaxable] = useState(true);
  const [isRecurring, setIsRecurring] = useState(true);
  const [isOneOff, setIsOneOff] = useState(false);
  const [prorate, setProrate] = useState(true);
  const [frequency, setFrequency] = useState<"monthly" | "daily">("monthly");
  const [valueType, setValueType] = useState<"amount" | "percent_of_basic">("amount");
  const [bases, setBases] = useState<Set<string>>(new Set(CATEGORY_PRESETS[0].bases));
  const [loading, setLoading] = useState(false);

  const preset = CATEGORY_PRESETS[presetIdx];

  if (!open) return null;

  function applyPreset(idx: number) {
    setPresetIdx(idx);
    setBases(new Set(CATEGORY_PRESETS[idx].bases));
  }

  function toggleBase(b: string) {
    const next = new Set(bases);
    if (next.has(b)) next.delete(b); else next.add(b);
    setBases(next);
  }

  async function handleSubmit() {
    const codeUpper = code.trim().toUpperCase();
    if (!codeUpper.match(/^[A-Z][A-Z0-9_]{0,39}$/)) {
      toast.error("Code must start with a letter, then A–Z, 0–9, _ (max 40)");
      return;
    }
    if (existingCodes.has(codeUpper)) {
      toast.error(`Component code "${codeUpper}" already exists`);
      return;
    }
    if (!label.trim()) {
      toast.error("Label is required");
      return;
    }
    if (preset.isBasic && hasBasic) {
      toast.error("Company already has a basic component. Mark the existing one non-basic first.");
      return;
    }

    setLoading(true);
    const payload: SalaryComponentCreate = {
      code: codeUpper,
      label: label.trim(),
      kind: preset.kind,
      category: preset.value,
      is_basic: preset.isBasic,
      is_taxable: isTaxable,
      is_recurring: isRecurring,
      is_one_off: isOneOff,
      prorate_on_partial_month: prorate,
      frequency: preset.isBasic ? "monthly" : frequency,
      value_type: preset.isBasic ? "amount" : valueType,
      statutory_base_codes: Array.from(bases),
    };
    const r = await salaryStructures.createComponent(companyId, payload);
    setLoading(false);
    if (isError(r)) {
      toast.error(r.error);
      return;
    }
    toast.success(`Component ${codeUpper} created`);
    setCode("");
    setLabel("");
    setFrequency("monthly");
    setValueType("amount");
    onCreated(r);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col border border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-gray-800 px-6 py-4">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">New salary component</h2>
          <button onClick={onClose} className="text-zinc-400 dark:text-gray-500 hover:text-zinc-600 dark:hover:text-gray-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-gray-200 mb-1">Type</label>
            <select
              value={presetIdx}
              onChange={(e) => applyPreset(Number(e.target.value))}
              className="w-full rounded-md border border-zinc-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-zinc-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {CATEGORY_PRESETS.map((p, i) => (
                <option key={p.value} value={i}>{p.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-gray-200 mb-1">
                Code <span className="text-zinc-400 dark:text-gray-500">(uppercase)</span>
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(sanitizeCode(e.target.value))}
                placeholder="e.g. TRANSPORT or BASIC_SALARY"
                className="w-full rounded-md border border-zinc-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-gray-500 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-zinc-400 dark:text-gray-500">
                Used in formulas (e.g. <code>BASIC * 0.10</code>) — letters, digits, underscore only. Spaces and dashes become <code>_</code>.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-gray-200 mb-1">Label</label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Transport allowance"
                className="w-full rounded-md border border-zinc-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-gray-200 mb-1">
              Statutory bases this contributes to
            </label>
            <p className="text-xs text-zinc-500 dark:text-gray-400 mb-2">
              Pick which deductions this component is part of the base for. Leaving none falls
              back to legacy inference based on flags below.
            </p>
            <div className="flex flex-wrap gap-2">
              {ALL_BASES.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => toggleBase(b)}
                  className={`px-2.5 py-1 rounded-md border text-xs font-mono ${
                    bases.has(b)
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white dark:bg-gray-800 text-zinc-700 dark:text-gray-200 border-zinc-200 dark:border-gray-700 hover:bg-zinc-50 dark:hover:bg-gray-700"
                  }`}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-gray-200 cursor-pointer">
              <input type="checkbox" checked={isTaxable} onChange={(e) => setIsTaxable(e.target.checked)} />
              Taxable (legacy flag)
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-gray-200 cursor-pointer">
              <input type="checkbox" checked={isRecurring} onChange={(e) => setIsRecurring(e.target.checked)} />
              Recurring (paid every period)
            </label>
            <label
              className="flex items-center gap-2 text-sm text-zinc-700 dark:text-gray-200 cursor-pointer"
              title="One-off components are used for ad-hoc payments (signing bonus, reimbursement). Scheduled per employee for a specific month."
            >
              <input type="checkbox" checked={isOneOff} onChange={(e) => setIsOneOff(e.target.checked)} />
              One-off (used for ad-hoc lump sums)
              <span className="text-xs text-zinc-400">ⓘ</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-gray-200 cursor-pointer">
              <input type="checkbox" checked={prorate} onChange={(e) => setProrate(e.target.checked)} />
              Prorate on partial month
            </label>
          </div>

          {!preset.isBasic && (
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-zinc-100 dark:border-gray-800">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-gray-200 mb-1">Frequency</label>
                <div className="flex rounded-md border border-zinc-200 dark:border-gray-700 overflow-hidden text-sm">
                  {(["monthly", "daily"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFrequency(f)}
                      className={`flex-1 px-3 py-1.5 capitalize ${
                        frequency === f
                          ? "bg-blue-600 text-white"
                          : "bg-white dark:bg-gray-800 text-zinc-700 dark:text-gray-200 hover:bg-zinc-50 dark:hover:bg-gray-700"
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-zinc-400 dark:text-gray-500">
                  Daily: the stored amount is a per-day rate, scaled by working days in the period.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-gray-200 mb-1">Value type</label>
                <div className="flex rounded-md border border-zinc-200 dark:border-gray-700 overflow-hidden text-sm">
                  {([
                    { value: "amount" as const, label: "Amount" },
                    { value: "percent_of_basic" as const, label: "% of basic" },
                  ]).map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => setValueType(o.value)}
                      className={`flex-1 px-3 py-1.5 ${
                        valueType === o.value
                          ? "bg-blue-600 text-white"
                          : "bg-white dark:bg-gray-800 text-zinc-700 dark:text-gray-200 hover:bg-zinc-50 dark:hover:bg-gray-700"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-zinc-400 dark:text-gray-500">
                  % of basic: the stored amount is percentage points (5 = 5%) of the structure&apos;s BASIC.
                </p>
              </div>
            </div>
          )}

          {preset.isBasic && (
            <div className="rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
              ⚠ This will be marked as the company&apos;s <strong>basic salary</strong> component.
              At most one basic component per company.
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 dark:border-gray-800 px-6 py-4">
          <button onClick={onClose} className="rounded-md border border-zinc-200 dark:border-gray-700 px-4 py-2 text-sm text-zinc-700 dark:text-gray-200 hover:bg-zinc-50 dark:hover:bg-gray-800">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Create component
          </button>
        </div>
      </div>
    </div>
  );
}
