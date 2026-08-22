"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { sectorAdmin, type Country } from "@/services/sectorAdmin";

const STORAGE_KEY = "admin_active_country";

// Sentinel for "no single country" — a real, first-class value the switcher
// itself can hold, not a per-page workaround. Never appears in `countries`
// (that list is always real country rows from the backend).
export const ALL_COUNTRIES = "ALL";

interface CountryContextValue {
  countries: Country[];
  loading: boolean;
  activeCountry: string;
  setActiveCountry: (code: string) => void;
}

const CountryContext = createContext<CountryContextValue | undefined>(undefined);

/**
 * Single source of truth for "which country is the platform admin working
 * in" across every /admin page — scoped to the admin layout, not the whole
 * app. Persisted to localStorage so it survives navigation between pages
 * and page reloads, instead of each page resetting to MU on every visit.
 *
 * There is exactly one country control in the admin UI: the switcher in the
 * layout header. Every page reads `activeCountry` straight from this
 * context — nothing keeps a local copy. Pages that can meaningfully show
 * data across every country (Employers, All Users, Compliance) treat
 * `activeCountry === ALL_COUNTRIES` as "no filter." Pages that fundamentally
 * require one concrete country (Payroll Rules, Sectors — a tax bracket set
 * or sector doesn't exist without a country) show a "pick a country above"
 * prompt instead of fetching when ALL_COUNTRIES is active.
 */
export function CountryProvider({ children }: { children: ReactNode }) {
  const [countries, setCountries] = useState<Country[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCountry, setActiveCountryState] = useState<string>("MU");

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (stored) setActiveCountryState(stored);

    sectorAdmin
      .listCountries()
      .then((list) => {
        setCountries(list);
        // If nothing was stored yet, or the stored code no longer exists
        // (e.g. deactivated), fall back to the first active country.
        // ALL_COUNTRIES is always valid — it isn't a row in `list`.
        setActiveCountryState((current) => {
          if (current === ALL_COUNTRIES) return current;
          if (list.some((c) => c.code === current)) return current;
          return list[0]?.code ?? "MU";
        });
      })
      .catch(() => setCountries([]))
      .finally(() => setLoading(false));
  }, []);

  const setActiveCountry = useCallback((code: string) => {
    setActiveCountryState(code);
    try {
      window.localStorage.setItem(STORAGE_KEY, code);
    } catch {
      /* private mode — in-memory only for this tab */
    }
  }, []);

  return (
    <CountryContext.Provider value={{ countries, loading, activeCountry, setActiveCountry }}>
      {children}
    </CountryContext.Provider>
  );
}

export function useCountry(): CountryContextValue {
  const ctx = useContext(CountryContext);
  if (!ctx) throw new Error("useCountry must be used within CountryProvider (admin layout only)");
  return ctx;
}
