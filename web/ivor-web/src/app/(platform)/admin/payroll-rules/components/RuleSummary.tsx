import React from "react";

// A single plain-English sentence that leads a rule-version card, so a reader
// (esp. a platform admin who doesn't speak payroll-engine jargon) grasps the
// rule at a glance before scanning the raw fields below it.
export default function RuleSummary({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-zinc-200 dark:border-zinc-700/60 bg-zinc-50 dark:bg-zinc-800/40 px-3 py-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">
      {children}
    </p>
  );
}
