"use client";

/**
 * Multi-select picker for departments across multiple companies (M14).
 *
 * Drives the optional `targeting.department_ids` field on an ad campaign.
 * Combined AND with `targeting.company_ids` on the serve side — an ad
 * targeting Acme + dept 5 only reaches Acme employees in dept 5.
 *
 * UX:
 *   - The parent passes the currently-selected allow-list company IDs.
 *   - We fetch each company's departments in parallel via GET
 *     /company/{id}/departments (public endpoint).
 *   - Results render grouped by company, prefixed with the company name
 *     so the admin can disambiguate same-named departments (every company
 *     has a "Sales" — without the prefix the chips would be ambiguous).
 *   - Empty selection means "all departments of the allow-listed companies."
 *
 * Why grouping matters: department_id is globally unique in the DB but
 * conceptually scoped to a company. An admin picking "Engineering" must
 * see WHICH company's Engineering. The grouped list makes that explicit.
 */

import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { getAdminCompanies, getDepartments } from '@/services/api';
import type { CompanySummary, ShowDepartment } from '@/services/api';

interface Props {
    /** Allow-list company IDs from the ad form. The picker only loads
     *  departments for these companies. Empty = picker self-disables. */
    companyIds: number[];
    value: number[];
    onChange: (ids: number[]) => void;
}

interface DeptWithCompany extends ShowDepartment {
    company_name: string;
}

export default function CrossCompanyDepartmentPicker({
    companyIds,
    value,
    onChange,
}: Props) {
    const [departments, setDepartments] = useState<DeptWithCompany[]>([]);
    const [loading, setLoading] = useState(false);
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);

    // Fetch the company catalogue once so we can attach company_name to
    // each dept for the grouped display.
    const [companies, setCompanies] = useState<CompanySummary[]>([]);
    useEffect(() => {
        getAdminCompanies(500, 0).then((res) => {
            if (!('error' in res)) setCompanies(res);
        });
    }, []);

    useEffect(() => {
        if (companyIds.length === 0) {
            setDepartments([]);
            return;
        }
        let cancelled = false;
        setLoading(true);
        Promise.all(
            companyIds.map((cid) =>
                getDepartments(cid).then((res) => {
                    if ('error' in res) {
                        // One company failing shouldn't kill the others.
                        return [] as ShowDepartment[];
                    }
                    return res;
                }),
            ),
        )
            .then((nestedLists) => {
                if (cancelled) return;
                const lookup = new Map(companies.map((c) => [c.company_id, c.company_name]));
                const flat: DeptWithCompany[] = nestedLists.flat().map((d) => ({
                    ...d,
                    company_name: lookup.get(d.company_id) || `#${d.company_id}`,
                }));
                setDepartments(flat);
            })
            .catch(() => toast.error('Could not load all departments.'))
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [companyIds, companies]);

    const selected = useMemo(() => {
        return value.map((id) => {
            const hit = departments.find((d) => d.department_id === id);
            return (
                hit ??
                ({
                    department_id: id,
                    name: `#${id}`,
                    company_id: -1,
                    company_name: '(unknown company)',
                } as DeptWithCompany)
            );
        });
    }, [value, departments]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        const sel = new Set(value);
        const pool = departments.filter((d) => !sel.has(d.department_id));
        if (!q) return pool.slice(0, 50);
        return pool
            .filter(
                (d) =>
                    d.name.toLowerCase().includes(q) ||
                    d.company_name.toLowerCase().includes(q) ||
                    String(d.department_id).includes(q),
            )
            .slice(0, 50);
    }, [query, departments, value]);

    function add(id: number) {
        if (value.includes(id)) return;
        onChange([...value, id]);
        setQuery('');
    }
    function remove(id: number) {
        onChange(value.filter((x) => x !== id));
    }

    if (companyIds.length === 0) {
        return (
            <div className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-900/40 rounded-lg border border-gray-200 dark:border-gray-800">
                Pick one or more companies in the allow-list above first —
                then their departments will appear here.
            </div>
        );
    }

    if (!loading && departments.length === 0) {
        return (
            <div className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-900/40 rounded-lg border border-gray-200 dark:border-gray-800">
                The allow-listed companies have no departments configured.
                Leave empty to target all their employees.
            </div>
        );
    }

    return (
        <div className="relative">
            {selected.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                    {selected.map((d) => (
                        <span
                            key={d.department_id}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200"
                        >
                            <span className="text-gray-500 dark:text-gray-400">{d.company_name}</span>
                            <span className="text-gray-300 dark:text-gray-600">/</span>
                            <span className="font-medium">{d.name}</span>
                            <button
                                type="button"
                                onClick={() => remove(d.department_id)}
                                className="text-gray-400 dark:text-gray-500 hover:text-red-600 ml-0.5"
                                aria-label={`Remove ${d.company_name}/${d.name}`}
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
                    placeholder={loading ? 'Loading departments…' : 'Search by department or company'}
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
                <ul className="absolute z-20 left-0 right-0 mt-1 max-h-72 overflow-y-auto border border-gray-200 dark:border-gray-800 rounded-lg bg-white dark:bg-zinc-900 shadow-lg">
                    {filtered.length === 0 && (
                        <li className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">
                            {value.length > 0 ? 'No more departments to add.' : 'No match.'}
                        </li>
                    )}
                    {filtered.map((d) => (
                        <li
                            key={d.department_id}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                add(d.department_id);
                            }}
                            className="px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm flex items-center justify-between"
                        >
                            <span>
                                <span className="text-gray-500 dark:text-gray-400">{d.company_name}</span>
                                <span className="text-gray-300 dark:text-gray-600 mx-1">/</span>
                                <span className="text-gray-900 dark:text-gray-100">{d.name}</span>
                            </span>
                            <span className="text-[10px] text-gray-400 dark:text-gray-500">#{d.department_id}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
