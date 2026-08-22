"use client";

import { AlertTriangle, XCircle, CheckCircle } from "lucide-react";
import { OnboardDraft, getComplianceIssues } from "./types";

interface Props {
  draft: OnboardDraft;
  compact?: boolean;
}

export default function ComplianceCheckBanner({ draft, compact }: Props) {
  const issues = getComplianceIssues(draft);

  if (issues.length === 0) {
    return (
      <div className={`flex items-center gap-2 ${compact ? "text-xs" : "text-sm"} text-green-600 dark:text-green-400`}>
        <CheckCircle size={compact ? 13 : 15} />
        <span className="font-medium">Work authorization looks good</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {issues.map((issue, i) => (
        <div
          key={i}
          className={`flex items-start gap-2 rounded-xl px-3 py-2.5 ${
            issue.level === "error"
              ? "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
              : "bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800"
          }`}
        >
          {issue.level === "error" ? (
            <XCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
          )}
          <p className={`text-xs leading-relaxed font-medium ${
            issue.level === "error"
              ? "text-red-700 dark:text-red-400"
              : "text-amber-700 dark:text-amber-400"
          }`}>
            {issue.text}
          </p>
        </div>
      ))}
    </div>
  );
}
