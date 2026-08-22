"use client";

/**
 * Payroll guide modal. Opened on demand via the "Guide" button on the payroll
 * and salary-structures screens (it no longer auto-opens — the inline
 * ExampleCallout on each page already explains the flow). Dismissal is
 * persisted under localStorage key kontokaz.payrollGuide.dismissed.v1 so the
 * "seen" state survives reloads.
 *
 * Re-usable across web payroll screens — pass `open` and `onClose` to control
 * it externally.
 */

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Check, X } from "lucide-react";


const STORAGE_KEY = "kontokaz.payrollGuide.dismissed.v1";

interface Step {
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    title: "Components",
    body: "Atomic earnings and deductions (BASIC, TRANSPORT, NPS). These are the building blocks.",
  },
  {
    title: "Structures",
    body: "Bundle components into reusable templates per department or role.",
  },
  {
    title: "Assignments",
    body: "Assign a structure to each employee, with optional per-component overrides.",
  },
  {
    title: "Run payroll",
    body: "Create a monthly draft, review payslips, finalize with OTP. PDFs and statutory splits are produced automatically.",
  },
];

const GLOSSARY: Array<[string, string]> = [
  ["Payroll Run", "The monthly draft → finalize cycle that produces payslips."],
  ["Payslip", "A single employee's pay statement for one period."],
  ["Component", "An atomic earning or deduction (e.g. BASIC, TRANSPORT)."],
  ["Structure", "A bundle of components used as a template."],
  ["Assignment", "Links one employee to one structure with effective dates."],
  ["Statutory Deduction", "A legally required deduction (e.g. NPS, NSF, CSG)."],
  ["PAYE", "Pay-As-You-Earn income tax, computed from progressive bands."],
  ["One-off Allowance", "An ad-hoc payment scheduled for a single month."],
  ["Step-up Token", "A short-lived OTP-backed token required for finalize."],
];

export function hasSeenPayrollGuide(): boolean {
  if (typeof window === "undefined") return true;
  try { return window.localStorage.getItem(STORAGE_KEY) === "1"; } catch { return true; }
}

export function markPayrollGuideSeen(): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_KEY, "1"); } catch { /* ignore */ }
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function PayrollGuide({ open, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [tab, setTab] = useState<"steps" | "glossary">("steps");

  useEffect(() => {
    if (open) {
      setStep(0);
      setTab("steps");
    }
  }, [open]);

  if (!open) return null;

  const close = () => { markPayrollGuideSeen(); onClose(); };
  const isLast = step === STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4"
      onClick={close}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-white dark:bg-zinc-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-blue-600 dark:text-blue-300" />
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">How payroll works</h2>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-md p-1 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-5 pt-3 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex gap-1">
            {(["steps", "glossary"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                  tab === t ? "bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300" : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50"
                }`}
              >
                {t === "steps" ? "Walkthrough" : "Glossary"}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        {tab === "steps" ? (
          <div className="px-5 py-6">
            <div className="flex items-center gap-1.5 mb-4">
              {STEPS.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 rounded-full transition-all ${
                    i === step ? "w-8 bg-blue-600" : i < step ? "w-4 bg-blue-300" : "w-4 bg-zinc-200 dark:bg-zinc-700"
                  }`}
                />
              ))}
            </div>
            <div className="text-xs font-medium uppercase tracking-wider text-blue-600 dark:text-blue-300 mb-2">
              Step {step + 1} of {STEPS.length}
            </div>
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">{STEPS[step].title}</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">{STEPS[step].body}</p>
          </div>
        ) : (
          <div className="px-5 py-5 max-h-96 overflow-y-auto">
            <dl className="space-y-3">
              {GLOSSARY.map(([term, def]) => (
                <div key={term}>
                  <dt className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{term}</dt>
                  <dd className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">{def}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 rounded-b-xl">
          {tab === "steps" ? (
            <>
              <button
                type="button"
                onClick={close}
                className="text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-700"
              >
                Skip
              </button>
              <div className="flex items-center gap-2">
                {step > 0 && (
                  <button
                    type="button"
                    onClick={() => setStep((s) => s - 1)}
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-white"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back
                  </button>
                )}
                {!isLast ? (
                  <button
                    type="button"
                    onClick={() => setStep((s) => s + 1)}
                    className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
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
              className="ml-auto inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
