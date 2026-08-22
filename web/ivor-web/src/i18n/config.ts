/**
 * Locale configuration for next-intl.
 *
 * Cookie-based mode (no `/[locale]/...` URL prefix). The active locale is
 * resolved on every request via `request.ts` from this priority chain:
 *   1. `NEXT_LOCALE` cookie (set by the locale switcher)
 *   2. authenticated user's `preferred_locale` (TODO when M18d wires)
 *   3. `Accept-Language` header
 *   4. `defaultLocale`
 *
 * Picking a different locale flips the cookie, hard-refreshes the page,
 * and (when authenticated) PATCHes /user/me with the new value so it
 * sticks across browsers.
 */

export const locales = ["en", "fr", "mg", "hi"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

export const LOCALE_COOKIE = "NEXT_LOCALE";

export const localeLabels: Record<Locale, string> = {
  en: "English",
  fr: "Français",
  mg: "Malagasy",
  hi: "हिन्दी",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}
