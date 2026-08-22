"use client";
import React, { useState } from "react";
import { X } from "lucide-react";
import { sectorAdmin, SectorGrade, SectorCategorySalary } from "@/services/sectorAdmin";
import { toast } from "sonner";

const inputCls =
  "w-full rounded border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 px-3 py-2 text-sm focus:border-gray-900 dark:focus:border-gray-500 focus:outline-none";
const labelCls = "block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400";

export default function SalaryVersionForm(props: {
  categoryId: number;
  grades: SectorGrade[];
  prefillFrom?: SectorCategorySalary | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [v, setV] = useState({
    sector_grade_id: props.prefillFrom?.sector_grade_id ?? null,
    // If the caller pre-filled a date (e.g. "schedule future version" from a
    // baseline row), use it; otherwise default to today for fresh appends.
    effective_from: props.prefillFrom?.effective_from ?? today,
    basic_monthly_salary: props.prefillFrom?.basic_monthly_salary ?? "",
    basic_daily_salary: props.prefillFrom?.basic_daily_salary ?? "",
    hourly_rate: props.prefillFrom?.hourly_rate ?? "",
    productivity: props.prefillFrom?.productivity ?? "",
    unit: props.prefillFrom?.unit ?? "",
    min_years_of_service: props.prefillFrom?.min_years_of_service ?? "",
    max_years_of_service: props.prefillFrom?.max_years_of_service ?? "",
    notes: props.prefillFrom?.notes ?? "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toNum = (s: any) => (s === "" || s === null || s === undefined ? null : Number(s));

  const submit = async () => {
    setError(null);
    const monthly = toNum(v.basic_monthly_salary);
    const daily = toNum(v.basic_daily_salary);
    const hourly = toNum(v.hourly_rate);
    const productivity = toNum(v.productivity);
    if (!monthly && !daily && !hourly && !productivity) {
      setError("Provide at least one rate (monthly / daily / hourly / productivity).");
      return;
    }
    setSubmitting(true);
    try {
      await sectorAdmin.appendSalary(props.categoryId, {
        sector_category_id: props.categoryId,
        sector_grade_id: v.sector_grade_id || null,
        effective_from: v.effective_from,
        basic_monthly_salary: monthly,
        basic_daily_salary: daily,
        hourly_rate: hourly,
        productivity: productivity,
        unit: v.unit || null,
        min_years_of_service: toNum(v.min_years_of_service),
        max_years_of_service: toNum(v.max_years_of_service),
        notes: v.notes || null,
      });
      toast.success("Salary version appended");
      props.onSaved();
    } catch (e: any) {
      const status = e?.response?.status;
      const detail = e?.response?.data?.detail || e?.message || "Append failed";
      const detailStr = typeof detail === "string" ? detail : JSON.stringify(detail);
      if (status === 409) {
        setError(
          detailStr +
            "\n\nTo fix this: either pick a future effective_from date " +
            "(this will become a scheduled version) OR cancel this dialog, " +
            "void the conflicting row (red 🚫 icon), then re-append with " +
            "the same date.",
        );
      } else {
        setError(detailStr);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-lg bg-white dark:bg-gray-900 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold dark:text-white">Append Salary Version</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Append-only. Use a future or new <code>effective_from</code>. To fix a typo, void the bad row first.
            </p>
          </div>
          <button onClick={props.onClose} className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="mb-3 whitespace-pre-line rounded border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-2 text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Effective from</label>
              <input
                type="date"
                className={inputCls}
                value={v.effective_from}
                onChange={(e) => setV({ ...v, effective_from: e.target.value })}
              />
            </div>
            <div>
              <label className={labelCls}>Grade (optional)</label>
              <select
                className={inputCls}
                value={v.sector_grade_id ?? ""}
                onChange={(e) =>
                  setV({ ...v, sector_grade_id: e.target.value ? Number(e.target.value) : null })
                }
              >
                <option value="">— No grade —</option>
                {props.grades.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.grade ?? `(unnamed grade #${g.id})`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Monthly</label>
              <input
                type="number"
                step="0.01"
                className={inputCls}
                value={v.basic_monthly_salary}
                onChange={(e) => setV({ ...v, basic_monthly_salary: e.target.value as any })}
              />
            </div>
            <div>
              <label className={labelCls}>Daily</label>
              <input
                type="number"
                step="0.01"
                className={inputCls}
                value={v.basic_daily_salary}
                onChange={(e) => setV({ ...v, basic_daily_salary: e.target.value as any })}
              />
            </div>
            <div>
              <label className={labelCls}>Hourly</label>
              <input
                type="number"
                step="0.01"
                className={inputCls}
                value={v.hourly_rate}
                onChange={(e) => setV({ ...v, hourly_rate: e.target.value as any })}
              />
            </div>
            <div>
              <label className={labelCls}>Productivity</label>
              <input
                type="number"
                step="0.01"
                className={inputCls}
                value={v.productivity}
                onChange={(e) => setV({ ...v, productivity: e.target.value as any })}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Unit</label>
              <input
                className={inputCls}
                value={v.unit}
                onChange={(e) => setV({ ...v, unit: e.target.value })}
                placeholder="per_kg, hourly…"
              />
            </div>
            <div>
              <label className={labelCls}>Min yrs service</label>
              <input
                type="number"
                className={inputCls}
                value={v.min_years_of_service}
                onChange={(e) => setV({ ...v, min_years_of_service: e.target.value as any })}
              />
            </div>
            <div>
              <label className={labelCls}>Max yrs service</label>
              <input
                type="number"
                className={inputCls}
                value={v.max_years_of_service}
                onChange={(e) => setV({ ...v, max_years_of_service: e.target.value as any })}
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>Notes</label>
            <textarea
              className={inputCls}
              rows={2}
              value={v.notes}
              onChange={(e) => setV({ ...v, notes: e.target.value })}
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={props.onClose}
            disabled={submitting}
            className="rounded border border-gray-300 dark:border-gray-700 px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 dark:text-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="rounded bg-gray-900 dark:bg-white px-4 py-2 text-sm text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100 disabled:opacity-50"
          >
            {submitting ? "Appending…" : "Append version"}
          </button>
        </div>
      </div>
    </div>
  );
}
