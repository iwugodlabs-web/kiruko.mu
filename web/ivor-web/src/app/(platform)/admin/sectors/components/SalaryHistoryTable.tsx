"use client";
import React, { useEffect, useState } from "react";
import { Plus, Ban, RotateCcw, Loader2 } from "lucide-react";
import { sectorAdmin, SalaryHistoryResponse, SectorGrade, SectorCategorySalary } from "@/services/sectorAdmin";
import { toast } from "sonner";
import SalaryVersionForm from "./SalaryVersionForm";
import { ConfirmDialog } from "./EntityFormModals";

export default function SalaryHistoryTable(props: {
  categoryId: number;
  currency: string;
  grades: SectorGrade[];
}) {
  const [history, setHistory] = useState<SalaryHistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAppend, setShowAppend] = useState(false);
  const [voiding, setVoiding] = useState<{ row: SectorCategorySalary; reason: string } | null>(null);
  const [prefill, setPrefill] = useState<SectorCategorySalary | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const h = await sectorAdmin.history(props.categoryId);
      setHistory(h);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Failed to load salary history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [props.categoryId]);

  const today = new Date().toISOString().slice(0, 10);

  const formatRate = (r: any) => {
    if (r === null || r === undefined) return "—";
    const n = Number(r);
    if (Number.isNaN(n)) return "—";
    return n.toLocaleString();
  };

  return (
    <div className="rounded border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Salary versions ({props.currency})</h4>
        <button
          onClick={() => {
            setPrefill(null);
            setShowAppend(true);
          }}
          className="inline-flex items-center gap-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-200 px-3 py-1 text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <Plus size={14} />
          Append version
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-4 text-xs text-gray-500 dark:text-gray-400">
          <Loader2 className="animate-spin" size={14} /> Loading…
        </div>
      )}

      {!loading && history && history.years.length === 0 && (
        <p className="py-4 text-xs italic text-gray-500 dark:text-gray-400">No salary versions yet. Append the first one.</p>
      )}

      {!loading &&
        history &&
        history.years
          .slice()
          .reverse()
          .map((year) => (
            <div key={year.effective_from} className="mb-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Effective {year.effective_from}
                {year.effective_from > today && (
                  <span className="ml-2 rounded bg-amber-100 dark:bg-amber-950/40 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-400">
                    Scheduled
                  </span>
                )}
              </div>
              <table className="w-full text-xs">
                <thead className="text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="px-2 py-1 text-left">Grade</th>
                    <th className="px-2 py-1 text-left">Yrs service</th>
                    <th className="px-2 py-1 text-right">Monthly</th>
                    <th className="px-2 py-1 text-right">Daily</th>
                    <th className="px-2 py-1 text-right">Hourly</th>
                    <th className="px-2 py-1 text-left">Unit</th>
                    <th className="px-2 py-1 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {year.rows.map((row: any) => {
                    const voided = !!row.voided_at;
                    return (
                      <tr
                        key={row.id}
                        className={`border-t border-gray-200 dark:border-gray-800 ${voided ? "text-gray-400 dark:text-gray-500 line-through" : ""}`}
                      >
                        <td className="px-2 py-1">{row.grade ?? "—"}</td>
                        <td className="px-2 py-1">
                          {row.min_years_of_service ?? "—"}–{row.max_years_of_service ?? "∞"}
                        </td>
                        <td className="px-2 py-1 text-right">{formatRate(row.basic_monthly_salary)}</td>
                        <td className="px-2 py-1 text-right">{formatRate(row.basic_daily_salary)}</td>
                        <td className="px-2 py-1 text-right">{formatRate(row.hourly_rate)}</td>
                        <td className="px-2 py-1">{row.unit ?? "—"}</td>
                        <td className="px-2 py-1 text-right">
                          {voided ? (
                            <span
                              className="rounded bg-red-50 dark:bg-red-950/40 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:text-red-400"
                              title={`Voided: ${row.voided_reason ?? ""}`}
                            >
                              voided
                            </span>
                          ) : (
                            <div className="flex justify-end gap-1">
                              <button
                                onClick={() => {
                                  // Pre-fill with this row's numbers, but advance the date so the prefilled
                                  // form doesn't immediately 409 against this active row. The intent is "schedule a
                                  // future version from this baseline". To replace today's row in-place, use Void.
                                  const baseline = new Date(row.effective_from || new Date().toISOString().slice(0, 10));
                                  const nextDay = new Date(Math.max(baseline.getTime() + 86400000, Date.now() + 86400000));
                                  setPrefill({
                                    id: row.id,
                                    sector_category_id: props.categoryId,
                                    sector_grade_id: row.sector_grade_id ?? null,
                                    min_years_of_service: row.min_years_of_service,
                                    max_years_of_service: row.max_years_of_service,
                                    effective_from: nextDay.toISOString().slice(0, 10),
                                    basic_monthly_salary: row.basic_monthly_salary,
                                    basic_daily_salary: row.basic_daily_salary,
                                    hourly_rate: row.hourly_rate,
                                    productivity: row.productivity,
                                    unit: row.unit,
                                    notes: row.notes,
                                    voided_at: null,
                                    voided_by_user_id: null,
                                    voided_reason: null,
                                  });
                                  setShowAppend(true);
                                }}
                                className="rounded p-1 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-white"
                                title="Schedule a future version (pre-filled from this row, date advanced to next day)"
                              >
                                <RotateCcw size={14} />
                              </button>
                              <button
                                onClick={() => setVoiding({ row: row as any, reason: "" })}
                                className="rounded p-1 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                                title="Void this version (append-only correction path)"
                              >
                                <Ban size={14} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}

      {showAppend && (
        <SalaryVersionForm
          categoryId={props.categoryId}
          grades={props.grades}
          prefillFrom={prefill}
          onClose={() => setShowAppend(false)}
          onSaved={() => {
            setShowAppend(false);
            load();
          }}
        />
      )}

      {voiding && (
        <ConfirmDialog
          title="Void this salary version?"
          destructive
          confirmLabel="Void"
          message={
            <>
              <p>
                This marks the row as voided. Rate values stay readable for audit. After voiding, you can append a
                corrective version with the same <code>effective_from</code>.
              </p>
            </>
          }
          onClose={() => setVoiding(null)}
          onConfirm={async () => {
            if (voiding.reason.trim().length < 5) {
              toast.error("Reason must be at least 5 characters");
              return;
            }
            try {
              await sectorAdmin.voidSalary(voiding.row.id, voiding.reason.trim());
              toast.success("Salary version voided");
              setVoiding(null);
              load();
            } catch (e: any) {
              toast.error(e?.response?.data?.detail || "Failed to void salary version");
            }
          }}
        >
          <label className="mt-3 block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Reason (5–500 chars)
          </label>
          <textarea
            rows={3}
            className="w-full rounded border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 px-3 py-2 text-sm focus:border-gray-900 dark:focus:border-gray-500 focus:outline-none"
            value={voiding.reason}
            onChange={(e) => setVoiding({ ...voiding, reason: e.target.value })}
            placeholder="e.g. typo, see ticket #123"
          />
        </ConfirmDialog>
      )}
    </div>
  );
}
