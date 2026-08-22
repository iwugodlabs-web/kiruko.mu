"use client";

import { CalendarClock, CheckCircle2, Clock, ExternalLink, History } from "lucide-react";


/**
 * "current" = effective today.
 * "scheduled" = effective_from is in the future.
 * "historical" = effective_to has passed.
 */
export type VersionStatus = "current" | "scheduled" | "historical";


export function deriveVersionStatus(
  effectiveFrom: string,
  effectiveTo?: string | null,
  asOf: Date = new Date(),
): VersionStatus {
  const from = new Date(effectiveFrom);
  const today = new Date(asOf.toISOString().slice(0, 10));
  if (from > today) return "scheduled";
  if (effectiveTo) {
    const to = new Date(effectiveTo);
    if (to <= today) return "historical";
  }
  return "current";
}


interface Props {
  version: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  sourceReference?: string | null;
  changeReason?: string | null;
  /** Lifecycle status relative to today. Computed by the caller via
   * `deriveVersionStatus()` so the badge reflects real-time eligibility. */
  status: VersionStatus;
  /** Optional one-liner condensed summary shown next to the version pill —
   * e.g. "3 brackets · max 25%" — so admins can scan without reading the body. */
  headline?: string;
  /** The renderable body of this version — usually a key/value table from the
   * caller showing the rule's value fields. */
  body: React.ReactNode;
  /** Optional inline diff against the prior version (caller-rendered). */
  diff?: React.ReactNode;
}


const STATUS_PILL: Record<VersionStatus, { label: string; classes: string; icon: typeof Clock }> = {
  current:   { label: "current",   classes: "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", icon: CheckCircle2 },
  scheduled: { label: "scheduled", classes: "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300",         icon: CalendarClock },
  historical:{ label: "historical",classes: "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400",                icon: History },
};


export default function TimelineCard({
  version, effectiveFrom, effectiveTo, sourceReference, changeReason, status, headline, body, diff,
}: Props) {
  const pill = STATUS_PILL[status];
  const PillIcon = pill.icon;
  const containerClass = status === "current"
    ? "border-emerald-200 bg-emerald-50/30"
    : status === "scheduled"
    ? "border-amber-200 bg-amber-50/30"
    : "border-zinc-200 bg-white";
  const versionPillClass = status === "current"
    ? "bg-emerald-600 text-white"
    : status === "scheduled"
    ? "bg-amber-600 text-white"
    : "bg-zinc-100 text-zinc-600";

  return (
    <div className={`rounded-lg border ${containerClass} p-4`}>
      <div className="flex items-start justify-between mb-2 gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className={`inline-flex items-center justify-center rounded-full text-xs font-mono w-7 h-7 flex-shrink-0 ${versionPillClass}`}>
            v{version}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-zinc-900">
              <span>
                {effectiveFrom}
                {effectiveTo ? <span className="text-zinc-400 mx-1">→</span> : null}
                {effectiveTo ? <span className="text-zinc-500">{effectiveTo}</span> : null}
              </span>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${pill.classes}`}>
                <PillIcon className="h-3 w-3" /> {pill.label}
              </span>
              {headline && (
                <span className="text-xs font-normal text-zinc-600">· {headline}</span>
              )}
            </div>
            {changeReason && <div className="text-xs text-zinc-500 mt-0.5">{changeReason}</div>}
          </div>
        </div>
        {sourceReference && (
          <div className="text-xs text-zinc-400 flex items-center gap-1 max-w-[40%] text-right flex-shrink-0">
            <ExternalLink className="h-3 w-3 flex-shrink-0" />
            <span className="truncate" title={sourceReference}>{sourceReference}</span>
          </div>
        )}
      </div>

      <div className="mt-3">{body}</div>
      {diff && <div className="mt-3 pt-3 border-t border-zinc-100">{diff}</div>}
    </div>
  );
}
