"use client";

import { useCallback, useEffect, useState } from "react";
import { payrollRules, type PublicHoliday } from "@/services/payroll-api";
import { toast } from "sonner";
import { RefreshCcw, CalendarDays, Plus, Pencil, Trash2, X } from "lucide-react";
import { isError } from "@/utils/payrollFormat";
import FilterSelect from "@/components/ui/FilterSelect";


function fmtDate(s: string): string {
  try {
    return new Date(s).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" });
  } catch {
    return s;
  }
}

function monthOf(s: string): number {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? 0 : d.getMonth();
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];


export default function HolidaysCalendar({ countryCode }: { countryCode: string }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [rows, setRows] = useState<PublicHoliday[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PublicHoliday | "new" | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await payrollRules.listPublicHolidays(countryCode, year);
    if (isError(r)) {
      toast.error(r.error);
      setRows([]);
    } else {
      setRows([...r].sort((a, b) => (a.date < b.date ? -1 : 1)));
    }
    setLoading(false);
  }, [countryCode, year]);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleDelete(h: PublicHoliday) {
    if (!confirm(`Delete "${h.name}" (${h.date})? This affects holiday pay on that date.`)) return;
    setDeletingId(h.holiday_id);
    const r = await payrollRules.deletePublicHoliday(countryCode, h.holiday_id);
    setDeletingId(null);
    if (isError(r)) { toast.error(r.error); return; }
    toast.success("Holiday deleted");
    refresh();
  }

  const byMonth = new Map<number, PublicHoliday[]>();
  for (const h of rows) {
    const m = monthOf(h.date);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(h);
  }
  const months = Array.from(byMonth.keys()).sort((a, b) => a - b);

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex-1">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Gazetted public holidays for {countryCode}. The payroll engine pays clock-ins on
            these dates at the holiday multiplier. When a holiday falls on a Sunday, the{" "}
            <span className="font-mono text-xs">observed date</span> is the substitute working day the premium attaches to.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <FilterSelect
            label="Year"
            value={String(year)}
            onChange={(v) => setYear(Number(v))}
            options={[thisYear - 1, thisYear, thisYear + 1].map((y) => ({ value: String(y), label: String(y) }))}
          />
          <button onClick={refresh} disabled={loading}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:bg-zinc-900/40 disabled:opacity-50">
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button onClick={() => setEditing("new")}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            <Plus className="h-4 w-4" />
            Add holiday
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <div key={i} className="rounded-lg border border-zinc-200 dark:border-zinc-800 h-20 animate-pulse" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-12 text-center">
          <CalendarDays className="h-8 w-8 mx-auto text-zinc-300 dark:text-zinc-600 mb-2" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No public holidays seeded for {countryCode} in {year}.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {months.map((m) => (
            <div key={m}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-2">
                {MONTHS[m]}
              </h3>
              <div className="space-y-1.5">
                {byMonth.get(m)!.map((h) => {
                  const substituted = h.observed_date && h.observed_date !== h.date;
                  return (
                    <div key={h.holiday_id} className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                          {h.name}
                          {h.is_recurring && (
                            <span className="inline-flex rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                              recurring
                            </span>
                          )}
                        </div>
                        {substituted && (
                          <div className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                            Observed {fmtDate(h.observed_date!)}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <div className="text-sm font-mono text-zinc-600 dark:text-zinc-300 text-right">
                          {fmtDate(h.date)}
                        </div>
                        <button onClick={() => setEditing(h)} title="Edit"
                          className="text-zinc-400 hover:text-blue-600 dark:hover:text-blue-300">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button onClick={() => handleDelete(h)} disabled={deletingId === h.holiday_id} title="Delete"
                          className="text-zinc-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-40">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <HolidayDialog
          countryCode={countryCode}
          holiday={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}


function HolidayDialog({
  countryCode, holiday, onClose, onSaved,
}: {
  countryCode: string;
  holiday: PublicHoliday | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(holiday?.name ?? "");
  const [date, setDate] = useState(holiday?.date ?? new Date().toISOString().slice(0, 10));
  const [observed, setObserved] = useState(holiday?.observed_date ?? "");
  const [recurring, setRecurring] = useState(holiday?.is_recurring ?? false);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim() || !date) { toast.error("Name and date are required"); return; }
    setSaving(true);
    const r = holiday
      ? await payrollRules.updatePublicHoliday(countryCode, holiday.holiday_id, {
          name: name.trim(), date, observed_date: observed || null, is_recurring: recurring,
        })
      : await payrollRules.createPublicHoliday(countryCode, {
          name: name.trim(), date, observed_date: observed || null, is_recurring: recurring,
        });
    setSaving(false);
    if (isError(r)) { toast.error(r.error); return; }
    toast.success(holiday ? "Holiday updated" : "Holiday added");
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 px-5 py-4">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            {holiday ? "Edit holiday" : "Add holiday"} · {countryCode}
          </h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Labour Day"
              className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </Field>
          <Field label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </Field>
          <Field label="Observed date (optional — for Sunday substitution)">
            <input type="date" value={observed} onChange={(e) => setObserved(e.target.value)}
              className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </Field>
          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
            Recurring (same calendar date every year)
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 dark:border-zinc-800 px-5 py-4">
          <button onClick={onClose} className="rounded-md border border-zinc-200 dark:border-zinc-800 px-4 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:bg-zinc-900/40">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? "Saving…" : holiday ? "Save changes" : "Add holiday"}
          </button>
        </div>
      </div>
    </div>
  );
}


function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs uppercase font-semibold text-zinc-500 dark:text-zinc-400 mb-1 tracking-wide">{label}</label>
      {children}
    </div>
  );
}
