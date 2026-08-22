"use client";

/**
 * First-run guide for the platform-admin /admin/payroll-rules screen.
 *
 * Distinct from the company-side PayrollGuide because the mental model is
 * different: country-scoped rules, append-only supersede, OTP step-up, and
 * the protection that finalized payroll runs snapshot the rules at finalize
 * time so historical edits don't retroactively change them.
 *
 * Auto-opens once per browser via localStorage key
 *   kontokaz.payrollRulesGuide.dismissed.v1
 * and is re-openable via the "Guide" button on the page header.
 */

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Check, X } from "lucide-react";


const STORAGE_KEY = "kontokaz.payrollRulesGuide.dismissed.v1";

interface Step {
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    title: "Append-only versioning",
    body: "You can't edit a rule — you supersede it. Each \"new version\" closes the prior one and creates a successor. The history stays in the database forever so audits can replay any past finalized run exactly.",
  },
  {
    title: "Country-scoped",
    body: "Every rule belongs to a country. The picker at the top decides which set you're editing. Mauritius (MU) and Tanzania (TZ) are live; Madagascar (MG) is seeded behind a flag.",
  },
  {
    title: "Four rule types",
    body: "Tax brackets (progressive PAYE bands per fiscal year) · Statutory deductions (CSG, NSF, NPF) · Leave defaults (accrual rules) · Bonus rules (EOY formula). Each has its own version chain keyed differently.",
  },
  {
    title: "OTP step-up + concurrent-edit guard",
    body: "Every supersede requires a fresh OTP delivered to your email. If another admin superseded the same rule while your dialog was open, you'll get a \"rule changed\" message and the list will refresh — no silent overwrites.",
  },
  {
    title: "Finalized payslips are immune",
    body: "Once a payroll run is finalized, it snapshots the rules in effect at finalize time. Changing a rule today does NOT alter past payslips. Future drafts will pick up the new version automatically.",
  },
];

const GLOSSARY: Array<[string, string]> = [
  ["Supersede", "Insert a new version that closes the prior one. The only legitimate way to change a rule."],
  ["Effective from / to", "The window in which a version is in force. Closed when a successor's effective_from passes."],
  ["Status badges", "Current = in force today. Scheduled = future effective_from. Historical = effective_to has passed."],
  ["Version conflict", "Another admin superseded the same rule between your read and your save. The dialog refuses, refreshes the list, you re-try."],
  ["Snapshot", "A frozen copy of the country rules attached to a finalized payroll run. Why historical edits can never break a finalized payslip."],
  ["Audit log", "Every supersede writes a row capturing who, when, and the field-level diff. Append-only at the DB level (triggers enforce it)."],
];

export function hasSeenPayrollRulesGuide(): boolean {
  if (typeof window === "undefined") return true;
  try { return window.localStorage.getItem(STORAGE_KEY) === "1"; } catch { return true; }
}

export function markPayrollRulesGuideSeen(): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_KEY, "1"); } catch { /* ignore */ }
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function PayrollRulesGuide({ open, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [tab, setTab] = useState<"steps" | "glossary">("steps");

  useEffect(() => {
    if (open) {
      setStep(0);
      setTab("steps");
    }
  }, [open]);

  if (!open) return null;

  const close = () => { markPayrollRulesGuideSeen(); onClose(); };
  const isLast = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4" onClick={close}>
      <div className="w-full max-w-lg rounded-xl bg-white dark:bg-gray-900 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-violet-600" />
            <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Country payroll rules</h2>
          </div>
          <button type="button" onClick={close} className="rounded-md p-1 text-zinc-500 dark:text-gray-400 hover:bg-zinc-100 dark:hover:bg-gray-800" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 pt-3 border-b border-zinc-100 dark:border-gray-800">
          <div className="flex gap-1">
            {(["steps", "glossary"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                  tab === t ? "bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400" : "text-zinc-500 dark:text-gray-400 hover:bg-zinc-50 dark:hover:bg-gray-800"
                }`}
              >
                {t === "steps" ? "Walkthrough" : "Glossary"}
              </button>
            ))}
          </div>
        </div>

        {tab === "steps" ? (
          <div className="px-5 py-6">
            <div className="flex items-center gap-1.5 mb-4">
              {STEPS.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 rounded-full transition-all ${
                    i === step ? "w-8 bg-violet-600" : i < step ? "w-4 bg-violet-300" : "w-4 bg-zinc-200 dark:bg-gray-700"
                  }`}
                />
              ))}
            </div>
            <div className="text-xs font-medium uppercase tracking-wider text-violet-600 mb-2">
              Step {step + 1} of {STEPS.length}
            </div>
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-2">{STEPS[step].title}</h3>
            <p className="text-sm text-zinc-600 dark:text-gray-400 leading-relaxed">{STEPS[step].body}</p>
          </div>
        ) : (
          <div className="px-5 py-5 max-h-96 overflow-y-auto">
            <dl className="space-y-3">
              {GLOSSARY.map(([term, def]) => (
                <div key={term}>
                  <dt className="text-sm font-semibold text-zinc-900 dark:text-white">{term}</dt>
                  <dd className="text-xs text-zinc-600 dark:text-gray-400 mt-0.5">{def}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-100 dark:border-gray-800 bg-zinc-50/50 dark:bg-gray-800/60 rounded-b-xl">
          {tab === "steps" ? (
            <>
              <button type="button" onClick={close} className="text-xs font-medium text-zinc-500 dark:text-gray-400 hover:text-zinc-700 dark:hover:text-white">
                Skip
              </button>
              <div className="flex items-center gap-2">
                {step > 0 && (
                  <button
                    type="button"
                    onClick={() => setStep((s) => s - 1)}
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-gray-700 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-800"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back
                  </button>
                )}
                {!isLast ? (
                  <button
                    type="button"
                    onClick={() => setStep((s) => s + 1)}
                    className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700"
                  >
                    Next
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={close}
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Got it
                  </button>
                )}
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={close}
              className="ml-auto inline-flex items-center gap-1 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
