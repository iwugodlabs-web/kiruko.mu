"use client";

import type { ReactNode } from "react";
import { CountryProvider } from "@/contexts/CountryContext";
import CountrySwitcher from "@/components/ui/CountrySwitcher";

/**
 * Wraps every /admin page — provides the shared CountryContext and renders
 * the global country switcher in a consistent, always-visible bar above
 * every admin page's own content. Individual pages no longer own their own
 * local, page-scoped, reset-on-navigate country state.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <CountryProvider>
      <div className="sticky top-0 z-40 flex items-center justify-end gap-2 border-b border-gray-100 dark:border-gray-900 bg-white/80 dark:bg-gray-950/80 backdrop-blur px-6 py-2.5">
        <span className="text-xs text-gray-400 dark:text-gray-600 mr-1">Working in</span>
        <CountrySwitcher />
      </div>
      {children}
    </CountryProvider>
  );
}
