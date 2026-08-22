/**
 * Single source for country flag/label display across admin UI. Adding a
 * new country's real name/flag here is the only edit needed — every
 * consumer (switcher, filters, detail pages, dashboard) reads from this,
 * not its own copy.
 */
export const COUNTRY_FLAGS: Record<string, string> = {
  MU: "🇲🇺",
  TZ: "🇹🇿",
  MG: "🇲🇬",
};

export const COUNTRY_NAMES: Record<string, string> = {
  MU: "Mauritius",
  TZ: "Tanzania",
  MG: "Madagascar",
};

// Operating currency per country — mirrors the backend Country.currency, so
// admin views that show ANOTHER company's money (not the viewer's own) can label
// it correctly. Keep in sync with the backend country seed.
export const COUNTRY_CURRENCIES: Record<string, string> = {
  MU: "MUR",
  TZ: "TZS",
  MG: "MGA",
};

/** The currency code for a country, or undefined if unknown. */
export function currencyForCountry(code: string | null | undefined): string | undefined {
  return code ? COUNTRY_CURRENCIES[code] : undefined;
}

export function countryLabel(code: string): string {
  const flag = COUNTRY_FLAGS[code];
  const name = COUNTRY_NAMES[code] ?? code;
  return flag ? `${flag} ${name}` : name;
}
