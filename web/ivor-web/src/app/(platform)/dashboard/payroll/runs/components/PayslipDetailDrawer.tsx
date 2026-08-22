"use client";

import { Fragment, useEffect, useState } from "react";
import { payroll, type Payslip, type PayslipComponent } from "@/services/payroll-api";
import { ChevronDown, ChevronUp, Download, FileText, Loader2, Lock, MapPin, X } from "lucide-react";
import { isError, formatMoney as fmtMoneyBase } from "@/utils/payrollFormat";
import { describeFlag } from "@/utils/describeFlag";
import { countryLabel } from "@/utils/countryDisplay";


interface Props {
  payslipId: number | null;
  onClose: () => void;
}


function formatMoney(amount: string | number, currency: string): string {
  return fmtMoneyBase(amount, currency, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}


// An adjustment payslip's amounts are signed deltas — render with an explicit
// +/− and a colour cue so the employer reads them as a change, not a total.
function formatSigned(amount: string | number, currency: string): { text: string; positive: boolean } {
  const n = Number(amount);
  const v = Number.isNaN(n) ? 0 : n;
  const positive = v >= 0;
  return { text: `${positive ? "+" : "−"}${formatMoney(Math.abs(v), currency)}`, positive };
}


export default function PayslipDetailDrawer({ payslipId, onClose }: Props) {
  const [payslip, setPayslip] = useState<Payslip | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (payslipId === null) {
      setPayslip(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    payroll.getPayslip(payslipId).then((r) => {
      if (cancelled) return;
      setLoading(false);
      if (isError(r)) {
        setPayslip(null);
      } else {
        setPayslip(r);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [payslipId]);

  if (payslipId === null) return null;

  return (
    // z-[60] so the payslip drawer stacks ABOVE the Start-payroll wizard (z-50)
    // and the finalized-run drawer (z-30) — it's always the topmost layer.
    <div className="fixed inset-0 z-[60]">
      {/* Backdrop */}
      <button
        aria-label="Close drawer"
        type="button"
        onClick={onClose}
        className="absolute inset-0 bg-black/30"
      />

      {/* Drawer */}
      <div className="absolute right-0 top-0 h-full w-full max-w-lg bg-white dark:bg-zinc-900 shadow-xl flex flex-col">
        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="h-5 w-5 shrink-0 text-zinc-500 dark:text-zinc-400" />
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                {payslip?.is_adjustment ? "Payslip correction" : "Payslip detail"}
              </h2>
              {payslip?.employee_name && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                  {payslip.employee_name}
                  {payslip.employee_code && <span className="ml-1 font-mono">{payslip.employee_code}</span>}
                </p>
              )}
              {payslip?.home_site_name && (
                <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate">
                  <MapPin className="inline h-3 w-3 -mt-0.5 mr-1 text-zinc-400 dark:text-zinc-500" />
                  {payslip.home_site_name}
                </p>
              )}
            </div>
            {payslip?.is_adjustment && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-violet-100 dark:bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                Correction
              </span>
            )}
            {payslip?.run_status === "draft" && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                Estimated
              </span>
            )}
            {payslip?.run_status === "finalized" && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                Approved
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-zinc-400 dark:text-zinc-500 hover:text-zinc-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-zinc-400 dark:text-zinc-500 gap-2">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading…
            </div>
          ) : payslip === null ? (
            <div className="text-zinc-500 dark:text-zinc-400 text-sm">Payslip not found.</div>
          ) : (
            <div className="space-y-5">
              <CorrectionBanner payslip={payslip} />
              <SummarySection payslip={payslip} />
              <FlagsBanner payslip={payslip} />
              <ComponentsSection payslip={payslip} />
              <LeaveSection payslip={payslip} />
              <LeaveBalanceSection payslip={payslip} />
              <StatutorySection payslip={payslip} />
              <ShadowSection payslip={payslip} />

              {payslip.run_status !== "finalized" ? (
                <div className="inline-flex items-center gap-2 rounded-md border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                  <Lock className="h-4 w-4" />
                  Download available after the run is finalized.
                </div>
              ) : payslip.pdf_url ? (
                <a
                  href={payslip.pdf_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  <Download className="h-4 w-4" />
                  {payslip.is_adjustment ? "Download correction note" : "Download PDF"}
                </a>
              ) : (
                <div className="text-xs text-zinc-400 dark:text-zinc-500 italic">
                  PDF not yet generated for this payslip.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


function FlagsBanner({ payslip }: { payslip: Payslip }) {
  const flags = payslip.flags ?? [];
  if (flags.length === 0) return null;
  const isZero = Number(payslip.gross) === 0;
  return (
    <div className="rounded-md border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 px-4 py-3">
      <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200 mb-1.5">
        {isZero ? "Why this payslip is zero" : "Payroll warnings"}
      </h3>
      <ul className="list-disc pl-5 space-y-1 text-xs text-amber-900 dark:text-amber-200">
        {flags.map((f, i) => (
          <li key={`${f}-${i}`}>{describeFlag(f, { terse: true, currency: payslip.currency })}</li>
        ))}
      </ul>
    </div>
  );
}


/** Banner shown on an adjustment payslip — explains that every figure below is
 *  a signed change versus the original, and surfaces the correction reason. */
function CorrectionBanner({ payslip }: { payslip: Payslip }) {
  if (!payslip.is_adjustment) return null;
  return (
    <div className="rounded-md border border-violet-200 dark:border-violet-500/30 bg-violet-50 dark:bg-violet-500/10 px-4 py-3">
      <h3 className="text-sm font-semibold text-violet-900 dark:text-violet-200 mb-1">
        Correction to a finalized payslip
      </h3>
      <p className="text-xs text-violet-900/80 dark:text-violet-200/80 leading-relaxed">
        The amounts below are the <strong>change (+/−)</strong> applied to the original payslip
        {payslip.parent_payslip_id ? <> (#{payslip.parent_payslip_id})</> : null}, not full-period totals.
        Settle the net difference with the employee outside the app.
      </p>
      {payslip.adjustment_reason ? (
        <p className="mt-2 text-xs text-violet-700 dark:text-violet-300 italic">
          Reason: {payslip.adjustment_reason}
        </p>
      ) : null}
    </div>
  );
}


function SummarySection({ payslip }: { payslip: Payslip }) {
  // For a correction every field is a signed delta — render +/− with colour.
  if (payslip.is_adjustment) {
    const net = formatSigned(payslip.net_pay, payslip.currency);
    return (
      <div className="grid grid-cols-2 gap-3">
        <SignedTile label="Net change" amount={payslip.net_pay} currency={payslip.currency} highlight />
        {Number(payslip.gross) !== 0 && <SignedTile label="Gross change" amount={payslip.gross} currency={payslip.currency} />}
        {Number(payslip.taxable_income) !== 0 && <SignedTile label="Taxable change" amount={payslip.taxable_income} currency={payslip.currency} />}
        {Number(payslip.paye) !== 0 && <SignedTile label="PAYE change" amount={payslip.paye} currency={payslip.currency} />}
        {Number(payslip.allowances_total) !== 0 && <SignedTile label="Allowances change" amount={payslip.allowances_total} currency={payslip.currency} />}
        {Number(payslip.loan_repayments) !== 0 && <SignedTile label="Loan repay. change" amount={payslip.loan_repayments} currency={payslip.currency} />}
        <div className="col-span-2 text-[11px] text-zinc-400 dark:text-zinc-500">
          {net.positive
            ? "Employee is owed a top-up of this net amount."
            : "This is a net claw-back from the employee."}
        </div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      <Tile label="Gross" value={formatMoney(payslip.gross, payslip.currency)} />
      <Tile label="Net pay" value={formatMoney(payslip.net_pay, payslip.currency)} highlight />
      <Tile label="Taxable" value={formatMoney(payslip.taxable_income, payslip.currency)} />
      <Tile label="PAYE" value={formatMoney(payslip.paye, payslip.currency)} />
      {Number(payslip.bonus) > 0 && (
        <Tile label="Bonus" value={formatMoney(payslip.bonus, payslip.currency)} />
      )}
      {Number(payslip.allowances_total) > 0 && (
        <Tile label="Allowances" value={formatMoney(payslip.allowances_total, payslip.currency)} />
      )}
      {Number(payslip.loan_repayments) > 0 && (
        <Tile label="Loan repayments" value={formatMoney(payslip.loan_repayments, payslip.currency)} />
      )}
    </div>
  );
}


function SignedTile({ label, amount, currency, highlight = false }: { label: string; amount: string | number; currency: string; highlight?: boolean }) {
  const s = formatSigned(amount, currency);
  const tone = s.positive ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400";
  return (
    <div className={`rounded-md border px-3 py-2 ${highlight ? "border-violet-200 dark:border-violet-500/30 bg-violet-50 dark:bg-violet-500/15" : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"}`}>
      <div className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">{label}</div>
      <div className={`text-base font-semibold tabular-nums ${tone}`}>{s.text}</div>
    </div>
  );
}


function LeaveSection({ payslip }: { payslip: Payslip }) {
  const items = payslip.leave_summary;
  if (!items || items.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide mb-2">
        Leave taken
      </h3>
      <div className="rounded-md border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <table className="min-w-full divide-y divide-zinc-100 text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-900/40">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">Type</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">Status</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">Days</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-50">
            {items.map((lv) => (
              <tr key={lv.code}>
                <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100 font-medium">
                  {lv.label}
                  <span className="ml-1 text-zinc-400 dark:text-zinc-500 text-xs">({lv.code})</span>
                </td>
                <td className="px-3 py-2 text-xs">
                  {lv.paid ? (
                    <span className="text-emerald-700 dark:text-emerald-300">paid</span>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-300">unpaid</span>
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums text-right text-zinc-900 dark:text-zinc-100">{lv.days}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


// Everyday types always shown; occasional ones (maternity, paternity, …) only
// when the employee has actually taken some — otherwise they're noise on a slip.
const ALWAYS_SHOW_LEAVE = new Set(["annual", "sick"]);

function LeaveBalanceSection({ payslip }: { payslip: Payslip }) {
  const items = (payslip.leave_balance ?? []).filter(
    (b) => ALWAYS_SHOW_LEAVE.has(b.code) || b.taken > 0,
  );
  if (items.length === 0) return null;
  const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const year = payslip.period_end ? new Date(payslip.period_end).getFullYear() : null;
  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide mb-2">
        Leave balance
        {year && <span className="ml-1.5 normal-case font-normal text-zinc-400 dark:text-zinc-500 text-xs">· {year} year-to-date</span>}
      </h3>
      <div className="rounded-md border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <table className="min-w-full divide-y divide-zinc-100 text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-900/40">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">Type</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">Entitled</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">Taken</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">Remaining</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-50">
            {items.map((b) => (
              <tr key={b.code}>
                <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100 font-medium">
                  {b.label}
                  <span className="ml-1 text-zinc-400 dark:text-zinc-500 text-xs">({b.code})</span>
                </td>
                <td className="px-3 py-2 tabular-nums text-right text-zinc-600 dark:text-zinc-400">{fmtDays(b.entitlement)}</td>
                <td className="px-3 py-2 tabular-nums text-right text-zinc-600 dark:text-zinc-400">{fmtDays(b.taken)}</td>
                <td className={`px-3 py-2 tabular-nums text-right font-semibold ${b.remaining <= 0 ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}`}>
                  {fmtDays(b.remaining)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
        Year-to-date guide from policy + approved leave. The period&apos;s exact leave is under &quot;Leave taken&quot;.
      </p>
    </div>
  );
}


function ComponentsSection({ payslip }: { payslip: Payslip }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  if (!payslip.components || payslip.components.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide mb-2">
        Components
      </h3>
      <div className="rounded-md border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <table className="min-w-full divide-y divide-zinc-100 text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-900/40">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">Item</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-50">
            {payslip.components.map((c: PayslipComponent, i: number) => {
              const mult = c.meta?.multiplier;
              const isOt = c.source === "overtime" && c.code !== "REG";
              const hasWhy = !!c.meta && (isOt || c.source === "overtime");
              const isOpen = expanded === i;
              return (
                <Fragment key={`${c.code}-${i}`}>
                  <tr
                    className={hasWhy ? "cursor-pointer hover:bg-amber-50/50 dark:hover:bg-amber-500/5" : ""}
                    onClick={hasWhy ? () => setExpanded(isOpen ? null : i) : undefined}
                  >
                    <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100 font-medium">
                      {c.label}
                      <span className="ml-1 text-zinc-400 dark:text-zinc-500 text-xs">({c.code})</span>
                      {isOt && mult && (
                        <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                          {mult}×
                        </span>
                      )}
                      {hasWhy && (
                        <button
                          type="button"
                          className="ml-2 inline-flex items-center gap-0.5 text-[11px] text-blue-600 dark:text-blue-300 hover:underline align-middle"
                          onClick={(e) => { e.stopPropagation(); setExpanded(isOpen ? null : i); }}
                        >
                          {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          Why this amount?
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-right whitespace-nowrap">
                      <span className={`font-semibold ${c.kind === "deduction" ? "text-red-600 dark:text-red-400" : "text-zinc-900 dark:text-zinc-100"}`}>
                        {c.kind === "deduction" ? "−" : ""}
                        {formatMoney(c.amount, payslip.currency)}
                      </span>
                    </td>
                  </tr>
                  {hasWhy && isOpen && (
                    <tr className="bg-amber-50/40 dark:bg-amber-500/5">
                      <td colSpan={2} className="px-4 py-3">
                        <WhyThisAmount component={c} currency={payslip.currency} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}


function WhyThisAmount({ component, currency }: { component: PayslipComponent; currency: string }) {
  const m = component.meta ?? {};
  const ids = m.source_timelog_ids ?? [];
  return (
    <div className="text-xs text-amber-900 dark:text-amber-200 space-y-1.5">
      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono">
        {m.hours != null && <span><span className="text-amber-700 dark:text-amber-400">hours:</span> {m.hours}</span>}
        {m.multiplier != null && <span><span className="text-amber-700 dark:text-amber-400">multiplier:</span> {m.multiplier}×</span>}
        {m.multiplier != null && m.hours != null && (
          <span>
            <span className="text-amber-700 dark:text-amber-400">amount:</span>{" "}
            {formatMoney(component.amount, currency)}
          </span>
        )}
      </div>
      {m.weekly_accumulator_at_emit != null && (
        <div>
          Weekly hours accumulated when this bucket was emitted:{" "}
          <span className="font-mono">{m.weekly_accumulator_at_emit}h</span> — this is what placed the hours in this rate band.
        </div>
      )}
      {ids.length > 0 && (
        <div>
          From clock-in{ids.length > 1 ? "s" : ""}:{" "}
          <span className="font-mono">{ids.join(", ")}</span>
        </div>
      )}
      {m.notes && <div className="italic">{m.notes}</div>}
    </div>
  );
}


function StatutorySection({ payslip }: { payslip: Payslip }) {
  const ee = payslip.statutory_employee ?? {};
  const er = payslip.statutory_employer ?? {};
  if (Object.keys(ee).length === 0 && Object.keys(er).length === 0) return null;
  // Derive deduction names from the actual codes on the payslip (e.g. CSG_EE →
  // CSG) instead of hardcoding MU-specific names — the statutory set differs by
  // country. PAYE is a separate field, included only when it applies.
  const families = Array.from(new Set(
    [...Object.keys(ee), ...Object.keys(er)].map((c) => c.replace(/_(EE|ER)$/i, "")),
  ));
  const statutoryNames = [
    ...(Number(payslip.paye) > 0 ? ["PAYE"] : []),
    ...families,
  ];
  const statutoryList = statutoryNames.length ? statutoryNames.join(", ") : "Statutory deductions";
  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide mb-2">
        Statutory split
      </h3>
      <div className="rounded-md border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-900/40">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">Code</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">Employee</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">Employer</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(new Set([...Object.keys(ee), ...Object.keys(er)])).sort().map((code) => (
              <tr key={code} className="border-t border-zinc-50">
                <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100 font-medium">{code}</td>
                <td className="px-3 py-2 tabular-nums text-right text-zinc-700 dark:text-zinc-300">
                  {ee[code] ? formatMoney(ee[code], payslip.currency) : "—"}
                </td>
                <td className="px-3 py-2 tabular-nums text-right text-zinc-500 dark:text-zinc-400">
                  {er[code] ? formatMoney(er[code], payslip.currency) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">
        {statutoryList} {statutoryNames.length === 1 ? "is" : "are"} computed using the statutory
        rates in force for this period. This is a guide, not tax or legal advice — verify with the
        relevant authority or a qualified accountant.
      </p>
    </div>
  );
}


/** Phase 2 shadow payroll: host-country statutory figures when the employee was
 *  on an active foreign mission during the period. The real pay is the home
 *  figures above; these are the host-country shadow amounts for reporting. */
function ShadowSection({ payslip }: { payslip: Payslip }) {
  if (!payslip.shadow_country_code) return null;
  const host = payslip.shadow_currency ?? "XXX";
  const rows: Array<[string, string]> = [
    ["Gross (host)", payslip.shadow_gross ? formatMoney(payslip.shadow_gross, host) : "—"],
    ["Taxable (host)", payslip.shadow_taxable_income ? formatMoney(payslip.shadow_taxable_income, host) : "—"],
    ["Income tax", payslip.shadow_tax ? formatMoney(payslip.shadow_tax, host) : "—"],
    ["Social security", payslip.shadow_ss ? formatMoney(payslip.shadow_ss, host) : "—"],
    ["Equalization due", payslip.shadow_equalization_due ? formatMoney(payslip.shadow_equalization_due, payslip.currency) : "—"],
  ];
  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide mb-2">
        Shadow payroll — {countryLabel(payslip.shadow_country_code)}
      </h3>
      <div className="rounded-md border border-blue-200 dark:border-blue-500/30 bg-blue-50/40 dark:bg-blue-500/5 px-4 py-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
              <dd className="tabular-nums font-medium text-zinc-900 dark:text-zinc-100">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">
          Reporting figures in {host} for the host country. The employee&apos;s actual
          pay is in {payslip.currency} (above). Equalization due is the excess of host
          tax over home tax borne by the employer, err on the side of professional advice.
        </p>
      </div>
    </div>
  );
}


function Tile({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-md border px-3 py-2 ${highlight ? "border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/15" : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"}`}>
      <div className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">{label}</div>
      <div data-testid={`tile-${label.replace(/\s+/g, "-").toLowerCase()}`} className={`text-base font-semibold tabular-nums ${highlight ? "text-blue-900 dark:text-blue-100" : "text-zinc-900 dark:text-zinc-100"}`}>{value}</div>
    </div>
  );
}
