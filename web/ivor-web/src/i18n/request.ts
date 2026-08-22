import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { defaultLocale, isLocale, LOCALE_COOKIE, type Locale } from "./config";

/**
 * Server-side locale resolver invoked by next-intl on every request.
 * Reads from cookie first, falls back to Accept-Language, then default.
 *
 * No URL routing — `/[locale]/...` segments are deliberately NOT used.
 * For an internal dashboard, locale is a per-user preference, not part
 * of the canonical URL.
 */
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;

  let locale: Locale = defaultLocale;

  if (isLocale(fromCookie)) {
    locale = fromCookie;
  } else {
    const headerStore = await headers();
    const accept = headerStore.get("accept-language") ?? "";
    // Crude parse — first preferred tag, lowercase, drop region.
    const first = accept.split(",")[0]?.split(";")[0]?.trim().toLowerCase();
    const base = first?.split("-")[0];
    if (isLocale(base)) {
      locale = base;
    }
  }

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
