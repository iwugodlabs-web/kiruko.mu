"use client";

/**
 * Multi-select autocomplete for picking N companies by name / BRN / ID.
 *
 * Used on the ads form for the allow-list (`company_ids`) and block-list
 * (`exclude_company_ids`) — replacing the original "type a CSV of numeric
 * IDs" inputs which were hostile to anyone who hadn't memorized company
 * IDs. Backed by the same `getAdminCompanies` catalogue as
 * `AdvertiserPicker`; the dataset is small enough to filter client-side.
 *
 * Renders selected companies as a row of chips above the search input.
 * Tap × on a chip to remove it. Click a result row to add it.
 */

import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { getAdminCompanies } from '@/services/api';
import type { CompanySummary } from '@/services/api';

interface Props {
    value: number[];
    onChange: (ids: number[]) => void;
    placeholder?: string;
}

export default function CompanyMultiPicker({
    value,
    onChange,
    placeholder,
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

    // Resolve selected ids → CompanySummary for chip rendering. An id that
    // doesn't appear in the catalogue (e.g. deleted company) still renders
    // as a "#42" chip so the admin can see + remove it.
    const selected = useMemo(() => {
        return value.map((id) => {
            const hit = companies.find((c) => c.company_id === id);
            return hit ?? ({ company_id: id, company_name: `#${id}`, brn: '' } as CompanySummary);
        });
    }, [value, companies]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        const sel = new Set(value);
        const pool = companies.filter((c) => !sel.has(c.company_id));
        if (!q) return pool.slice(0, 30);
        return pool
            .filter(
                (c) =>
                    c.company_name.toLowerCase().includes(q) ||
                    (c.brn || '').toLowerCase().includes(q) ||
                    String(c.company_id).includes(q),
            )
            .slice(0, 30);
    }, [query, companies, value]);

    function add(id: number) {
        if (value.includes(id)) return;
        onChange([...value, id]);
        setQuery('');
        // Keep dropdown open so admin can add several in a row.
    }
    function remove(id: number) {
        onChange(value.filter((x) => x !== id));
    }

    return (
        <div className="relative">
            {/* Chip row — shown above the search field. */}
            {selected.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                    {selected.map((c) => (
                        <span
                            key={c.company_id}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200"
                        >
                            <span className="font-medium">{c.company_name}</span>
                            <span className="text-gray-400 dark:text-gray-500">#{c.company_id}</span>
                            <button
                                type="button"
                                onClick={() => remove(c.company_id)}
                                className="text-gray-400 dark:text-gray-500 hover:text-red-600 ml-0.5"
                                aria-label={`Remove ${c.company_name}`}
                            >
                                <X size={11} />
                            </button>
                        </span>
                    ))}
                </div>
            )}

            <div className="flex items-center px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg bg-white dark:bg-zinc-900">
                <Search size={14} className="text-gray-400 dark:text-gray-500 mr-2 shrink-0" />
                <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={
                        loading
                            ? 'Loading companies…'
                            : placeholder || 'Search by name, BRN, or ID'
                    }
                    disabled={loading}
                    className="w-full text-sm bg-transparent focus:outline-none"
                    onFocus={() => setOpen(true)}
                    onBlur={() => setTimeout(() => setOpen(false), 200)}
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
                <ul className="absolute z-20 left-0 right-0 mt-1 max-h-64 overflow-y-auto border border-gray-200 dark:border-gray-800 rounded-lg bg-white dark:bg-zinc-900 shadow-lg">
                    {filtered.length === 0 && (
                        <li className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">
                            {value.length > 0 ? 'No more matches.' : 'No match.'}
                        </li>
                    )}
                    {filtered.map((c) => (
                        <li
                            key={c.company_id}
                            onMouseDown={(e) => {
                                e.preventDefault(); // keep input focus so the dropdown stays open
                                add(c.company_id);
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
