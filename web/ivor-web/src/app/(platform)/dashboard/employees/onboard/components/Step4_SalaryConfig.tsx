"use client";

import { useEffect } from "react";
import { OnboardDraft, MIN_WAGES } from "./types";
import { AlertTriangle } from "lucide-react";
import { useCompanyCurrency } from "@/hooks/useCompanyCurrency";

interface Props {
  draft: OnboardDraft;
  onChange: (patch: Partial<OnboardDraft>) => void;
}

const inputCls = "w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-red-500 placeholder:text-gray-400 dark:placeholder:text-gray-600";
const labelCls = "block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5";

export default function Step4_SalaryConfig({ draft, onChange }: Props) {
  // Currency is server-authoritative (derived from the company's country); it's
  // not chosen per employee. Keep the draft in sync with the company currency so
  // the min-wage check and Review show the right unit, and display it read-only.
  const { currency: companyCurrency } = useCompanyCurrency();
  useEffect(() => {
    if (companyCurrency && draft.currency !== companyCurrency) {
      onChange({ currency: companyCurrency });
    }
  }, [companyCurrency, draft.currency, onChange]);

  const mw = MIN_WAGES[draft.currency];
  const belowMinWage = mw && draft.base_salary !== null && draft.base_salary > 0 && draft.base_salary < mw.monthly;

  const hoursPerMonth = draft.hours_per_month
    ?? (draft.contracted_hours ? Math.round(draft.contracted_hours * 4.33) : null);
  const hourlyRate =
    draft.base_salary && hoursPerMonth && hoursPerMonth > 0
      ? (draft.base_salary / hoursPerMonth).toFixed(2)
      : null;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Salary Configuration</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Monthly base salary and deductions. Salary will be configurable in detail once the employee joins.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Base Monthly Salary</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-gray-400">
              {draft.currency}
            </span>
            <input
              type="number"
              min={0}
              value={draft.base_salary ?? ""}
              onChange={(e) => onChange({ base_salary: e.target.value ? parseFloat(e.target.value) : null })}
              placeholder="0"
              className={`${inputCls} pl-12`}
            />
          </div>
          {belowMinWage && (
            <div className="flex items-center gap-1.5 mt-2 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle size={12} />
              Below minimum wage ({mw.label})
            </div>
          )}
        </div>
        <div>
          <label className={labelCls}>Currency</label>
          <div className={`${inputCls} flex items-center justify-between text-gray-500 dark:text-gray-400 cursor-not-allowed`}>
            <span className="font-medium text-gray-700 dark:text-gray-300">{draft.currency}</span>
            <span className="text-xs">Set by company country</span>
          </div>
        </div>
      </div>

      <div>
        <label className={labelCls}>Contracted Hours / Month</label>
        <input
          type="number"
          min={1}
          value={draft.hours_per_month ?? hoursPerMonth ?? ""}
          onChange={(e) => onChange({ hours_per_month: e.target.value ? parseFloat(e.target.value) : null })}
          placeholder={hoursPerMonth ? String(hoursPerMonth) : "173"}
          className={inputCls}
        />
        {hourlyRate && (
          <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">
            Effective hourly rate: <span className="font-semibold text-gray-700 dark:text-gray-300">{draft.currency} {hourlyRate}/hr</span>
          </p>
        )}
      </div>

      <div>
        <p className={labelCls}>Deductions</p>
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.deduct_transport}
              onChange={(e) => onChange({ deduct_transport: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300 accent-red-600"
            />
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Transport allowance deduction</p>
              <p className="text-xs text-gray-400 dark:text-gray-500">Employer-provided transport deducted from gross salary</p>
            </div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.deduct_accommodation}
              onChange={(e) => onChange({ deduct_accommodation: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300 accent-red-600"
            />
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Accommodation deduction</p>
              <p className="text-xs text-gray-400 dark:text-gray-500">Employer-provided housing deducted from gross salary</p>
            </div>
          </label>
        </div>
      </div>

      {!draft.base_salary && (
        <p className="text-xs text-gray-400 dark:text-gray-500 italic">
          Salary is optional here — you can configure it in detail from the employee profile after they join.
        </p>
      )}
    </div>
  );
}
