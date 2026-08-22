"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, ArrowLeft } from "lucide-react";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  /**
   * If provided, renders a back-arrow button on the left. If `true`, defaults
   * to `router.back()`. If a function, calls it. If a string, navigates to
   * that path. Set to `false`/omit to hide the back button.
   */
  back?: boolean | string | (() => void);
  className?: string;
}

export default function Breadcrumbs({ items, back, className = "" }: BreadcrumbsProps) {
  const router = useRouter();

  const handleBack = () => {
    if (typeof back === "function") back();
    else if (typeof back === "string") router.push(back);
    else router.back();
  };

  return (
    <nav aria-label="Breadcrumb" className={`flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 ${className}`}>
      {back && (
        <button
          onClick={handleBack}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors -ml-1.5"
          aria-label="Go back"
          title="Back"
        >
          <ArrowLeft size={15} />
        </button>
      )}
      <ol className="flex items-center gap-1.5 min-w-0">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li key={`${item.label}-${idx}`} className="flex items-center gap-1.5 min-w-0">
              {idx > 0 && <ChevronRight size={12} className="text-gray-300 dark:text-gray-600 shrink-0" aria-hidden />}
              {isLast || !item.href ? (
                <span
                  className={`truncate ${isLast ? "text-gray-700 dark:text-gray-200 font-medium" : ""}`}
                  aria-current={isLast ? "page" : undefined}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="truncate hover:text-gray-900 dark:hover:text-gray-100 hover:underline"
                >
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
