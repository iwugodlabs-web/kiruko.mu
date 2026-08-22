"use client";

import { useEffect, useMemo, useState } from "react";
import { payroll, stepUp, type PayrollRun, type Payslip } from "@/services/payroll-api";
import { fetchCompanyUsers, type User } from "@/services/api";
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, ShieldCheck, Timer, X } from "lucide-react";
import { toast } from "sonner";
import { isError, formatMoney as fmtMoneyBase } from "@/utils/payrollFormat";


interface Props {
  open: boolean;
  companyId: number;
  // When set, the wizard resumes an existing draft at the review step
  // instead of starting from the period picker. Used by the run list's
  // "Open" action so a stuck draft can be inspected and finalized.
  resumeDraftId?: number | null;
  onClose: () => void;
  onCompleted: () => void;
  onOpenPayslip: (payslipId: number) => void;
}


function lastDayOfMonth(year: number, month: number /* 1-12 */): string {
  // month is 1-indexed; new Date(year, month, 0) gives the last day of `month`.
  const d = new Date(Date.UTC(year, month, 0));
  return d.toISOString().slice(0, 10);
}


function firstDayOfMonth(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month - 1, 1));
  return d.toISOString().slice(0, 10);
}


function formatMoney(amount: string, currency: string): string {
  return fmtMoneyBase(amount, currency, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}


// The backend nests private_user_id under private_user (see SalariesSection /
// SalaryPreviewWidget for the established read path).
function privateIdOf(u: User): number | undefined {
  return u.private_user?.private_user_id ?? u.private_user_id;
}

function nameOf(u: User): string {
  const first = u.private_user?.first_name?.trim() ?? "";
  const last = u.private_user?.last_name?.trim() ?? "";
  const full = `${first} ${last}`.trim();
  return full || u.user_name || u.email || `Employee #${privateIdOf(u) ?? u.user_id}`;
}


type Step = "select" | "review" | "finalize";


export default function StartRunWizard({ open, companyId, resumeDraftId, onClose, onCompleted, onOpenPayslip }: Props) {
  const today = useMemo(() => new Date(), []);
  const defaultMonth = today.getMonth() + 1; // 1-12
  const defaultYear = today.getFullYear();

  const [step, setStep] = useState<Step>("select");
  const [year, setYear] = useState(defaultYear);
  const [month, setMonth] = useState(defaultMonth);
  const [draftRun, setDraftRun] = useState<PayrollRun | null>(null);
  const [loading, setLoading] = useState(false);

  // Map of private_user_id → display name, so the review table shows employee
  // names instead of raw #ids on the last check before locking pay. Populated
  // from the company users list when the wizard opens.
  const [nameById, setNameById] = useState<Record<number, string>>({});

  // Step-up state
  const [otpRequested, setOtpRequested] = useState(false);
  const [otpCode, setOtpCode] = useState("");

  // Reset on close
  useEffect(() => {
    if (!open) {
      setStep("select");
      setDraftRun(null);
      setOtpRequested(false);
      setOtpCode("");
      setLoading(false);
    }
  }, [open]);

  // Load the company roster once per open so the review table can resolve
  // private_user_id → name. Best-effort: if it fails the table falls back to
  // showing the id, which is still correct, just less readable.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const res = await fetchCompanyUsers(companyId);
      if (cancelled || !Array.isArray(res)) return;
      const map: Record<number, string> = {};
      for (const u of res as User[]) {
        const pid = privateIdOf(u);
        if (pid != null) map[pid] = nameOf(u);
      }
      setNameById(map);
    })();
    return () => { cancelled = true; };
  }, [open, companyId]);

  // Resume an existing draft when the list passes resumeDraftId — fetch the
  // run and jump straight to the review step. If the fetch fails (deleted,
  // permission, network), we fall back to the select step rather than
  // leaving the wizard wedged.
  useEffect(() => {
    if (!open || !resumeDraftId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const r = await payroll.getRun(resumeDraftId);
      if (cancelled) return;
      setLoading(false);
      if (isError(r)) {
        toast.error(r.error);
        setStep("select");
        return;
      }
      setDraftRun(r);
      setYear(new Date(r.period_start).getUTCFullYear());
      setMonth(new Date(r.period_start).getUTCMonth() + 1);
      setStep("review");
    })();
    return () => { cancelled = true; };
  }, [open, resumeDraftId]);

  // periodOptions must be declared *before* the `!open` early return —
  // React reconciles hook calls by index, so a hook that only runs when
  // open=true creates a hook-count mismatch on the open-toggle render
  // and trips the production minified error #310. Compute it always;
  // it's pure and cheap.
  const periodOptions = useMemo(() => {
    const opts: { value: string; label: string; year: number; month: number }[] = [];
    for (let offset = -6; offset <= 5; offset++) {
      const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
      opts.push({
        value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        label: d.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
        year: d.getFullYear(),
        month: d.getMonth() + 1,
      });
    }
    return opts;
  }, [today]);

  // Overtime cost preview — computed client-side from the draft's payslip
  // components. Each overtime bucket (source==='overtime', code!=='REG')
  // carries a multiplier in meta; the premium *above base rate* is
  // amount × (1 − 1/multiplier). REG buckets are regular-rate, so excluded.
  // MUST be before the `!open` early return (same hook-order rule as
  // periodOptions) — otherwise the hook count changes when the wizard toggles.
  const ot = useMemo(() => {
    let bucketPay = 0;
    let premiumAboveBase = 0;
    let employeesWithOt = 0;
    for (const p of draftRun?.payslips ?? []) {
      let slipHasOt = false;
      for (const c of p.components ?? []) {
        if (c.source !== "overtime" || c.code === "REG" || c.kind !== "earning") continue;
        const amt = Number(c.amount);
        if (Number.isNaN(amt) || amt === 0) continue;
        slipHasOt = true;
        bucketPay += amt;
        const mult = c.meta?.multiplier ? Number(c.meta.multiplier) : NaN;
        if (!Number.isNaN(mult) && mult > 1) premiumAboveBase += amt * (1 - 1 / mult);
      }
      if (slipHasOt) employeesWithOt += 1;
    }
    return { bucketPay, premiumAboveBase, employeesWithOt };
  }, [draftRun]);

  if (!open) return null;

  // ------------------------------ Step actions ------------------------------

  async function handleCreateDraft() {
    setLoading(true);
    const r = await payroll.createDraft({
      company_id: companyId,
      period_start: firstDayOfMonth(year, month),
      period_end: lastDayOfMonth(year, month),
    });
    setLoading(false);
    if (isError(r)) {
      toast.error(r.error);
      return;
    }
    setDraftRun(r);
    setStep("review");
  }

  async function handleCancelDraft() {
    if (!draftRun) return;
    if (!confirm("Cancel this draft run? You can recreate it later.")) return;
    setLoading(true);
    const r = await payroll.cancel(draftRun.id);
    setLoading(false);
    if (isError(r)) {
      toast.error(r.error);
      return;
    }
    toast.success("Draft cancelled");
    onCompleted();
  }

  async function handleRequestOtp() {
    setLoading(true);
    const r = await stepUp.request("payroll_finalize");
    setLoading(false);
    if (isError(r)) {
      toast.error(r.error);
      return;
    }
    setOtpRequested(true);
    toast.success("OTP sent. Check your email.");
  }

  async function handleFinalize() {
    if (!draftRun) return;
    if (!otpCode.match(/^\d{6}$/)) {
      toast.error("Enter the 6-digit OTP from your email");
      return;
    }
    setLoading(true);
    const verifyResp = await stepUp.verify("payroll_finalize", otpCode);
    if (isError(verifyResp)) {
      setLoading(false);
      toast.error(verifyResp.error);
      return;
    }
    const finalizeResp = await payroll.finalize(draftRun.id, verifyResp.token);
    setLoading(false);
    if (isError(finalizeResp)) {
      toast.error(finalizeResp.error);
      return;
    }
    toast.success("Payroll finalized");
    onCompleted();
  }

  // ------------------------------ Step bodies ------------------------------

  const totalGross = draftRun?.payslips.reduce((sum: number, p: Payslip) => sum + Number(p.gross), 0) ?? 0;
  const totalNet = draftRun?.payslips.reduce((sum: number, p: Payslip) => sum + Number(p.net_pay), 0) ?? 0;
  const totalPaye = draftRun?.payslips.reduce((sum: number, p: Payslip) => sum + Number(p.paye), 0) ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Start payroll</h2>
            <div className="flex items-center gap-2 mt-1">
              <StepDot label="Select" active={step === "select"} done={step !== "select"} />
              <StepBar />
              <StepDot label="Review" active={step === "review"} done={step === "finalize"} />
              <StepBar />
              <StepDot label="Finalize" active={step === "finalize"} done={false} />
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-400 dark:text-zinc-500 hover:text-zinc-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {step === "select" && (
            <div className="space-y-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Pick the month to run. The engine will resolve every employee with an
                active salary assignment for that period and generate draft payslips.
              </p>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Period
                </label>
                <select
                  value={`${year}-${String(month).padStart(2, "0")}`}
                  onChange={(e) => {
                    const [y, m] = e.target.value.split("-").map(Number);
                    setYear(y);
                    setMonth(m);
                  }}
                  className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {periodOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {step === "review" && draftRun && (
            <div>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <SummaryTile label="Payslips" value={String(draftRun.payslips.length)} />
                <SummaryTile label="Total gross" value={formatMoney(String(totalGross), draftRun.currency)} />
                <SummaryTile label="Total net" value={formatMoney(String(totalNet), draftRun.currency)} highlight />
              </div>

              {ot.bucketPay > 0 && (
                <div className="mb-4 rounded-md border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 px-4 py-3 flex items-start gap-3">
                  <Timer className="h-5 w-5 text-amber-600 dark:text-amber-300 mt-0.5 shrink-0" />
                  <div className="text-sm text-amber-800 dark:text-amber-200">
                    <span className="font-semibold">{formatMoney(String(ot.bucketPay), draftRun.currency)}</span> of this run is
                    overtime &amp; premium pay
                    {ot.premiumAboveBase > 0 && (
                      <> — <span className="font-semibold">{formatMoney(String(ot.premiumAboveBase), draftRun.currency)}</span> of that is the premium above base rate</>
                    )}
                    , across {ot.employeesWithOt} employee{ot.employeesWithOt === 1 ? "" : "s"}. Open a payslip to see the per-bucket breakdown.
                  </div>
                </div>
              )}
              <div className="rounded-md border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                <table className="min-w-full divide-y divide-zinc-100">
                  <thead className="bg-zinc-50 dark:bg-zinc-900/40">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">Employee</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">Gross</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">PAYE</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">Net</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50">
                    {draftRun.payslips.map((p: Payslip) => (
                      <tr key={p.id}>
                        <td className="px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300">
                          {nameById[p.private_user_id] ?? `#${p.private_user_id}`}
                        </td>
                        <td className="px-3 py-2 text-sm tabular-nums text-zinc-700 dark:text-zinc-300 text-right">
                          {formatMoney(p.gross, draftRun.currency)}
                        </td>
                        <td className="px-3 py-2 text-sm tabular-nums text-zinc-500 dark:text-zinc-400 text-right">
                          {formatMoney(p.paye, draftRun.currency)}
                        </td>
                        <td className="px-3 py-2 text-sm tabular-nums text-zinc-900 dark:text-zinc-100 font-medium text-right">
                          {formatMoney(p.net_pay, draftRun.currency)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => onOpenPayslip(p.id)}
                            className="text-xs text-blue-600 dark:text-blue-300 hover:underline"
                          >
                            Detail
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-zinc-50 dark:bg-zinc-900/40">
                    <tr>
                      <td className="px-3 py-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Total</td>
                      <td className="px-3 py-2 tabular-nums text-right text-sm font-medium">
                        {formatMoney(String(totalGross), draftRun.currency)}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-right text-sm font-medium text-zinc-500 dark:text-zinc-400">
                        {formatMoney(String(totalPaye), draftRun.currency)}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-right text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {formatMoney(String(totalNet), draftRun.currency)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {step === "finalize" && draftRun && (
            <div className="space-y-4">
              <div className="rounded-md border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 px-4 py-3 flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-300 mt-0.5 shrink-0" />
                <div className="text-sm text-amber-800 dark:text-amber-200">
                  Finalizing locks {draftRun.payslips.length} payslip{draftRun.payslips.length !== 1 ? "s" : ""} totaling{" "}
                  <span className="font-semibold">{formatMoney(String(totalNet), draftRun.currency)}</span>{" "}
                  in net pay — these become the amounts payable for the period. Country
                  rules are snapshotted, so later rule changes cannot retroactively alter
                  this run, and it cannot be undone without explicitly cancelling.
                  <p className="mt-2 text-xs text-amber-700/90 dark:text-amber-300/90">
                    Statutory deductions are computed at the rates in force for this period —
                    verifying them is your responsibility. Clock-ins still pending
                    review and task pay not yet verified are <strong>not</strong> included. Review
                    every payslip before finalizing.
                  </p>
                </div>
              </div>

              <div className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <ShieldCheck className="h-4 w-4 text-blue-600 dark:text-blue-300" />
                  <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">2-step confirmation</h3>
                </div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-3">
                  Finalizing payroll requires a fresh OTP sent to your email.
                </p>

                {!otpRequested ? (
                  <button
                    onClick={handleRequestOtp}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    Send OTP to my email
                  </button>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="h-4 w-4" />
                      OTP sent. It expires in 5 minutes.
                    </div>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="\d{6}"
                      maxLength={6}
                      placeholder="6-digit code"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      className="w-40 rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-center text-lg tracking-[0.5em] tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={handleRequestOtp}
                      disabled={loading}
                      className="ml-2 text-xs text-blue-600 dark:text-blue-300 hover:underline disabled:opacity-50"
                    >
                      Resend
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-100 dark:border-zinc-800 px-6 py-4">
          {step === "review" && draftRun ? (
            <button
              onClick={handleCancelDraft}
              disabled={loading}
              className="text-sm text-red-600 dark:text-red-300 hover:underline disabled:opacity-50"
            >
              Cancel draft
            </button>
          ) : (
            <button
              onClick={onClose}
              className="text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700"
            >
              Close
            </button>
          )}

          <div className="flex items-center gap-2">
            {step === "review" && (
              <button
                onClick={() => setStep("select")}
                className="rounded-md border border-zinc-200 dark:border-zinc-800 px-4 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50"
              >
                Back
              </button>
            )}
            {step === "finalize" && (
              <button
                onClick={() => setStep("review")}
                className="rounded-md border border-zinc-200 dark:border-zinc-800 px-4 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50"
              >
                Back
              </button>
            )}

            {step === "select" && (
              <button
                onClick={handleCreateDraft}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                Generate draft
              </button>
            )}
            {step === "review" && draftRun && (
              <button
                onClick={() => setStep("finalize")}
                className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Continue to finalize
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
            {step === "finalize" && (
              <button
                onClick={handleFinalize}
                disabled={loading || !otpRequested || otpCode.length !== 6}
                className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Finalize payroll
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


function StepDot({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  let cls = "border-zinc-200 dark:border-zinc-800 text-zinc-400 dark:text-zinc-500 bg-white dark:bg-zinc-900";
  if (active) cls = "border-blue-600 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/15";
  else if (done) cls = "border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {done ? <CheckCircle2 className="h-3 w-3" /> : null}
      {label}
    </span>
  );
}

function StepBar() {
  return <span className="h-px w-4 bg-zinc-200 dark:bg-zinc-700 inline-block" />;
}

function SummaryTile({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-md border px-3 py-2 ${highlight ? "border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/15" : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"}`}>
      <div className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">{label}</div>
      <div data-testid={`tile-${label.replace(/\s+/g, "-").toLowerCase()}`} className={`text-lg font-semibold tabular-nums ${highlight ? "text-blue-900 dark:text-blue-100" : "text-zinc-900 dark:text-zinc-100"}`}>{value}</div>
    </div>
  );
}
