"use client";

import { useState } from "react";
import { payrollRules, type OvertimeReconcileResponse, type ReconcileClockIn } from "@/services/payroll-api";
import { isError } from "@/utils/payrollFormat";
import { describeFlag } from "@/utils/describeFlag";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, Calculator } from "lucide-react";


const DOW = [
  { v: 1, l: "Mon" }, { v: 2, l: "Tue" }, { v: 3, l: "Wed" }, { v: 4, l: "Thu" },
  { v: 5, l: "Fri" }, { v: 6, l: "Sat" }, { v: 7, l: "Sun" },
];
const DAY_NAMES: Record<number, string> = {
  1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday", 7: "Sunday",
};

function fmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface Row extends ReconcileClockIn {
  _key: number;
}

let keySeq = 1;
function blankRow(date: string): Row {
  return { _key: keySeq++, date, start_hhmm: "09:00", end_hhmm: "18:00", is_overtime: false, overtime_confirmed: false };
}


export default function PayslipReconcilePanel({ countryCode }: { countryCode: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const [periodStart, setPeriodStart] = useState(today);
  const [periodEnd, setPeriodEnd] = useState(today);
  const [hourlyRate, setHourlyRate] = useState("200");
  const [eligibility, setEligibility] = useState("HOURLY");
  const [restDow, setRestDow] = useState(7);
  const [contracted, setContracted] = useState("");
  const [monthlyBasic, setMonthlyBasic] = useState("");
  const [tz, setTz] = useState("Etc/UTC");
  const [rows, setRows] = useState<Row[]>([blankRow(today)]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OvertimeReconcileResponse | null>(null);
  // Actual payslip amounts the admin transcribes, keyed by bucket code.
  const [actuals, setActuals] = useState<Record<string, string>>({});
  const [prefillId, setPrefillId] = useState("");
  const [prefilling, setPrefilling] = useState(false);

  function updateRow(key: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r._key === key ? { ...r, ...patch } : r)));
  }

  // Read-only: pull a real employee's contract + clock-ins for the chosen
  // period and fill the form, so there's nothing to hand-transcribe.
  async function handlePrefill() {
    const pid = parseInt(prefillId, 10);
    if (!pid) { toast.error("Enter an employee ID first."); return; }
    setPrefilling(true);
    const r = await payrollRules.reconcilePrefill(countryCode, {
      private_user_id: pid, period_start: periodStart, period_end: periodEnd,
    });
    setPrefilling(false);
    if (isError(r)) { toast.error(r.error); return; }
    if (r.period_start) setPeriodStart(r.period_start);
    if (r.period_end) setPeriodEnd(r.period_end);
    setEligibility(r.overtime_eligibility || "HOURLY");
    setHourlyRate(r.hourly_rate ?? "0");
    setRestDow(Number(r.weekly_rest_day_dow) || 7);
    setContracted(r.contracted_hours_per_week ?? "");
    setMonthlyBasic(r.monthly_basic ?? "");
    setTz(r.company_timezone || "Etc/UTC");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cins: any[] = Array.isArray(r.clock_ins) ? r.clock_ins : [];
    setRows(cins.length
      ? cins.map((c) => ({ _key: keySeq++, date: c.date, start_hhmm: c.start_hhmm, end_hhmm: c.end_hhmm, is_overtime: !!c.is_overtime, overtime_confirmed: !!c.overtime_confirmed }))
      : [blankRow(periodStart)]);
    setResult(null);
    setActuals({});
    toast.success(`Loaded ${r.employee_name || "employee"} — ${cins.length} shift(s).`);
  }

  async function handleRun() {
    if (eligibility === "MONTHLY_ELIGIBLE" && (!monthlyBasic.trim() || !contracted.trim())) {
      toast.error("MONTHLY_ELIGIBLE needs both Monthly basic and Contracted h/wk (the hourly rate is derived from them).");
      return;
    }
    setLoading(true);
    setResult(null);
    const r = await payrollRules.reconcileOvertime(countryCode, {
      period_start: periodStart,
      period_end: periodEnd,
      hourly_rate: hourlyRate || "0",
      weekly_rest_day_dow: restDow,
      overtime_eligibility: eligibility,
      monthly_basic: monthlyBasic || null,
      contracted_hours_per_week: contracted || null,
      company_timezone: tz || "Etc/UTC",
      clock_ins: rows.map(({ _key, ...ci }) => ci),
    });
    setLoading(false);
    if (isError(r)) { toast.error(r.error); return; }
    setResult(r);
  }

  const expectedTotal = result ? Number(result.total) : 0;
  const actualTotal = result
    ? result.buckets.reduce((s, b) => s + (Number(actuals[b.code]) || 0), 0)
    : 0;

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <div className="flex items-center gap-2 mb-1">
        <Calculator className="h-4 w-4 text-blue-600 dark:text-blue-300" />
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Check a payslip against the rules</h3>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
        Did a real payslip pay the legal minimum? Enter the employee&apos;s pay setup and the shifts
        they worked — we&apos;ll show what they <span className="font-medium">should</span> have earned under
        the {countryCode} rules. Then type what the payslip actually paid to spot any gap.
      </p>
      <ol className="mb-3 ml-4 list-decimal text-xs text-zinc-500 dark:text-zinc-400 space-y-0.5">
        <li>Fill in the pay setup (pay period, how they&apos;re paid, salary, day off).</li>
        <li>Add each shift they worked.</li>
        <li>Press <span className="font-medium">Work out the pay</span> — the table shows what each part should be.</li>
        <li>Type the payslip&apos;s real amounts in the last column; red means it doesn&apos;t match.</li>
      </ol>

      {/* Shortcut: load a real employee instead of typing everything. */}
      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-blue-100 dark:border-blue-500/20 bg-blue-50/50 dark:bg-blue-500/5 p-2.5">
        <div className="min-w-[150px]">
          <div className="text-[10px] uppercase text-zinc-500 dark:text-zinc-400 tracking-wide mb-1">Load a real employee (optional)</div>
          <input value={prefillId} onChange={(e) => setPrefillId(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="Employee ID" inputMode="numeric" className={`${inputCls} w-40`} />
        </div>
        <button onClick={handlePrefill} disabled={prefilling}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {prefilling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Load
        </button>
        <span className="text-xs text-zinc-400 dark:text-zinc-500 self-center">Set the pay period first, then load — fills everything below from their contract + clock-ins.</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
        <Labelled label="Pay period — from"><input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className={inputCls} /></Labelled>
        <Labelled label="Pay period — to"><input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className={inputCls} /></Labelled>
        <Labelled label="How are they paid?">
          <select value={eligibility} onChange={(e) => setEligibility(e.target.value)} className={inputCls}>
            <option value="HOURLY">By the hour</option>
            <option value="MONTHLY_ELIGIBLE">Monthly salary (gets overtime)</option>
            <option value="EXEMPT">Monthly salary (no overtime)</option>
          </select>
        </Labelled>
        <Labelled label="Weekly day off">
          <select value={restDow} onChange={(e) => setRestDow(Number(e.target.value))} className={inputCls}>
            {DOW.map((d) => <option key={d.v} value={d.v}>{DAY_NAMES[d.v]}</option>)}
          </select>
        </Labelled>

        {eligibility === "MONTHLY_ELIGIBLE" ? (
          <>
            <Labelled label="Monthly basic salary"><input value={monthlyBasic} onChange={(e) => setMonthlyBasic(e.target.value)} placeholder="e.g. 18000" className={inputCls} /></Labelled>
            <Labelled label="Contracted hours / week"><input value={contracted} onChange={(e) => setContracted(e.target.value)} placeholder="e.g. 45" className={inputCls} /></Labelled>
          </>
        ) : (
          <Labelled label="Hourly pay rate"><input value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} placeholder="e.g. 200" className={inputCls} /></Labelled>
        )}
      </div>

      <details className="mb-3 text-xs">
        <summary className="cursor-pointer select-none text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">Advanced settings</summary>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Labelled label="Timezone"><input value={tz} onChange={(e) => setTz(e.target.value)} className={inputCls} /></Labelled>
          {eligibility !== "MONTHLY_ELIGIBLE" && (
            <Labelled label="Contracted hours / week (optional)"><input value={contracted} onChange={(e) => setContracted(e.target.value)} placeholder="optional" className={inputCls} /></Labelled>
          )}
        </div>
      </details>

      <div className="mb-3">
        <div className="text-[10px] uppercase text-zinc-500 dark:text-zinc-400 tracking-wide mb-1">Shifts worked</div>
        <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-1.5">One row per shift — the day, then start and end time. Tick “Overtime” only if the payslip paid that shift as overtime.</p>
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r._key} className="flex flex-wrap items-center gap-2">
              <input type="date" value={r.date} onChange={(e) => updateRow(r._key, { date: e.target.value })} className={`${inputCls} w-auto`} />
              <input value={r.start_hhmm} onChange={(e) => updateRow(r._key, { start_hhmm: e.target.value })} placeholder="HH:MM" className={`${inputCls} w-20`} />
              <span className="text-zinc-400">→</span>
              <input value={r.end_hhmm} onChange={(e) => updateRow(r._key, { end_hhmm: e.target.value })} placeholder="HH:MM" className={`${inputCls} w-20`} />
              <label className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300" title="This shift was paid as overtime on the payslip">
                <input type="checkbox" checked={r.is_overtime} onChange={(e) => updateRow(r._key, { is_overtime: e.target.checked })} /> Overtime
              </label>
              <label className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300" title="The overtime was formally approved">
                <input type="checkbox" checked={r.overtime_confirmed} onChange={(e) => updateRow(r._key, { overtime_confirmed: e.target.checked })} /> approved
              </label>
              <button onClick={() => setRows((rs) => rs.filter((x) => x._key !== r._key))}
                className="text-zinc-400 hover:text-red-600" title="Remove this shift"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
        <button onClick={() => setRows((rs) => [...rs, blankRow(periodStart)])}
          className="mt-2 inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-300 hover:underline">
          <Plus className="h-3 w-3" /> Add another shift
        </button>
      </div>

      <button onClick={handleRun} disabled={loading}
        className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
        Work out the pay
      </button>

      {result && (
        <div className="mt-4">
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">
            Worked out using the {countryCode} rule v{result.rule_version} (in force from {result.rule_effective_from}).
            Type each amount from the real payslip under <span className="font-medium">On payslip</span> — a red
            {" "}<span className="font-medium">Difference</span> means it doesn&apos;t match what the rules require.
            {result.compliance_flags.length > 0 && (
              <span className="ml-1 text-amber-600 dark:text-amber-400">Warnings: {result.compliance_flags.map((f) => describeFlag(f)).join("; ")}.</span>
            )}
          </p>
          <table className="min-w-full text-sm border border-zinc-200 dark:border-zinc-800 rounded-md overflow-hidden">
            <thead className="bg-zinc-50 dark:bg-zinc-900/40 text-xs uppercase text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className="text-left px-3 py-1.5">Pay component</th>
                <th className="text-right px-3 py-1.5">Hours</th>
                <th className="text-right px-3 py-1.5">Rate</th>
                <th className="text-right px-3 py-1.5">Should be</th>
                <th className="text-right px-3 py-1.5">On payslip</th>
                <th className="text-right px-3 py-1.5">Difference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {result.buckets.map((b) => {
                const exp = Number(b.amount);
                const act = Number(actuals[b.code]) || 0;
                const d = act - exp;
                const mismatch = actuals[b.code] != null && actuals[b.code] !== "" && Math.abs(d) > 0.01;
                return (
                  <tr key={b.code}>
                    <td className="px-3 py-1.5 text-zinc-900 dark:text-zinc-100">{b.label}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{Number(b.hours).toFixed(2)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{Number(b.multiplier).toFixed(2)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(exp)}</td>
                    <td className="px-3 py-1.5 text-right">
                      <input value={actuals[b.code] ?? ""} onChange={(e) => setActuals((a) => ({ ...a, [b.code]: e.target.value }))}
                        placeholder="—" className={`${inputCls} w-24 text-right`} />
                    </td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${mismatch ? "text-red-600 dark:text-red-400 font-semibold" : "text-zinc-400"}`}>
                      {actuals[b.code] ? fmt(d) : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-zinc-50 dark:bg-zinc-900/40 font-semibold">
              <tr>
                <td className="px-3 py-1.5" colSpan={3}>TOTAL (gross pay)</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(expectedTotal)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{actualTotal ? fmt(actualTotal) : ""}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums ${actualTotal && Math.abs(actualTotal - expectedTotal) > 1 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                  {actualTotal ? fmt(actualTotal - expectedTotal) : ""}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500";

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-zinc-500 dark:text-zinc-400 tracking-wide mb-1">{label}</div>
      {children}
    </div>
  );
}
