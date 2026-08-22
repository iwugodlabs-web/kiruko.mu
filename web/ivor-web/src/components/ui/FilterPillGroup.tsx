"use client";

import type React from "react";

/**
 * Single shared visual style for a segmented pill-button filter (an enum
 * filter with a small, fixed set of options — e.g. status/kind). Before
 * this, Employers used `rounded-lg` pills and Sponsored Moderation used
 * `rounded-full` pills with different padding/colors for the same UI
 * concept — this is the one place that style lives now.
 */
export interface FilterPillOption<T extends string> {
  label: string;
  value: T;
  badge?: number;
  /** Show the badge even when it's 0 (default: hide, e.g. an empty queue). */
  showZeroBadge?: boolean;
  /** "amber" (default) reads as "needs attention" (e.g. a pending queue); "neutral" is a plain tally (e.g. a headcount); "red" is an urgent count (e.g. unread). */
  badgeVariant?: "amber" | "neutral" | "red";
  icon?: React.ElementType;
  /** Tailwind bg-* class for a small leading status dot (e.g. a permit-status color). */
  dotColor?: string;
}

export default function FilterPillGroup<T extends string>({
  label,
  value,
  onChange,
  options,
  className = "",
}: {
  label?: string;
  value: T;
  onChange: (value: T) => void;
  options: FilterPillOption<T>[];
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {label && <span className="text-xs font-medium text-gray-500 dark:text-gray-400 mr-0.5">{label}</span>}
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              active
                ? "bg-gray-900 text-white border-gray-900 dark:bg-white dark:text-gray-900 dark:border-white"
                : "bg-white text-gray-600 border-gray-200 hover:border-gray-300 dark:bg-gray-900 dark:text-gray-400 dark:border-gray-700 dark:hover:border-gray-600"
            }`}
          >
            {o.dotColor && <span className={`w-1.5 h-1.5 rounded-full ${o.dotColor}`} />}
            {o.icon && <o.icon size={12} />}
            {o.label}
            {((o.badge ?? 0) > 0 || (o.showZeroBadge && o.badge !== undefined)) && (
              <span className={`ml-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                active
                  ? "bg-white/20"
                  : o.badgeVariant === "neutral"
                  ? "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
                  : o.badgeVariant === "red"
                  ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
              }`}>
                {o.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
