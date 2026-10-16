"use client";

import { AlertTriangle, CheckCircle2, MinusCircle, UserX } from "lucide-react";
import type { MemberStatus } from "@/services/payroll-api";

// Human-readable label + whether it's a problem the admin should act on, per
// reason_code. Mirrors the backend reason taxonomy.
function describeReason(code: string | null | undefined): string {
  if (!code) return "";
  if (code.startsWith("off_payroll_")) {
    const r = code.slice("off_payroll_".length).replace(/_/g, " ");
    return `Off-payroll: ${r}`;
  }
  if (code.startsWith("hourly_zero_pay")) return "Zero hours this period";
  const map: Record<string, string> = {
    no_assignment_monthly: "No salary assignment (legacy setup)",
    no_job: "No job record — onboarding incomplete",
    no_pay_setup: "No salary on file",
    resolve_empty: "Salary structure is empty",
    data_error: "Data error — must be fixed",
    unpaid_resolvable: "Resolvable but unpaid — recompute the run",
    unexpected_dropout: "Paid last period, now dropped — review",
    onboarding_draft_job: "Onboarding not complete",
    terminated_before_period: "Left before this period",
  };
  return map[code] ?? code;
}

function initials(name?: string | null): string {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export default function RunCoveragePanel({ members }: { members: MemberStatus[] }) {
  if (!members || members.length === 0) return null;

  const paid = members.filter((m) => m.bucket === "paid");
  const nil = members.filter((m) => m.bucket === "nil_paid");
  const excluded = members.filter((m) => m.bucket === "excluded");
  // Blocking exclusions (setup gaps / errors) vs expected ones (off-payroll,
  // onboarding placeholder, left before period).
  const needsAttention = excluded.filter((m) => m.blocks_finalize);
  const expected = excluded.filter((m) => !m.blocks_finalize);

  return (
    <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
      <h3 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">Coverage</h3>

      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 px-2.5 py-1 text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5" /> {paid.length} paid
        </span>
        {nil.length > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 text-zinc-600 dark:text-zinc-300">
            <MinusCircle className="h-3.5 w-3.5" /> {nil.length} zero-pay
          </span>
        )}
        {excluded.length > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 dark:bg-amber-500/10 px-2.5 py-1 text-amber-700 dark:text-amber-300">
            <UserX className="h-3.5 w-3.5" /> {excluded.length} not paid
          </span>
        )}
      </div>

      {needsAttention.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" /> Needs attention — not in this run
          </p>
          <ul className="space-y-1.5">
            {needsAttention.map((m) => (
              <li key={m.private_user_id} className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-200/70 dark:bg-amber-500/25 text-[10px] font-bold text-amber-800 dark:text-amber-200">
                  {initials(m.employee_name)}
                </span>
                <div className="min-w-0 leading-snug">
                  <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                    {m.employee_name ?? `Employee #${m.private_user_id}`}
                  </span>
                  <span className="text-xs text-amber-800/90 dark:text-amber-200/80"> — {describeReason(m.reason_code)}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {expected.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
            {expected.length} intentionally excluded (off-payroll / not yet onboarded / left)
          </summary>
          <ul className="mt-1.5 space-y-1 pl-1">
            {expected.map((m) => (
              <li key={m.private_user_id} className="text-xs text-zinc-500 dark:text-zinc-400">
                {m.employee_name ?? `Employee #${m.private_user_id}`} — {describeReason(m.reason_code)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
