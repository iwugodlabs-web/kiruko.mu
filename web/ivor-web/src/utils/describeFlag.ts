// Single source of truth for turning a raw payroll compliance-flag code into a
// plain-English explanation. Used by the payslip drawer, the run list, and the
// reconcile panel so the logic can't drift as new codes are added.
//
// Flags may arrive prefixed `u<id>:` (run-level compliance_flags list) — the
// prefix is stripped here.
//
// Two presentations, same dispatch:
//   • default ("subject") — `who` names the subject for per-employee messages
//     where the employee isn't otherwise on screen: the run list passes
//     "An employee"; the reconcile panel keeps the default "This employee".
//   • `terse: true` — the payslip drawer's compact, payslip-context copy (one
//     employee already on screen, so no "An employee has…" framing). Only the
//     codes the drawer can show have a terse form; anything else falls through
//     to the subject phrasing.
//
// Unknown codes fall through verbatim — never hide a flag.
export function describeFlag(
  flag: string,
  opts: { who?: string; terse?: boolean; currency?: string } = {},
): string {
  // `currency` is the money unit for amounts inside the message — pass the
  // payslip/run currency (derived from the company's country). Falls back to
  // "Rs" (MUR) only when a caller doesn't have it.
  const { who = "This employee", terse = false, currency = "Rs" } = opts;
  const m = flag.match(/^u(\d+):(.*)$/);
  const code = m ? m[2] : flag;
  const plural = (n: string, s = "s") => (n === "1" ? "" : s);

  // ── Terse, payslip-context phrasings (the payslip drawer) ───────────────────
  if (terse) {
    if (code === "hourly_zero_pay:no_logs_in_period") return "No clock-ins recorded in this pay period.";
    let t = code.match(/^hourly_zero_pay:unapproved_clockins:(\d+)$/);
    if (t) return `${t[1]} clock-in${plural(t[1])} awaiting admin approval — approve them, then re-run payroll.`;
    t = code.match(/^hourly_zero_pay:pending_overtime:(\d+)$/);
    if (t) return `${t[1]} overtime shift${plural(t[1])} pending your confirmation — confirm the overtime, then re-run payroll.`;
    t = code.match(/^hourly_zero_pay:open_logs:(\d+)$/);
    if (t) return `${t[1]} open shift${plural(t[1])} (clocked in but never clocked out) — not payable until closed.`;
    if (code === "hourly_zero_pay:no_hourly_rate") return "This employee has no hourly rate set — payroll can't compute their wages.";
    if (code === "hourly_zero_pay:no_payable_hours") return "Clock-ins exist but resolved to zero payable hours.";
    t = code.match(/^salaried_absence:(\d+)d$/);
    if (t) return `Pay docked for ${t[1]} working day${plural(t[1])} of absence this period.`;
    if (code === "salaried_absence_skipped:no_clockins") return "Absence not measured — no clock-ins this period (no deduction applied).";
    t = code.match(/^salaried_ot_review:([\d.]+):([\d.]+)$/);
    if (t) return `Salaried overtime detected — ~${t[1]}h of rest-day / public-holiday / over-45h work (≈ ${currency} ${t[2]} at the s.25 rate). Not auto-paid: review and add it via "Additional duty" pay if owed.`;
    t = code.match(/^net_pay_floored:([\d.]+)$/);
    if (t) return `Deductions exceeded pay — net floored to ${currency} 0 (${currency} ${t[1]} couldn't be collected).`;
    t = code.match(/^loan_capped_to_net:([\d.]+)$/);
    if (t) return `Loan repayment reduced by ${currency} ${t[1]} to keep net pay above zero — the rest carries forward.`;
    // any non-drawer code → fall through to the subject phrasings below
  }

  // ── Run-level signals ──────────────────────────────────────────────────────
  let pm = code.match(/^pending_clockins:(\d+)$/);
  if (pm) return `${pm[1]} clock-in${plural(pm[1])} still pending review — approve them to include in this run.`;
  pm = code.match(/^unverified_task_pay:(\d+)$/);
  if (pm) return `${pm[1]} completed task${plural(pm[1])} with pay not yet verified — verify to include the pay.`;

  // ── Per-employee zero-pay reasons (hourly_zero_pay:*) ───────────────────────
  if (code === "hourly_zero_pay:no_logs_in_period") return `${who} has no clock-ins this period → zero pay.`;
  pm = code.match(/^hourly_zero_pay:unapproved_clockins:(\d+)$/);
  if (pm) return `${who} has ${pm[1]} unapproved clock-in${plural(pm[1])} (excluded) → zero pay.`;
  pm = code.match(/^hourly_zero_pay:pending_overtime:(\d+)$/);
  if (pm) return `${who} has ${pm[1]} pending overtime entr${pm[1] === "1" ? "y" : "ies"} (excluded).`;
  pm = code.match(/^hourly_zero_pay:open_logs:(\d+)$/);
  if (pm) return `${who} has ${pm[1]} still-open clock-in session${plural(pm[1])}.`;
  if (code === "hourly_zero_pay:no_payable_hours") return `${who} has no payable hours → zero pay.`;
  if (code === "hourly_zero_pay:no_hourly_rate") return `${who} has no hourly rate set → zero pay.`;

  // ── Other per-employee signals ──────────────────────────────────────────────
  if (code === "worked_but_unpaid_no_salary")
    return `${who} has approved hours this period but no salary set up — configure their salary so payroll can pay them.`;
  if (code === "no_schedule_hours_imprecise")
    return `${who} has no scheduled end time — auto-closed hours are capped (not a precise shift end) and overtime isn't measured against a threshold. Verify the hours, or set a schedule.`;
  pm = code.match(/^salaried_absence:(\d+)d$/);
  if (pm) return `${who} was absent ${pm[1]} working day${plural(pm[1])} this period — pay docked accordingly.`;
  if (code === "salaried_absence_skipped:no_clockins")
    return `${who}'s absence couldn't be measured (no clock-ins this period) — no deduction applied.`;

  // ── Salaried overtime (WRA s.24/s.25) ───────────────────────────────────────
  pm = code.match(/^salaried_ot_review:([\d.]+):([\d.]+)$/);
  if (pm) return `${who} worked ~${pm[1]}h of salaried overtime (rest-day / holiday / over-45h) ≈ ${currency} ${pm[2]} — not auto-paid. Review and add it via "Additional duty" pay if owed.`;
  if (code === "monthly_basic_above_ot_cap_downgraded_to_exempt")
    return "Basic above the OT cap — treated as exempt (no overtime owed).";

  // ── Net-pay floor ───────────────────────────────────────────────────────────
  pm = code.match(/^net_pay_floored:([\d.]+)$/);
  if (pm) return `${who}'s deductions exceeded their pay — net floored to ${currency} 0 (${currency} ${pm[1]} couldn't be collected this period).`;
  pm = code.match(/^loan_capped_to_net:([\d.]+)$/);
  if (pm) return `${who}'s loan repayment was reduced by ${currency} ${pm[1]} to keep net pay above zero — the rest carries forward.`;

  return code; // fallback: show the (prefix-stripped) code — never hide a flag, but don't leak the ugly u<id>: prefix
}
