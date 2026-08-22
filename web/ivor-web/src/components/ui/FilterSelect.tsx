"use client";

import { ChevronDown } from "lucide-react";

/**
 * Single shared visual style for a labeled dropdown filter used to narrow a
 * list/table (as opposed to a form field inside a create/edit modal, which
 * has its own styling). Before this, every admin page that filtered a list
 * via a `<select>` (Employers, All Users, Compliance, Platform Users,
 * Kiosks, ...) had independently hand-rolled slightly different borders,
 * radii, and text sizes — this is the one place that style lives now.
 *
 * `appearance-none` is required, not decorative: without it, a native
 * `<select>` renders its OS/browser's own dark-mode chrome (on macOS,
 * a rounded near-black capsule) which overrides most of the classes below
 * — the filter would look consistent with itself across pages (same select
 * everywhere) but glaringly inconsistent with the plain `<button>`-based
 * pills right next to it on the same page, which this codebase fully
 * controls and which don't have this problem. The manual ChevronDown
 * replaces the native dropdown arrow appearance-none also removes.
 */
export interface FilterSelectOption<T extends string> {
  label: string;
  value: T;
}

export default function FilterSelect<T extends string>({
  label,
  value,
  onChange,
  options,
  className = "",
  selectClassName = "",
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: FilterSelectOption<T>[];
  /** Applied to the wrapping label (spacing, shrink behavior). */
  className?: string;
  /** Applied to the <select> itself (e.g. a min-width override). */
  selectClassName?: string;
}) {
  return (
    <label className={`flex items-center gap-2 shrink-0 ${className}`}>
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</span>
      <span className="relative inline-flex items-center">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          className={`appearance-none rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 pl-3 pr-7 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-900/5 dark:focus:ring-white/10 cursor-pointer ${selectClassName}`}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <ChevronDown size={12} className="pointer-events-none absolute right-2.5 text-gray-400" />
      </span>
    </label>
  );
}
