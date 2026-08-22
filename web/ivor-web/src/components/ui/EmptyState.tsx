"use client";

import React from "react";
import { LucideIcon, ArrowRight } from "lucide-react";

type EmptyStateMode = "no-data" | "no-results" | "error";

interface EmptyStateProps {
  /**
   * `no-data`    — the underlying collection is genuinely empty; CTA should help the user create something.
   * `no-results` — there is data, but the active filters/search returned nothing; CTA should help clear them.
   * `error`      — request failed; CTA should retry.
   */
  mode?: EmptyStateMode;
  icon?: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

const MODE_STYLES: Record<EmptyStateMode, { iconBg: string; iconText: string; ctaText: string }> = {
  "no-data":   { iconBg: "bg-blue-50",  iconText: "text-blue-500",  ctaText: "text-blue-600 hover:text-blue-700" },
  "no-results":{ iconBg: "bg-amber-50", iconText: "text-amber-500", ctaText: "text-amber-600 hover:text-amber-700" },
  "error":     { iconBg: "bg-red-50",   iconText: "text-red-500",   ctaText: "text-red-600 hover:text-red-700" },
};

export default function EmptyState({
  mode = "no-data",
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  className = "",
}: EmptyStateProps) {
  const styles = MODE_STYLES[mode];

  return (
    <div className={`flex flex-col items-center justify-center py-10 px-6 text-center ${className}`}>
      {Icon && (
        <div className={`w-12 h-12 ${styles.iconBg} rounded-full flex items-center justify-center mb-3`}>
          <Icon size={20} className={styles.iconText} />
        </div>
      )}
      <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">{title}</p>
      {description && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-sm">{description}</p>
      )}
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className={`mt-4 text-xs font-medium ${styles.ctaText} hover:underline flex items-center gap-1`}
        >
          {actionLabel} <ArrowRight size={11} />
        </button>
      )}
    </div>
  );
}
