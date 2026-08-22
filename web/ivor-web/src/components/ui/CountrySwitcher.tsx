"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Globe, Search } from "lucide-react";
import { ALL_COUNTRIES, useCountry } from "@/contexts/CountryContext";
import { COUNTRY_FLAGS } from "@/utils/countryDisplay";

/**
 * Global, always-visible country switcher for the admin section — lives in
 * the admin layout header, not per-page. A segmented control (tabs) only
 * reads well up to ~4 options; this is a searchable combobox instead, so it
 * scales the same way whether there are 3 countries or 30. Selecting here
 * persists (via CountryContext) across every admin page. This is the ONLY
 * country control anywhere in /admin — pages never hold their own local
 * copy or second dropdown, including for "All countries," which is a first
 * -class option here rather than a per-page workaround.
 */
export default function CountrySwitcher() {
  const { countries, activeCountry, setActiveCountry, loading } = useCountry();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const active = countries.find((c) => c.code === activeCountry);
  const isAll = activeCountry === ALL_COUNTRIES;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter(
      (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
    );
  }, [countries, query]);

  const showAllOption = "all countries".includes(query.trim().toLowerCase());

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 pl-3 pr-2.5 py-2 text-sm font-medium text-blue-900 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors disabled:opacity-50"
      >
        <Globe size={15} className="text-blue-500 dark:text-blue-400" />
        {loading ? (
          "Loading…"
        ) : isAll ? (
          <span>All countries</span>
        ) : active ? (
          <>
            <span>{COUNTRY_FLAGS[active.code] ?? ""}</span>
            <span>{active.name}</span>
            <span className="text-xs text-blue-400 dark:text-blue-600">({active.code})</span>
          </>
        ) : (
          "Select country"
        )}
        <ChevronDown size={14} className={`text-blue-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1.5 w-72 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg overflow-hidden">
          <div className="relative border-b border-gray-100 dark:border-gray-800 p-2">
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search countries…"
              className="w-full pl-7 pr-2 py-1.5 text-sm bg-transparent text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none"
            />
          </div>
          <ul className="max-h-72 overflow-y-auto py-1">
            {showAllOption && (
              <li
                onMouseDown={(e) => {
                  e.preventDefault();
                  setActiveCountry(ALL_COUNTRIES);
                  setOpen(false);
                  setQuery("");
                }}
                className={`flex items-center justify-between gap-2 px-3 py-2 text-sm cursor-pointer border-b border-gray-100 dark:border-gray-800 ${
                  isAll
                    ? "bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200"
                    : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                <span className="flex items-center gap-2">
                  <Globe size={13} className="text-gray-400" />
                  <span>All countries</span>
                </span>
                {isAll && <Check size={14} className="text-blue-600 dark:text-blue-400 shrink-0" />}
              </li>
            )}
            {filtered.length === 0 ? (
              <li className="px-3 py-4 text-center text-xs text-gray-400">No matching countries</li>
            ) : (
              filtered.map((c) => {
                const isActive = c.code === activeCountry;
                return (
                  <li
                    key={c.code}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setActiveCountry(c.code);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={`flex items-center justify-between gap-2 px-3 py-2 text-sm cursor-pointer ${
                      isActive
                        ? "bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200"
                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span>{COUNTRY_FLAGS[c.code] ?? ""}</span>
                      <span>{c.name}</span>
                      <span className="text-xs text-gray-400">{c.code} · {c.currency}</span>
                    </span>
                    {isActive && <Check size={14} className="text-blue-600 dark:text-blue-400 shrink-0" />}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
