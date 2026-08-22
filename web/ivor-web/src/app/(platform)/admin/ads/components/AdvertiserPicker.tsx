"use client";

/**
 * Autocomplete combobox for selecting an advertiser company.
 *
 * Backed by `getAdminCompanies` — the admin listing endpoint (no tenant
 * filter). Loads the list once on mount; the dataset is small enough
 * (hundreds of rows) to filter client-side. Switch to server-side search
 * if/when the catalogue grows past a few thousand.
 */

import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { getAdminCompanies } from '@/services/api';
import type { CompanySummary } from '@/services/api';

interface Props {
    value: number | null;
    valueLabel: string;
    disabled?: boolean;
    onChange: (companyId: number | null, companyName: string) => void;
}

export default function AdvertiserPicker({
    value,
    valueLabel,
    disabled,
    onChange,
}: Props) {
    const [companies, setCompanies] = useState<CompanySummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);

    useEffect(() => {
        let cancelled = false;
        getAdminCompanies(500, 0)
            .then((res) => {
                if (cancelled) return;
                if ('error' in res) {
                    toast.error(`Could not load companies: ${res.error}`);
                    setCompanies([]);
                } else {
                    setCompanies(res);
                }
            })
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
    }, []);

    // Resolve label from id when we have the catalogue — covers the edit
    // case where parent only knows the id.
    const displayLabel = useMemo(() => {
        if (valueLabel) return valueLabel;
        if (value == null) return '';
        const hit = companies.find((c) => c.company_id === value);
        return hit ? hit.company_name : `#${value}`;
    }, [valueLabel, value, companies]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return companies.slice(0, 30);
        return companies
            .filter(
                (c) =>
                    c.company_name.toLowerCase().includes(q) ||
                    (c.brn || '').toLowerCase().includes(q) ||
                    String(c.company_id).includes(q),
            )
            .slice(0, 30);
    }, [query, companies]);

    if (value && !open) {
        return (
            <div className="flex items-center gap-2">
                <div className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg text-sm bg-gray-50 dark:bg-gray-900/40">
                    <span className="font-medium text-gray-900 dark:text-gray-100">{displayLabel}</span>
                    <span className="text-gray-400 dark:text-gray-500 text-xs ml-2">#{value}</span>
                </div>
                {!disabled && (
                    <button
                        type="button"
                        onClick={() => {
                            onChange(null, '');
                            setOpen(true);
                        }}
                        className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600"
                    >
                        Change
                    </button>
                )}
            </div>
        );
    }

    return (
        <div className="relative">
            <div className="flex items-center px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg bg-white dark:bg-zinc-900">
                <Search size={14} className="text-gray-400 dark:text-gray-500 mr-2 shrink-0" />
                <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={loading ? 'Loading companies…' : 'Search by name, BRN, or ID'}
                    disabled={loading || disabled}
                    className="w-full text-sm bg-transparent focus:outline-none"
                    onFocus={() => setOpen(true)}
                />
                {query && (
                    <button
                        type="button"
                        onClick={() => setQuery('')}
                        className="text-gray-400 dark:text-gray-500 hover:text-gray-700"
                    >
                        <X size={12} />
                    </button>
                )}
            </div>
            {open && !loading && (
                <ul className="absolute z-10 left-0 right-0 mt-1 max-h-64 overflow-y-auto border border-gray-200 dark:border-gray-800 rounded-lg bg-white dark:bg-zinc-900 shadow-lg">
                    {filtered.length === 0 && (
                        <li className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">No match.</li>
                    )}
                    {filtered.map((c) => (
                        <li
                            key={c.company_id}
                            // onMouseDown fires BEFORE the input's blur event,
                            // so the selection lands before focus loss can
                            // tear down the dropdown. preventDefault keeps
                            // input focus from changing during the click.
                            // Same pattern as CompanyMultiPicker — onClick
                            // here was racing with the focus change and
                            // silently never firing.
                            onMouseDown={(e) => {
                                e.preventDefault();
                                onChange(c.company_id, c.company_name);
                                setOpen(false);
                                setQuery('');
                            }}
                            className="px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm flex items-center justify-between"
                        >
                            <span className="text-gray-900 dark:text-gray-100">
                                {c.country_code ? `[${c.country_code}] ` : ""}{c.company_name}
                            </span>
                            <span className="text-[10px] text-gray-400 dark:text-gray-500">
                                {c.brn || `#${c.company_id}`}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
