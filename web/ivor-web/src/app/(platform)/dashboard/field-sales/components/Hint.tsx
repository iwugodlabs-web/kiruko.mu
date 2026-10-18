"use client";

import { type ReactNode } from "react";
import { Info, Lightbulb, AlertTriangle, type LucideIcon } from "lucide-react";

type Tone = "info" | "tip" | "warning";

const TONES: Record<
  Tone,
  { icon: LucideIcon; wrap: string; iconColor: string; titleColor: string }
> = {
  info: {
    icon: Info,
    wrap: "border-blue-200 bg-blue-50/60 dark:border-blue-500/30 dark:bg-blue-500/5",
    iconColor: "text-blue-600 dark:text-blue-400",
    titleColor: "text-blue-900 dark:text-blue-200",
  },
  tip: {
    icon: Lightbulb,
    wrap: "border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/5",
    iconColor: "text-amber-600 dark:text-amber-400",
    titleColor: "text-amber-900 dark:text-amber-200",
  },
  warning: {
    icon: AlertTriangle,
    wrap: "border-red-200 bg-red-50/60 dark:border-red-500/30 dark:bg-red-500/5",
    iconColor: "text-red-600 dark:text-red-400",
    titleColor: "text-red-900 dark:text-red-200",
  },
};

interface HintProps {
  title: string;
  children?: ReactNode;
  tone?: Tone;
  /** Optional trailing action (e.g. a "Go to Plans" button). */
  action?: ReactNode;
  className?: string;
}

/**
 * Small inline "how this works" banner used at the top of each field-sales
 * tab. Keeps guidance next to the controls it describes instead of burying
 * it in documentation.
 */
export default function Hint({ title, children, tone = "info", action, className = "" }: HintProps) {
  const t = TONES[tone];
  const Icon = t.icon;
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${t.wrap} ${className}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${t.iconColor}`} />
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-semibold ${t.titleColor}`}>{title}</p>
        {children && (
          <div className="mt-0.5 text-xs leading-relaxed text-gray-600 dark:text-gray-400">{children}</div>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
