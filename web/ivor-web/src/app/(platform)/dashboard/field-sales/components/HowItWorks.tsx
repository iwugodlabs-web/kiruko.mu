"use client";

import { useEffect, useState } from "react";
import { Boxes, Check, ChevronDown, ClipboardCheck, ReceiptText, Target } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  listPlans,
  listProducts,
  listRuns,
  listSales,
} from "@/services/fieldSales";
import type { NavigateTab, TabId } from "./types";

interface Step {
  id: TabId;
  n: number;
  title: string;
  blurb: string;
  done: boolean;
  cta: string;
  icon: typeof Boxes;
}

/**
 * First-run guide shown at the top of the Overview tab. Explains the four
 * steps in plain language and, more usefully, reflects the real data: each
 * step is ticked off once the company actually has products / plans / sales /
 * runs. Empty steps are clickable and jump straight to the right tab.
 */
export default function HowItWorks({ onNavigate }: { onNavigate: NavigateTab }) {
  const { companyId } = useAuth();
  const [counts, setCounts] = useState<{ products: number; plans: number; sales: number; runs: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companyId) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [p, pl, s, r] = await Promise.all([
          listProducts(companyId).catch(() => []),
          listPlans(companyId).catch(() => []),
          listSales(companyId).catch(() => []),
          listRuns(companyId).catch(() => []),
        ]);
        if (alive) setCounts({ products: p.length, plans: pl.length, sales: s.length, runs: r.length });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [companyId]);

  const c = counts ?? { products: 0, plans: 0, sales: 0, runs: 0 };
  const steps: Step[] = [
    {
      id: "catalog",
      n: 1,
      title: "Build your product catalog",
      blurb: "Add the products your reps sell and a price for each. Reps pick from this list in the app.",
      done: c.products > 0,
      cta: "Add products",
      icon: Boxes,
    },
    {
      id: "plans",
      n: 2,
      title: "Create a commission plan & assign it",
      blurb: "Decide how reps get paid (e.g. 3% of sales, or Rs 20 per unit), then assign it to reps.",
      done: c.plans > 0,
      cta: "Create a plan",
      icon: Target,
    },
    {
      id: "sales",
      n: 3,
      title: "Capture field sales",
      blurb: "Reps record sales in the mobile app — online or offline. Approve or reject them here.",
      done: c.sales > 0,
      cta: "Review sales",
      icon: ClipboardCheck,
    },
    {
      id: "runs",
      n: 4,
      title: "Run payroll for commissions",
      blurb: "Compute the period, approve it, then push to payroll. Commission lands on the next payslip.",
      done: c.runs > 0,
      cta: "Open runs",
      icon: ReceiptText,
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  const [open, setOpen] = useState(true);
  const [touched, setTouched] = useState(false);
  // Once we know everything is set up, collapse the guide (unless the user
  // has already toggled it themselves).
  useEffect(() => {
    if (!loading && allDone && !touched) setOpen(false);
  }, [loading, allDone, touched]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <button
        type="button"
        onClick={() => {
          setTouched(true);
          setOpen((v) => !v);
        }}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            How Field Sales &amp; Commissions works
          </p>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {loading
              ? "Checking your setup…"
              : allDone
                ? "All set up — you're good to go."
                : `${doneCount} of ${steps.length} steps done — finish these to start paying commissions.`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden text-xs font-medium tabular-nums text-gray-500 sm:inline dark:text-gray-400">
            {doneCount}/{steps.length}
          </span>
          <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-5 py-4 dark:border-gray-800">
          <ol className="grid gap-3 sm:grid-cols-2">
            {steps.map((s) => {
              const Icon = s.icon;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate(s.id)}
                    className={`group flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                      s.done
                        ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-500/25 dark:bg-emerald-500/5"
                        : "border-gray-200 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:border-gray-600 dark:hover:bg-gray-800/60"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                        s.done
                          ? "bg-emerald-500 text-white"
                          : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                      }`}
                    >
                      {s.done ? <Check className="h-3.5 w-3.5" /> : s.n}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <Icon className="h-3.5 w-3.5 text-gray-400" />
                        <span className="text-sm font-medium text-gray-900 dark:text-white">{s.title}</span>
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                        {s.blurb}
                      </span>
                      {!s.done && !loading && (
                        <span className="mt-1.5 inline-block text-xs font-medium text-blue-600 group-hover:underline dark:text-blue-400">
                          {s.cta} →
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
