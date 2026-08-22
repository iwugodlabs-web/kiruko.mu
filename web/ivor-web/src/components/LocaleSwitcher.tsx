"use client";

import { useLocale } from "next-intl";
import { Languages, Check } from "lucide-react";
import { api } from "@/services/apiClient";
import { locales, localeLabels, LOCALE_COOKIE, type Locale } from "../i18n/config";

/**
 * Compact locale switcher rendered inside the user menu in Sidebar.
 *
 * On select:
 *   1. Write the NEXT_LOCALE cookie (Path=/, 1 year) so the next-intl
 *      server resolver picks the new locale on the very next render.
 *   2. Best-effort PATCH /user/me with preferred_locale so the choice
 *      sticks across browsers + devices. A network failure here is
 *      logged but not surfaced — the cookie alone is enough to flip
 *      the UI immediately, the backend persist is a "nice to have".
 *   3. Hard reload so the server layout re-renders with new messages.
 */
export default function LocaleSwitcher({ onClose }: { onClose?: () => void }) {
  const current = useLocale() as Locale;

  async function pick(next: Locale) {
    if (next === current) {
      onClose?.();
      return;
    }

    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;

    api.put("/user/me", { preferred_locale: next }).catch((e) => {
      console.warn("LocaleSwitcher: persist failed (cookie still applied):", e);
    });

    onClose?.();
    // Hard reload so server components re-render with new messages.
    window.location.reload();
  }

  return (
    <div className="border-t border-gray-50 dark:border-gray-800 py-1">
      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
        <Languages size={11} />
        Language
      </div>
      {locales.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => pick(l)}
          className="w-full flex items-center justify-between gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          <span className="font-medium">{localeLabels[l]}</span>
          {l === current && <Check size={14} className="text-emerald-500" />}
        </button>
      ))}
    </div>
  );
}
