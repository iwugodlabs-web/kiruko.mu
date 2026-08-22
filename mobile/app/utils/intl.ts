import i18n from "./i18n";

// Maps i18next language codes to BCP-47 locale tags that JS Intl understands.
// Keep this list aligned with the supported set in
// mobile/app/private_dashboard/settings.tsx (currently EN/FR/MG).
const LOCALE_MAP: Record<string, string> = {
  en: "en-GB",
  fr: "fr-FR",
  mg: "mg-MG",
  es: "es-ES",
  ar: "ar-MA",
};

export const activeLocale = (): string => LOCALE_MAP[i18n.language] ?? "en-GB";

export const formatDate = (
  d: Date | string | number,
  opts?: Intl.DateTimeFormatOptions,
): string => new Date(d).toLocaleDateString(activeLocale(), opts);

export const formatTime = (
  d: Date | string | number,
  opts?: Intl.DateTimeFormatOptions,
): string => new Date(d).toLocaleTimeString(activeLocale(), opts);

export const formatDateTime = (
  d: Date | string | number,
  opts?: Intl.DateTimeFormatOptions,
): string => new Date(d).toLocaleString(activeLocale(), opts);

export const formatMoney = (amount: number, currency: string): string => {
  try {
    return new Intl.NumberFormat(activeLocale(), {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    // Some currency codes can be rejected by older Intl impls; fall back to a
    // plain number with a currency suffix rather than throwing in render.
    return `${new Intl.NumberFormat(activeLocale()).format(amount)} ${currency}`;
  }
};
