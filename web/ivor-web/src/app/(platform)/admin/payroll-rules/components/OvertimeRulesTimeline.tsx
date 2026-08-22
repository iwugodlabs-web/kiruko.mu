"use client";

import { useCallback, useEffect, useState } from "react";
import { payrollRules, type CountryOvertimeRule } from "@/services/payroll-api";
import { toast } from "sonner";
import { RefreshCcw, Lock, AlertTriangle, Wrench } from "lucide-react";
import TimelineCard, { deriveVersionStatus } from "./TimelineCard";
import { isError } from "@/utils/payrollFormat";
import ExampleCallout from "@/components/ui/ExampleCallout";
import PayslipReconcilePanel from "./PayslipReconcilePanel";
import RuleSummary from "./RuleSummary";


function fmtMult(v?: string | null): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return v;
  return `${n.toFixed(2).replace(/\.?0+$/, "")}×`;
}

function fmtHours(v?: string | null): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return v;
  return `${n.toFixed(2).replace(/\.?0+$/, "")}h`;
}

function tierSummary(r: CountryOvertimeRule): string {
  const tiers = [...r.weekday_tiers].sort((a, b) => a.tier_order - b.tier_order);
  if (tiers.length === 0) return "no weekday tiers";
  return tiers
    .map((t) => (t.up_to_hours ? `≤${fmtHours(t.up_to_hours)} ${fmtMult(t.multiplier)}` : `beyond ${fmtMult(t.multiplier)}`))
    .join(" · ");
}

// One plain-English sentence describing the rule, so the card is legible at a
// glance before the reader digs into the raw fields below.
function plainSummary(r: CountryOvertimeRule): string {
  const tiers = [...r.weekday_tiers].sort((a, b) => a.tier_order - b.tier_order);
  const beyond = tiers.find((t) => !t.up_to_hours) ?? tiers[tiers.length - 1];
  const otMult = beyond ? fmtMult(beyond.multiplier) : "a premium";

  const parts: string[] = [];
  parts.push(
    `Overtime is paid at ${otMult} beyond ${fmtHours(r.weekly_threshold_h)}/week` +
      (r.daily_threshold_h ? ` or ${fmtHours(r.daily_threshold_h)}/day` : "") + ".",
  );

  const rest = fmtMult(r.rest_day_multiplier);
  const holNorm = fmtMult(r.public_holiday_normal_hours_multiplier);
  const holAfter = fmtMult(r.public_holiday_after_hours_multiplier);
  parts.push(
    `Rest days ${rest}, public holidays ${holNorm}` +
      (r.public_holiday_after_hours_multiplier && holAfter !== holNorm ? ` (${holAfter} past the daily threshold)` : "") + ".",
  );

  if (r.night_multiplier_habitual || r.night_start) {
    const nm = fmtMult(r.night_multiplier_habitual);
    const stack =
      r.stack_night_on_premium === "STACK" ? ", stacked on top of other premiums"
      : r.stack_night_on_premium === "NO_STACK" ? " (does not stack with other premiums)"
      : "";
    parts.push(`Night work ${nm}${stack}.`);
  }

  if (r.weekly_total_max_h) parts.push(`Weekly hours are capped at ${fmtHours(r.weekly_total_max_h)}.`);
  return parts.join(" ");
}


export default function OvertimeRulesTimeline({ countryCode }: { countryCode: string }) {
  const [rows, setRows] = useState<CountryOvertimeRule[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await payrollRules.listOvertimeRules(countryCode);
    if (isError(r)) {
      toast.error(r.error);
      setRows([]);
    } else {
      setRows([...r].sort((a, b) => b.version - a.version));
    }
    setLoading(false);
  }, [countryCode]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex-1">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            How overtime, rest-day, public-holiday and night premiums are paid.
            Each clock-in is split into rate-coded buckets and paid at the multiplier in force.
          </p>
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-600 dark:text-zinc-300">
            <Lock className="h-3.5 w-3.5" />
            Read-only — overtime rules are seeded/superseded by engineering, not the admin UI.
          </p>
          <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>
              <span className="font-semibold">General statutory floor only.</span> This rule encodes the country&apos;s
              baseline (e.g. Mauritius WRA 2019). Sector-specific Remuneration Orders
              (catering/tourism, construction, security, sugar, …) can set higher floors and are
              <span className="font-semibold"> not yet applied</span>. If your company is in a regulated sector, verify the
              statutory minimum against its Remuneration Order before relying on these figures.
            </span>
          </div>
          <ExampleCallout caption="How the buckets are paid" className="mt-2">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-zinc-500 dark:text-zinc-400 uppercase">
                  <th className="text-left py-1 font-medium">Bucket</th>
                  <th className="text-left py-1 font-medium">When</th>
                  <th className="text-right py-1 font-medium">Multiplier</th>
                </tr>
              </thead>
              <tbody className="text-zinc-700 dark:text-zinc-300">
                <tr><td>Regular</td><td>Within weekly threshold</td><td className="text-right">1×</td></tr>
                <tr><td>Weekday OT</td><td>Beyond weekly threshold</td><td className="text-right">tiered</td></tr>
                <tr><td>Rest day</td><td>Worker&apos;s weekly rest day</td><td className="text-right">premium</td></tr>
                <tr><td>Public holiday</td><td>Gazetted holiday</td><td className="text-right">premium</td></tr>
                <tr><td>Night</td><td>Within night window</td><td className="text-right">premium</td></tr>
              </tbody>
            </table>
          </ExampleCallout>
        </div>
        <button onClick={refresh} disabled={loading}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:bg-zinc-900/40 disabled:opacity-50">
          <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1].map((i) => <div key={i} className="rounded-lg border border-zinc-200 dark:border-zinc-800 h-32 animate-pulse" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-12 text-center">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No overtime rule seeded for {countryCode} yet. Payroll runs for this country
            will fail with <span className="font-mono">NO_OVERTIME_RULE_FOR_COUNTRY</span> until one is added.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((v, i) => {
            const prior = rows[i + 1];
            return (
              <TimelineCard
                key={v.id}
                version={v.version}
                effectiveFrom={v.effective_from}
                effectiveTo={v.effective_to ?? null}
                sourceReference={v.source_reference}
                changeReason={v.change_reason}
                status={deriveVersionStatus(v.effective_from, v.effective_to)}
                headline={`${fmtHours(v.weekly_threshold_h)}/wk · ${tierSummary(v)}`}
                body={
                  <div className="space-y-3">
                    <RuleSummary>{plainSummary(v)}</RuleSummary>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                      <Field label="Weekly threshold" value={fmtHours(v.weekly_threshold_h)} />
                      <Field label="Daily threshold" value={fmtHours(v.daily_threshold_h)} />
                      <Field label="Rest day" value={fmtMult(v.rest_day_multiplier)} />
                      <Field label="Week starts" value={DOW[v.week_start_dow] ?? String(v.week_start_dow)} />
                      <Field label="Holiday (normal)" value={fmtMult(v.public_holiday_normal_hours_multiplier)} />
                      <Field label="Holiday (after)" value={fmtMult(v.public_holiday_after_hours_multiplier)} />
                      <Field label="OT soft cap" value={fmtHours(v.weekly_ot_soft_cap_h)} />
                      <Field label="Weekly max" value={fmtHours(v.weekly_total_max_h)} />
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-zinc-500 dark:text-zinc-400 tracking-wide mb-1">Weekday OT tiers</div>
                      <div className="flex flex-wrap gap-1.5">
                        {[...v.weekday_tiers].sort((a, b) => a.tier_order - b.tier_order).map((t) => (
                          <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 px-2 py-0.5 text-xs font-mono">
                            {t.up_to_hours ? `≤${fmtHours(t.up_to_hours)}` : "beyond"}: {fmtMult(t.multiplier)}
                          </span>
                        ))}
                        {v.weekday_tiers.length === 0 && <span className="text-xs text-zinc-400">none</span>}
                      </div>
                    </div>
                    {(v.night_start || v.night_multiplier_habitual) && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                        <Field label="Night window" value={v.night_start && v.night_end ? `${v.night_start}–${v.night_end}` : "—"} />
                        <Field label="Night (habitual)" value={fmtMult(v.night_multiplier_habitual)} />
                        <Field label="Night (occasional)" value={fmtMult(v.night_multiplier_occasional)} />
                        <Field label="Night mode" value={v.night_mode ?? "—"} />
                      </div>
                    )}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                      <Field label="Stack holiday on rest" value={v.stack_holiday_on_rest_day}
                        hint={STACK_HOLIDAY_HINTS[v.stack_holiday_on_rest_day]} />
                      <Field label="Stack night on premium" value={v.stack_night_on_premium}
                        hint={STACK_NIGHT_HINTS[v.stack_night_on_premium]} />
                      <Field label="Monthly basic OT cap" value={v.monthly_basic_ot_cap ?? "—"} />
                    </div>
                  </div>
                }
                diff={prior ? <DiffRow prior={prior} current={v} /> : null}
              />
            );
          })}
        </div>
      )}

      {!loading && rows.length > 0 && (
        <details className="mt-6 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 rounded-lg flex items-center gap-2">
            <Wrench className="h-4 w-4 text-zinc-400" />
            Check a payslip against the rules
            <span className="ml-1 text-xs font-normal text-zinc-400">(optional tool)</span>
          </summary>
          <div className="px-4 pb-4 pt-1 border-t border-zinc-100 dark:border-zinc-800">
            <PayslipReconcilePanel countryCode={countryCode} />
          </div>
        </details>
      )}
    </div>
  );
}

const DOW = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];


function Field({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div
      className="rounded border border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40 px-2 py-1.5"
      title={hint}
    >
      <div className="text-[10px] uppercase text-zinc-500 dark:text-zinc-400 tracking-wide flex items-center gap-1">
        {label}
        {hint && <span className="text-zinc-400 dark:text-zinc-500 cursor-help" aria-label={hint}>ⓘ</span>}
      </div>
      <div className="text-sm font-mono text-zinc-900 dark:text-zinc-100">{value}</div>
    </div>
  );
}


// Plain-language explanations of the stacking-policy enum values — surfaced as
// field tooltips so admins (esp. for MG) understand the no-stack rule.
const STACK_HOLIDAY_HINTS: Record<string, string> = {
  MAX: "When a shift is both a rest day and a public holiday, pay the higher of the two multipliers — they do not add together.",
  ADD: "When a shift is both a rest day and a public holiday, the two multipliers are summed.",
};
const STACK_NIGHT_HINTS: Record<string, string> = {
  NO_STACK: "Night premium does NOT combine with a rest-day/holiday premium (Madagascar rule): the day-type multiplier wins, night does not add on top. Overtime tiers still apply.",
  STACK: "Night premium is added on top of any other premium for the slice (Mauritius sector rule).",
  REPLACE: "Night work replaces the base rate with the night multiplier rather than adding to it.",
};


function DiffRow({ prior, current }: { prior: CountryOvertimeRule; current: CountryOvertimeRule }) {
  const fields: Array<{ label: string; old: string; cur: string }> = [
    { label: "weekly_threshold_h", old: prior.weekly_threshold_h, cur: current.weekly_threshold_h },
    { label: "rest_day_multiplier", old: prior.rest_day_multiplier, cur: current.rest_day_multiplier },
    { label: "holiday_normal", old: prior.public_holiday_normal_hours_multiplier, cur: current.public_holiday_normal_hours_multiplier },
    { label: "holiday_after", old: prior.public_holiday_after_hours_multiplier, cur: current.public_holiday_after_hours_multiplier },
    { label: "weekly_total_max_h", old: prior.weekly_total_max_h ?? "—", cur: current.weekly_total_max_h ?? "—" },
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
